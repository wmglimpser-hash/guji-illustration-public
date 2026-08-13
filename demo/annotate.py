"""
中医古籍插图 AI 标注脚本
支持：网络URL / 本地图片 / PDF自动截图
输出：JSONL 标注文件 + HTML 可视化报告

用法：
  python annotate.py --input sample_input.json --config config.json
  python annotate.py --input sample_input.json --config config.json --mock   # 无API key时测试
  python annotate.py --pdf path/to/file.pdf --config config.json             # 直接处理PDF

依赖安装：
  pip install requests pymupdf pillow openai --break-system-packages
"""

import argparse
import base64
import json
import os
import sys
import time
import traceback
from datetime import datetime
from io import BytesIO
from pathlib import Path

# 与 bridge.py 共用的 provider 端点表 / JSON 解析，避免两处漂移
sys.path.insert(0, str(Path(__file__).resolve().parent))
from vision_client import (
    call_vision_content, parse_annotation_json,
    image_part, text_part, VisionAPIError,
)

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ──────────────────────────────────────────────
# 1. 工具函数
# ──────────────────────────────────────────────

def load_config(config_path: str) -> dict:
    """加载配置文件，缺失时使用 mock 模式"""
    if config_path and Path(config_path).exists():
        with open(config_path, encoding="utf-8") as f:
            cfg = json.load(f)
        # 过滤注释键
        return {k: v for k, v in cfg.items() if not k.startswith("_")}
    print("[警告] 未找到 config.json，自动切换为 mock 模式")
    return {"api_provider": "mock", "model": "mock"}


JSON_SCHEMA = (
    '{"description":"对图像的简要描述",'
    '"academic_class":"疾病图/诊法图/医疗图/药物图/器具图/养生图/脏腑图/经穴图/部位图/理论图/符咒图/人物图/unknown",'
    '"academic_subclass":"对应细分类；【必填】有细分类的大类必须从其下细分类中选填一项，不得为null；器具图和符咒图无预设细分可填null",'
    '"image_type":"兼容旧格式：PLANT/ANIMAL/MINERAL/PROCESSED/HUMAN_BODY/MEDICAL_PRACTICE/LIFESTYLE/PERSON_SCENE/unknown",'
    '"confidence":"高/中/低",'
    '"content":{'
    '"main_subject":"主要描绘对象（优先从图上题签/标注直接读取；图上无文字时参考页面原文）",'
    '"herb_name_ancient":"繁体药名（第一优先：图上题签直接写出的字；图上无文字时参考页面原文，不确定填null）",'
    '"herb_name_modern":"现代规范名",'
    '"procedure_step":"炮制工序（第一优先：图上标注的工序文字；图上无标注时参考页面原文，不确定填null）",'
    '"plant_parts_shown":[],'
    '"drawing_style":"线描/彩绘/水墨/其他",'
    '"layout":"独版图/嵌入文中/多图同版/其他"},'
    '"image_quality":{"preservation":"良好/一般/残损","resolution_ok":true,"has_text_overlay":"有/无"},'
    '"text_in_image":"图中可识别的所有文字（逐字抄录，这是最直接的标注依据）",'
    '"text_image_relation":"一致/存疑/矛盾（图上文字与页面原文的关系；图上无文字则填存疑）",'
    '"text_image_note":"说明图上文字与页面原文是否对应，若页面原文与该插图无关请注明）",'
    '"annotation_note":"其他不确定之处",'
    '"corresponding_text":"从上下文原文中摘录与本插图最直接对应的完整描述段落；字符原文照录，不添加或修改标点；无字数限制；无明确对应则填null"}'
)


