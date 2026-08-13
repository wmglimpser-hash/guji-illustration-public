/* D-Data Management V2：日常入口收束的静态回归检查。 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
let failed = 0;

function check(condition, message) {
  if (condition) console.log('  ✓ ' + message);
  else { failed += 1; console.error('  ✗ ' + message); }
}

console.log('\n[D-Data Management V2] 前端入口收束');
check(html.includes('>插图记录</button>'), '顶部日常入口为“插图记录”');
check(html.includes('id="btn-run-history"'), '更多菜单保留“运行历史”入口');
check(!html.includes('id="btn-backup-now"'), '普通前端不再显示即时备份');
check(!html.includes('id="btn-data-center"'), '普通前端不再显示数据中心');
check(!html.includes('id="data-center-overlay"'), '数据中心维护模态不再注入日常页面');
check(!html.includes('data-tab="assets"'), '基础信息旁不再显示素材页签');
check(!html.includes('id="tab-assets"'), '素材详情面板不再注入日常页面');
check(html.includes('id="left-asset-source-controls"'), '图片列表提供显式源素材导出任务入口');
check(html.includes('data-ltab="images">图片列表'), '图片列表为默认左侧入口');
check(app.includes("leftTab: 'images'"), '新会话默认显示图片列表');
check(!html.includes('.shell.book-workspace #left-tab-images'), '书籍工作区不再强制隐藏图片列表');
check(app.includes("const hideLeft  = state.mainView === 'archive-manager'"), '首页不再隐藏图片列表');
check(!app.includes("&& tab !== 'books')"), '书籍工作区不再强制切回书籍列表');
check(app.includes("function renderRunHistoryView()"), '运行历史拥有独立视图');
check(app.includes("function renderArchiveManagerView()"), '插图记录拥有独立视图');
check(app.includes("'run-history'"), '路由允许进入运行历史');
check(app.includes('当前规范插图库'), '插图记录明确只读当前规范插图库');
check(app.includes('同一插图可能有多次模型运行'), '运行历史明确说明可重复运行语义');
check(app.includes('function renderAssetSourceControls()'), '图片列表按任务模式组织源素材选择');
check(app.includes('点击整张插图卡片选择'), '源素材任务支持整卡选择');
check(app.includes("if (!['form', 'stats'].includes(state.rightTab)) state.rightTab = 'form';"), '旧素材页会话自动回到基础信息');

console.log(`结果：${failed ? '失败 ' + failed : '全部通过'}`);
if (failed) process.exit(1);
