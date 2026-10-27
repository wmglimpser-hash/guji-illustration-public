/* Mount after app.js: only demo integration points are replaced. */
pageHiResUrl = (...args) => Demo.urlFor(...args);
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
  const step = state.mainView === 'review-queue' ? 'review' : state.illustCropEditing ? 'crop' : state.pageDetailMode === 'text' ? 'proof' : 'candidate';
  document.querySelectorAll('#demo-toolbar [data-step]').forEach(button => button.classList.toggle('active', button.dataset.step === step));
  demoHint({proof:'对照原页，把 OCR 中的「炮製片草」校为「炮製甘草」，可在校正文区保存。',crop:'拖动绿色边框或四角，调整甘草插图范围，再保存。',candidate:'查看右侧预置 AI 候选：对象、题签、分类与图文互证。',review:'核对候选后点击“确认”。修改字段时，选择修改原因并保存。'}[step]);
}
const nativeConfirm = confirmAnnotation;
confirmAnnotation = async function (...args) {
  const result = await nativeConfirm(...args); updateDemoProgress(); return result;
};
const nativePersist = persist;
persist = function (...args) { const result = nativePersist(...args); updateDemoProgress(); return result; };

function demoStep(step) {
  document.querySelectorAll('#demo-toolbar [data-step]').forEach(button => button.classList.toggle('active', button.dataset.step === step));
  document.getElementById('overlay-root').replaceChildren();
  state.filter = 'all'; state.imageBookFilter = 'all'; state.pageRectEditing = false;
  state.illustCropEditing = false; state.rightCollapsed = false;
  if (step === 'proof') {
    openPageDetail('sample-juan3', 20, 'text');
    demoHint('对照原页，把 OCR 中的「炮製片草」校为「炮製甘草」，可在右侧文字编辑区保存。');
  } else if (step === 'crop') {
    openPageDetail('sample-juan3', 20, 'illustrations', 'sample-p020-i01');
    enterIllustCropEditing(20, 'sample-p020-i01');
    renderAll();
    demoHint('拖动绿色边框或四角，调整甘草插图范围，再保存。也可返回插图页新增图项。');
  } else if (step === 'candidate') {
    openPageDetail('sample-juan3', 20, 'illustrations', 'sample-p020-i02');
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
    if (['导出源素材', '批量 OCR', '重新 OCR 并采用', '导入完整文本'].includes(button.textContent.trim())) button.hidden = true;
    if (/^(⟳|↺).*重新(标注|运行 AI)/.test(button.textContent)) button.textContent = '⟳ 重载预置候选';
  });
}
new MutationObserver(trimProductionActions).observe(document.querySelector('.shell'), { childList: true, subtree: true });
document.getElementById('demo-toolbar').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.step) demoStep(button.dataset.step);
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