def build_context_prompt(page_context: str = "", has_full_page_image: bool = False) -> str:
    """
    根据可用的上下文构建 prompt。
    - page_context 非空：单图 + 文字上下文模式
    - has_full_page_image 为 True：双图模式（全页在前，裁图在后）
    - 否则：降级为仅凭图像模式
    """
    if page_context.strip():
        return (
            "你是中医古籍插图整理专家。\n\n"
            "【本页原文】（已从PDF提取，注意：古籍排版中页面文字不一定专属于当前插图）：\n"
            f"{page_context.strip()}\n\n"
            "标注步骤（严格按优先级执行）：\n"
            "1. 【第一步，最重要】仔细观察图像本身——识别图上直接题写的文字（题签、药名标注、"
            "图注、工序注释等）。将这些文字逐字记录到 text_in_image。"
            "图上的文字与该插图直接对应，是最可靠的一手依据。\n"
            "2. 【第二步】再对照本页原文——检查原文中是否出现了与图上文字相同或相关的词。"
            "若一致，视为双重验证（text_image_relation: 一致）；"
            "若原文无对应内容，图上文字仍为准（注明：原文无对应）；"
            "若原文与图上文字矛盾，填『矛盾』并在 text_image_note 说明差异。\n"
            "3. 【第三步】从本页原文中摘录与本插图最直接对应的完整描述段落，存入 corresponding_text；"
            "字符原文照录，不添加或修改标点；"
            "若上下文跨多页，有明确归属的只取属于本图的部分；"
            "若文字泛指全页或无法确定归属，填 null，不要猜测或改写原文。\n"
            "4. 【若图上无文字】herb_name_ancient / procedure_step 可参考原文提取，"
            "但须意识到原文可能属于相邻插图；不确定时填 null，confidence 降为『低』。\n\n"
            "核心原则：herb_name_ancient 和 procedure_step 优先从图上题签直接读取，"
            "页面原文仅作交叉验证，不是权威覆盖来源。\n\n"
            f"仅输出 JSON，不要输出其他文字：\n{JSON_SCHEMA}"
        )
    if has_full_page_image:
        return (
            "你是中医古籍插图整理专家。\n\n"
            "我将提供两张图像：\n"
            "・第一张：原书完整页面扫描图（用于全局布局参考）\n"
            "・第二张：从该页裁出的插图（标注对象，优先依据）\n\n"
            "标注步骤（严格按优先级执行）：\n"
            "1. 【第一步，最重要】仔细观察第二张图（插图本身）——"
            "识别图上直接题写的文字（题签、药名标注、图注等），逐字记录到 text_in_image。"
            "这些文字直接描述该插图，是最可靠的一手依据。\n"
            "2. 【第二步】观察第一张图（完整页面）——"
            "注意古籍排版特点：页面文字可能横跨多幅图或属于相邻文段，"
            "找出与该插图位置相邻的文字做交叉验证，而非直接以页面文字覆盖图上信息。\n"
            "3. herb_name_ancient / procedure_step 优先从第二张图上的题签直接读取；"
            "图上无文字时参考页面邻近文字，不确定则填 null，confidence 降为『低』。\n\n"
            f"仅输出 JSON，不要输出其他文字：\n{JSON_SCHEMA}"
        )
    # 降级：仅凭图像
    return (
        "你是中医古籍插图整理专家。分两步分析图像：\n"
        "【第一步】用1-3句描述图中内容（主体、文字、风格）。\n"
        f"【第二步】仅输出 JSON，不要输出其他文字：\n{JSON_SCHEMA}\n"
        "重要：herb_name_ancient 必须从图中文字直接读取；无法识别的字段填 null。"
    )


def load_sidecar_text(image_path: str) -> str:
    """
    查找与图像同名的 .txt 旁白文件作为页面文字上下文。
    例：extracted/buyi_p012.png → 同目录下 buyi_p012.txt
    """
    p = Path(image_path)
    txt = p.with_suffix(".txt")
    if txt.exists():
        return txt.read_text(encoding="utf-8").strip()
    return ""


