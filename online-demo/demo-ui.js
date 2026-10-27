/* Mount after app.js: only demo integration points are replaced. */
pageHiResUrl = (...args) => Demo.urlFor(...args);
const nativeOpenPageDetail = openPageDetail;
let latestPageRequest = 0;
openPageDetail = async function (bookId, pageNum, ...args) {
  const request = ++latestPageRequest;
  try {
    await Promise.all([Number(pageNum)-1, Number(pageNum), Number(pageNum)+1].filter(page => page >= 1 && page <= 160).map(Demo.loadPage));
    if (request !== latestPageRequest) return;
    const result = nativeOpenPageDetail(bookId, pageNum, ...args);
    document.getElementById('demo-page-number').value = pageNum;
    return result;
  } catch (error) { toast(error.message, 'error'); }
};
const nativeCropFromHiRes = cropFromHiRes;
cropFromHiRes = async function (book, page, ...args) {
  await Demo.loadPage(page.pageNum);
  return nativeCropFromHiRes(book, page, ...args);
};
const nativeBootstrap = bootstrapApp;
bootstrapApp = async function () {
  try {
    await Demo.ready;
    await nativeBootstrap();
    document.getElementById('demo-loading').remove();
    document.querySelectorAll('#demo-toolbar button').forEach(button => button.disabled = false);
    updateDemoProgress();
    syncDemoNavigation();
  } catch (error) {
    document.getElementById('demo-loading').textContent = error.message;
  }
};

// These actions deliberately open the preset, never simulate a model request.
runAI = async function (id) {
  const preset = DEMO_FIXTURE.state.illustrations.find(item => item.id === id);
  const image = state.illustrations.find(item => item.id === id);
  if (!preset || !image) { toast('新裁图可体验人工整理；AI 候选请查看两条预置案例。', 'info'); return false; }
  image.aiDraft = deepClone(preset.aiDraft);
  image.annotation = deepClone(preset.aiDraft);
  image.status = 'review'; image.modelUsed = '预置 AI 候选'; image.reviewDiff = {};
  delete image.canonicalId; delete image.verifiedAt;
  persistImage(image); renderAll(); updateDemoProgress();
  toast('已载入预置 AI 候选，可继续核对和审核', 'info');
  return true;
};
const demoOnly = () => { toast('在线版提供预置案例体验；完整导入、OCR 和模型调用请在本地运行。', 'info'); return Promise.resolve(false); };
openBookImport = demoOnly;
openReferenceImportDialog = demoOnly;
runFullBookScan = demoOnly;
runSelectedBookScan = demoOnly;
runContextBookScan = demoOnly;
runBookFullTextScan = demoOnly;
runSelectedPagesOcr = demoOnly;
requestPageImageOcr = demoOnly;
scanBookPages = demoOnly;

function updateDemoProgress() {
  const confirmed = state.illustrations.filter(item => item.status === 'ok').length;
  const proofed = state.books[0]?.pages.filter(page => page.textAsset?.correctedText).length || 0;
  document.getElementById('demo-progress').textContent = `已校文 ${proofed} 页 · 已确认 ${confirmed} 图`;
}
function syncDemoNavigation() {
  const step = state.mainView === 'gallery' || state.mainView === 'home' ? 'browse' : state.mainView === 'review-queue' ? 'review' : state.illustCropEditing ? 'crop' : state.pageDetailMode === 'text' ? 'proof' : 'candidate';
  document.querySelectorAll('#demo-toolbar [data-step]').forEach(button => button.classList.toggle('active', button.dataset.step === step));
  demoHint({browse:'卷三全卷160页，可点书页浏览、连续翻页或输入页码跳转。下方四个入口可体验甘草案例。',proof:'对照原页，把 OCR 中的「炮製片草」校为「炮製甘草」，可在校正文区保存。',crop:'拖动绿色边框或四角，调整甘草插图范围，再保存。',candidate:'查看右侧预置 AI 候选：对象、题签、分类与图文互证。',review:'核对候选后点击“确认”。修改字段时，选择修改原因并保存。'}[step]);
}
const nativeConfirm = confirmAnnotation;
confirmAnnotation = async function (...args) {
  const result = await nativeConfirm(...args); updateDemoProgress(); return result;
};
const nativePersist = persist;
persist = function (...args) { const result = nativePersist(...args); updateDemoProgress(); return result; };

