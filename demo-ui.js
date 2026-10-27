// The snapshot already uses the current schema. Keep historical AI/human values verbatim on load.
const nativeNormalizeReviewState = normalizeImageReviewState;
normalizeImageReviewState = function(image) {
  if (DEMO_FIXTURE.state.illustrations.some(item => item.id === image.id)) return false;
  return nativeNormalizeReviewState(image);
};
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

// Restore saved work, including its human review status; no inference is simulated.
runAI = async function (id) {
  const preset = DEMO_FIXTURE.state.illustrations.find(item => item.id === id);
  const index = state.illustrations.findIndex(item => item.id === id);
  if (!preset || index < 0) { toast('新裁图可体验人工整理；模型调用请在本地运行。', 'info'); return false; }
  if (!(await openConfirm('将此图恢复到本地工作快照中的标注和审核状态，继续吗？'))) return false;
  state.illustrations[index] = deepClone(preset);
  persistImage(state.illustrations[index]); renderAll(); updateDemoProgress();
  toast('已恢复此图的本地标注、AI 初稿和审核状态', 'info'); return true;
};
const demoOnly = () => { toast('在线版提供本地工作快照体验；完整导入、OCR 和模型调用请在本地运行。', 'info'); return Promise.resolve(false); };
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
  document.getElementById('demo-progress').textContent = `人工修订 ${proofed} 页 · 已确认 ${confirmed} 图 · 保留 ${state.illustrations.filter(item => item.status === 'review').length} 条历史记录`;
}
function syncDemoNavigation() {
  const step = state.mainView === 'gallery' || state.mainView === 'home' ? 'browse' : state.mainView === 'review-queue' ? 'review' : state.illustCropEditing ? 'crop' : state.pageDetailMode === 'text' ? 'proof' : 'candidate';
  document.querySelectorAll('#demo-toolbar [data-step]').forEach(button => button.classList.toggle('active', button.dataset.step === step));
  demoHint({browse:'卷三全卷160页，可点书页浏览、连续翻页或输入页码跳转。下方入口可查看已有校文、插图选框和标注。',proof:'查看第10页已有人工修订，对照原始 OCR 与校正文，可继续编辑保存。',crop:'拖动绿色边框或四角，调整甘草插图范围，再保存。',candidate:'查看右侧已有标注：对象、题签、分类与图文互证；可对照 AI 初稿和人工修改。',review:'核对候选后点击“确认”。修改字段时，选择修改原因并保存。'}[step]);
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
    openGallery('book_1780643127071', 'pages');
    syncDemoNavigation();
  } else if (step === 'proof') {
    await openPageDetail('book_1780643127071', DEMO_FIXTURE.examples.proofPage, 'text');
    demoHint('第10页保留了本地人工修订，可对照原始 OCR 与校正文继续编辑。');
  } else if (step === 'crop') {
    await openPageDetail('book_1780643127071', 20, 'illustrations', 'book_1780643127071_p020_i01');
    enterIllustCropEditing(20, 'book_1780643127071_p020_i01');
    renderAll();
    demoHint('拖动绿色边框或四角，调整甘草插图范围，再保存。也可返回插图页新增图项。');
  } else if (step === 'candidate') {
    await openPageDetail('book_1780643127071', 20, 'illustrations', 'book_1780643127071_p020_i02');
    demoHint('查看右侧已有标注：对象、题签、分类与图文互证；可对照 AI 初稿和人工修改。点“下一插图”比较两个案例。');
  } else if (step === 'review') {
    state.currentBookId = 'book_1780643127071';
    if (getReviewQueueItems().length) enterReviewMode();
    else { showSnapshotHistory(); return; }
    demoHint('核对候选后点击“确认标注”。修改字段时，按原系统流程选择修改原因并保存。');
  }
}
function demoHint(text) { document.getElementById('demo-hint').textContent = text; }
// Hide production-only entry points without changing their implementation.
function trimProductionActions() {
  document.querySelectorAll('button').forEach(button => {
    if (['导出源素材', '批量 OCR', '重新 OCR 并采用', '导入完整文本', '扫描', '页面操作', '🔄 重新扫描'].includes(button.textContent.trim())) button.hidden = true;
    if (/^(⟳|↺).*重新(标注|运行 AI)/.test(button.textContent)) button.textContent = '⟳ 恢复本地记录';
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
    await openPageDetail('book_1780643127071', page, 'pages');
    demoHint(`卷三第 ${page} 页，可用左右箭头继续翻阅，也可切换“校文”对照原图。`);
  }
  if (button.id === 'demo-reset') {
    if (!(await openConfirm('重置将清除本浏览器中的体验修改，恢复本地工作快照（112条当前图项、16条历史记录）。继续吗？'))) return;
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

function showSnapshotHistory() {
  const host=document.getElementById('overlay-root'); host.replaceChildren();
  const shade=document.createElement('div'); shade.style='position:fixed;inset:0;z-index:9999;background:#0007;display:grid;place-items:center;padding:24px';
  const panel=document.createElement('section');panel.style='background:#fff;border-radius:12px;padding:24px;width:min(1000px,94vw);max-height:85vh;overflow:auto;color:#223';
  const title=document.createElement('h2'); title.textContent='卷三标注与审核记录';panel.append(title);
  const note=document.createElement('p');note.textContent='当前使用112条独立图项，均已确认。拆分前的16条整页记录保留原有待审核状态，可在下方查看原标注、AI初稿及审核记录。';panel.append(note);
  const close=document.createElement('button');close.textContent='关闭记录';close.onclick=()=>shade.remove();panel.append(close);
  for (const image of state.illustrations) {
    const details=document.createElement('details'),summary=document.createElement('summary');
    const historical=!shouldUseIllustrationRecord(image);
    summary.textContent=`第${image.pdfSource.pageNum}页 · ${image.annotation?.illustrationName || image.id} · ${historical?'拆分前整页记录 · ':''}${image.status==='ok'?'已确认':'原状态：待审核'}`;
    details.append(summary);
    details.style='border-bottom:1px solid #ddd;padding:12px 0';
    details.addEventListener('toggle',()=>{
      if (!details.open || details.dataset.loaded) return;details.dataset.loaded='yes';
      const preview=document.createElement('img');preview.src=image.url;preview.alt='保存的插图选区';preview.style='max-width:280px;max-height:300px;object-fit:contain;float:right;margin:12px';details.append(preview);
      for (const [label,value] of [['当前标注',image.annotation],['AI初稿',image.aiDraft],['人工修改及原因',{reviewDiff:image.reviewDiff,fieldReviewReasons:image.fieldReviewReasons,reviewEvents:image.reviewEvents}],['图文证据',image.annotationEvidence]]) {
        const group=document.createElement('details'),heading=document.createElement('summary'),pre=document.createElement('pre');heading.textContent=label;pre.textContent=JSON.stringify(value || {},null,2);pre.style='white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 system-ui';group.append(heading,pre);details.append(group);
      }
    });
    panel.append(details);
  }
  shade.append(panel);host.append(shade);
}