def load_sidecar_full_page_image(image_path: str) -> bytes | None:
    """
    查找与裁图同目录的全页图 sidecar，供“双图上下文”模式使用。

    约定优先级：
    1. <stem>.page.png / .jpg / .jpeg / .webp
    2. <stem>_page.png / .jpg / .jpeg / .webp
    3. <stem>.full.png / .jpg / .jpeg / .webp
    4. <stem>_full.png / .jpg / .jpeg / .webp
    """
    p = Path(image_path)
    candidates = []
    for suffix in (".png", ".jpg", ".jpeg", ".webp"):
        candidates.extend([
            p.with_suffix(f".page{suffix}"),
            p.with_name(f"{p.stem}_page{suffix}"),
            p.with_suffix(f".full{suffix}"),
            p.with_name(f"{p.stem}_full{suffix}"),
        ])
    for candidate in candidates:
        if candidate.exists():
            return candidate.read_bytes()
    return None


def image_to_base64(image_bytes: bytes) -> str:
    """图像字节转base64字符串"""
    return base64.b64encode(image_bytes).decode("utf-8")


def fetch_url_image(url: str) -> bytes:
    """下载URL图像为字节"""
    import requests
    resp = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    return resp.content


def make_placeholder_image(label: str = "古籍插图") -> bytes:
    """生成带文字的占位图（mock模式用，无需网络）"""
    try:
        from PIL import Image, ImageDraw, ImageFont
        img = Image.new("RGB", (400, 300), color=(245, 240, 225))
        draw = ImageDraw.Draw(img)
        # 外框
        draw.rectangle([10, 10, 389, 289], outline=(180, 150, 100), width=3)
        draw.rectangle([18, 18, 381, 281], outline=(210, 185, 140), width=1)
        # 简单装饰线
        for y in [80, 220]:
            draw.line([(30, y), (370, y)], fill=(200, 170, 120), width=1)
        # 文字（中文显示依赖系统字体，fallback到英文）
        try:
            # 尝试系统中文字体
            import platform
            if platform.system() == "Windows":
                font_path = "C:/Windows/Fonts/simsun.ttc"
            else:
                font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            font_title = ImageFont.truetype(font_path, 24)
            font_sub = ImageFont.truetype(font_path, 14)
        except Exception:
            font_title = ImageFont.load_default()
            font_sub = font_title
        draw.text((200, 130), label, fill=(100, 70, 40), font=font_title, anchor="mm")
        draw.text((200, 165), "[ Mock Demo Image ]", fill=(160, 130, 90), font=font_sub, anchor="mm")
        draw.text((200, 185), "Replace with real scan URL or local file", fill=(180, 155, 110), font=font_sub, anchor="mm")
        buf = BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        # 极简fallback：返回1x1白色PNG
        return (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
                b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f'
                b'\x00\x00\x01\x01\x00\x05\x18\xd4n\x00\x00\x00\x00IEND\xaeB`\x82')


def load_local_image(path: str) -> bytes:
    """读取本地图像文件"""
    with open(path, "rb") as f:
        return f.read()


# ──────────────────────────────────────────────
# 2. PDF 图像提取
# ──────────────────────────────────────────────

def extract_images_from_pdf(pdf_path: str, pages: list = None, output_dir: str = "output/pdf_images") -> list:
    """
    从PDF中提取图像页面（每页作为一张图）
    返回：[{"image_id": ..., "image_bytes": ..., "page_num": ..., "source_text": ...}]
    """
    try:
        import fitz  # pymupdf
    except ImportError:
        print("[错误] 未安装 pymupdf，请运行：pip install pymupdf --break-system-packages")
        return []

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    results = []
    total_pages = len(doc)

    # 默认处理所有页，或指定页码（1-indexed）
    page_indices = [p - 1 for p in pages] if pages else range(total_pages)
    pdf_stem = Path(pdf_path).stem

    print(f"[PDF] 处理 {pdf_path}，共 {total_pages} 页，提取第 {list(page_indices)} 页")

    for idx in page_indices:
        if idx < 0 or idx >= total_pages:
            continue
        page = doc[idx]
        # 以 2x 分辨率渲染页面为图像（裁图用）
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")

        # 提取文字层（数字化PDF有效；扫描件返回空字符串）
        page_text = page.get_text("text").strip()
        page_text = " ".join(page_text.split())  # 规范化空白

        image_id = f"{pdf_stem}_p{idx+1:04d}"
        save_path = Path(output_dir) / f"{image_id}.png"
        with open(save_path, "wb") as f:
            f.write(img_bytes)

        # 同时保存文字层到旁白文件（供后续复查和 load_sidecar_text）
        if page_text:
            txt_path = save_path.with_suffix(".txt")
            txt_path.write_text(page_text, encoding="utf-8")

        results.append({
            "image_id": image_id,
            "source_type": "pdf_page",
            "page_num": idx + 1,
            "local_path": str(save_path),
            "image_bytes": img_bytes,
            "page_context": page_text,  # 文字上下文（扫描件为空）
        })
        ctx_note = f"文字层 {len(page_text)} 字" if page_text else "扫描件（无文字层）"
        print(f"  [PDF] 第 {idx+1} 页：{save_path}  [{ctx_note}]")

    doc.close()
    return results


