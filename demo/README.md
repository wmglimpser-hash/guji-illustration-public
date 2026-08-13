# 中医古籍插图 AI 辅助标注工具

> **唯一正确入口**：通过 `bridge.py` 启动本地服务，用浏览器访问 `http://localhost:5678/`。  
> 不要直接双击打开 `index.html`——file:// 协议下 pdf.js 无法正常工作，AI 请求也无法发出。

---

## 快速启动

### 首次运行

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 下载 pdf.js（仅首次，需联网，约 2 MB）
python download_pdfjs.py

# 3. 配置 AI 接口
cp config.example.json config.json
# 用文本编辑器打开 config.json，填写 api_provider 和 api_key
```

### 日常启动

```bash
python bridge.py
```

终端出现 `* Running on http://0.0.0.0:5678` 后，浏览器打开：

**http://localhost:5678/**

---

## 数据存储位置

所有数据保存在本地，关闭浏览器或重启 bridge.py **不会丢失数据**：

demo/data/
  global.json              # 项目级信息
  books/
    book_<id>/
      book.json            # 书籍元信息（标题、总页数等）
      images.json          # 该书所有标注图片及审核状态
      book.pdf             # 上传的原始 PDF
    group_<id>/
      group.json           # 书籍组信息（合并多卷时生成）
      pdfs/                # 各卷 PDF 副本
```

### 插图素材源导出

在“图片列表 → 导出源素材”任务中，可把已确认插图从原始 PDF 按已确认裁图重新导出，交给后续分层素材制作；它不会修改标注数据。需要先设置素材根目录：

```powershell
# 在 illustration\demo 目录运行时
$env:TCM_ILLUSTRATION_ASSET_ROOT=(Resolve-Path ..\paozhifang\art_2d).Path
python bridge.py
```

从仓库根目录运行 `启动标注系统.cmd` 时，如未设置变量，脚本会自动采用 `paozhifang\art_2d`。每个包位于：

```text
<ASSET_ROOT>/_sources/<source_id>/<source_revision>/
  manifest.json  source.png  preview.webp  context-page.jpg  annotation.json