async function demoStep(step) {
  document.querySelectorAll('#demo-toolbar [data-step]').forEach(button => button.classList.toggle('active', button.dataset.step === step));
  document.getElementById('overlay-root').replaceChildren();
  state.filter = 'all'; state.imageBookFilter = 'all'; state.pageRectEditing = false;
  state.illustCropEditing = false; state.rightCollapsed = false;
  if (step === 'browse') {
    openGallery('sample-juan3', 'pages');
    syncDemoNavigation();
  } else if (step === 'proof') {
    await openPageDetail('sample-juan3', 20, 'text');
    demoHint('对照原页，把 OCR 中的「炮製片草」校为「炮製甘草」，可在右侧文字编辑区保存。');
  } else if (step === 'crop') {
    await openPageDetail('sample-juan3', 20, 'illustrations', 'sample-p020-i01');
    enterIllustCropEditing(20, 'sample-p020-i01');
    renderAll();
    demoHint('拖动绿色边框或四角，调整甘草插图范围，再保存。也可返回插图页新增图项。');
  } else if (step === 'candidate') {
    await openPageDetail('sample-juan3', 20, 'illustrations', 'sample-p020-i02');
    demoHint('查看右侧预置 AI 候选：对象、题签、分类与图文互证。点“下一插图”比较两个案例。');
  } else if (step === 'review') {
    state.currentBookId = 'sample-juan3';
    if (getReviewQueueItems().length) enterReviewMode();
    else { openPageDetail('sample-juan3', 20, 'illustrations', 'sample-p020-i01'); toast('两条案例均已确认，可重置后再体验审核。', 'info'); }
    demoHint('核对候选后点击“确认标注”。修改字段时，按原系统流程选择修改原因并保存。');
  }
}
function demoHint(text) { document.getElementById('demo-hint').textContent = text; }
// Hide production-only entry points without changing their implementation.
function trimProductionActions() {
  document.querySelectorAll('button').forEach(button => {
    if (['导出源素材', '批量 OCR', '重新 OCR 并采用', '导入完整文本', '扫描', '页面操作', '🔄 重新扫描'].includes(button.textContent.trim())) button.hidden = true;
    if (/^(⟳|↺).*重新(标注|运行 AI)/.test(button.textContent)) button.textContent = '⟳ 重载预置候选';
  });
}
new MutationObserver(trimProductionActions).observe(document.querySelector('.shell'), { childList: true, subtree: true });
document.getElementById('demo-toolbar').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.step) await demoStep(button.dataset.step);
  if (button.id === 'demo-go-page') {
    const page = Number(document.getElementById('demo-page-number').value);
    if (!Number.isInteger(page) || page < 1 || page > 160) { toast('请输入1—160之间的页码', 'info'); return; }
    await openPageDetail('sample-juan3', page, 'pages');
    demoHint(`卷三第 ${page} 页，可用左右箭头继续翻阅，也可切换“校文”对照原图。`);
  }
  if (button.id === 'demo-reset') {
    if (!(await openConfirm('重置将清除本浏览器中的案例修改，恢复预置案例。继续吗？'))) return;
    await enqueueBridgeFlush();
    Demo.store.reset(); localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_CFG);
    location.reload();
  }
  if (button.id === 'demo-export') {
    await enqueueBridgeFlush();
    const blob = new Blob([JSON.stringify({ ...Demo.store.snapshot(), demo: true }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = '医图志_案例体验记录.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
});
// Capture before native handlers, including handlers attached before overrides.
document.addEventListener('click', event => {
  const blocked = event.target.closest('#btn-settings,#btn-add,#btn-import-book-2,#btn-asset-desk,#btn-guide,#btn-run-history');
  if (blocked) { event.preventDefault(); event.stopImmediatePropagation(); demoOnly(); }
}, true);