# ──────────────────────────────────────────────
# 3. AI 标注接口
# ──────────────────────────────────────────────

def annotate_mock(image_bytes: bytes, prompt: str, image_id: str) -> dict:
    """Mock 模式：返回示例数据，用于无 API key 时演示"""
    import random
    types = ["PLANT", "ANIMAL", "HUMAN_BODY", "MEDICAL_PRACTICE", "MINERAL", "PROCESSED"]
    herbs = ["人參", "黃芪", "當歸", "川芎", "白朮"]
    return {
        "image_type": random.choice(types),
        "confidence": random.choice(["高", "中"]),
        "content": {
            "main_subject": random.choice(herbs),
            "herb_name_ancient": random.choice(herbs),
            "herb_name_modern": random.choice(["人参", "黄芪", "当归", "川芎", "白术"]),
            "plant_parts_shown": ["根", "茎", "叶"],
            "drawing_style": random.choice(["线描", "水墨"]),
            "layout": "图在上，文注在下"
        },
        "image_quality": {
            "preservation": random.choice(["良好", "一般"]),
            "resolution_ok": True,
            "has_text_overlay": "有"
        },
        "text_image_hints": "（Mock 模式，未调用真实 API）",
        "annotation_note": f"Mock 数据，image_id={image_id}",
        "_mock": True
    }


def annotate_gemini(image_bytes: bytes, prompt: str, api_key: str,
                    model: str = "gemini-1.5-flash",
                    full_page_bytes: bytes = None) -> dict:
    """调用 Google Gemini API 标注图像
    申请地址：aistudio.google.com（免费额度较大）
    支持模型：gemini-1.5-flash（快速便宜）/ gemini-1.5-pro（更准确）
    """
    try:
        import google.generativeai as genai
        from PIL import Image
    except ImportError:
        raise RuntimeError("请安装：pip install google-generativeai Pillow --break-system-packages")

    genai.configure(api_key=api_key)
    m = genai.GenerativeModel(model)
    parts = [prompt]
    if full_page_bytes:
        parts.append(Image.open(BytesIO(full_page_bytes)))
    parts.append(Image.open(BytesIO(image_bytes)))
    response = m.generate_content(parts)
    return parse_annotation_json(response.text)


def annotate_baidu(image_bytes: bytes, prompt: str, api_key: str,
                   model: str = "ERNIE-Bot-Vision",
                   full_page_bytes: bytes = None) -> dict:
    """调用百度文心 ERNIE-Vision API 标注图像
    申请地址：console.bce.baidu.com → 千帆大模型平台
    api_key 格式：ACCESS_TOKEN（需要先用 API_KEY + SECRET_KEY 换取）
    支持模型：ERNIE-Bot-Vision / ERNIE-4.0-Vision（部分需申请权限）
    """
    import requests
    b64 = image_to_base64(image_bytes)
    url = f"https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{model}"
    content = []
    if full_page_bytes:
        page_b64 = image_to_base64(full_page_bytes)
        content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{page_b64}"}})
    content.extend([
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        {"type": "text", "text": prompt},
    ])
    payload = {
        "messages": [
            {
                "role": "user",
                "content": content
            }
        ]
    }
    resp = requests.post(url, json=payload,
                         params={"access_token": api_key}, timeout=30)
    resp.raise_for_status()
    result = resp.json()
    if "result" in result:
        return parse_annotation_json(result["result"])
    raise RuntimeError(f"百度API错误：{result}")