```

公开镜像保留 `layer-package-v1` 的运行代码和目录约定；内部素材桥接契约未随公开镜像发布。实现行为以本目录代码、接口校验和上面的目录结构为准。

下游完成分层后，将合规 `layer-package.json` 与预览、图层 PNG 放入：

```text
<ASSET_ROOT>/_packages/<source_id>/<package_id>/
```

下游 Agent 仍按既有 `layer-package-v1` 流程直接读取上述素材目录，制作分层包并放入
`_packages/<source_id>/<package_id>/`。标注系统已有的扫描、独立审查与 `asset-links.json` 存储边界不变；本次只把日常的**源素材导出入口**移到“图片列表”，不会写回 `images.json` 或任何标注字段。

---

## 界面说明

```
┌─────────────┬──────────────────────────┬────────────────┐
│  左侧面板    │       主视图              │   右侧面板      │
│             │                          │                │
│ 图片列表     │  首页 / 书籍页面          │ 来源           │
│ 书籍 [N]    │  图片标注工作台           │ 标注信息        │
│             │  批量处理监控             │ 统计           │
│             │                          │ 📗 书籍        │
└─────────────┴──────────────────────────┴────────────────┘
```

---

## 功能概览

### 书籍管理（左侧「书籍」标签）

| 操作 | 说明 |
|------|------|
| **导入新书籍** | 上传 PDF，自动建立页面索引 |
| **点击书卡** | 右侧面板显示封面预览 + 统计，不跳转主视图 |
| **进入书籍 →** | 从右侧预览进入，浏览各页 |
| **🔗 合并** | 选中多本书合并为书籍组（适用于多卷本） |

### 书籍组（多卷合并后）

| 操作 | 说明 |
|------|------|
| **点击 ▼** | 收起 / 展开该组下的各卷列表 |
| **点击组名** | 右侧面板编辑书籍组信息（朝代、版本、总介绍） |
| **点击卷名** | 切换到单卷预览 |

### 标注工作流（六步）

1. **导入书籍** — 上传 PDF，设置全书统一裁切框
2. **准备文字** — 提取 PDF 文字层，或手动输入原文对照
3. **识别候选页** — 全书扫描，标记含插图页面
4. **AI 标注** — 逐张发送 AI，生成图像类型 / 炮制工序 / 图文互证结论
5. **专家核查** — 检查 AI 草稿，修改确认（ai_draft 与终稿独立保存）
6. **导出** — 输出 JSONL / CSV / HTML 报告；或在「标注数据管理」页点
   **🚀 导出到展示站**（按书/分类/条目筛选已确认记录，直写 `../showcase/data/`
   或下载 zip，供对外展示站消费，详见 `../showcase/README.md`）

### 数据中心（顶部「更多 → 数据中心」）

不要求使用者理解 JSON、数据根目录或环境变量，提供统一的数据管理入口：

| 页签 | 说明 |
|------|------|
| **总览** | 项目名、数据集身份、书/插图/页计数、状态分布、版本上下文、素材统计、最近写入/备份时间 |
| **健康检查** | 12 项只读检查（解析、ID 重复、PDF 缺失、裁框缺失、合并残留、OCR 中断、版本上下文、空记录、素材 stale、备份 manifest 等），不自动修复 |
| **备份与恢复** | 创建备份（ZIP + manifest 含 SHA-256）；恢复需输入"恢复"二次确认，自动生成 before_restore 备份，原子替换白名单文件，不删除额外记录；只读库允许备份，恢复被 423 拦截 |
| **导出** | 论文冻结包（confirmed-only + 版本上下文 + 审核归因 + 数据字典 + "仅供论文复算"声明）；展示数据（accepted-only，剥离 `_rawText`/`modelRawResponse`）；完整备份（同备份页） |

备份白名单严格限定 `global.json`/`asset-links.json`/`books/<id>/{book,images,meta}.json`，排除 PDF/缓存/素材/密钥/源码。数据中心不修改 `aiDraft`/`annotation`/`reviewDiff`/`status`/`reviewEvents`。任务书见 `../docs/TASK_data_center_v1.md`。

---

## 标注字段说明

| 字段 | 说明 |
|------|------|
| 图像类型 | 12 类规范主分类：疾病图、诊法图、医疗图、药物图、器具图、养生图、脏腑图、经穴图、部位图、理论图、符咒图、人物图 |
| 具体分类 | 各主分类下的学术细分类；其中药物图固定使用“药物形态图 / 药物炮制图 / 药物关联图”三分法 |
| 药材名（古籍 / 现代） | 页面原文药名 + 现代规范名 |
| 炮制工序 | 从原文提取的工序步骤描述 |
| 图文互证结论 | 一致 / 存疑 / 矛盾（附说明文字） |
| AI 置信度 | 高 / 中 / 低 |
| 审核状态 | `todo` → `review` → `ok` / `bad` |

### 药物图三分法

`药物图` 是描绘药物形态、药物炮制过程和器具，以及与药物相关内容的一大类图像。AI 标注和人工复核时统一按以下三类填写“具体分类”：

| 具体分类 | 判定口径 |
|----------|----------|
| 药物形态图 | 直接描绘药物整体、入药部位、药材饮片、植物/动物/矿物药外观形态；如果正文提到炮制方法，但图像本身没有炮制动作或加工场景，仍归入本类 |
| 药物炮制图 | 描绘药物加工炮制方法、工艺流程或相关器具使用；出现人物处理药物，或炒、煅、煮、蒸、炙、洗、晒、研、捣、切、炼、熬等操作场景时归入本类 |
| 药物关联图 | 以药物为中心扩展表达生态环境、产地、运用、民俗、神话传说、对外交流、文学作品等内容；不直接描绘药物形态或炮制过程 |

历史数据说明：2026-06-09 已将旧的 `药物图 / 炼丹图 / 炮制图` 细分类迁移到上述三分法。迁移不改变 `ok/review` 状态，并在记录中保留 `_legacyAcademicSubclass`、`_academicSubclassMigratedAt`、`_academicSubclassMigration` 以便追溯。

---

## AI 模型配置

编辑 `config.json`：

```json
{
  "api_provider": "qwen",
  "api_key": "sk-xxxx"
}
```

支持的提供商：`openai` / `deepseek` / `qwen` / `zhipu` / `kimi`

---

## 常见问题

**Q：重启 bridge.py 后数据还在吗？**  
A：在。数据保存在 `data/books/` 下的 JSON 文件，重启只是重新读取文件。

**Q：running 状态的图片卡住了怎么办？**  
A：bridge.py 启动时会自动重置残留的 `running` 状态为 `review`，刷新页面即可。

**Q：合并书籍后，原来的 PDF 还在吗？**  
A：在。合并操作将各卷 PDF 复制到 `data/books/group_<id>/pdfs/`，原目录文件不删除。

**Q：如何备份数据？**  
A：直接复制整个 `data/` 目录即可，所有书籍、标注、PDF 均在其中。

---

## 详细文档

完整操作手册 → 浏览器打开 [guide.html](guide.html)
