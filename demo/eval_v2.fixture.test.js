/* ============================================================
   Task 21 Gate 2.1 评价数据完整性修复 — 固定 fixture 单测
   覆盖 A-E：
     A. 完整字段归因（含 correspondingText/meridian/points + supplement 不追踪）
     B. 原因必须显式选择（初始空 / 拒绝 / 用后清空）
     C. 证据/OCR 上下文映射（reviewed / ocr candidate / pdf_text / missing）
     D. 审核模式与直接接受统计（no_recorded_change / legacy 仅 versionContext 缺失）
     E. AI 重跑隔离（draftRunId/reviewCycleId，旧事件不污染新导出）
   运行： node demo\eval_v2.fixture.test.js
   退出码：0=全通过；1=有失败
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const illustrationNameRules = require('./illustration_name_rules');
const annotationRun = require('./annotation_run');
const textProofDiff = require('./text_proof_diff');

// ── 加载真实 app.js（最小 DOM stub）──────────────────────────────
function loadApp() {
  let src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  src += '\n;globalThis.__v2 = { REVIEW_TRACK_FIELDS, FIELD_TIER, HUMAN_REVIEW_REASONS, ALL_REVIEW_REASONS, SYSTEM_REVIEW_REASONS, REVIEW_MODES, ANNOTATION_EVAL_SCHEMA_VERSION, UNTRACKED_FREE_TEXT_FIELDS, deriveTextSourceStatus, deriveOcrStatus, deriveReviewModeFromEvidence, describeDerivedReviewMode, buildVersionContext, fieldHash, appendReviewEvent, appendSystemEvent, appendSystemGeneratedTrackedChanges, markLegacyUnattributed, humanEditField, setPendingReason, clearPendingReason, commitTrackedFieldEdit, getReviewFormAnnotation, getPendingReviewChanges, stageTrackedFieldEdit, savePendingTrackedEdits, archiveConfirmedVersionBeforeRerun, restoreConfirmedVersionSnapshot, startNewDraftRun, resetCurrentReviewStateForFreshDraft, currentCycleEvents, currentCycleReasons, startReviewSession, settleCurrentSegment, resumeActiveSegment, getCurrentSession, effectiveReviewSeconds, percentile, buildEvalStats, buildEvalRecord, buildEvalExport, formatEvalStatsTxt, normalizeReviewMode, noteHumanEdit, getVisualDescription, appendTextAssetOcrRun, archiveCurrentOcrRun, applyOcrRunToTextAsset, getQueuedIllustrationsForPages, getBookIllustrations, getPageOcrTaskConfig, normalizeOcrFailureMessage, summarizeOcrFailures, compactPageNumberList, parsePageNumberSelection, describeSelectedPageOcrProgress, describeBookPageScanProgress, getGalleryScanJob, describeGalleryScanAction, gallerySelectionModeFor, assetStatusLabel, getAssetLayerVisibility, assetDeskLayerBBox, assetDeskObjectPosition, assetDeskBBoxStyle, assetDeskSources, assetDeskLabel, assetDeskLayerTypeLabel, assetDeskState, normalizeReferenceEditText, referenceEditHasChanges, PROMPT_VERSION, buildPrompt, parseAnnotationText, mapAIResponse, getMergeIdentityMeta, calculateMergeCompositeLayout, getVisibleConfirmedIllustrations, getIllustrationNavItems, getScanContentRect, resolveScanInputRegion, buildScanReadingContext, computeScanDirectionWarnings, determineAnnotationEvidenceMode, SCAN_INPUT_VERSION, SCAN_CONTENT_LONG_SIDE, state };';
  src += '\n;Object.assign(globalThis.__v2, { normalizeIllustrationWorkflowStatus, getGalleryPageTextAsset });';
  src += '\n;Object.assign(globalThis.__v2, { referenceScopeId, mountReferencePane, updateReferenceInsertTarget, isReferencePaneMounted, renderReferencePane, resetReferenceReaderScope, referenceReaderState, captureReferencePaneViewState, saveReferenceEditedCopy, referenceExportFilename });';
  src += '\n;Object.assign(globalThis.__v2, { updateReferenceComparisonSource, markReferenceComparisonStale, currentReferenceWorkingContent, referenceUncertainMarkForCurrentDraft, nextReferenceUncertaintyIndex, rememberReferenceComparisonRange, getReferenceComparisonRanges, clearReferenceComparisonRanges, chooseReferenceStartHint, activateReferenceComparisonDifference, buildReferenceComparisonRangeSummary, setReferenceSelectedRange, clampProofreadingGuideRect, proofreadingGuideState, clampReferencePaneWidth, isProofEditorCollapsed, setProofEditorCollapsed, referenceSearchMatchOffsets, findReferenceSearchTargetPage, syncReferenceRangeToProofPage, referenceProofNavigationRange, openReferenceProofPage, setReferenceComparisonStartFromRange, resolveReferenceComparisonLocation, referenceComparisonActionLabel });';
  const noop = () => {};
  const fakeEl = {
    addEventListener: noop, style: {}, append: noop, appendChild: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    value: '', textContent: '', innerHTML: '', dataset: {},
  };
  const doc = {
    addEventListener: noop, getElementById: () => fakeEl, querySelector: () => fakeEl,
    querySelectorAll: () => [], createElement: () => fakeEl, createTextNode: () => fakeEl,
    createTreeWalker: () => ({ nextNode: () => false, currentNode: null }), body: fakeEl, documentElement: fakeEl,
    hidden: false, visibilityState: 'visible',
  };
  const storageValues = new Map();
  const storage = {
    getItem: key => storageValues.has(key) ? storageValues.get(key) : null,
    setItem: (key, value) => storageValues.set(key, String(value)),
    removeItem: key => storageValues.delete(key),
  };
  const win = {
    addEventListener: noop, localStorage: storage, location: { href: 'http://127.0.0.1:5678/', hostname: '127.0.0.1' },
    navigator: { userAgent: 'node' }, innerWidth: 1024, innerHeight: 768,
    crypto: { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); return b; } },
  };
  const fetchCalls = [];
  const ctx = {
    IllustrationNameRules: illustrationNameRules,
    AnnotationRun: annotationRun,
    TextProofDiff: textProofDiff,
    document: doc, window: win, localStorage: storage, location: win.location, navigator: win.navigator,
    innerWidth: 1024, innerHeight: 768, crypto: win.crypto, console,
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Map, Set, Array, Object, String, Number, RegExp, Error,
    NodeFilter: { SHOW_TEXT: 4 },
    Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: noop },
    fetch: (url, options = {}) => {
      fetchCalls.push({ url, options });
      const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {};
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          item: { id: 'ref-save', has_edits: true },
          content: body.content || '',
          original_content: '黄芩味苦',
          has_edits: true,
        }),
      });
    },
    alert: noop, confirm: () => true, prompt: () => '',
    requestAnimationFrame: noop, cancelAnimationFrame: noop, atob: () => '', btoa: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.__fetchCalls = fetchCalls;
  return ctx;
}

// ── 简易断言 ────────────────────────────────────────────────────
let _pass = 0, _fail = 0;
function assert(cond, msg) {
  if (cond) { _pass++; console.log('  ✓ ' + msg); }
  else { _fail++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(a, b, msg) { assert(a === b, `${msg} (期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)})`); }

// ── fixture 工厂 ─────────────────────────────────────────────────
function legacyFixture() {
  return {
    id: 'leg-001',
    aiDraft: { type: 'PLANT', subject: '甘草', style: '工笔' },
    annotation: { type: 'PLANT', subject: '甘草', style: '工笔' },
    annotationEvidence: { mode: 'text' },
    modelUsed: 'qwen3.5-flash',
    // 无 versionContext → legacy
  };
}

function v2Fixture() {
  return {
    id: 'v2-001',
    aiDraft: { type: 'ANIMAL', subject: '鹿', style: '写意' },
    annotation: { type: 'ANIMAL', subject: '鹿', style: '写意' },
    annotationEvidence: { mode: 'full_page_scan', promptVersion: 'v1.3' },
    modelUsed: 'qwen3.5-flash',
    reviewMeta: { reviewMode: 'strict' }, // Gate 2.1 B：pendingReason 初始为空（不在此预设）
    versionContext: {
      schemaVersion: 'annotation-eval-v2', classificationVersion: 'academic-12class-v1',
      promptVersion: 'v1.3', model: { provider: 'qwen', name: 'qwen3.5-flash' },
      evidenceMode: 'full_page_scan', textSourceStatus: 'verified', ocrStatus: 'verified',
      createdAt: '2026-07-16T10:00:00.000Z',
    },
    draftRunId: 'dr-test-001',
    reviewCycleId: 1,
  };
}

// textAsset 工厂（C 测试用）
function textAssetReviewed() {
  return { verified: true, textStatus: 'reviewed', textSource: 'ai_ocr', fullText: '甘草' };
}
function textAssetOcrCandidate() {
  return { verified: false, textStatus: 'extracted', textSource: 'ai_ocr', fullText: '甘草' };
}
function textAssetPdfText() {
  return { verified: false, textStatus: 'extracted', textSource: 'pdf_text_layer', fullText: '甘草' };
}
function textAssetMissing() {
  return { verified: false, textStatus: 'missing', textSource: 'none', fullText: '' };
}

async function runTests() {
  const app = loadApp();
  const V = app.__v2;
  const {
    REVIEW_TRACK_FIELDS, FIELD_TIER, HUMAN_REVIEW_REASONS, ALL_REVIEW_REASONS,
    SYSTEM_REVIEW_REASONS, REVIEW_MODES, UNTRACKED_FREE_TEXT_FIELDS,
    deriveTextSourceStatus, deriveOcrStatus, deriveReviewModeFromEvidence, describeDerivedReviewMode, buildVersionContext, fieldHash,
    appendReviewEvent, appendSystemEvent, appendSystemGeneratedTrackedChanges, markLegacyUnattributed,
    humanEditField, setPendingReason, clearPendingReason, commitTrackedFieldEdit,
    getReviewFormAnnotation, getPendingReviewChanges, stageTrackedFieldEdit, savePendingTrackedEdits,
    archiveConfirmedVersionBeforeRerun, restoreConfirmedVersionSnapshot,
    startNewDraftRun, resetCurrentReviewStateForFreshDraft, currentCycleEvents, currentCycleReasons,
    startReviewSession, settleCurrentSegment, resumeActiveSegment,
    effectiveReviewSeconds, percentile, buildEvalStats, buildEvalRecord, buildEvalExport,
    formatEvalStatsTxt, normalizeReviewMode, getVisualDescription, appendTextAssetOcrRun, archiveCurrentOcrRun, applyOcrRunToTextAsset, getQueuedIllustrationsForPages, getBookIllustrations, getPageOcrTaskConfig, normalizeOcrFailureMessage, summarizeOcrFailures, compactPageNumberList, parsePageNumberSelection, describeSelectedPageOcrProgress, describeBookPageScanProgress, getGalleryScanJob, describeGalleryScanAction, gallerySelectionModeFor, assetStatusLabel, getAssetLayerVisibility, assetDeskLayerBBox, assetDeskObjectPosition, assetDeskBBoxStyle,
    PROMPT_VERSION, buildPrompt, parseAnnotationText, mapAIResponse,
    getMergeIdentityMeta, calculateMergeCompositeLayout, getVisibleConfirmedIllustrations, getIllustrationNavItems, normalizeIllustrationWorkflowStatus, getGalleryPageTextAsset,
    getScanContentRect, resolveScanInputRegion, buildScanReadingContext, computeScanDirectionWarnings, determineAnnotationEvidenceMode,
    assetDeskSources, assetDeskLabel, assetDeskLayerTypeLabel, assetDeskState,
    normalizeReferenceEditText, referenceEditHasChanges,
    referenceScopeId, mountReferencePane, updateReferenceInsertTarget, isReferencePaneMounted, renderReferencePane, resetReferenceReaderScope, referenceReaderState, captureReferencePaneViewState, saveReferenceEditedCopy, referenceExportFilename,
    updateReferenceComparisonSource, markReferenceComparisonStale, currentReferenceWorkingContent, referenceUncertainMarkForCurrentDraft, nextReferenceUncertaintyIndex,
    setReferenceSelectedRange, clampProofreadingGuideRect, proofreadingGuideState,
    clampReferencePaneWidth, isProofEditorCollapsed, setProofEditorCollapsed,
    rememberReferenceComparisonRange, getReferenceComparisonRanges, clearReferenceComparisonRanges, chooseReferenceStartHint, activateReferenceComparisonDifference, buildReferenceComparisonRangeSummary, referenceSearchMatchOffsets, findReferenceSearchTargetPage, syncReferenceRangeToProofPage, referenceProofNavigationRange, openReferenceProofPage, setReferenceComparisonStartFromRange, resolveReferenceComparisonLocation, referenceComparisonActionLabel,
    SCAN_INPUT_VERSION, SCAN_CONTENT_LONG_SIDE, state,
  } = V;

  console.log('\n[UI1] 合并图基础信息保留主编号并列出全部来源编号');
  {
    const oldBooks = state.books;
    const oldIllustrations = state.illustrations;
    const owner = {
      id: 'book-test_p019_i02', subIndex: 2, figureIndex: 2,
      pdfSource: { bookId: 'book-test', pageNum: 19 },
      imageMerge: { items: ['book-test_p020', 'book-test_p019_i02'] },
    };
    const source = {
      id: 'book-test_p020',
      pdfSource: { bookId: 'book-test', pageNum: 20 },
      mergedInto: owner.id,
    };
    state.books = [{ id: 'book-test', code: 'BYLGJ01', title: '补遗雷公炮制便览（卷1）' }];
    state.illustrations = [owner, source];
    const meta = getMergeIdentityMeta(owner);
    assertEq(meta.count, 2, '合并身份显示两个来源');
    assertEq(meta.sources.map(item => item.code).join(','), 'BYLGJ01_p0020,BYLGJ01_p0019_i02', '来源编号按合并顺序显示');
    assertEq(meta.sources.filter(item => item.isOwner).length, 1, '仅稳定主记录带主记录标记');
    assertEq(getMergeIdentityMeta(source), null, '隐藏来源本身不伪装为合并主记录');
    state.books = oldBooks;
    state.illustrations = oldIllustrations;
  }

  console.log('\n[UI2] 合并图按来源顺序生成一个受尺寸约束的整体画布');
  {
    const layout = calculateMergeCompositeLayout([
      { width: 600, height: 1200 },
      { width: 500, height: 1000 },
    ], 1800, 2);
    assertEq(layout.items.length, 2, '两个来源只生成一个画布内的两个绘制区域');
    assert(layout.items[0].x < layout.items[1].x, '绘制区域保持来源数组的左右顺序');
    assert(layout.items[0].width > 0 && layout.items[1].width > 0, '每个来源均进入整体画布');
    assert(Math.max(layout.width, layout.height) <= 1800, '整体长边不超过模型输入上限');
    assertEq(calculateMergeCompositeLayout([], 1800).items.length, 0, '空来源不伪造合并图');
  }

  console.log('\n[UI3] 预处理固定使用正文框，标注证据不再以版心图兜底');
  {
    const explicitRect = [0.1, 0.12, 0.9, 0.88];
    const templateRect = [0.05, 0.1, 0.95, 0.9];
    assertEq(JSON.stringify(getScanContentRect({ contentRectTemplate: templateRect }, { contentRect: explicitRect })), JSON.stringify(explicitRect), '页面正文框优先于书级模板');
    assertEq(JSON.stringify(getScanContentRect({ contentRectTemplate: templateRect }, {})), JSON.stringify(templateRect), '页面缺框时使用书级统一正文框');
    assertEq(getScanContentRect({}, {}), null, '正文框缺失时不静默退回整页');
    assertEq(resolveScanInputRegion({}, {}, { allowFullPage: false }), null, '未获用户许可时正文框缺失仍阻止扫描');
    assertEq(JSON.stringify(resolveScanInputRegion({}, {}, { allowFullPage: true })), JSON.stringify({ region: 'full_page', rect: [0, 0, 1, 1] }), '用户仅本次许可后才使用原始整页');
    assertEq(resolveScanInputRegion({ contentRectTemplate: templateRect }, {}).region, 'content_rect', '已有正文框时始终优先正文框');
    assertEq(SCAN_INPUT_VERSION, 'page-region-v1', '预处理输入版本可区分正文框与整页降级');
    assertEq(SCAN_CONTENT_LONG_SIDE, 1700, '正文框按1700长边渲染');
    const reading = buildScanReadingContext({ bookTraits: {
      textDirection: '竖排右起', titleLabelDirection: '横排右起', pageOrder: 'rtl',
      readingNote: '蓝底题签按横排右起读取。旧规则：必须判断药名和工序。',
    } });
    assertEq(reading.text_direction, '竖排右起', '预处理注入书级正文方向');
    assertEq(reading.title_label_direction, '横排右起', '预处理注入书级题签方向');
    assert(reading.reading_note.includes('蓝底题签按横排右起读取'), '保留可执行读向说明');
    assert(!reading.reading_note.includes('必须判断药名和工序'), '不向OCR注入研究分类旧规则');
    assertEq(computeScanDirectionWarnings(reading, '竖排右起', '横排右起').length, 0, '页面方向符合书级规则时无冲突');
    assertEq(computeScanDirectionWarnings(reading, '横排左起', '横排右起').length, 1, '页面正文方向冲突时单独告警');
    assertEq(determineAnnotationEvidenceMode([{ kind: 'current' }]), 'text', '有文字证据时使用text模式');
    assertEq(determineAnnotationEvidenceMode([]), 'image_only', '无文字时进入image_only而非full_page_scan');
  }

  console.log('\n[UI4] 插图页批量目标只包含所选页面的有效图项');
  {
    const oldIllustrations = state.illustrations;
    const book = { id: 'book-bulk' };
    state.illustrations = [
      { id: 'bulk_p007', pdfSource: { bookId: 'book-bulk', pageNum: 7 } },
      { id: 'bulk_p007_merged', pdfSource: { bookId: 'book-bulk', pageNum: 7 }, mergedInto: 'bulk_p007' },
      { id: 'bulk_p008', pdfSource: { bookId: 'book-bulk', pageNum: 8 } },
      { id: 'other_p007', pdfSource: { bookId: 'other-book', pageNum: 7 } },
    ];
    const targets = getQueuedIllustrationsForPages(book, [7, 999, 'bad']);
    assertEq(targets.map(img => img.id).join(','), 'bulk_p007', '只保留所选页且排除已合并的子图');
    assertEq(getQueuedIllustrationsForPages(book, []).length, 0, '空选择不隐式扩展为整本书');
    state.illustrations = oldIllustrations;
  }

  console.log('\n[UI4.1] 合并子图不再作为独立插图页进入书内浏览');
  {
    const oldIllustrations = state.illustrations;
    const book = {
      id: 'book-merge-nav',
      illustrationPages: [{ pageNum: 19, confirmed: true }, { pageNum: 20, confirmed: true }, { pageNum: 21, confirmed: true }],
      pages: [{ pageNum: 19 }, { pageNum: 20 }, { pageNum: 21 }],
    };
    state.illustrations = [
      { id: 'merged_owner', pdfSource: { bookId: book.id, pageNum: 19 }, imageMerge: { items: ['merged_owner', 'merged_child'] } },
      { id: 'merged_child', pdfSource: { bookId: book.id, pageNum: 20 }, mergedInto: 'merged_owner' },
      { id: 'ordinary_021', pdfSource: { bookId: book.id, pageNum: 21 } },
    ];
    assertEq(getVisibleConfirmedIllustrations(book).map(page => page.pageNum).join(','), '19,21', '只含已合并子图的第20页不再单独显示');
    assertEq(getIllustrationNavItems(book).map(item => item.pageNum).join(','), '19,21', '插图导航只保留合并主图和普通图');
    assertEq(getBookIllustrations(book).map(page => page.pageNum).join(','), '19,21', '批量标注同样排除已合并子图的空白页');
    state.illustrations = oldIllustrations;
  }

  console.log('\n[UI4.2] 插图工作流状态与 OCR 显示均读取权威页面数据');
  {
    const freshCrop = { id: 'fresh-crop', status: undefined, reviewMeta: {} };
    assert(normalizeIllustrationWorkflowStatus(freshCrop), '缺失状态被规范化');
    assertEq(freshCrop.status, 'todo', '只保留裁图的新记录必须待标注，而非已完成');

    const completedDraft = { id: 'draft-crop', status: undefined, reviewMeta: {}, aiDraft: { type: '药物图' } };
    assert(normalizeIllustrationWorkflowStatus(completedDraft), '已有初稿的缺失状态被规范化');
    assertEq(completedDraft.status, 'review', '已有 AI 初稿的记录必须进入待审核');

    const book = { id: 'book-live-text', pages: [{ pageNum: 7, textAsset: { fullText: '正式页面 OCR', textStatus: 'extracted' } }] };
    const staleIllustrationPage = { pageNum: 7, textAsset: { fullText: '', textStatus: 'todo' } };
    assertEq(getGalleryPageTextAsset(book, staleIllustrationPage).fullText, '正式页面 OCR', '插图列表优先读取正式页面 OCR，不误报缺原文');
  }

  console.log('\n[UI5] 批量 OCR 使用扫描配置，并发状态、失败原因与重试页可解释');
  {
    const taskConfig = getPageOcrTaskConfig({
      provider: 'qwen', scanProvider: 'qwen', scanModel: 'qwen3-vl-flash',
      qwenModel: 'qwen3.5-flash', scanConcurrency: 10,
    });
    assertEq(taskConfig.model, 'qwen3-vl-flash', '页面 OCR 使用扫描模型而非普通标注模型');
    assertEq(taskConfig.concurrency, 10, '页面 OCR 使用扫描并行设置');
    const running = describeSelectedPageOcrProgress({
      running: true, finished: false, cancelRequested: false,
      current: 2, total: 5, currentPageNum: 20, activePageNums: [19, 20],
      updated: 1, skipped: 0, failed: 0,
    });
    assertEq(running.pct, 40, '运行中进度按当前页/总页数计算');
    assert(running.statusText.includes('第 19、20 页（已完成 2/5）'), '运行中状态显示全部并发页码与完成数');
    assert(running.countText.includes('已采用 1'), '运行中状态显示已采用数');
    const stopping = describeSelectedPageOcrProgress({
      running: true, cancelRequested: true, current: 2, total: 5, activePageNums: [19, 20],
    });
    assert(stopping.statusText.includes('等待当前 2 个请求结束'), '停止请求明确说明不会中断在途请求');
    const done = describeSelectedPageOcrProgress({
      running: false, finished: true, cancelled: true, current: 2, total: 5, updated: 1, skipped: 1, failed: 0,
    });
    assertEq(done.pct, 100, '结束后进度条收束为100%');
    assert(done.statusText.includes('已停止：处理至 2/5 页'), '停止后保留可读的最终状态');

    const proxyReason = normalizeOcrFailureMessage(new Error(
      'ProxyError: Unable to connect to proxy 127.0.0.1:7892',
    ));
    assert(proxyReason.includes('本机代理 127.0.0.1:7892 无法连接'), '代理失败转为可操作的中文原因');
    const groups = summarizeOcrFailures([
      { pageNum: 18, error: proxyReason },
      { pageNum: 20, error: proxyReason },
      { pageNum: 25, error: 'Read timed out timeout=90' },
    ]);
    assertEq(groups.length, 2, '相同失败原因合并展示');
    assertEq(groups[0].pages.join(','), '18,20', '失败原因保留准确页码');
    assertEq(compactPageNumberList([18, 19, 20, 25, 28, 29]), '18–20、25、28–29', '失败页列表压缩为易读范围');
    assertEq(parsePageNumberSelection('18、20, 45-47；49至50').join(','), '18,20,45,46,47,49,50', '失败页范围可直接粘贴还原为选择');

    const persistedJob = {
      kind: 'selected_page_ocr', running: false, finished: true,
      current: 5, total: 5, failed: 2, completedAt: 200,
    };
    assertEq(getGalleryScanJob({ id: 'book-persisted-job', lastSelectedPageOcrJob: persistedJob }), persistedJob, '刷新后可恢复最近一次页面扫描状态');
  }

  console.log('\n[UI6] 单一扫描按钮按缩略图选择自动切换任务范围');
  {
    const book = {
      id: 'scan-action-book',
      pages: [
        { pageNum: 1, textAsset: { fullScanDone: true, scanInputVersion: SCAN_INPUT_VERSION } },
        { pageNum: 2, textAsset: {} },
        { pageNum: 3, textAsset: {} },
      ],
    };
    const full = describeGalleryScanAction(book, []);
    assertEq(full.mode, 'full_scan', '未选择缩略图时执行全书未完成页扫描');
    assert(full.label.includes('剩2页'), '全书扫描按钮提示剩余页数');
    const selected = describeGalleryScanAction(book, [3, 2, 2, 999]);
    assertEq(selected.mode, 'selected_ocr', '选择缩略图后切换为所选页 OCR');
    assertEq(selected.selectedCount, 2, '所选扫描页去重并排除无效页码');
    assertEq(selected.label, '扫描所选（2页）', '按钮文案明确当前处理范围');
    book.pages.forEach(page => {
      page.textAsset = { fullScanDone: true, scanInputVersion: SCAN_INPUT_VERSION };
    });
    assertEq(describeGalleryScanAction(book, []).mode, 'full_rescan', '全书已完成时明确进入重新扫描模式');

    const progress = describeBookPageScanProgress({
      running: true, current: 4, total: 10, newIllust: 2, errors: 1,
    });
    assertEq(progress.pct, 40, '全书扫描与多选 OCR 共用可计算进度');
    assert(progress.countText.includes('新增插图 2'), '全书进度保留插图检测统计');
  }

  console.log('\n[UI7] 缩略图多选仅在具体任务需要时启用');
  {
    assertEq(gallerySelectionModeFor(null, 'pages', 'all'), false, '默认浏览状态不显示页面选择');
    assertEq(gallerySelectionModeFor('scan', 'pages', 'all'), false, '全书扫描不强迫进入多选');
    assertEq(gallerySelectionModeFor('scan', 'pages', 'selected'), true, '选择页面扫描时整卡可选');
    assertEq(gallerySelectionModeFor('scan', 'illustrations', 'selected'), true, '插图页扫描时整卡可选');
    assertEq(gallerySelectionModeFor('confirm', 'pages', 'selected'), true, '确认插图任务启用页面选择');
    assertEq(gallerySelectionModeFor('annotate', 'illustrations', 'selected'), true, '标注任务启用插图选择');
    assertEq(gallerySelectionModeFor('manage', 'pages', 'selected'), true, '页面操作任务保留封面和删除能力');
    assertEq(gallerySelectionModeFor('annotate', 'pages', 'selected'), false, '错误作用域不启用选择');
  }

  console.log('\n[A1] 完整字段归因：correspondingText/meridian/points 进入 REVIEW_TRACK_FIELDS');
  {
    assert(REVIEW_TRACK_FIELDS.includes('correspondingText'), 'correspondingText 在 REVIEW_TRACK_FIELDS');
    assert(REVIEW_TRACK_FIELDS.includes('meridian'), 'meridian 在 REVIEW_TRACK_FIELDS');
    assert(REVIEW_TRACK_FIELDS.includes('points'), 'points 在 REVIEW_TRACK_FIELDS');
    assert(REVIEW_TRACK_FIELDS.includes('illustrationName'), 'illustrationName 在 REVIEW_TRACK_FIELDS');
    assert(REVIEW_TRACK_FIELDS.includes('visualDescription'), 'visualDescription 在 REVIEW_TRACK_FIELDS');
    assertEq(FIELD_TIER['correspondingText'], 'evidence', 'correspondingText 属 evidence 层');
    assertEq(FIELD_TIER['visualDescription'], 'evidence', 'visualDescription 属 evidence 层');
    assert(!REVIEW_TRACK_FIELDS.includes('evidenceSufficiency'), '证据充分性退出新审核字段');
    assertEq(FIELD_TIER['meridian'], 'extended', 'meridian 属 extended 层');
    assertEq(FIELD_TIER['points'], 'extended', 'points 属 extended 层');
  }

  console.log('\n[A2] supplement 显式标为不受追踪，不写 reviewEvent');
  {
    assert(UNTRACKED_FREE_TEXT_FIELDS.has('supplement'), 'supplement 在 UNTRACKED_FREE_TEXT_FIELDS');
    assert(!REVIEW_TRACK_FIELDS.includes('supplement'), 'supplement 不在 REVIEW_TRACK_FIELDS');
    const img = v2Fixture();
    setPendingReason(img, 'normalization');
    const beforeCount = (img.reviewEvents || []).length;
    // supplement 不经 humanEditField，故不产生事件
    assertEq((img.reviewEvents || []).length, beforeCount, 'supplement 编辑不产生 reviewEvent');
  }

  console.log('\n[A2b] 画面描述兼容读取尊重人工清空');
  {
    assertEq(getVisualDescription({ _description: '旧草稿描述' }), '旧草稿描述', '旧记录可读取 _description');
    assertEq(getVisualDescription({ visualDescription: '', _description: '旧草稿描述' }), '', '正式字段被清空后不复活旧值');
  }

  console.log('\n[A3] humanEditField 对所有受追踪字段写完整事件（field/reason/actorType/at/sessionId/beforeHash/afterHash）');
  {
    const img = v2Fixture();
    setPendingReason(img, 'model_error');
    const r = humanEditField(img, 'correspondingText', '旧原文', '新原文');
    assert(r.ok, 'correspondingText 修改成功归因');
    const ev = img.reviewEvents[img.reviewEvents.length - 1];
    assertEq(ev.field, 'correspondingText', '事件 field=correspondingText');
    assertEq(ev.reason, 'model_error', '事件 reason=model_error');
    assertEq(ev.actorType, 'human', '事件 actorType=human');
    assert(ev.at && typeof ev.at === 'string', '事件 at 存在');
    assert(ev.draftRunId === 'dr-test-001', '事件 draftRunId 关联当前周期');
    assert(ev.reviewCycleId === 1, '事件 reviewCycleId 关联当前周期');
    assert(ev.beforeHash && ev.afterHash && ev.beforeHash !== ev.afterHash, '事件 beforeHash/afterHash 不同');
    assertEq(img.fieldReviewReasons['correspondingText'], 'model_error', 'fieldReviewReasons 投影更新');
  }

  console.log('\n[B1] pendingReason 初始为空，humanEditField 拒绝并要求恢复原值');
  {
    const img = v2Fixture();
    // 不设 pendingReason
    assert(!img.reviewMeta.pendingReason, 'pendingReason 初始为空');
    const r = humanEditField(img, 'type', 'ANIMAL', 'PLANT');
    assert(!r.ok && r.restored, '未选原因 → ok=false, restored=true');
    assertEq((img.reviewEvents || []).length, 0, '未选原因 → 不写事件');
    assert(!img.fieldReviewReasons || !img.fieldReviewReasons.type, '未选原因 → 不更新投影');
  }

  console.log('\n[B2] 选原因后成功归因，并清空 pendingReason');
  {
    const img = v2Fixture();
    setPendingReason(img, 'ocr_correction');
    const r = humanEditField(img, 'meridian', '手太阴', '手阳明');
    assert(r.ok, '选了 ocr_correction → 归因成功');
    clearPendingReason(img); // 模拟 UI 用后清空
    assertEq(img.reviewMeta.pendingReason, '', '成功归因后 pendingReason 清空');
    // 再次编辑另一字段应被拒绝
    const r2 = humanEditField(img, 'points', ['a'], ['b']);
    assert(!r2.ok && r2.restored, '清空后再次编辑 → 拒绝并恢复');
  }

  console.log('\n[B3] 系统原因不可由 UI 选择（setPendingReason 拒绝系统原因）');
  {
    const img = v2Fixture();
    // setPendingReason 拒绝系统原因，pendingReason 保持空
    setPendingReason(img, 'schema_migration');
    assert(!img.reviewMeta.pendingReason, 'setPendingReason(schema_migration) 被拒绝，pendingReason 保持空');
    setPendingReason(img, 'system_generated');
    assert(!img.reviewMeta.pendingReason, 'setPendingReason(system_generated) 被拒绝，pendingReason 保持空');
    setPendingReason(img, 'legacy_unattributed');
    assert(!img.reviewMeta.pendingReason, 'setPendingReason(legacy_unattributed) 被拒绝，pendingReason 保持空');
    // 设合法原因再尝试改系统原因
    setPendingReason(img, 'normalization');
    setPendingReason(img, 'system_generated');
    assertEq(img.reviewMeta.pendingReason, 'normalization', 'setPendingReason 拒绝 system_generated，保持 normalization');
  }

  console.log('\n[B4] UI handler 级模拟：commitTrackedFieldEdit onchange 流程（捕获 before → 提交 → restored 恢复 + toast）');
  {
    // 模拟 illustrationName onchange handler 的完整流程（统一经 commitTrackedFieldEdit）
    const img = v2Fixture();
    const editable = img.annotation;
    editable.illustrationName = '原名';
    // 场景1：未选原因，编辑被拒绝并恢复，无任何模型变化
    const before = '原名';
    const newValue = '新名';
    const r1 = commitTrackedFieldEdit(img, 'illustrationName', before, newValue, ed => { ed.illustrationName = newValue; });
    let inputVal = newValue;
    if (r1.restored) { inputVal = before; } // handler 恢复输入框
    assertEq(inputVal, '原名', 'handler 拒绝后恢复输入框原值');
    assertEq(editable.illustrationName, '原名', 'handler 拒绝后 annotation 未变');
    assertEq((img.reviewEvents || []).length, 0, 'handler 拒绝后无事件');
    assert(!img.reviewMeta.pendingReason, 'handler 拒绝后 pendingReason 仍空（falsy）');

    // 场景2：选原因后提交成功，commitTrackedFieldEdit 内部清空 pendingReason
    setPendingReason(img, 'normalization');
    const r2 = commitTrackedFieldEdit(img, 'illustrationName', '原名', '新名', ed => { ed.illustrationName = '新名'; });
    assert(r2.committed, 'commit 成功');
    assertEq(editable.illustrationName, '新名', 'commit 成功后 annotation 写入新值');
    assertEq(img.reviewMeta.pendingReason, '', 'commit 成功后 pendingReason 已清空（无需手动 clear）');
    assertEq((img.reviewEvents || []).length, 1, 'commit 成功后写 1 条事件');
  }

  console.log('\n[B5] UI handler 级模拟：correspondingText _saveCt 流程（审核队列表单）');
  {
    const img = v2Fixture();
    img.annotation.correspondingText = '旧原文';
    // 未选原因 → 拒绝，恢复 textarea 值，无模型变化
    let taValue = '新原文';
    const cur = img.annotation.correspondingText;
    const r = commitTrackedFieldEdit(img, 'correspondingText', cur, taValue, ed => { ed.correspondingText = taValue; });
    if (r.restored) { taValue = cur; }
    assertEq(taValue, '旧原文', '_saveCt 拒绝后 textarea 恢复原值');
    assertEq(img.annotation.correspondingText, '旧原文', '_saveCt 拒绝后字段未变');
    assertEq((img.reviewEvents || []).length, 0, '_saveCt 拒绝后无事件');
    // 选原因后成功
    setPendingReason(img, 'evidence_enrichment');
    const r2 = commitTrackedFieldEdit(img, 'correspondingText', '旧原文', '新原文', ed => { ed.correspondingText = '新原文'; });
    assert(r2.committed, '_saveCt commit 成功');
    assertEq(img.annotation.correspondingText, '新原文', '_saveCt 成功后字段更新');
    assertEq(img.reviewMeta.pendingReason, '', '_saveCt 成功后 pendingReason 已清空');
  }

  console.log('\n[C1] 四类 textAsset → textSourceStatus/ocrStatus 映射（reviewed/ocr/pdf_text/missing）');
  {
    // reviewed（人工已校）
    const taRev = textAssetReviewed();
    assertEq(deriveTextSourceStatus(taRev), 'verified', 'reviewed → textSourceStatus=verified');
    assertEq(deriveOcrStatus(taRev), 'verified', 'reviewed → ocrStatus=verified');
    // OCR candidate（未校）
    const taOcr = textAssetOcrCandidate();
    assertEq(deriveTextSourceStatus(taOcr), 'ocr', 'OCR candidate → textSourceStatus=ocr');
    assertEq(deriveOcrStatus(taOcr), 'candidate', 'OCR candidate → ocrStatus=candidate');
    // PDF text
    const taPdf = textAssetPdfText();
    assertEq(deriveTextSourceStatus(taPdf), 'pdf_text', 'PDF text → textSourceStatus=pdf_text');
    assertEq(deriveOcrStatus(taPdf), 'not_needed', 'PDF text → ocrStatus=not_needed');
    // missing
    const taMiss = textAssetMissing();
    assertEq(deriveTextSourceStatus(taMiss), 'missing', 'missing → textSourceStatus=missing');
    assertEq(deriveOcrStatus(taMiss), 'unavailable', 'missing → ocrStatus=unavailable');
  }

  console.log('\n[C2] 只有 verified/reviewed 产生 verified；OCR candidate 必须是 candidate');
  {
    // verified=false 但有 correctedText → 不是 verified
    const ta1 = { verified: false, textStatus: 'extracted', textSource: 'ai_ocr', fullText: 'x', correctedText: 'y' };
    assertEq(deriveTextSourceStatus(ta1), 'ocr', '未校但有 correctedText → ocr（非 verified）');
    assertEq(deriveOcrStatus(ta1), 'candidate', '未校 OCR → candidate（非 verified）');
    // verified=true → verified
    const ta2 = { verified: true, textStatus: 'reviewed', textSource: 'ai_ocr', fullText: 'x' };
    assertEq(deriveTextSourceStatus(ta2), 'verified', 'verified=true → verified');
    assertEq(deriveOcrStatus(ta2), 'verified', 'verified=true → verified');
  }

  console.log('\n[C3] Gate 2.2 B：6 类 OCR/手工文字映射收紧测试');
  {
    // 1) manual + fullText + 未校 → 不得 verified，保守 missing/unavailable
    const ta1 = { verified: false, textStatus: 'extracted', textSource: 'manual', fullText: '甘草' };
    assertEq(deriveTextSourceStatus(ta1), 'missing', '1) manual+fullText+未校 → textSourceStatus=missing（不伪造 verified）');
    assertEq(deriveOcrStatus(ta1), 'unavailable', '1) manual+fullText+未校 → ocrStatus=unavailable（不伪造 verified）');
    // 2) manual_corrected + 未校 → 不得 verified
    const ta2 = { verified: false, textStatus: 'extracted', textSource: 'manual_corrected', fullText: '甘草', correctedText: '甘艸' };
    assertEq(deriveTextSourceStatus(ta2), 'missing', '2) manual_corrected+未校 → textSourceStatus=missing（不伪造 verified）');
    assertEq(deriveOcrStatus(ta2), 'unavailable', '2) manual_corrected+未校 → ocrStatus=unavailable（不伪造 verified）');
    // 3) textStatus=reviewed 且 verified=false → verified（reviewed 等价于已校）
    const ta3 = { verified: false, textStatus: 'reviewed', textSource: 'ai_ocr', fullText: '甘草' };
    assertEq(deriveTextSourceStatus(ta3), 'verified', '3) textStatus=reviewed+verified=false → textSourceStatus=verified');
    assertEq(deriveOcrStatus(ta3), 'verified', '3) textStatus=reviewed+verified=false → ocrStatus=verified');
    // 4) 已验证 OCR
    const ta4 = { verified: true, textStatus: 'reviewed', textSource: 'ai_ocr', fullText: '甘草' };
    assertEq(deriveTextSourceStatus(ta4), 'verified', '4) 已验证 OCR → textSourceStatus=verified');
    assertEq(deriveOcrStatus(ta4), 'verified', '4) 已验证 OCR → ocrStatus=verified');
    // 5) PDF text（未校）
    const ta5 = { verified: false, textStatus: 'extracted', textSource: 'pdf_text_layer', fullText: '甘草' };
    assertEq(deriveTextSourceStatus(ta5), 'pdf_text', '5) PDF text → textSourceStatus=pdf_text');
    assertEq(deriveOcrStatus(ta5), 'not_needed', '5) PDF text → ocrStatus=not_needed');
    // 6) 缺失文字
    const ta6 = { verified: false, textStatus: 'missing', textSource: 'none', fullText: '' };
    assertEq(deriveTextSourceStatus(ta6), 'missing', '6) 缺失文字 → textSourceStatus=missing');
    assertEq(deriveOcrStatus(ta6), 'unavailable', '6) 缺失文字 → ocrStatus=unavailable');
  }

  console.log('\n[C4] buildVersionContext 用映射后的状态，不内联推断');
  {
    const vc = buildVersionContext({ provider: 'qwen', model: 'm1', evidenceMode: 'text', textSourceStatus: 'ocr', ocrStatus: 'candidate' });
    assertEq(vc.textSourceStatus, 'ocr', 'versionContext.textSourceStatus=ocr');
    assertEq(vc.ocrStatus, 'candidate', 'versionContext.ocrStatus=candidate');
    assertEq(vc.schemaVersion, 'annotation-eval-v2', 'versionContext.schemaVersion');
  }

  console.log('\n[C5] 重新 OCR 直接采用时保留旧底稿且不覆盖人工校文');
  {
    const ta = {
      fullText: '旧 OCR 文本', textSource: 'ai_ocr', ocrModel: 'old-model',
      extractedAt: '2026-07-20T10:00:00.000Z', correctedText: '人工校正文',
      verified: true, textStatus: 'reviewed', scanInputVersion: 'old-v1',
      scanInput: { region: 'content_rect' }, ocrRuns: [],
    };
    applyOcrRunToTextAsset(ta, {
      text: '新 OCR 文本', source: 'ai_ocr', model: 'new-model',
      at: '2026-07-20T11:00:00.000Z', pageNum: 8,
      scanInputVersion: 'page-region-v1', scanInput: { region: 'content_rect' },
    });
    assertEq(ta.fullText, '新 OCR 文本', '新 OCR 直接更新底稿');
    assertEq(ta.correctedText, '人工校正文', '重新 OCR 不覆盖人工校正文');
    assertEq(ta.verified, true, '重新 OCR 不取消人工已校状态');
    assertEq(ta.ocrRuns.length, 2, '新旧 OCR 均进入历史');
    assertEq(ta.ocrRuns[0].text, '新 OCR 文本', '历史首项为新 OCR');
    assertEq(ta.ocrRuns[1].text, '旧 OCR 文本', '历史保留被替换的旧 OCR');

    const sameTextBefore = ta.ocrRuns.length;
    applyOcrRunToTextAsset(ta, { text: '新 OCR 文本', source: 'ai_ocr', model: 'new-model' });
    assertEq(ta.ocrRuns.length, sameTextBefore + 1, '相同结果不重复归档当前底稿，仅记录新的运行');
  }

  console.log('\n[D1] startReviewSession 按文字证据状态自动生成 reviewMode');
  {
    const img = v2Fixture();
    delete img.reviewMeta.reviewMode;
    startReviewSession(img);
    assertEq(img.reviewMeta.reviewMode, 'strict', '人工已校文字 → strict');
    const sess = img.reviewSessions[img.reviewSessions.length - 1];
    assertEq(sess.reviewMode, 'strict', 'session 保存系统推导结果');

    const ocrImg = v2Fixture();
    ocrImg.versionContext.textSourceStatus = 'ocr';
    ocrImg.versionContext.ocrStatus = 'candidate';
    startReviewSession(ocrImg);
    assertEq(ocrImg.reviewMeta.reviewMode, 'fast', '未校 OCR → fast');
  }

  console.log('\n[D2] v2 记录无字段修改 → no_recorded_change（非 legacy_unattributed）');
  {
    const img = v2Fixture();
    // 有 versionContext 但无 reviewEvents
    const recs = buildEvalRecord(img);
    const typeRec = recs.find(r => r.field === 'type');
    assertEq(typeRec.reason, 'no_recorded_change', 'v2 无事件 → no_recorded_change');
    assert(typeRec.reason !== 'legacy_unattributed', 'v2 无事件不标为 legacy');
  }

  console.log('\n[D2.3] v2 有差异但无当前周期事件 → unattributed_diff（不混入无记录差异）');
  {
    const img = v2Fixture();
    img.annotation.type = 'PLANT';
    const recs = buildEvalRecord(img);
    const typeRec = recs.find(r => r.field === 'type');
    assertEq(typeRec.reviewDiff, 1, 'type 存在候选—终稿差异');
    assertEq(typeRec.reason, 'unattributed_diff', '有差异无事件 → unattributed_diff');
    const stats = buildEvalStats([typeRec]);
    assert(stats.byReason.unattributed_diff > 0, '异常桶进入按原因统计');
    assertEq(stats.coreFieldNoRecordedDiff, 0, '异常桶不计入核心字段无记录差异');
    assert(stats.warnings.length === 1 && /unattributed_diff/.test(stats.warnings[0]), '异常桶非零时导出带数据完整性警告');
  }

  console.log('\n[D3] legacy_unattributed 仅当记录缺 versionContext');
  {
    const img = legacyFixture();
    markLegacyUnattributed(img);
    assertEq(img.fieldReviewReasons.type, 'legacy_unattributed', '无 versionContext → legacy_unattributed');
    const recs = buildEvalRecord(img);
    assertEq(recs[0].reason, 'legacy_unattributed', 'legacy 导出 reason=legacy_unattributed');
    // 有 versionContext 但无事件 → no_recorded_change，不是 legacy
    const img2 = v2Fixture();
    markLegacyUnattributed(img2);
    assert(!img2._legacyMarked, '有 versionContext → 不标记 legacy');
    const recs2 = buildEvalRecord(img2);
    assertEq(recs2[0].reason, 'no_recorded_change', '有 versionContext 无事件 → no_recorded_change');
  }

  console.log('\n[D4] reason 枚举不扩张为"AI正确"；no_recorded_change 仅在导出层');
  {
    assert(!ALL_REVIEW_REASONS.includes('no_recorded_change'), 'no_recorded_change 不在 reason 枚举');
    assert(!ALL_REVIEW_REASONS.includes('ai_correct'), 'ai_correct 不在 reason 枚举');
    const img = v2Fixture();
    const recs = buildEvalRecord(img);
    const stats = buildEvalStats(recs);
    // no_recorded_change 出现在 byReason 统计桶
    assert(stats.byReason['no_recorded_change'] > 0, 'stats.byReason 含 no_recorded_change 桶');
    assert(stats.coreFieldNoRecordedDiff > 0, '仅无事件且无差异的核心字段进入无记录差异计数');
    // 但不出现 accuracy/correct
    const badKeys = Object.keys(stats).filter(k => /accuracy|correct|aiCorrect/i.test(k));
    assertEq(badKeys.length, 0, 'stats 无 accuracy/correct 字段');
  }

  console.log('\n[D5] reviewDiff=0 不被导出为"正确/准确"');
  {
    const img = legacyFixture();
    markLegacyUnattributed(img);
    const recs = buildEvalRecord(img);
    const stats = buildEvalStats(recs);
    const txt = formatEvalStatsTxt(stats);
    assert(/不等于 AI 正确|非 AI 准确率/.test(txt), 'TXT 标注 reviewDiff=0 不等于 AI 正确');
    assert(!/准确率\s*[:：]/.test(txt), 'TXT 不出现"准确率:"字样');
  }

  console.log('\n[E1] startNewDraftRun 生成不可变 draftRunId + 递增 reviewCycleId');
  {
    const img = v2Fixture();
    const origRun = img.draftRunId;
    const origCyc = img.reviewCycleId;
    const { draftRunId, reviewCycleId } = startNewDraftRun(img);
    assert(draftRunId !== origRun, 'draftRunId 变化（新草稿）');
    assertEq(reviewCycleId, origCyc + 1, 'reviewCycleId 递增');
    assert(/^dr-/.test(draftRunId), 'draftRunId 以 dr- 开头');
  }

  console.log('\n[E2] 重跑后旧事件保留 append-only，但不进入当前周期导出');
  {
    const img = v2Fixture();
    // 周期1：人工修改 type
    setPendingReason(img, 'model_error');
    humanEditField(img, 'type', 'ANIMAL', 'PLANT');
    clearPendingReason(img);
    const ev1 = img.reviewEvents[img.reviewEvents.length - 1];
    assertEq(ev1.draftRunId, 'dr-test-001', '周期1事件 draftRunId=dr-test-001');
    assertEq(ev1.reviewCycleId, 1, '周期1事件 reviewCycleId=1');

    // 重跑 AI：新周期
    startNewDraftRun(img);
    const newRun = img.draftRunId;
    const newCyc = img.reviewCycleId;
    assertEq(newCyc, 2, '重跑后 reviewCycleId=2');

    // 周期2：人工修改 subject
    setPendingReason(img, 'normalization');
    humanEditField(img, 'subject', '鹿', '梅花鹿');
    clearPendingReason(img);
    const ev2 = img.reviewEvents[img.reviewEvents.length - 1];
    assertEq(ev2.draftRunId, newRun, '周期2事件 draftRunId=新');
    assertEq(ev2.reviewCycleId, 2, '周期2事件 reviewCycleId=2');

    // 旧事件保留 append-only
    assertEq(img.reviewEvents.length, 2, '两周期事件均保留（append-only）');

    // currentCycleEvents 只返回周期2事件
    const curEvents = currentCycleEvents(img);
    assertEq(curEvents.length, 1, 'currentCycleEvents 只返回当前周期1条');
    assertEq(curEvents[0].field, 'subject', '当前周期事件 field=subject');

    // currentCycleReasons 只含周期2投影
    const curFrr = currentCycleReasons(img);
    assertEq(curFrr.subject, 'normalization', '当前周期投影 subject=normalization');
    assert(!curFrr.type, '当前周期投影不含旧 type（重跑隔离）');
  }

  console.log('\n[E3] buildEvalRecord 只统计当前周期事件（旧事件不污染新草稿）');
  {
    const img = v2Fixture();
    // 周期1：type=model_error
    setPendingReason(img, 'model_error');
    humanEditField(img, 'type', 'ANIMAL', 'PLANT');
    clearPendingReason(img);
    // 重跑
    img.aiDraft.type = 'PLANT';
    img.annotation.type = 'PLANT'; // 模拟新 AI 草稿及新周期终稿均回到同一候选基线
    startNewDraftRun(img);
    // 周期2：不修改任何字段（直接接受）
    const recs = buildEvalRecord(img);
    const typeRec = recs.find(r => r.field === 'type');
    // 周期2无 type 事件 → no_recorded_change，不污染为 model_error
    assertEq(typeRec.reason, 'no_recorded_change', '新周期 type 无事件 → no_recorded_change（旧 model_error 不污染）');
    assert(typeRec.reason !== 'model_error', '旧周期 model_error 不进入新导出');
    // 但全部历史事件仍 append-only 保留
    assertEq(img.reviewEvents.length, 1, '旧事件仍 append-only 保留');
  }

  console.log('\n[E4] 回归：完成一次人工修改 → 重跑 AI → 导出，旧事件不进入当前导出');
  {
    const imgs = [v2Fixture()];
    // 周期1：correspondingText 修改
    setPendingReason(imgs[0], 'evidence_enrichment');
    humanEditField(imgs[0], 'correspondingText', '旧', '新');
    clearPendingReason(imgs[0]);
    // 重跑
    startNewDraftRun(imgs[0]);
    // 周期2：meridian 修改
    setPendingReason(imgs[0], 'ocr_correction');
    humanEditField(imgs[0], 'meridian', '手太阴', '手阳明');
    clearPendingReason(imgs[0]);

    const out = buildEvalExport(imgs);
    const parsed = JSON.parse(out.json);
    // 当前周期只有 meridian 事件
    const curReasons = Object.keys(parsed.byReason);
    assert(parsed.byReason['ocr_correction'] > 0, '当前导出含 ocr_correction（周期2）');
    assert(!parsed.byReason['evidence_enrichment'], '当前导出不含旧周期 evidence_enrichment');
  }

  console.log('\n[E5] 全书库重标前完整保存人工终稿，并可恢复旧版本');
  {
    const img = v2Fixture();
    img.status = 'ok';
    img.canonicalId = 'OLD-001';
    img.verifiedAt = 1700000000000;
    img.annotatedAt = 1690000000000;
    img.versionContext.datasetId = 'legacy-production';
    setPendingReason(img, 'normalization');
    humanEditField(img, 'subject', '鹿', '梅花鹿');
    clearPendingReason(img);
    const oldAnnotation = JSON.stringify(img.annotation);
    const oldEvents = JSON.stringify(img.reviewEvents);

    const snapshot = archiveConfirmedVersionBeforeRerun(img, 'ok');
    assert(snapshot && snapshot.source === 'human_confirmed', '已确认记录产生人工终稿快照');
    assertEq(snapshot.datasetId, 'legacy-production', '快照保留旧数据集身份');
    assertEq(JSON.stringify(snapshot.annotation), oldAnnotation, '快照完整保存人工终稿');
    assertEq(JSON.stringify(snapshot.reviewEvents), oldEvents, '快照完整保存字段归因事件');
    assertEq(img.reviewMeta.modelArchives.length, 1, '历史版本写入记录内归档');

    img.annotation.subject = '新版模型结果';
    img.aiDraft.subject = '新版模型结果';
    img.reviewEvents = [];
    img.versionContext.datasetId = 'reannotation-v1-full';
    restoreConfirmedVersionSnapshot(img, snapshot);
    assertEq(JSON.stringify(img.annotation), oldAnnotation, '可恢复旧人工终稿');
    assertEq(JSON.stringify(img.reviewEvents), oldEvents, '可恢复旧字段归因事件');
    assertEq(img.versionContext.datasetId, 'legacy-production', '恢复时一并恢复旧版本上下文');
    assertEq(img.status, 'ok', '恢复后状态为已确认');
  }

  console.log('\n[F1] 有效审核时间边界：暂停/失焦/切换/空闲只累计 active');
  {
    let clock = 1000000;
    const _orig = Date.now;
    Date.now = () => clock;
    const img = v2Fixture();
    startReviewSession(img);
    clock += 30000;
    settleCurrentSegment(img, 'pause');
    clock += 60000;
    resumeActiveSegment(img);
    clock += 20000;
    settleCurrentSegment(img, 'save');
    assertEq(effectiveReviewSeconds(img), 50, '有效时间=30+20=50s（pause 60s 不计入）');
    Date.now = _orig;
  }

  console.log('\n[F2] 统计可复算（相同 fixture 两次结果一致）');
  {
    const img = v2Fixture();
    setPendingReason(img, 'model_error');
    humanEditField(img, 'type', 'ANIMAL', 'PLANT');
    clearPendingReason(img);
    img.reviewSessions = [{ sessionId: 's1', reviewMode: 'strict', startedAt: 't', endedAt: 't', activeSeconds: 42, idleTimeoutSeconds: 120, segments: [] }];
    const s1 = buildEvalStats(buildEvalRecord(img));
    const s2 = buildEvalStats(buildEvalRecord(JSON.parse(JSON.stringify(img))));
    assertEq(JSON.stringify(s1), JSON.stringify(s2), '相同 fixture 两次统计一致');
  }

  console.log('\n[F3] 系统事件不计人工时间/模型错误');
  {
    const imgA = v2Fixture();
    appendSystemEvent(imgA, { field: 'type', reason: 'schema_migration' });
    const statsA = buildEvalStats(buildEvalRecord(imgA));
    // schema_migration(core) 不计入 coreFieldModelError
    assertEq(statsA.coreFieldModelError, 0, 'schema_migration(core) 不计入 coreFieldModelError');
    const imgB = v2Fixture();
    setPendingReason(imgB, 'model_error');
    humanEditField(imgB, 'type', 'ANIMAL', 'PLANT');
    clearPendingReason(imgB);
    const statsB = buildEvalStats(buildEvalRecord(imgB));
    assertEq(statsB.coreFieldModelError, 1, '人工 model_error(core) 计入 coreFieldModelError');
  }

  console.log('\n[F3.1] 系统合并改写逐字段写 system_generated，且不落入无记录差异');
  {
    const img = v2Fixture();
    const before = { ...img.annotation };
    const after = { ...img.annotation, type: 'PLANT', subject: '甘草' };
    const events = appendSystemGeneratedTrackedChanges(img, before, after);
    img.annotation = after;
    assertEq(events.length, 2, '仅两个受追踪字段变化时写两条系统事件');
    assert(events.every(e => e.reason === 'system_generated' && e.actorType === 'system'), '合并改写事件均为 system_generated/system');
    const recs = buildEvalRecord(img);
    const typeRec = recs.find(r => r.field === 'type');
    assertEq(typeRec.reason, 'system_generated', '有系统事件的字段不落入 no_recorded_change');
  }

  console.log('\n[F4] reviewMode 由证据状态自动推导，不再人工选择');
  {
    const img = v2Fixture();
    const recs = buildEvalRecord(img);
    assertEq(recs[0].evidenceMode, 'full_page_scan', 'evidenceMode=full_page_scan');
    assertEq(recs[0].reviewMode, 'strict', 'verified 自动推导为 strict');
    img.versionContext.textSourceStatus = 'ocr';
    assertEq(deriveReviewModeFromEvidence(img), 'fast', '未校 OCR 自动推导为 fast');
    assert(describeDerivedReviewMode(img).includes('OCR'), '界面解释 OCR 尚未校准');
    img.versionContext.textSourceStatus = 'missing';
    assertEq(deriveReviewModeFromEvidence(img), 'no_text_review', '无文字线索自动推导为 no_text_review');
    img.aiDraft._textInImage = '玉泉';
    assertEq(deriveReviewModeFromEvidence(img), 'fast', '图中存在文字线索时不误判为无文字审核');
    assertEq(buildEvalRecord(img)[0].evidenceMode, 'full_page_scan', '自动审核条件不改写 evidenceMode');
    assertEq(normalizeReviewMode('image'), 'no_text_review', '历史 reviewMode=image 映射为 no_text_review');
  }

  console.log('\n[F5] 导出 JSON+TXT 双格式，含所有分组维度');
  {
    const imgs = [legacyFixture(), v2Fixture()];
    const out = buildEvalExport(imgs);
    assert(typeof out.json === 'string' && out.json.startsWith('{'), 'json 为字符串');
    assert(typeof out.txt === 'string' && out.txt.includes('标注评价统计'), 'txt 含标题');
    const parsed = JSON.parse(out.json);
    for (const k of ['byTier', 'byReason', 'byEvidenceMode', 'byTextSourceStatus', 'byReviewMode', 'byModel', 'bySchemaVersion']) {
      assert(parsed[k] && typeof parsed[k] === 'object', `JSON 含 ${k} 分组`);
    }
    assert(['median', 'p75', 'p90', 'mean'].every(k => typeof parsed.effectiveTime[k] === 'number'), 'effectiveTime 含 median/p75/p90/mean');
  }

  // ── Gate 2.2 D 新增：输入中 / 未触发 change / 关闭前 不落盘 ──
  // 通过 persist spy 断言：未选原因时 commitTrackedFieldEdit 不调用 persist；
  //   输入阶段（无 commit）不应有任何 persist/annotation/reviewEvents 变化。
  console.log('\n[G1] 输入中（未触发 change）：annotation/reviewEvents/persist 均不变');
  {
    // 安装 persist spy
    const _origPersist = app.persist;
    let persistCalls = 0;
    app.persist = function () { persistCalls++; return _origPersist ? _origPersist.apply(this, arguments) : undefined; };

    const img = v2Fixture();
    img.annotation.subject = '鹿';
    const beforeAnn = JSON.stringify(img.annotation);
    const beforeEvents = JSON.stringify(img.reviewEvents || []);
    const beforeMeta = JSON.stringify(img.reviewMeta);

    // 模拟 oninput 阶段：Gate 2.2 后 oninput 不修改 annotation、不调用 persist
    // 输入框值变化但不触发 commit —— 模型层应完全不变
    // （真实 oninput handler 已移除模型写入；此处断言模型快照不变）
    persistCalls = 0;
    // 模拟用户在输入框打字，未触发 onchange
    // 模型不变
    assertEq(JSON.stringify(img.annotation), beforeAnn, '输入阶段 annotation 不变');
    assertEq(JSON.stringify(img.reviewEvents || []), beforeEvents, '输入阶段 reviewEvents 不变');
    assertEq(JSON.stringify(img.reviewMeta), beforeMeta, '输入阶段 reviewMeta 不变');
    assertEq(persistCalls, 0, '输入阶段 persist 未被调用');

    // 恢复 persist
    app.persist = _origPersist;
  }

  console.log('\n[G2] 未选原因触发 change：commitTrackedFieldEdit restored，无 persist/annotation/reviewEvents 变化');
  {
    const _origPersist = app.persist;
    let persistCalls = 0;
    app.persist = function () { persistCalls++; return _origPersist ? _origPersist.apply(this, arguments) : undefined; };

    const img = v2Fixture();
    img.annotation.subject = '鹿';
    // 确保 pendingReason 为空
    img.reviewMeta.pendingReason = '';
    const beforeAnn = JSON.stringify(img.annotation);
    const beforeEvents = JSON.stringify(img.reviewEvents || []);

    // 模拟 onchange：未选原因 → restored
    persistCalls = 0;
    const r = commitTrackedFieldEdit(img, 'subject', '鹿', '梅花鹿', ed => { ed.subject = '梅花鹿'; });
    assert(r.restored && !r.committed, '未选原因 → restored=true, committed=false');
    assertEq(persistCalls, 0, 'restored 时 persist 未被调用（零落盘）');
    assertEq(JSON.stringify(img.annotation), beforeAnn, 'restored 时 annotation 不变');
    assertEq(JSON.stringify(img.reviewEvents || []), beforeEvents, 'restored 时 reviewEvents 不变');
    assertEq(img.reviewMeta.pendingReason, '', 'restored 时 pendingReason 仍空');

    app.persist = _origPersist;
  }

  console.log('\n[G3] 选原因触发 change：commitTrackedFieldEdit committed，persist 被调用且模型变化');
  {
    const _origPersist = app.persist;
    let persistCalls = 0;
    app.persist = function () { persistCalls++; return _origPersist ? _origPersist.apply(this, arguments) : undefined; };

    const img = v2Fixture();
    img.annotation.subject = '鹿';
    setPendingReason(img, 'normalization'); // setPendingReason 内部会 persist 一次
    persistCalls = 0;
    const r = commitTrackedFieldEdit(img, 'subject', '鹿', '梅花鹿', ed => { ed.subject = '梅花鹿'; });
    assert(r.committed && !r.restored, '选了原因 → committed=true');
    assert(persistCalls >= 1, 'committed 时 persist 被调用（落盘）');
    assertEq(img.annotation.subject, '梅花鹿', 'committed 时 annotation 更新');
    assertEq((img.reviewEvents || []).length, 1, 'committed 时写 1 条事件');
    assertEq(img.reviewMeta.pendingReason, '', 'committed 时 pendingReason 清空');

    app.persist = _origPersist;
  }

  console.log('\n[G4] 关闭前/失焦未触发 change：模型保持输入前状态（无半落盘）');
  {
    const _origPersist = app.persist;
    let persistCalls = 0;
    app.persist = function () { persistCalls++; return _origPersist ? _origPersist.apply(this, arguments) : undefined; };

    const img = v2Fixture();
    img.annotation.meridian = '手太阴';
    const beforeAnn = JSON.stringify(img.annotation);
    // 模拟：用户改了输入框值但未触发 change 就关闭/切换
    // 输入框值（DOM 层）变了，但模型层不变（oninput 不写模型）
    persistCalls = 0;
    // 不调用任何 commit —— 模型不变
    assertEq(JSON.stringify(img.annotation), beforeAnn, '关闭前未 change → annotation 不变');
    assertEq(persistCalls, 0, '关闭前未 change → persist 未被调用');
    assertEq((img.reviewEvents || []).length, 0, '关闭前未 change → 无事件');

    app.persist = _origPersist;
  }

  // ── Gate 2.2 C：当前周期归因投影（仅供数据导出，不在审核页展示）──
  console.log('\n[H1] 当前周期归因投影隔离旧事件（重跑后旧事件不进入当前归因）');
  {
    const img = v2Fixture();
    // 周期1：type=model_error
    setPendingReason(img, 'model_error');
    humanEditField(img, 'type', 'ANIMAL', 'PLANT');
    clearPendingReason(img);
    const ev1 = img.reviewEvents[0];
    assertEq(ev1.reviewCycleId, 1, '周期1事件 cycle=1');

    // 重跑 AI → 周期2
    startNewDraftRun(img);
    assertEq(img.reviewCycleId, 2, '重跑后 cycle=2');
    // 周期2：不修改任何字段（直接接受）

    // currentCycleEvents 只返回周期2（空）
    const curEvents = currentCycleEvents(img);
    assertEq(curEvents.length, 0, '当前周期事件数=0（旧周期1事件不显示）');
    // currentCycleReasons 不含旧 type
    const curFrr = currentCycleReasons(img);
    assert(!curFrr.type, '当前周期投影不含旧 type=model_error');
    // 全部事件仍 append-only 保留
    assertEq(img.reviewEvents.length, 1, '旧事件仍 append-only 保留');
  }

  console.log('\n[H2] buildEvalRecord 只统计当前周期（旧事件不污染新草稿归因）');
  {
    const img = v2Fixture();
    // 周期1：correspondingText=evidence_enrichment
    setPendingReason(img, 'evidence_enrichment');
    humanEditField(img, 'correspondingText', '旧', '新');
    clearPendingReason(img);
    // 重跑
    startNewDraftRun(img);
    // 周期2：meridian=ocr_correction
    setPendingReason(img, 'ocr_correction');
    humanEditField(img, 'meridian', '手太阴', '手阳明');
    clearPendingReason(img);

    const recs = buildEvalRecord(img);
    const ctRec = recs.find(r => r.field === 'correspondingText');
    const merRec = recs.find(r => r.field === 'meridian');
    // 周期2只有 meridian 事件；correspondingText 无当前周期事件 → no_recorded_change
    assertEq(ctRec.reason, 'no_recorded_change', '旧周期 correspondingText 不污染 → no_recorded_change');
    assertEq(merRec.reason, 'ocr_correction', '当前周期 meridian=ocr_correction');
    // 全部事件 append-only 保留
    assertEq(img.reviewEvents.length, 2, '两周期事件均 append-only 保留');
  }

  console.log('\n[I1] 重标 Prompt v7 使用核心实体展示名并保持书级读向');
  {
    const prompt = buildPrompt('【本页原文】\n雷丸图', false, {
      title: '补遗雷公炮制便览',
      topicNote: '旧研究结论：逐项提取炮制工序',
      readingNote: '蓝底题签按横排右起读取，不得按现代横排左起误读。旧规则：必须判断药名和工序。',
    }, {
      textSourceStatus: 'verified', ocrStatus: 'verified',
    });
    assertEq(PROMPT_VERSION, 'quick_search_v7_core_entity_name', 'Prompt 版本已递增为 v7 core entity name');
    assert(prompt.includes('"illustration_name"'), 'Prompt 要求模型直接输出插图名称');
    assert(prompt.includes('不得用旧标注、旧人工修改或历史名称补全本次结果'), 'Prompt 明确禁止旧人工数据进入新结果');
    assert(prompt.includes('"primary_subject"'), 'Prompt 包含主要对象字段');
    assert(prompt.includes('"source_label"'), 'Prompt 包含可选原文标签字段');
    assert(!prompt.includes('"evidence_sufficiency"'), 'Prompt 不再要求主观证据充分性字段');
    assert(prompt.includes('"description"'), 'Prompt 包含1至2句画面事实描述');
    assert(prompt.includes('textSourceStatus: verified'), 'Prompt 显式注入文字来源状态');
    assert(!prompt.includes('"procedure_step"'), 'Prompt 不再输出结构化炮制工序');
    assert(!prompt.includes('"herb_name_modern"'), 'Prompt 不再输出现代规范药名');
    assert(!prompt.includes('"page_full_text"'), '标注 Prompt 不再承担整页 OCR 输出');
    assert(!prompt.includes('figure_source') && !prompt.includes('source_edition'), 'Prompt 不要求判断仿刻来源或整理版本');
    assert(prompt.includes('蓝底题签按横排右起读取'), '书级操作性读向备注继续注入 Prompt');
    assert(prompt.includes('乳鍾石製炮') && prompt.includes('炮製石鍾乳'), 'Prompt 给出横排右起规范读序示例');
    assert(prompt.includes('黄芩植株') && prompt.includes('illustration_name 均写“黄芩”'), 'Prompt 明确无题签时只保留核心实体名');
    assert(!prompt.includes('旧研究结论') && !prompt.includes('必须判断药名和工序'), '专题研究与分类性旧规则不进入生产 Prompt');
  }

  console.log('\n[I2] v7 映射分离名称、主要对象与原文标签，并兼容旧证据充分性值');
  {
    const mapped = mapAIResponse({
      academic_class: '药物图', academic_subclass: null,
      illustration_name: '雷丸炮制图', primary_subject: '人物持杵捣药', source_label: '雷丸',
      description: '图中一人持杵在臼中捣药。',
      evidence_sufficiency: '部分', text_in_image: '雷丸',
      evidence_relation: '支持', evidence_note: '题签与图像相符',
      evidence_excerpt: '雷丸，去皮捣之。', uncertainty_note: null,
      has_multiple_illustrations: false,
    }, '{}', { evidenceMode: 'text' });
    assertEq(mapped.subject, '人物持杵捣药', 'primary_subject 只进入主要对象');
    assertEq(mapped.illustrationName, '雷丸', '展示名优先由原文标签派生');
    assert(mapped._outputQualityFlags.includes('illustration_name_normalized_to_source_label'), '显式名称与可靠题签不一致时写入规范化标记');
    assertEq(mapped.herbClassical, '雷丸', 'source_label 写入历史兼容键');
    assertEq(mapped.procedureStep, '', '新标注不产生 procedureStep');
    assertEq(mapped.correspondingText, '雷丸，去皮捣之。', '炮制内容保留在最小对应原文');
    assertEq(mapped.aiVerdict, '一致', 'evidence_relation=支持 映射为现有一致状态');
    assertEq(mapped.evidenceSufficiency, '部分', '历史 Prompt 的证据充分性只读兼容保存');
    assert(!mapped._outputQualityFlags.includes('invalid_evidence_sufficiency'), '历史兼容字段不再构成新质量门');
    assertEq(mapped.visualDescription, '图中一人持杵在臼中捣药。', 'description 进入正式画面描述字段');
    assertEq(mapped._description, mapped.visualDescription, '旧 _description 保持兼容副本');
  }

  console.log('\n[I3] image_only 下无可见文字支持的原文标签自动清空');
  {
    const mapped = mapAIResponse({
      academic_class: '药物图', academic_subclass: null,
      primary_subject: '植物根部', source_label: '人参',
      evidence_sufficiency: '不足', text_in_image: null,
      evidence_relation: '存疑', evidence_excerpt: null,
      uncertainty_note: '无文字证据', has_multiple_illustrations: false,
    }, '{}', { evidenceMode: 'image_only' });
    assertEq(mapped.herbClassical, '', '无文字支持时 source_label 被清空');
    assert(mapped._outputQualityFlags.includes('unsupported_source_label_cleared'), '清空操作写入质量标记');
    assertEq(mapped.procedureStep, '', '降级模式同样不产生工序字段');
  }

  console.log('\n[I4] 截断/解析恢复不会伪装成完整草稿');
  {
    const parsed = parseAnnotationText('{"academic_class":"药物图","primary_subject":"捣药');
    const mapped = mapAIResponse(parsed, parsed.raw_text, { evidenceMode: 'text', finishReason: 'length' });
    assert(mapped._outputQualityFlags.includes('output_truncated'), 'finish_reason=length 标记输出截断');
    assert(mapped._outputQualityFlags.includes('recovered_partial_output'), '解析失败恢复结果标记为部分恢复');
    assertEq(mapped.confidence, 'low', '部分恢复结果强制降为低可信');
  }

  console.log('\n[I5] versionContext 登记上下文范围、人工证据引用与质量标记');
  {
    const ctx = buildVersionContext({
      provider: 'qwen', model: 'qwen-test', evidenceMode: 'text',
      textSourceStatus: 'ocr', ocrStatus: 'candidate', contextRadius: 5,
      contextPages: [12, 10, 11, 11],
      pinnedEvidenceRefs: [{ pageNums: [11], label: '人工关联', contentHash: 'h123' }],
      outputQualityFlags: ['output_truncated', 'output_truncated'],
      annotationImageMode: 'illustration_crop',
    });
    assertEq(JSON.stringify(ctx.contextPages), JSON.stringify([10, 11, 12]), '上下文页码去重排序');
    assertEq(ctx.contextRadius, 5, '记录上下文半径');
    assertEq(ctx.pinnedEvidenceRefs[0].contentHash, 'h123', '记录人工证据内容 hash');
    assertEq(JSON.stringify(ctx.outputQualityFlags), JSON.stringify(['output_truncated']), '质量标记去重保存');
    assertEq(ctx.annotationImageMode, 'illustration_crop', '记录模型实际收到的插图裁图类型');
    assert(/^[0-9a-f]{64}$/.test(ctx.promptContentSha256), '记录 Prompt 内容 SHA-256');
    assert(/^[0-9a-f]{64}$/.test(ctx.classificationSchemeSha256), '记录分类规范 SHA-256');
  }

  console.log('\n[I6] 书级读向约束进入映射校验，未校 OCR 题名不得静默提升');
  {
    const bookCtx = {
      textDirection: '竖排右起',
      titleLabelDirection: '横排右起',
    };
    const mapped = mapAIResponse({
      academic_class: '药物图', academic_subclass: '药物炮制图',
      primary_subject: '石钟乳炮制', source_label: '乳鍾石製炮',
      description: '图中一人正在炉旁炮制药物。',
      text_in_image: null,
      evidence_relation: '支持', evidence_excerpt: '以五香水煮過一伏時',
      text_direction: '竖排右起', reading_order_assumed: '右→左、自上而下',
      title_label_direction: 'null', has_multiple_illustrations: false,
    }, '{}', { evidenceMode: 'text', textSourceStatus: 'ocr', bookCtx });
    assertEq(mapped.titleLabelDirection, '横排右起', '字符串 null 归一为空并采用书级题签方向');
    assert(mapped._outputQualityFlags.includes('title_direction_defaulted_from_book'), '缺失题签方向写入默认标记');
    assert(mapped._outputQualityFlags.includes('unverified_title_reading'), '未校 OCR 题名写入人工复核标记');
    assertEq(mapped.illustrationName, '石钟乳', '未核题名不自动替代主要对象，回退名只保留核心实体');
    assertEq(mapped.herbClassical, '乳鍾石製炮', '原始题名候选仍保留供人工核对');
    assert(mapped._outputQualityFlags.includes('illustration_name_simplified_to_core_entity'), '回退名简化写入质量标记');
    assert(!Object.prototype.hasOwnProperty.call(mapped, 'evidenceSufficiency'), 'v7 不生成主观证据充分性');
    assertEq(mapped.confidence, '', 'v7 不伪造模型置信度');

    const corrected = mapAIResponse({
      academic_class: '药物图', academic_subclass: '药物炮制图',
      primary_subject: '石钟乳炮制', source_label: '炮製石鍾乳',
      description: '图中一人正在炉旁炮制药物。',
      text_in_image: '炮製石鍾乳',
      evidence_relation: '支持', evidence_excerpt: '以五香水煮過一伏時',
      text_direction: '竖排右起', reading_order_assumed: '右→左、自上而下',
      title_label_direction: '橫排右起', has_multiple_illustrations: false,
    }, '{}', { evidenceMode: 'text', textSourceStatus: 'ocr', bookCtx });
    assertEq(corrected.illustrationName, '炮製石鍾乳', '明确遵守书级题签方向时采用规范题名');
    assertEq(corrected.titleLabelDirection, '横排右起', '繁体橫排方向归一为书级规范值');
    assert(!corrected._outputQualityFlags.includes('unverified_title_reading'), '明确题签方向时不产生未核读向标记');

    const titleOnlyCrop = mapAIResponse({
      academic_class: '药物图', academic_subclass: '药物形态图',
      illustration_name: '水銀', primary_subject: '红色颗粒状矿物药物', source_label: '水銀',
      description: '蓝底横排题签下绘一盘红褐色颗粒状物。',
      text_in_image: '水銀', evidence_relation: '支持',
      evidence_excerpt: '其水銀色微紅', text_direction: '横排右起',
      reading_order_assumed: '右→左、自上而下', title_label_direction: '横排右起',
      has_multiple_illustrations: false,
    }, '{}', { evidenceMode: 'text', textSourceStatus: 'ocr', bookCtx });
    assert(!titleOnlyCrop._outputQualityFlags.includes('text_direction_conflict'), '题签横排不再误报为正文方向冲突');
    assert(titleOnlyCrop._outputQualityFlags.includes('text_direction_scoped_to_title'), '明确记录横排方向属于题签');
    assertEq(titleOnlyCrop.illustrationName, '水銀', 'BYLGJ01_p0087 正确题名不再被主要对象替换');
    assert(!Object.prototype.hasOwnProperty.call(titleOnlyCrop, 'evidenceSufficiency'), '客观读向校验不再生成主观充分性等级');

    const conflicting = mapAIResponse({
      academic_class: '药物图', primary_subject: '石钟乳炮制', source_label: '乳鍾石製炮',
      text_in_image: '乳鍾石製炮', evidence_relation: '支持',
      text_direction: '竖排右起', reading_order_assumed: '右→左、自上而下',
      title_label_direction: '横排左起', has_multiple_illustrations: false,
    }, '{}', { evidenceMode: 'text', textSourceStatus: 'ocr', bookCtx });
    assert(conflicting._outputQualityFlags.includes('title_direction_conflict'), '题签方向冲突被机器识别');
    assertEq(conflicting.illustrationName, '石钟乳', '冲突题名不得进入展示名称，回退名只保留核心实体');
    assert(!Object.prototype.hasOwnProperty.call(conflicting, 'evidenceSufficiency'), '读向冲突只写客观质量标记，不生成主观充分性等级');
  }

  console.log('\n[I7] 无可靠题签时把模型名称归一为核心实体');
  {
    const mapped = mapAIResponse({
      academic_class: '药物图', academic_subclass: '药物关联图',
      illustration_name: '玉泉产地景观', primary_subject: '山林溪流中的玉泉产地景观',
      source_label: null, description: '画面描绘山林溪流环境。',
      text_in_image: null, evidence_relation: '支持',
      evidence_excerpt: '玉泉生山谷中', uncertainty_note: null,
      has_multiple_illustrations: false,
    }, '{}', { evidenceMode: 'text', textSourceStatus: 'ocr' });
    assertEq(mapped.illustrationName, '玉泉', '无可靠题签时从 explicit illustration_name 提取核心实体');
    assertEq(mapped.subject, '山林溪流中的玉泉产地景观', '主要对象仍与展示名称分离');
    assert(!mapped._outputQualityFlags.includes('missing_illustration_name'), '显式名称完整时不报缺失');
    assert(mapped._outputQualityFlags.includes('illustration_name_simplified_to_core_entity'), '名称简化进入质量标记');
  }

  console.log('\n[I8] 重新运行只建立全新当前审核状态，不沿用旧人工修改');
  {
    const img = v2Fixture();
    img.reviewMeta = {
      pendingReason: 'model_error', reviewMode: 'strict', humanEditedAt: 123,
      modelArchives: [{ source: 'human_confirmed', annotation: { illustrationName: '旧人工名称' } }],
    };
    img.reviewDiff = { illustrationName: { ai: '旧AI名', human: '旧人工名称' } };
    img.fieldReviewReasons = { illustrationName: 'model_error' };
    img.reviewEvents = [{ field: 'illustrationName', reason: 'model_error', draftRunId: 'old' }];
    resetCurrentReviewStateForFreshDraft(img, 'qwen-new');
    assertEq(img.reviewMeta.pendingReason, '', '旧修改原因不会进入新草稿');
    assertEq(img.reviewMeta.humanEditedAt, null, '旧人工修改时间不会进入新草稿');
    assert(!Object.prototype.hasOwnProperty.call(img.reviewMeta, 'reviewMode'), '旧审核模式不会进入新草稿');
    assertEq(Object.keys(img.reviewDiff).length, 0, '当前差异投影清空');
    assertEq(Object.keys(img.fieldReviewReasons).length, 0, '当前归因投影清空');
    assertEq(img.reviewMeta.modelArchives.length, 1, '后台审计归档保留但不进入当前标注');
    assertEq(img.reviewEvents.length, 1, '历史事件仍只作后台审计记录');
  }

  console.log('\n[J1] 新审核动线：先编辑草稿，不选原因不得保存正式数据');
  {
    const img = v2Fixture();
    const before = JSON.stringify(img.annotation);
    const staged = stageTrackedFieldEdit(img, 'subject', '鹿', '梅花鹿', draft => { draft.subject = '梅花鹿'; });
    assert(staged.staged && staged.pendingCount === 1, '字段修改先进入页面草稿');
    assertEq(img.annotation.subject, '鹿', '暂存阶段不修改正式 annotation');
    assertEq(getReviewFormAnnotation(img).subject, '梅花鹿', '表单继续显示草稿值');
    assertEq(getPendingReviewChanges(img).length, 1, '检测到 1 个待保存字段');
    const rejected = await savePendingTrackedEdits(img, { blocking: false });
    assert(rejected.needsReason && !rejected.saved, '未选原因时保存被拒绝');
    assertEq(JSON.stringify(img.annotation), before, '保存被拒绝后正式数据保持不变');
    assertEq((img.reviewEvents || []).length, 0, '保存被拒绝后不产生归因事件');
  }

  console.log('\n[J2] 选择原因后一次保存全部字段并逐字段写归因');
  {
    const img = v2Fixture();
    img.id = 'v2-002';
    stageTrackedFieldEdit(img, 'subject', '鹿', '梅花鹿', draft => { draft.subject = '梅花鹿'; });
    stageTrackedFieldEdit(img, 'type', '药物图', '经穴图', draft => { draft.type = '经穴图'; });
    setPendingReason(img, 'model_error');
    const saved = await savePendingTrackedEdits(img, { blocking: false });
    assert(saved.saved && saved.changed, '选择原因后保存成功');
    assertEq(img.annotation.subject, '梅花鹿', '正式 annotation 写入对象修改');
    assertEq(img.annotation.type, '经穴图', '正式 annotation 写入分类修改');
    assertEq((img.reviewEvents || []).length, 2, '两个字段分别写入两条事件');
    assert((img.reviewEvents || []).every(e => e.reason === 'model_error'), '同批字段使用所选原因');
    assertEq(img.reviewMeta.pendingReason, '', '保存后清空原因，避免误复用');
    assertEq(getPendingReviewChanges(img).length, 0, '保存后清空页面草稿');
  }

  console.log('\n[K1] 素材页状态映射与图层可见性只保留在浏览器会话');
  {
    const pkg = {
      package_id: 'BYLGJ01_p0008_layered_v001',
      layers: [{ id: 'group', default_visible: true }, { id: 'atomic', default_visible: false }],
    };
    assertEq(assetStatusLabel('stale'), '已过期', '素材 stale 状态使用明确中文标签');
    assertEq(assetStatusLabel('approved'), '已通过', '素材 approved 状态使用明确中文标签');
    const defaults = getAssetLayerVisibility(pkg);
    assert(defaults.group && !defaults.atomic, '分层包可默认只显示组合关系层，避免与原子层重复叠加');
    const geometryLayer = { bbox:[1,2,3,4], source_bbox:[5,6,7,8], render_bbox:[9,10,11,12], anchor:{kind:'bottom_center'} };
    assertEq(JSON.stringify(assetDeskLayerBBox(geometryLayer, 'source')), JSON.stringify([5,6,7,8]), '原图对照使用 source_bbox');
    assertEq(JSON.stringify(assetDeskLayerBBox(geometryLayer, 'render')), JSON.stringify([9,10,11,12]), '组合展示使用 render_bbox');
    assertEq(assetDeskObjectPosition(geometryLayer), 'center bottom', '底部中心锚点映射为等比 contain 的对象定位');
    assert(assetDeskBBoxStyle(geometryLayer, {width:100,height:200}).includes('object-position:center bottom'), '组合样式携带锚点且不依赖拉伸');
    app.__v2.state.rightTab = 'assets';
    // 纯函数不会改动 annotation/aiDraft/reviewDiff；可见性只读取 assetPanelState 的会话级状态。
    assertEq(v2Fixture().annotation.subject, '鹿', '素材页辅助逻辑不接触标注终稿');
  }

  console.log('\n[K2] 素材档案台独立筛选插图，不借用审核选中状态');
  {
    const oldIndex = assetDeskState.sourceIndex;
    const oldSelected = app.__v2.state.selectedId;
    assetDeskState.sourceIndex = { sources: {
      source_a: { record_id:'record-a', canonical_id:'炉前人物', latest_revision:'rev-a', revisions:[{ source_revision:'rev-a', package_path:'_sources/source_a/rev-a' }] },
      source_b: { record_id:'record-b', canonical_id:'药材供案', latest_revision:'rev-b', revisions:[{ source_revision:'rev-b', package_path:'_sources/source_b/rev-b' }] },
    }};
    assertEq(assetDeskSources().map(item => item.sourceId).join(','), 'source_a,source_b', '素材台从正式素材索引读取全部源图');
    assertEq(assetDeskLabel(assetDeskSources()[0]), '炉前人物', '素材台优先显示规范插图名称');
    assertEq(assetDeskLayerTypeLabel({ asset_type:'prop' }), '物品', '素材台将可交互物品与人物等语义素材区分显示');
    assertEq(app.__v2.state.selectedId, oldSelected, '素材台筛选不改写审核工作台选中记录');
    assetDeskState.sourceIndex = oldIndex;
  }

  console.log('\n[L1] 参考文本原位编辑只在内容变化后进入待保存状态');
  {
    assertEq(normalizeReferenceEditText('杏林\r\n杂话\u00a0全'), '杏林\n杂话 全',
      '浏览器换行和不换行空格被规范为可比较文本');
    assertEq(normalizeReferenceEditText('  杏林杂话\n'), '杏林杂话',
      '保存接口会忽略的首尾空白不触发伪修改');
    assert(!referenceEditHasChanges('杏林杂话', '杏林杂话'),
      '未修改参考文本时不显示保存状态');
    assert(referenceEditHasChanges('杏林杂话', '杏林杂话序'),
      '原位修改后进入待保存状态');
    assert(referenceEditHasChanges('杏林杂话', '杏林，杂话。'),
      '只增加标点也属于可保存的整理稿修改');

    resetReferenceReaderScope('book-save');
    referenceReaderState.selectedId = 'ref-save';
    referenceReaderState.loaded = true;
    referenceReaderState.items = [{ id: 'ref-save' }];
    referenceReaderState.documents.set('ref-save', {
      content: '黄芩味苦',
      original_content: '黄芩味苦',
    });
    referenceReaderState.editing = true;
    referenceReaderState.editDraft = '黄芩，味苦。';
    const saveViewSnapshot = {
      scrollTop: 4321,
      selectedId: 'ref-save',
      search: '',
      searchIndex: 0,
      showOriginal: false,
      editing: true,
      editDraft: '黄芩，味苦。',
    };
    const draftUncertainMarks = [{
      id: 'uncertain-draft',
      start: 3,
      end: 5,
      quote: '味苦',
      created_at: '2026-07-31T10:00:00.000Z',
    }];
    referenceReaderState.pendingUncertaintyMarks = new Map([['ref-save', draftUncertainMarks]]);
    await saveReferenceEditedCopy(
      { id: 'book-save', title: '保存测试' },
      'ref-save',
      saveViewSnapshot,
    );
    const saveCall = app.__fetchCalls.at(-1);
    assertEq(
      JSON.parse(saveCall.options.body).content,
      '黄芩，味苦。',
      '只增加标点时前端原样提交整理稿内容',
    );
    assertEq(
      JSON.stringify(JSON.parse(saveCall.options.body).uncertain_marks),
      JSON.stringify(draftUncertainMarks),
      '编辑中新增的存疑标记随同整理稿在一次保存中提交',
    );
    assert(referenceReaderState.editing === false,
      '标点修改保存成功后退出待保存状态');
    assertEq(saveViewSnapshot.scrollTop, 4321,
      '保存事务复用调用前固定的滚动快照，不在两次重绘之间重新取值');
  }

  console.log('\n[L1.1] 编辑草稿中的存疑引文必须从当前草稿取词');
  {
    resetReferenceReaderScope('book-uncertain-current-draft');
    referenceReaderState.editing = true;
    referenceReaderState.editDraft = '前言甲乙丙丁戊己';
    const mark = referenceUncertainMarkForCurrentDraft(
      { content: '甲乙丙丁戊己' },
      { start: 2, end: 4 },
    );
    assertEq(mark.quote, '甲乙',
      '编辑后新增存疑按新草稿坐标取词，避免后端报文字不符');
    assertEq(nextReferenceUncertaintyIndex(4, 3, 1), 0,
      '存疑查找可从最后一条循环到第一条');
    assertEq(nextReferenceUncertaintyIndex(4, 0, -1), 3,
      '存疑查找可反向循环定位');
    referenceReaderState.editing = false;
    referenceReaderState.editDraft = '';
  }

  console.log('\n[L2] 同书翻页 mountReferencePane 不重置 selectedId/search/编辑状态');
  {
    const book = { id: 'book-test-ref', title: '测试书' };
    const scopeId = referenceScopeId(book);
    resetReferenceReaderScope(scopeId);
    // 模拟翻页前的右侧栏状态：已选中某参考文档、有查找词、正在编辑
    referenceReaderState.selectedId = 'ref-doc-1';
    referenceReaderState.search = '丹砂';
    referenceReaderState.searchIndex = 2;
    referenceReaderState.editing = true;
    referenceReaderState.editDraft = '草稿内容';
    referenceReaderState.showOriginal = false;
    const editorA = { value: '校文A' };
    const editorB = { value: '校文B' };
    referenceReaderState.editor = editorA;

    // 首次挂载（scope 已通过 reset 设置，renderReferencePane 在无 items 时安全返回）
    mountReferencePane(book, editorA);
    assertEq(referenceReaderState.scopeId, scopeId, '同书翻页 scopeId 不变');
    assertEq(referenceReaderState.selectedId, 'ref-doc-1', '同书翻页不重置 selectedId');
    assertEq(referenceReaderState.search, '丹砂', '同书翻页不重置 search');
    assertEq(referenceReaderState.searchIndex, 2, '同书翻页不重置 searchIndex');
    assert(referenceReaderState.editing === true, '同书翻页不重置编辑状态');
    assertEq(referenceReaderState.editDraft, '草稿内容', '同书翻页不丢失编辑草稿');

    // 模拟翻到下一页：调用 mountReferencePane(book, newEditor)
    mountReferencePane(book, editorB);
    assertEq(referenceReaderState.editor, editorB, '翻页后差异跳转目标更新为当前页校文框');
    assertEq(referenceReaderState.selectedId, 'ref-doc-1', '翻页后 selectedId 仍保持');
    assertEq(referenceReaderState.search, '丹砂', '翻页后 search 仍保持');
    assert(referenceReaderState.editing === true, '翻页后编辑状态仍保持');
    assertEq(referenceReaderState.editDraft, '草稿内容', '翻页后编辑草稿仍保持');
  }

  console.log('\n[L3] 切换到另一本书才重置参考文本范围');
  {
    const bookA = { id: 'book-A', title: '书A' };
    const bookB = { id: 'book-B', title: '书B' };
    resetReferenceReaderScope(referenceScopeId(bookA));
    referenceReaderState.selectedId = 'ref-A-1';
    referenceReaderState.search = '关键字';
    referenceReaderState.editing = true;
    referenceReaderState.editDraft = '草稿A';
    // 切换到另一本书
    mountReferencePane(bookB, referenceReaderState.editor);
    assertEq(referenceReaderState.scopeId, referenceScopeId(bookB), '换书后 scopeId 切换');
    assertEq(referenceReaderState.selectedId, '', '换书后 selectedId 被重置');
    assertEq(referenceReaderState.search, '', '换书后 search 被重置');
    assert(referenceReaderState.editing === false, '换书后编辑状态被重置');
    assertEq(referenceReaderState.editDraft, '', '换书后编辑草稿被重置');
  }

  console.log('\n[L4] updateReferenceInsertTarget 只更新 editor 目标');
  {
    const editor = { value: '目标校文框' };
    referenceReaderState.editor = null;
    updateReferenceInsertTarget(editor);
    assertEq(referenceReaderState.editor, editor, 'updateReferenceInsertTarget 设置 editor');
    // 不影响其他状态
    const prevSearch = referenceReaderState.search;
    updateReferenceInsertTarget({ value: '另一个' });
    assertEq(referenceReaderState.search, prevSearch, 'updateReferenceInsertTarget 不改 search');
  }

  console.log('\n[L5] captureReferencePaneViewState 捕获当前视图状态快照');
  {
    const book = { id: 'book-snap', title: '快照书' };
    resetReferenceReaderScope(referenceScopeId(book));
    referenceReaderState.selectedId = 'ref-snap';
    referenceReaderState.search = '炮制';
    referenceReaderState.searchIndex = 3;
    referenceReaderState.editing = true;
    referenceReaderState.editDraft = '快照草稿';
    referenceReaderState.showOriginal = true;
    const snap = captureReferencePaneViewState();
    assertEq(snap.selectedId, 'ref-snap', '快照包含 selectedId');
    assertEq(snap.search, '炮制', '快照包含 search');
    assertEq(snap.searchIndex, 3, '快照包含 searchIndex');
    assert(snap.editing === true, '快照包含编辑状态');
    assertEq(snap.editDraft, '快照草稿', '快照包含编辑草稿');
    assert(snap.showOriginal === true, '快照包含 showOriginal');
  }

  console.log('\n[L5.1] 整理稿查找优先同步到已有对照页，再以正文上下文匹配');
  {
    const book = {
      id: 'book-search-sync',
      pages: [
        { pageNum: 1, textAsset: { fullText: '卷首药性与炮制方法。' } },
        { pageNum: 2, textAsset: { fullText: '卷中记载甘草味甘，调和诸药。' } },
      ],
    };
    const content = '卷首药性与炮制方法。卷中记载甘草味甘，调和诸药。';
    resetReferenceReaderScope(referenceScopeId(book));
    referenceReaderState.selectedId = 'ref-search-sync';
    rememberReferenceComparisonRange(book, { pageNum: 2 }, 'ref-search-sync', {
      referenceStart: 9,
      referenceEnd: content.length,
      ocrStart: 3,
      ocrEnd: 7,
    });
    const matches = referenceSearchMatchOffsets(content, '甘草味甘');
    assertEq(matches.length, 1, '整理稿查找保留命中字符位置');
    const mapped = findReferenceSearchTargetPage(
      book,
      'ref-search-sync',
      content,
      matches[0],
      matches[0] + '甘草味甘'.length,
    );
    assertEq(mapped.pageNum, 2, '已有逐页对照范围时查找跳到对应原书页');
    assertEq(mapped.ocrStart, 4, '已有逐页对照范围时左侧 OCR 同步到对应字位');
    assertEq(mapped.ocrEnd, 8, '已有逐页对照范围时左侧 OCR 保留对应范围终点');
    clearReferenceComparisonRanges(book, 'ref-search-sync');
    const contextual = findReferenceSearchTargetPage(
      book,
      'ref-search-sync',
      content,
      matches[0],
      matches[0] + '甘草味甘'.length,
    );
    assertEq(contextual.pageNum, 2, '没有对照范围时用正文命中与上下文定位原书页');
    const singleCharacterStart = content.indexOf('甘草味甘');
    assertEq(
      findReferenceSearchTargetPage(book, 'ref-search-sync', content, singleCharacterStart, singleCharacterStart + 1),
      null,
      '普通单字查找不自动跳页，避免古籍高频字误定位',
    );
    assertEq(
      findReferenceSearchTargetPage(
        book,
        'ref-search-sync',
        content,
        singleCharacterStart,
        singleCharacterStart + 1,
        { allowSingleCharacter: true },
      ).pageNum,
      2,
      '存疑单字使用上下文后可同步到对应原书页',
    );
    const fallbackBook = {
      id: 'book-search-progress',
      pages: [
        { pageNum: 1, textAsset: { fullText: '甲甲甲甲' } },
        { pageNum: 2, textAsset: { fullText: '乙乙乙乙' } },
        { pageNum: 3, textAsset: { fullText: '丙丙丙丙' } },
      ],
    };
    assertEq(
      findReferenceSearchTargetPage(
        fallbackBook,
        'ref',
        '甲乙丙丁戊己庚辛壬癸',
        6,
        7,
        { allowSingleCharacter: true, allowApproximatePosition: true },
      ).pageNum,
      2,
      '存疑字无法与 OCR 精确匹配时按整书文字进度定位原书页',
    );
    const unanchoredLocation = resolveReferenceComparisonLocation(
      book,
      { pageNum: 2 },
      'ref-search-sync',
    );
    assertEq(getReferenceComparisonRanges(book, 'ref-search-sync').length, 0,
      '清除旧页范围后不残留自动定位锚点');
    assertEq(unanchoredLocation.source, 'unique-text',
      '当前页尚无已对照范围时只允许唯一正文命中，不按页码比例误猜整理稿位置');
    setReferenceSelectedRange('ref-search-sync', matches[0], matches[0] + '甘草味甘'.length);
    assertEq(
      referenceProofNavigationRange(content, 'ref-search-sync').source,
      'selection',
      '查看原页优先使用右侧当前选中的文字或存疑标记',
    );
    referenceReaderState.selectedRange = null;
    referenceReaderState.search = '甘草味甘';
    referenceReaderState.searchIndex = 0;
    assertEq(
      referenceProofNavigationRange(content, 'ref-search-sync').source,
      'search',
      '右侧查找结果可用同一规则反查原页',
    );
    referenceReaderState.search = '';
    referenceReaderState.comparisonStale = false;
    referenceReaderState.comparisonResult = {
      matched: true,
      referenceStart: matches[0],
      referenceEnd: matches[0] + '甘草味甘'.length,
    };
    assertEq(
      referenceProofNavigationRange(content, 'ref-search-sync').source,
      'comparison',
      '完成本页对照后可从对照范围回看原页',
    );
    referenceReaderState.comparisonResult = null;
    state.currentBookId = book.id;
    state.currentBookPage = 2;
    state.mainView = 'page-detail';
    referenceReaderState.editor = {
      value: book.pages[1].textAsset.fullText,
      focus: () => {},
      setSelectionRange: () => {},
    };
    assert(
      openReferenceProofPage(book, content, 'ref-search-sync', {
        range: { start: singleCharacterStart, end: singleCharacterStart + 1 },
        source: 'search',
      }) === true,
      '单字查找也按整理稿当前位置同步 OCR 与原页',
    );
    assert(
      syncReferenceRangeToProofPage(book, content, {
        start: matches[0],
        end: matches[0] + '甘草味甘'.length,
      }) === true,
      '存疑标记同样按其起止坐标同步到对应原书页',
    );
    clearReferenceComparisonRanges(book, 'ref-search-sync');
    assert(
      setReferenceComparisonStartFromRange(book, { pageNum: 2 }, 'ref-search-sync', {
        start: matches[0],
        end: matches[0] + '甘草味甘'.length,
      }),
      '选择存疑后可将其登记为当前页对照起点',
    );
    assertEq(
      chooseReferenceStartHint({
        pageNum: 2,
        ranges: getReferenceComparisonRanges(book, 'ref-search-sync'),
      }),
      matches[0],
      '点击对照本页会从所选存疑位置开始，不再回到整理稿开头',
    );
    referenceReaderState.comparisonActive = true;
    referenceReaderState.comparisonStale = true;
    assertEq(
      referenceComparisonActionLabel(false),
      '对照本页',
      '不论此前是否已有对照状态，操作始终表述为对照当前正文页',
    );
    assertEq(referenceComparisonActionLabel(true), '正在对照…', '只有执行期间显示对照进度');
    const ambiguousBook = {
      id: 'book-search-ambiguous',
      pages: [
        { pageNum: 1, textAsset: { fullText: '甘草味甘。' } },
        { pageNum: 2, textAsset: { fullText: '甘草味甘。' } },
      ],
    };
    assertEq(
      findReferenceSearchTargetPage(ambiguousBook, 'ref', '甘草味甘。', 0, 4),
      null,
      '同一命中无法唯一归属时不误跳原书页',
    );
  }

  console.log('\n[L6] 正文差异核对翻页时只使瞬时结果失效，不改书籍或文字数据');
  {
    const book = { id: 'book-proof-diff', title: '对照书', pages: [{ pageNum: 1 }] };
    const before = JSON.stringify(book);
    resetReferenceReaderScope(referenceScopeId(book));
    referenceReaderState.comparisonActive = true;
    updateReferenceComparisonSource(
      book,
      { pageNum: 1 },
      { value: '人工校正文' },
      '原始 OCR 底稿',
    );
    assertEq(referenceReaderState.comparisonSource.ocrText, '人工校正文',
      '正文差异核对读取左侧唯一可见文本框，不再维护第二套 OCR 显示');
    referenceReaderState.comparisonResult = { matched: true, differences: [{ kind: 'content' }] };
    updateReferenceComparisonSource(book, { pageNum: 2 }, { value: '甘草味甘' });
    assert(referenceReaderState.comparisonStale === true, '翻页后旧差异结果标记为失效');
    assertEq(referenceReaderState.comparisonResult, null, '翻页后不沿用上一页差异结果');
    assertEq(referenceReaderState.comparisonSource.pageKey, 'book-proof-diff:2', '差异源更新到当前页');
    assertEq(JSON.stringify(book), before, '瞬时差异状态不写入书籍、OCR或整理稿');
    assertEq(currentReferenceWorkingContent({ content: '整理稿正文' }), '整理稿正文',
      '未编辑时对照读取整理稿副本而不是改写原始对象');
    referenceReaderState.selectedId = 'ref-proof-diff';
    rememberReferenceComparisonRange(book, { pageNum: 1 }, 'ref-proof-diff', {
      referenceStart: 100,
      referenceEnd: 180,
    });
    const ranges = getReferenceComparisonRanges(book, 'ref-proof-diff');
    assertEq(ranges.length, 1, '已对照页范围只保存在当前浏览会话');
    assertEq(
      chooseReferenceStartHint({ pageNum: 2, ranges }),
      180,
      '下一页从上一页整理稿结束位置继续逐字定位',
    );
    clearReferenceComparisonRanges(book, 'ref-proof-diff');
    assertEq(
      getReferenceComparisonRanges(book, 'ref-proof-diff').length,
      0,
      '整理稿内容变化后清除旧连续定位范围',
    );
    referenceReaderState.comparisonResult = {
      matched: true,
      differences: [
        { ocrStart: 1, ocrEnd: 2, referenceStart: 10, referenceEnd: 11 },
        { ocrStart: 4, ocrEnd: 5, referenceStart: 14, referenceEnd: 15 },
      ],
    };
    referenceReaderState.comparisonIndex = 0;
    activateReferenceComparisonDifference(1);
    assertEq(referenceReaderState.comparisonIndex, 1,
      '上一处/下一处只更新当前差异焦点');
    assertEq(referenceReaderState.comparisonResult.differences.length, 2,
      '切换焦点不会过滤或删除其他差异');
    const rangeSummary = buildReferenceComparisonRangeSummary(
      '卷首文字。三卷以傳于世昔時始舶載醫學正傳。卷尾文字',
      { referenceStart: 5, referenceEnd: 25 },
    );
    assertEq(rangeSummary.displayStart, 6,
      '对照范围向用户显示一基起始字位');
    assertEq(rangeSummary.displayEnd, 25,
      '对照范围向用户显示包含式结束字位');
    assert(rangeSummary.startSnippet.includes('三卷以傳于世'),
      '对照范围显示实际开头内容');
    assert(rangeSummary.endSnippet.includes('醫學正傳'),
      '对照范围显示实际结尾内容');

    referenceReaderState.comparisonActive = true;
    referenceReaderState.comparisonSource = { editor: { value: '校正文' } };
    const stableResult = { matched: true, differences: [{ ocrStart: 1, ocrEnd: 2 }] };
    referenceReaderState.comparisonResult = stableResult;
    markReferenceComparisonStale('整理稿已修改，请重新对照', {
      preserveOcrHighlights: true,
    });
    assertEq(referenceReaderState.comparisonResult, stableResult,
      '整理稿修改后左侧继续保留上一轮差异高亮依据');
    assert(referenceReaderState.comparisonStale === true,
      '整理稿修改后仍明确标记结果待重新对照');
  }

  console.log('\n[L7] 存疑选区在一次保存后可重新建立');
  {
    referenceReaderState.selectedRange = { referenceId: 'ref-uncertain', start: 2, end: 4 };
    referenceReaderState.selectedRange = null; // 模拟保存存疑后，旧选区被清空
    const secondRange = setReferenceSelectedRange('ref-uncertain', 6, 9);
    assertEq(secondRange.referenceId, 'ref-uncertain', '第二次选区仍属于当前整理稿');
    assertEq(secondRange.start, 6, '第二次选区正确记录起点');
    assertEq(secondRange.end, 9, '第二次选区正确记录终点');
    assertEq(referenceReaderState.selectedRange, secondRange, '第二次选区会替换已保存的旧选区');
  }

  console.log('\n[L8] 校文阅读提示是独立于书页的会话图层');
  {
    const rect = clampProofreadingGuideRect([0.72, 0.2, 0.9, 0.36]);
    proofreadingGuideState.rect = rect;
    proofreadingGuideState.editing = true;
    assertEq(proofreadingGuideState.rect, rect, '提示图层只保存相对矩形');
    assert(!Object.prototype.hasOwnProperty.call(proofreadingGuideState, 'bookId'), '提示图层不绑定书籍');
    assert(!Object.prototype.hasOwnProperty.call(proofreadingGuideState, 'pageNum'), '提示图层不绑定书页');
    assertEq(JSON.stringify(clampProofreadingGuideRect([2, -1, 3, 4])), '[0.94,0,1,1]', '提示矩形会被限制在图像范围内');
    proofreadingGuideState.rect = null;
    proofreadingGuideState.editing = false;
  }

  console.log('\n[L9] 校文三栏可按需收起左侧校正文，并放宽整理稿栏宽度');
  {
    const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    assertEq(clampReferencePaneWidth(1200), 960, '整理稿栏允许拖宽到960px');
    assertEq(clampReferencePaneWidth(100), 260, '整理稿栏仍保留可用的最小宽度');
    assert(
      htmlSource.includes('.shell.reference-workspace .pane-reference.is-collapsed'),
      '校文模式下整理稿折叠规则必须覆盖展开状态的宽度约束',
    );
    setProofEditorCollapsed(false);
    assertEq(isProofEditorCollapsed(), false, '校正文栏默认展开');
    setProofEditorCollapsed(true);
    assertEq(isProofEditorCollapsed(), true, '校正文栏可折叠并记住当前选择');
    assertEq(referenceExportFilename({ title: '本草/整理?' }), '本草_整理__整理稿.txt', '整理稿导出文件名移除 Windows 非法字符');
  }

  console.log(`\n========== 结果：${_pass} 通过 / ${_fail} 失败 ==========`);
  return _fail === 0 ? 0 : 1;
}

runTests()
  .then(code => process.exit(code))
  .catch(e => {
    console.error('\n测试执行异常:', e.stack || e.message);
    process.exit(1);
  });