def annotate_image(image_bytes: bytes, prompt: str, config: dict, image_id: str,
                   page_context: str = "", full_page_bytes: bytes = None) -> dict:
    """统一标注入口，根据配置选择 API。

    page_context: 页面文字上下文（PDF文字层提取 或 旁白文件内容）。
                  非空时自动替换 prompt 为图文对照版，并以文字为标注依据。
    full_page_bytes: 全页扫描图（扫描件无文字层时使用）。
                     非空时启用双图模式（全页 + 裁图）。
    """
    provider = config.get("api_provider", "mock")
    model = config.get("model", "mock")
    api_key = config.get("api_key", "")

    # 动态构建上下文感知 prompt（忽略传入的旧 prompt）
    effective_prompt = build_context_prompt(
        page_context=page_context,
        has_full_page_image=bool(full_page_bytes)
    )
    ctx_label = "文字上下文" if page_context else ("双图" if full_page_bytes else "仅图像")
    print(f"  [标注] {image_id} -> {provider}/{model}  上下文：{ctx_label}")

    _OPENAI_COMPAT = {"qwen", "openai", "kimi", "doubao", "zhipu"}

    if provider == "mock" or not api_key or api_key.startswith("YOUR_"):
        return annotate_mock(image_bytes, effective_prompt, image_id)
    elif provider in _OPENAI_COMPAT:
        parts = []
        if full_page_bytes:
            parts.append(image_part(b64=image_to_base64(full_page_bytes), mime="image/jpeg"))
        parts.append(image_part(b64=image_to_base64(image_bytes)))
        parts.append(text_part(effective_prompt))
        return parse_annotation_json(
            call_vision_content(provider, api_key, model, parts, max_tokens=1800)
        )
    elif provider == "gemini":
        return annotate_gemini(image_bytes, effective_prompt, api_key, model, full_page_bytes)
    elif provider == "baidu":
        return annotate_baidu(image_bytes, effective_prompt, api_key, model, full_page_bytes)
    else:
        raise ValueError(f"未知的 api_provider：{provider}")


# ──────────────────────────────────────────────
# 4. 主流程
# ──────────────────────────────────────────────

