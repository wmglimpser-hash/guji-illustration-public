"""统一视觉模型调用客户端。

bridge.py（REST 代理）与 annotate.py（CLI）共用本模块，集中三处历史上易漂移的逻辑：
  1. provider → 端点 URL 映射（PROVIDER_BASE_URLS / provider_chat_url）
  2. OpenAI 兼容的多模态请求发送（call_vision_content）
  3. 从模型回复中抽取 JSON（parse_annotation_json）

本模块不依赖 Flask，可被任意脚本导入。
"""
import json
import re

# provider → API base url（chat/completions 由 provider_chat_url 拼出）
PROVIDER_BASE_URLS = {
    "qwen":     "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "deepseek": "https://api.deepseek.com",
    "openai":   "https://api.openai.com/v1",
    "kimi":     "https://api.moonshot.cn/v1",
    "doubao":   "https://ark.cn-beijing.volces.com/api/v3",
    "zhipu":    "https://open.bigmodel.cn/api/paas/v4",
    "gemini":   "https://generativelanguage.googleapis.com/v1beta/openai",
    "baidu":    "https://aip.baidubce.com/rpc/2.0/ai_custom/v1",
}

# 当前不支持图像输入的 provider（统一在一处声明，避免各端点各写一份判断）
NO_VISION_PROVIDERS = {"deepseek"}
DEEPSEEK_NO_VISION_MSG = (
    "DeepSeek 官方当前仅公开文本模型接口，无法执行本项目所需的图像任务。"
    "请切换到支持视觉输入的提供商。"
)


def provider_chat_url(provider):
    """返回某 provider 的 chat/completions 端点；未知 provider 返回 None。"""
    base = PROVIDER_BASE_URLS.get(provider)
    return base + "/chat/completions" if base else None


def supports_vision(provider):
    return provider not in NO_VISION_PROVIDERS


class VisionAPIError(RuntimeError):
    """携带 HTTP 状态码与响应体的调用错误，便于上层记录失败日志。"""
    def __init__(self, message, status_code=None, response_text=""):
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text


def image_part(*, b64=None, url=None, mime="image/png"):
    """构造一个 image_url 内容块。b64 优先；都没有返回 None。"""
    if b64:
        return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
    if url:
        return {"type": "image_url", "image_url": {"url": url}}
    return None


def text_part(text):
    return {"type": "text", "text": text}


def call_vision_content(provider, api_key, model, content_parts,
                        *, max_tokens=1800, timeout=120, return_metadata=False):
    """向 OpenAI 兼容端点发送一条多模态 user 消息，返回回复正文字符串。

    失败时抛 VisionAPIError（含 status_code / response_text）。
    """
    import requests as req

    if provider in NO_VISION_PROVIDERS:
        raise VisionAPIError(DEEPSEEK_NO_VISION_MSG)
    url = provider_chat_url(provider)
    if not url:
        raise VisionAPIError(f"Unsupported provider: {provider}")

    resp = req.post(
        url,
        headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
        json={"model": model,
              "messages": [{"role": "user", "content": content_parts}],
              "max_tokens": max_tokens},
        timeout=timeout,
    )
    if resp.status_code != 200:
        raise VisionAPIError(
            f"API error {resp.status_code}: {resp.text[:300]}",
            status_code=resp.status_code,
            response_text=resp.text,
        )
    payload = resp.json()
    choice = payload["choices"][0]
    content = choice["message"]["content"]
    if return_metadata:
        return {
            "content": content,
            "finish_reason": choice.get("finish_reason", ""),
            "usage": payload.get("usage") or {},
        }
    return content


def parse_annotation_json(text):
    """从模型回复中抽取 JSON。失败时返回带 parse_failed=True 的兜底字典。"""
    m = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', text)
    if m:
        text = m.group(1)
    else:
        s = text.find("{")
        e = text.rfind("}")
        if s != -1 and e != -1:
            text = text[s:e + 1]
    try:
        return json.loads(text)
    except Exception:
        return {
            "parse_failed": True,
            "image_type": "unknown",
            "confidence": "low",
            "content": {"main_subject": "parse failed, see raw_text"},
            "raw_text": text[:500],
        }
