"""
download_pdfjs.py — 一次性下载 pdf.js 到本地 static/
运行后 index.html 无需网络即可解析真实 PDF。

用法：
    cd guji-illustration/demo
    python download_pdfjs.py
"""

import urllib.request
import pathlib
import sys

VERSION = "3.11.174"
BASE    = f"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/{VERSION}"
FILES   = {
    "pdf.min.js":        f"{BASE}/pdf.min.js",
    "pdf.worker.min.js": f"{BASE}/pdf.worker.min.js",
}

dest = pathlib.Path(__file__).parent / "static"
dest.mkdir(exist_ok=True)

for fname, url in FILES.items():
    out = dest / fname
    if out.exists():
        print(f"[OK] 已存在，跳过：static/{fname}")
        continue
    print(f"[DOWN] 下载 {url} ...", end=" ", flush=True)
    try:
        urllib.request.urlretrieve(url, out)
        size_kb = out.stat().st_size // 1024
        print(f"完成（{size_kb} KB）")
    except Exception as e:
        print(f"失败：{e}")
        sys.exit(1)

print("\n[OK] pdf.js 本地依赖已就绪（static/ 目录）")
print("   启动服务：python bridge.py")
print("   浏览器访问：http://localhost:5678/")
