"""古籍图像增强 / 修复（从 bridge.py 拆出）。

纯计算模块，不依赖 Flask。重依赖（cv2 / numpy / PIL / realesrgan / dashscope）
均在函数内部按需 import，未安装时只在对应模式调用时报错，不影响 bridge 启动。

对外函数：
  restore_combined / restore_document / get_realesrgan / correct_yellow
  restore_with_gen_api（通义万象生图修复，结果带「AI增强·仅展示」水印）
"""
import base64
import threading

_realesrgan_model = None
_realesrgan_ok    = None   # None=未检测, True=可用, False=不可用
_realesrgan_lock  = threading.Lock()   # 防 Flask 多线程下双重初始化


def get_realesrgan():
    """懒加载 Real-ESRGAN，首次调用自动下载权重（约 67 MB）。线程安全。"""
    global _realesrgan_model, _realesrgan_ok
    # 快路径：已就绪/已知不可用，无需加锁
    if _realesrgan_model is not None:
        return _realesrgan_model
    if _realesrgan_ok is False:
        raise RuntimeError("realesrgan 未安装，请运行：pip install realesrgan basicsr")
    with _realesrgan_lock:
        # 双重检查：可能在等锁期间已被别的线程初始化
        if _realesrgan_model is not None:
            return _realesrgan_model
        if _realesrgan_ok is False:
            raise RuntimeError("realesrgan 未安装，请运行：pip install realesrgan basicsr")
        return _init_realesrgan()


def _init_realesrgan():
    global _realesrgan_model, _realesrgan_ok
    try:
        from realesrgan import RealESRGANer
        from basicsr.archs.rrdbnet_arch import RRDBNet
        model = RRDBNet(num_in_ch=3, num_out_ch=3,
                        num_feat=64, num_block=6, num_grow_ch=32, scale=4)
        weights_url = (
            "https://github.com/xinntao/Real-ESRGAN/releases/download/"
            "v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
        )
        _realesrgan_model = RealESRGANer(
            scale=4, model_path=weights_url, model=model,
            tile=512, tile_pad=10, pre_pad=0, half=False,
        )
        _realesrgan_ok = True
        print("[restore] Real-ESRGAN 模型加载成功")
        return _realesrgan_model
    except ImportError:
        _realesrgan_ok = False
        raise RuntimeError("realesrgan 未安装，请运行：pip install realesrgan basicsr")


def correct_yellow(bgr_np):
    """白平衡校正：抑制古籍纸张泛黄色偏（R↓ B↑）。"""
    import numpy as np
    f = bgr_np.astype(np.float32)
    f[:, :, 0] = np.clip(f[:, :, 0] * 1.04, 0, 255)  # B 微升
    f[:, :, 1] = np.clip(f[:, :, 1] * 0.97, 0, 255)  # G 微降
    f[:, :, 2] = np.clip(f[:, :, 2] * 0.92, 0, 255)  # R 降（泛黄主要在红通道）
    return f.astype(np.uint8)


def restore_combined(img_np, de_yellow, sharpen):
    """组合增强：LAB 背景归一化（保留色彩）→ Real-ESRGAN ×2 → 锐化。
    适合同时含插图和文字的古籍页面。"""
    import cv2
    import numpy as np

    lab = cv2.cvtColor(img_np, cv2.COLOR_BGR2LAB).astype(np.float32)
    l   = lab[:, :, 0]
    sigma = max(l.shape) * 0.04
    bg    = cv2.GaussianBlur(l, (0, 0), sigmaX=sigma)
    l_norm = np.clip(l / (bg + 1e-6) * 220, 0, 255)
    l_uint8 = l_norm.astype(np.uint8)
    clahe   = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_final = clahe.apply(l_uint8).astype(np.float32)
    lab[:, :, 0] = l_final
    enhanced = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)

    if de_yellow:
        enhanced = correct_yellow(enhanced)

    upsampler = get_realesrgan()
    output, _ = upsampler.enhance(enhanced, outscale=2)

    if sharpen > 0:
        blur   = cv2.GaussianBlur(output, (0, 0), sigmaX=1.2)
        output = cv2.addWeighted(output, 1 + sharpen, blur, -sharpen, 0)
        output = np.clip(output, 0, 255).astype(np.uint8)
    return output