def process_input_file(input_path: str, config: dict, prompt: str, output_dir: str, mock: bool) -> list:
    """处理 input JSON 文件中的所有图像"""
    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    if mock:
        config["api_provider"] = "mock"

    results = []
    images = data.get("images", [])
    print(f"\n[任务] 项目：{data.get('project', '未命名')}")
    print(f"[任务] 共 {len(images)} 张图像待标注\n")

    for item in images:
        image_id = item.get("image_id", f"img_{len(results)+1:03d}")
        source_type = item.get("source_type", "url")
        source = item.get("source", "")

        print(f"[{len(results)+1}/{len(images)}] {image_id}（{source_type}）")

        is_mock_mode = config.get("api_provider", "mock") == "mock"

        try:
            # 获取图像字节
            if is_mock_mode:
                # mock 模式：用占位图，不访问网络/本地文件
                image_bytes = make_placeholder_image(item.get("image_id", "古籍插图"))
                print(f"  [Mock] 使用占位图（真实运行时替换为实际图片）")
            elif source_type == "url":
                image_bytes = fetch_url_image(source)
            elif source_type == "local_file":
                image_bytes = load_local_image(source)
            else:
                print(f"  [跳过] 不支持的来源类型：{source_type}")
                continue

            # 保存图像到 output
            img_save_path = Path(output_dir) / "images" / f"{image_id}.png"
            img_save_path.parent.mkdir(parents=True, exist_ok=True)
            with open(img_save_path, "wb") as f:
                f.write(image_bytes)

            # 加载页面文字上下文（优先级：JSON内置 > 旁白 .txt 文件）
            page_context = item.get("page_context", "").strip()
            if not page_context and source_type == "local_file":
                page_context = load_sidecar_text(source)
            # 加载全页图上下文（优先级：JSON显式 full_page_path > 约定式 sidecar 全页图）
            full_page_bytes = None
            full_page_path = item.get("full_page_path", "").strip()
            if full_page_path:
                full_page_bytes = load_local_image(full_page_path)
            elif source_type == "local_file":
                full_page_bytes = load_sidecar_full_page_image(source)

            if page_context:
                print(f"  [上下文] 文字层 {len(page_context)} 字")
            elif full_page_bytes:
                print(f"  [上下文] 全页图像上下文（双图模式）")
            else:
                print(f"  [上下文] 无（降级为仅图像模式）")

            # AI标注
            annotation = annotate_image(image_bytes, prompt, config, image_id,
                                        page_context=page_context,
                                        full_page_bytes=full_page_bytes)
            time.sleep(0.5)  # 避免API限频

            record = {
                "image_id": image_id,
                "source_text": item.get("source_text", ""),
                "page_ref": item.get("page_ref", ""),
                "page_context": page_context,          # 记录使用的原文上下文
                "full_page_path": full_page_path,
                "source_type": source_type,
                "source_url": source if source_type == "url" else "",
                "local_path": str(img_save_path),
                "annotation": annotation,
                "annotation_model": config.get("model", "mock"),
                "annotation_time": datetime.now().isoformat(),
                "human_verified": False,
                "human_note": ""
            }
            results.append(record)
            print(f"  [完成] {annotation.get('image_type', '?')} | "
                  f"主体：{annotation.get('content', {}).get('main_subject', '?')} | "
                  f"置信度：{annotation.get('confidence', '?')}")

        except Exception as e:
            print(f"  [失败] {e}")
            results.append({
                "image_id": image_id,
                "source_text": item.get("source_text", ""),
                "error": str(e),
                "annotation_time": datetime.now().isoformat()
            })

    # 处理 PDF 来源
    for pdf_item in data.get("pdf_sources", []):
        pdf_path = pdf_item.get("pdf_path", "")
        is_mock_mode = config.get("api_provider", "mock") == "mock"
        if not pdf_path or not Path(pdf_path).exists():
            if is_mock_mode:
                print(f"[PDF] Mock 模式跳过（文件不存在）：{pdf_path}")
            else:
                print(f"[PDF] 跳过（文件不存在）：{pdf_path}")
            continue
        pages = pdf_item.get("pages", None)
        source_text = pdf_item.get("source_text", Path(pdf_path).stem)
        pdf_images = extract_images_from_pdf(
            pdf_path, pages,
            output_dir=str(Path(output_dir) / "pdf_images")
        )
        for pi in pdf_images:
            pi["source_text"] = source_text
            page_context = pi.get("page_context", "")
            annotation = annotate_image(
                pi["image_bytes"], prompt, config, pi["image_id"],
                page_context=page_context
            )
            if config.get("api_provider", "mock") != "mock":
                time.sleep(0.5)  # 避免API限频
            record = {
                "image_id": pi["image_id"],
                "source_text": source_text,
                "page_ref": f"PDF第{pi['page_num']}页",
                "page_context": page_context,
                "source_type": "pdf_page",
                "local_path": pi["local_path"],
                "annotation": annotation,
                "annotation_model": config.get("model", "mock"),
                "annotation_time": datetime.now().isoformat(),
                "human_verified": False,
                "human_note": ""
            }
            results.append(record)

    return results


