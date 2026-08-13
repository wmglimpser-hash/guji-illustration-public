# 公开内容清单

本镜像采用白名单发布方式。

| 路径 | 内容 |
|---|---|
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
