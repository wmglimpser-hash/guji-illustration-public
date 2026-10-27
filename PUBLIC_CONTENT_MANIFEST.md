# 公开内容清单

本镜像采用白名单发布方式。

| 路径 | 内容 |
|---|---|
| `online-demo/` | 真实工作台前端的浏览器案例版；仅卷3第20—21页及甘草、炮製甘草两条预置候选 |
| `demo/` | 标注、校文与数据管理工作台代码；不含运行时数据 |
| `showcase/` | 只读展示站代码；不含真实展示数据和样例扫描图 |
| `specs/` | 对外公开的现行分类体系规范；内部重标注、评价和素材桥接契约不在镜像内 |
| `scripts/` | 启动与公开展示包构建辅助脚本 |

公开镜像明确排除：`paper/`、`research/`、`evaluation/`、`demo/data/`、`demo/data_archives/`、`showcase/data/`、`showcase/samples/`、内部任务和交接文档。

新增文件进入公开镜像前，应同时满足：无密钥、无个人信息、无本地绝对路径、无投稿中论文、无未发布研究数据、无权利状态不明的扫描图。

公开版本以 GitHub Release 标签为准。每次发布应记录对应提交号，并重新执行白名单、敏感信息和相对链接检查。

提交前运行：

```bash
python scripts/verify_public_mirror.py
```

## 在线案例资产白名单

仅以下四个图像文件按 SHA-256 放行；其它图像与生产目录仍由发布检查拒绝。

| 文件 | SHA-256 |
|---|---|
| `online-demo/assets/gancao-process.jpg` | `c3e64e028a34f67556c17668cb285e744d59166245031751071537ead4a9f3db` |
| `online-demo/assets/gancao.jpg` | `69b163cafeabc8e71c5b58b11a94d6305cfb71d15103f9d3383fdad055de5ef5` |
| `online-demo/assets/page-20.jpg` | `9ac468b12db4a1b099b6c37d77dce3c5c0a562b4052f4ee81c81343c35c4b376` |
| `online-demo/assets/page-21.jpg` | `a5d330d008d0e7a18e870684c3a7babbb0520bccf5a15b32b074b492c88e9d78` |