def process_pdf_direct(pdf_path: str, config: dict, prompt: str, output_dir: str, mock: bool) -> list:
    """直接处理PDF文件"""
    if mock:
        config["api_provider"] = "mock"
    pdf_images = extract_images_from_pdf(
        pdf_path, None,
        output_dir=str(Path(output_dir) / "pdf_images")
    )
    results = []
    for pi in pdf_images:
        page_context = pi.get("page_context", "")
        annotation = annotate_image(pi["image_bytes"], prompt, config, pi["image_id"],
                                    page_context=page_context)
        if config.get("api_provider", "mock") != "mock":
            time.sleep(0.5)  # 避免API限频
        record = {
            "image_id": pi["image_id"],
            "source_text": Path(pdf_path).stem,
            "page_ref": f"PDF第{pi['page_num']}页",
            "page_context": page_context,
            "source_type": "pdf_page",
            "local_path": pi["local_path"],
            "annotation": annotation,
            "annotation_model": config.get("model", "mock"),
            "annotation_time": datetime.now().isoformat(),
            "human_verified": False,
            "human_note": ""
        }
        results.append(record)
    return results


# ──────────────────────────────────────────────
# 5. HTML 报告生成
# ──────────────────────────────────────────────

def generate_html_report(results, output_dir, project_name="TCM Illustration Annotation"):
    import os
    import html as _html
    from pathlib import Path as _P
    from datetime import datetime as _dt
    gen_time = _dt.now().strftime("%Y-%m-%d %H:%M:%S")
    ok = [r for r in results if "annotation" in r]

    def esc(v):
        return _html.escape(str(v))

    cards = []
    for r in ok:
        ann = r.get("annotation", {})
        c = ann.get("content", {})
        q = ann.get("image_quality", {})
        img_path = r.get("local_path", "")
        # 修裂图：local_path 是相对/绝对路径，报告写在 output_dir 下，需转成相对 report.html 的 web 路径
        rel_src = ""
        if img_path:
            try:
                rel_src = os.path.relpath(img_path, output_dir)
            except Exception:
                rel_src = img_path
            rel_src = rel_src.replace("\\", "/")
        img_tag = f'<img src="{esc(rel_src)}" style="max-width:100%;max-height:200px">' if rel_src else ""
        ctx = r.get("page_context", "")
        ctx_html = (
            '<div class="ctx"><b>原文：</b>' + esc(ctx[:200]) + ("…" if len(ctx) > 200 else "") + "</div>"
        ) if ctx else ""
        rel = ann.get("text_image_relation", "")
        rel_color = {"一致": "#4caf50", "存疑": "#ff9800", "矛盾": "#f44336"}.get(rel, "#9e9e9e")
        rel_badge = (
            '<span class="badge" style="background:' + rel_color + '">' + esc(rel) + "</span>"
        ) if rel else ""
        itype = ann.get("image_type", "?")
        img_id = r.get("image_id", "")
        confidence = ann.get("confidence", "")
        note = ann.get("annotation_note", "") or ""
        text_note = ann.get("text_image_note", "") or ""
        annotation_model = r.get("annotation_model", "") or ""
        annotation_time = r.get("annotation_time", "") or ""

        # 所有动态字段（含 AI 输出、原文照录）一律转义，杜绝破版/HTML 注入
        def fv(v):
            return esc(v) if v not in (None, "") else "—"

        card = (
            '<div class="card">'
            '<div class="card-img">' + img_tag + "</div>"
            '<div class="card-body">'
            '<div class="card-title">' + esc(img_id) +
            ' <span class="badge" style="background:#2196f3">' + esc(itype) + "</span>" +
            rel_badge + "</div>"
            '<table class="info-table">'
            "<tr><td>标注模型</td><td>" + fv(annotation_model) + "</td></tr>"
            "<tr><td>标注时间</td><td>" + fv(annotation_time) + "</td></tr>"
            "<tr><td>主体</td><td>" + fv(c.get("main_subject")) + "</td></tr>"
            "<tr><td>药名（古）</td><td>" + fv(c.get("herb_name_ancient")) + "</td></tr>"
            "<tr><td>炮制工序</td><td>" + fv(c.get("procedure_step")) + "</td></tr>"
            "<tr><td>图文关系</td><td>" + fv(rel) + " — " + fv(text_note) + "</td></tr>"
            "<tr><td>置信度</td><td>" + fv(confidence) + "</td></tr>"
            "<tr><td>保存状态</td><td>" + fv(q.get("preservation")) + "</td></tr>"
            "<tr><td>来源页</td><td>" + fv(r.get("page_ref")) + "</td></tr>"
            "</table>" +
            ctx_html +
            '<div class="note">' + esc(note) + "</div>"
            "</div></div>"
        )
        cards.append(card)

    style = (
        "body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#f5f6f8;color:#333;margin:0}"
        ".header{background:linear-gradient(135deg,#1a3a5c,#2e6da4);color:#fff;padding:28px 40px}"
        ".header h1{font-size:1.5rem;font-weight:600}"
        ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px;padding:24px 40px}"
        ".card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}"
        ".card-img{background:#f0ece0;text-align:center;padding:12px;min-height:80px}"
        ".card-body{padding:16px}"
        ".card-title{font-size:1rem;font-weight:600;margin-bottom:10px}"
        ".badge{display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;font-size:.78rem;margin:0 2px}"
        ".info-table{width:100%;border-collapse:collapse;font-size:.85rem;margin:6px 0}"
        ".info-table td{padding:3px 6px;border-bottom:1px solid #f0ede4;vertical-align:top}"
        ".info-table td:first-child{color:#888;white-space:nowrap;width:80px}"
        ".ctx{background:#fffbf0;border-left:3px solid #d4a030;padding:8px 10px;font-size:.8rem;color:#555;margin-top:8px}"
        ".note{color:#888;font-size:.8rem;margin-top:8px}"
    )

    html = (
        "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>"
        "<title>" + esc(project_name) + "</title>"
        "<style>" + style + "</style></head><body>"
        '<div class="header"><h1>' + esc(project_name) + "</h1>"
        "<p>生成时间：" + gen_time + " | 共 " + str(len(results)) + " 条 | 已标注 " + str(len(ok)) + " 条 | 报告内逐条显示标注模型</p>"
        "</div>"
        '<div class="grid">' + "\n".join(cards) + "</div>"
        "</body></html>"
    )

    out = _P(output_dir) / "report.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"[报告] HTML -> {out}")
    return str(out)


