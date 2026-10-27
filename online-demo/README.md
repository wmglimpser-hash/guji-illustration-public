# 医图志 · 标注系统在线 Demo

以公开工作台前端为基础，提供预置案例交互体验。

- 案例：《补遗雷公炮制便览》卷3第20—21页，甘草、炮製甘草两条图项。
- 操作：校文保存、框选裁图、查看预置 AI 候选、修改字段、选择修改原因、审核确认。
- 修改保存在当前浏览器，可导出体验记录或一键重置。
- AI 候选和 OCR 底稿均为预置结果。完整导入、OCR 和模型调用在本地系统中运行。

## 本地预览

在本目录执行 `python3 -m http.server 7910 --bind 127.0.0.1`，打开 http://127.0.0.1:7910/ 。

## Vercel 部署

将本目录内容放入公开仓库的 `online-demo/`，在 Vercel 导入该仓库。

- Framework Preset：Other
- Root Directory：online-demo
- Build Command：留空
- Output Directory：.
- Environment Variables：无需配置

部署成功并实际检查后，把真实网址加入仓库首页。

## 来源

[项目源码](https://github.com/wmglimpser-hash/guji-illustration-public)，前端基础版本 `ca4662254511d1bd65586ceb8ff5b087cb291de5`。代码遵循 MIT 许可证。

[成果展示](https://yituzhi.cn/)
