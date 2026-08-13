#!/usr/bin/env python3
"""带 no-cache 头的静态文件服务器（本地开发用）。

用法: python scripts/serve_static_nocache.py <port> <directory>

普通 `python -m http.server` 不发 Cache-Control，浏览器会缓存 .js/.css；
改了文件后普通刷新仍可能跑旧版（showcase 迭代时反复踩这个坑）。本服务对所有
响应加 `Cache-Control: no-store`，迭代时普通刷新即拿最新。

仅用于本地开发预览，不用于生产部署（GitHub Pages 自有缓存策略）。
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7901
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(NoCacheHandler, directory=directory)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"[no-cache] static server on http://0.0.0.0:{port}  dir={directory}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