def save_jsonl(results, output_dir):
    import json as _json
    from pathlib import Path as _P
    out_path = _P(output_dir) / "annotations.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        for r in results:
            row = {k: v for k, v in r.items() if k != "image_bytes"}
            f.write(_json.dumps(row, ensure_ascii=False) + "\n")
    print(f"[保存] JSONL -> {out_path}")
    return str(out_path)


def main():
    import argparse
    from pathlib import Path as _P
    parser = argparse.ArgumentParser(description="TCM Illustration Annotator")
    parser.add_argument("--input", "-i", default="sample_input.json")
    parser.add_argument("--config", "-c", default="config.json")
    parser.add_argument("--pdf", default=None)
    parser.add_argument("--mock", action="store_true")
    parser.add_argument("--output", "-o", default="output")
    parser.add_argument("--prompt", default="prompt.txt")
    args = parser.parse_args()

    config = load_config(args.config)
    if args.mock:
        config["api_provider"] = "mock"

    provider = config.get("api_provider", "mock")
    model = config.get("model", "?")
    print(f"[Mode] {provider}/{model}")
    print("[Info] context: PDF text layer > sidecar .txt > image-only (fallback)\n")

    prompt = ""
    _P(args.output).mkdir(parents=True, exist_ok=True)

    if args.pdf:
        results = process_pdf_direct(args.pdf, config, prompt, args.output, args.mock)
    else:
        results = process_input_file(args.input, config, prompt, args.output, args.mock)

    if not results:
        print("[Warning] No images processed.")
        return

    jsonl_path = save_jsonl(results, args.output)
    project_name = "TCM Illustration Annotation"
    try:
        import json as _json
        with open(args.input, encoding="utf-8") as f:
            project_name = _json.load(f).get("project", project_name)
    except Exception:
        pass
    report_path = generate_html_report(results, args.output, project_name)
    print(f"\nDone!\n  JSONL  : {jsonl_path}\n  Report : {report_path}")


if __name__ == "__main__":
    main()