def restore_document(img_np, scale, de_yellow, sharpen):
    """古籍文档增强：背景归一化 + CLAHE 局部对比度 + 锐化。"""
    import cv2
    import numpy as np

    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sigma = max(gray.shape) * 0.04
    bg    = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma)
    norm = np.clip(gray / (bg + 1e-6) * 220, 0, 255).astype(np.uint8)

    clahe   = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(norm)

    if sharpen > 0:
        blurred  = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=1.2)
        enhanced = cv2.addWeighted(enhanced, 1 + sharpen, blurred, -sharpen, 0)
        enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)

    if scale > 1:
        h, w     = enhanced.shape
        enhanced = cv2.resize(enhanced, (w * scale, h * scale),
                              interpolation=cv2.INTER_LANCZOS4)
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def _add_display_watermark(pil_img):
    """在图像右下角加「AI增强·仅展示」水印，明确标注非原始图像。"""
    from PIL import ImageDraw, ImageFont
    draw = ImageDraw.Draw(pil_img)
    text = "AI增强·仅展示"
    w, h = pil_img.size
    font_size = max(12, int(min(w, h) * 0.025))
    try:
        font = ImageFont.truetype("msyh.ttc", font_size)
    except Exception:
        try:
            font = ImageFont.truetype("simhei.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    margin = max(8, font_size // 2)
    x, y   = w - tw - margin, h - th - margin
    draw.rectangle([x - 4, y - 3, x + tw + 4, y + th + 3], fill=(0, 0, 0, 140))
    draw.text((x, y), text, fill=(255, 220, 80), font=font)
    return pil_img


def restore_with_gen_api(img_np, de_yellow, api_key):
    """qwen-image-2.0 图像修复（MultiModalConversation SDK）。
    仅用于展示，结果带水印，不可替代原始标注图像。"""
    import cv2, io, os, tempfile
    import requests as req
    from PIL import Image

    if de_yellow:
        img_np = correct_yellow(img_np)
    h, w = img_np.shape[:2]
    if min(h, w) < 512:
        s = 512 / min(h, w)
        img_np = cv2.resize(img_np, (int(w * s), int(h * s)), interpolation=cv2.INTER_LANCZOS4)
        h, w = img_np.shape[:2]
    if max(h, w) > 4096:
        s = 4096 / max(h, w)
        img_np = cv2.resize(img_np, (int(w * s), int(h * s)), interpolation=cv2.INTER_LANCZOS4)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            tmp_path = f.name
        Image.fromarray(img_np[:, :, ::-1]).save(tmp_path, format="PNG")

        import dashscope
        from dashscope import MultiModalConversation
        dashscope.api_key           = api_key
        dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"

        messages = [{
            "role": "user",
            "content": [
                {"image": f"file://{tmp_path}"},
                {"text": ("高清修复这张古代中医典籍木版插图，"
                          "增强墨线清晰度，净化纸张背景，"
                          "保持所有文字和图像内容与原图完全一致，"
                          "线条清晰锐利，笔画准确无误。")},
            ],
        }]

        resp = MultiModalConversation.call(
            api_key=api_key, model="qwen-image-2.0", messages=messages,
            result_format="message", stream=False, n=1, watermark=False,
            negative_prompt="模糊，变形，添加内容，修改文字，现代风格，低质量",
        )
        if resp.status_code != 200:
            raise RuntimeError(f"API 调用失败 {resp.status_code}：{resp.message}")

        content = resp.output.choices[0].message.content
        img_url = None
        for item in (content if isinstance(content, list) else [content]):
            if isinstance(item, dict):
                img_url = item.get("image") or item.get("image_url") or img_url
        if not img_url:
            raise RuntimeError(f"响应中未找到图像，原始响应：{str(resp.output)[:300]}")

        ir = req.get(img_url, timeout=30)
        ir.raise_for_status()
        pil_out = Image.open(io.BytesIO(ir.content)).convert("RGBA")
        pil_out = _add_display_watermark(pil_out).convert("RGB")
        buf_out = io.BytesIO()
        pil_out.save(buf_out, format="JPEG", quality=92)
        return base64.b64encode(buf_out.getvalue()).decode(), pil_out.size
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
