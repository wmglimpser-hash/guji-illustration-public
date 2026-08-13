/* ============================================================
   STATE
   ============================================================ */
const LS_KEY = 'gjbz.ui.v2';
const LS_CFG = 'gjbz.config.v1';
const illustrationNameRules = globalThis.IllustrationNameRules;
if (!illustrationNameRules) {
  throw new Error('IllustrationNameRules 未加载，请先加载 illustration_name_rules.js');
}
const {
  cleanIllustrationName,
  resolveIllustrationDisplayName,
} = illustrationNameRules;
const annotationRunInterface = globalThis.AnnotationRun;
if (!annotationRunInterface) {
  throw new Error('AnnotationRun 未加载，请先加载 annotation_run.js');
}
const {
  createAnnotationRunModule,
} = annotationRunInterface;
const textProofDiffInterface = globalThis.TextProofDiff;
if (!textProofDiffInterface) {
  throw new Error('TextProofDiff 未加载，请先加载 text_proof_diff.js');
}
const {
  chooseReferenceStartHint,
  compareContinuousText,
  buildDifferenceHighlightSegments,
} = textProofDiffInterface;
const BRIDGE_BASE = 'http://127.0.0.1:5678';
const BRIDGE_URL = `${BRIDGE_BASE}/api/annotate`;
const BRIDGE_SESSION_URL = `${BRIDGE_BASE}/api/session`;
const BRIDGE_GLOBAL_URL  = `${BRIDGE_BASE}/api/session/global`;
const BRIDGE_BOOK_URL    = (id) => `${BRIDGE_BASE}/api/session/book/${encodeURIComponent(id)}`;
const BRIDGE_STATUS_URL = `${BRIDGE_BASE}/api/status`;
const BRIDGE_UPLOAD_IMAGE_URL = `${BRIDGE_BASE}/api/upload-image`;
const BRIDGE_UPLOAD_PDF_URL = `${BRIDGE_BASE}/api/upload-pdf`;
const BRIDGE_IMPORT_IMAGE_BOOK_URL = `${BRIDGE_BASE}/api/import-image-book`;
const BRIDGE_DELETE_BOOK_ASSETS_URL = `${BRIDGE_BASE}/api/delete-book-assets`;
const BRIDGE_EXTRACT_TEXT_URL = `${BRIDGE_BASE}/api/extract-page-text`;
const BRIDGE_SCAN_PAGE_URL    = `${BRIDGE_BASE}/api/scan-page-ocr-detect`;
const BRIDGE_GET_CONFIG_URL   = `${BRIDGE_BASE}/api/config`;
const BRIDGE_SAVE_CONFIG_URL  = `${BRIDGE_BASE}/api/save-config`;
const BRIDGE_STORE_MODEL_RUN_URL = `${BRIDGE_BASE}/api/store-model-run`;
const BRIDGE_MODEL_RUNS_URL = `${BRIDGE_BASE}/api/model-runs`;
const BRIDGE_CLIENT_ERROR_LOG_URL = `${BRIDGE_BASE}/api/log-client-error`;
const BRIDGE_SAVE_EXPORT_URL = `${BRIDGE_BASE}/api/save-export`;
const BRIDGE_UPDATE_BOOK_META_URL   = `${BRIDGE_BASE}/api/update-book-meta`;
const BRIDGE_UPDATE_GROUP_META_URL  = `${BRIDGE_BASE}/api/update-group-meta`;
const BRIDGE_ASSET_SOURCE_EXPORT_URL = `${BRIDGE_BASE}/api/asset-sources/export`;
const BRIDGE_LAYER_PACKAGE_SCAN_URL = `${BRIDGE_BASE}/api/layer-packages/scan`;
const BRIDGE_ILLUSTRATION_ASSET_PACKAGES_URL = (id) => `${BRIDGE_BASE}/api/illustrations/${encodeURIComponent(id)}/asset-packages`;
const BRIDGE_ASSET_PACKAGE_REVIEW_URL = (sourceId, packageId) => `${BRIDGE_BASE}/api/asset-packages/${encodeURIComponent(sourceId)}/${encodeURIComponent(packageId)}/review`;
const BRIDGE_ASSET_PACKAGE_DOWNLOAD_URL = (sourceId, packageId) => `${BRIDGE_BASE}/api/asset-packages/${encodeURIComponent(sourceId)}/${encodeURIComponent(packageId)}/download`;
const BRIDGE_TEXT_REFERENCES_URL = (scopeId) => `${BRIDGE_BASE}/api/text-references/${encodeURIComponent(scopeId)}`;
const BRIDGE_TEXT_REFERENCE_URL = (scopeId, referenceId) => `${BRIDGE_TEXT_REFERENCES_URL(scopeId)}/${encodeURIComponent(referenceId)}`;
const BRIDGE_TEXT_REFERENCE_UNCERTAINTY_URL = (scopeId, referenceId) =>
  `${BRIDGE_TEXT_REFERENCE_URL(scopeId, referenceId)}/uncertain-marks`;
const BRIDGE_TEXT_CONVERT_URL = `${BRIDGE_BASE}/api/text-convert`;
const BRIDGE_ASSET_FILE_URL = (relativePath, download = false) => {
  const safePath = String(relativePath || '').split('/').map(encodeURIComponent).join('/');
  return `${BRIDGE_BASE}/api/asset-file/${safePath}${download ? '?download=1' : ''}`;
};

// 素材包的选择、图层可见性与记录内页签只属于当前浏览器会话；不写进标注记录。
const assetPanelState = { recordId: '', packageId: '', visibleLayers: {}, soloLayerId: '', detailView: 'info' };
// 源素材只在“图片列表”的显式导出任务内选择；不写入标注数据。
const assetSourceExportTask = { active: false, selectedIds: new Set() };
// 原始参考文本和整理稿只属于校文工作流：正文文件由 bridge 独立保存，前端仅缓存
// 索引、当前文档、阅读位置与瞬时差异结果；不写入 book/images/textAsset，也不进入论文数据。
const referenceReaderState = {
  scopeId: '',
  items: [],
  selectedId: '',
  documents: new Map(),
  loaded: false,
  loading: false,
  loadingDocument: '',
  error: '',
  search: '',
  searchIndex: 0,
  selectedRange: null,
  editor: null,
  editing: false,
  editDraft: '',
  savingEdit: false,
  showOriginal: false,
  comparisonSource: null,
  comparisonActive: false,
  comparisonLoading: false,
  comparisonError: '',
  comparisonResult: null,
  comparisonIndex: 0,
  comparisonStale: false,
  comparisonExpanded: false,
  comparisonRequestId: 0,
  comparisonPageRanges: new Map(),
  savingUncertainty: false,
  uncertaintyIndex: -1,
  // 编辑中的存疑旁注仅短暂保留在当前浏览会话，随后与整理稿同一事务保存。
  pendingUncertaintyMarks: new Map(),
};
const referenceComparisonCanonicalCache = new Map();
// OCR 繁简转换只属于当前校文视图。结果不进入 textAsset、标注记录或论文数据。
const ocrTextConversionState = {
  sourceKey: '',
  direction: '',
  text: '',
  loading: false,
  error: '',
  showOriginal: false,
};
// 校文阅读提示仅是当前浏览会话的独立图层：不绑定书籍或书页，也不写入任何数据。
const proofreadingGuideState = { rect: null, editing: false };
// 素材档案台直接读取正式素材索引；它不借用审核工作台的选中状态，也不写入插图记录。
const assetDeskState = {
  selectedSourceId: '', requestedRecordId: '', packageId: '', sourceIndex: null, loading: false, error: '',
  viewMode: 'browse', catalogFilter: 'with_layers', search: '', searchDraft: '', selectedLayerId: '', layerVisibility: {}, packageCache: new Map(),
};
const ASSET_LAYER_TYPE_LABELS = {
  character: '人物', prop: '物品', environment: '环境', architecture: '建筑', inscription: '题签', scene_fragment: '组合片段',
};

// 历史工程分类（兼容旧数据与旧模型输出）
// value = 旧版存入 annotation.type 的英文 canonical code
// label = 旧前端显示中文名称
const ENGINEERING_TYPES = [
  { value: 'PLANT',            label: '植物药图' },
  { value: 'ANIMAL',           label: '动物药图' },
  { value: 'MINERAL',          label: '矿物药图' },
  { value: 'PROCESSED',        label: '炮制加工图' },
  { value: 'HUMAN_BODY',       label: '人体结构图' },
  { value: 'MEDICAL_PRACTICE', label: '医疗技法图' },
  { value: 'LIFESTYLE',        label: '养生保健图' },
  { value: 'PERSON_SCENE',     label: '人物场景图' },
];
const ENGINEERING_TYPE_LABEL = Object.fromEntries(ENGINEERING_TYPES.map(t => [t.value, t.label]));

// 《历代中医古籍图像类编》12大类体系
// 当前前端主分类正式切换到该 12 类体系，旧 8 类工程分类保存在 legacyType 兼容字段中。
// 工程分类 → 学术分类默认映射：
//   PLANT/ANIMAL/MINERAL → 药物图
//   PROCESSED            → 药物图 / 器具图 / 医疗图（视图像内容）
//   HUMAN_BODY           → 脏腑图 / 经穴图 / 部位图（视图像内容）
//   MEDICAL_PRACTICE     → 医疗图 / 诊法图
//   LIFESTYLE            → 养生图
//   PERSON_SCENE         → 人物图
const ACADEMIC_CLASSES = [
  { value: '疾病图',   subclasses: ['病位图','病形图','病因图'] },
  { value: '诊法图',   subclasses: ['脉诊图','望诊图'] },
  { value: '医疗图',   subclasses: ['疗法图','推拿图','复位图'] },
  { value: '药物图',   subclasses: ['药物形态图','药物炮制图','药物关联图'] },
  { value: '器具图',   subclasses: [] },
  { value: '养生图',   subclasses: ['练功图','拳法图'] },
  { value: '脏腑图',   subclasses: ['脏腑图','内景图'] },
  { value: '经穴图',   subclasses: ['全身经脉图','局部经脉图','铜人图','穴位图'] },
  { value: '部位图',   subclasses: ['骨度图','体表部位图'] },
  { value: '理论图',   subclasses: ['五运六气图','太极图','命门图','星象图','子午流注图','方解图','胎产图','禁忌图','五轮八廓图'] },
  { value: '符咒图',   subclasses: [] },
  { value: '人物图',   subclasses: ['作者像','历史人物'] },
];
const ILLUSTRATION_TYPES = ACADEMIC_CLASSES.map(c => ({ value: c.value, label: c.value }));
const TYPE_LABEL = Object.fromEntries(ILLUSTRATION_TYPES.map(t => [t.value, t.label]));
const ACADEMIC_CLASS_SET = new Set(ACADEMIC_CLASSES.map(c => c.value));
const ACADEMIC_SUBCLASS_MAP = Object.fromEntries(ACADEMIC_CLASSES.map(c => [c.value, c.subclasses]));
const UNSPECIFIED_ACADEMIC_SUBCLASS = '未细分';
function getAcademicClassMeta(value) {
  return ACADEMIC_CLASSES.find(c => c.value === value) || null;
}
function getSelectableAcademicSubclasses(cls) {
  const options = ACADEMIC_SUBCLASS_MAP[cls] || [];
  if (!options.length) return [];
  return [UNSPECIFIED_ACADEMIC_SUBCLASS, ...options];
}
function normalizeAcademicSubclass(cls, sub) {
  if (!cls || !sub) return null;
  const options = getSelectableAcademicSubclasses(cls);
  return options.includes(sub) ? sub : null;
}
// ── 全站统一状态词汇与样式：所有视图渲染状态时经此映射，禁止英文原始值直出界面 ──
const STATUS_LABEL = { running: '标注中', todo: '待标注', review: '待确认', ok: '已确认', bad: '已跳过' };
const STATUS_CLASS = { running: 'st-running', todo: 'st-todo', review: 'st-review', ok: 'st-ok', bad: 'st-bad' };
function statusLabel(s) { return STATUS_LABEL[s] || s || '—'; }
// ── /api/ 相对资源地址补成 bridge 绝对地址（file:// 或异源打开前端时不裂图）──
function absApiUrl(u) { return (typeof u === 'string' && u.startsWith('/api/')) ? BRIDGE_BASE + u : u; }
// ── 组内卷册显示名：去掉与组名重复的前缀，组卡片/列表只显示卷号部分 ──
function bookDisplayTitle(book) {
  const t = (book?.title || '').trim();
  if (book?.groupId && book.groupTitle && t.startsWith(book.groupTitle)) {
    const rest = t.slice(book.groupTitle.length).replace(/^[\s·\-—（(]+/, '').replace(/[\s）)]+$/, '');
    if (rest) return rest;
  }
  return t;
}
function inferDrugAcademicSubclassFromAnnotation(ann = {}, currentSub = '') {
  const subject = ann.subject || '';
  const visualText = [
    subject,
    ann.description || '',
    ann._description || '',
    ann.note || '',
    ann.annotationNote || '',
    ann.aiInterpretation || '',
    ann.textImageNote || '',
  ].join(' ');
  const allText = [
    visualText,
    ann.procedureStep || '',
    ann.herbClassical || '',
    ann.herbModern || '',
  ].join(' ');

  if (currentSub === '炼丹图') return '药物炮制图';
  if (currentSub && normalizeAcademicSubclass('药物图', currentSub)) return currentSub;

  const noProcessVisual = /图像(?:未|不)?直接(?:展示|描绘|表现).{0,12}(?:炮制|炮製|加工|操作)|(?:未见|没有|无).{0,8}(?:炮制|炮製|加工|操作)(?:场景|動作|动作)/.test(visualText);
  if (noProcessVisual) return '药物形态图';

  const relationWords = /生态|生境|环境|產地|产地|采集|採集|应用|運用|运用|民俗|神话|神話|传说|傳說|文学|詩文|诗文|交流|贸易|外来|对外|文化/.test(visualText);
  const shapeWords = /形态|形態|外形|药材|藥材|饮片|飲片|植物|动物|動物|矿物|礦物|根|茎|莖|叶|葉|花|果|皮|石|砂|屑|末/.test(visualText);
  const processWords = /炮制|炮製|加工|工序|流程|炒|煅|炼|煉|熬|煮|蒸|炙|洗|晒|曬|研|捣|搗|切|舂|磨|碾|淘|煎|火|炉|爐|鼎|锅|鍋|灶|竈|臼|钵|鉢|杵/.test(visualText);
  const processSceneWords = /场景|場景|过程|過程|人物|正在|操作|处理|處理|使用|手持|炉|爐|鼎|锅|鍋|灶|竈|臼|钵|鉢|杵/.test(visualText);

  if (processWords && processSceneWords) return '药物炮制图';
  if (/炮制|炮製/.test(subject) && !shapeWords) return '药物炮制图';
  if (relationWords && !shapeWords && !processWords) return '药物关联图';
  if (['PLANT', 'ANIMAL', 'MINERAL'].includes(ann.legacyType || '')) return '药物形态图';

  // procedureStep 来自文字证据，不能单独决定图像是炮制图；只作为弱兜底。
  if (/炮制|炮製/.test(allText) && /场景|場景|过程|過程|人物|正在|操作/.test(visualText)) return '药物炮制图';
  return '药物形态图';
}
function inferAcademicClassificationFromAnnotation(ann = {}) {
  if (!ann || typeof ann !== 'object') return { type: '', academicClass: null, academicSubclass: null, legacyType: null };
  const legacyType = ENGINEERING_TYPE_LABEL[ann.legacyType] ? ann.legacyType
    : (ENGINEERING_TYPE_LABEL[ann.type] ? ann.type : null);
  let academicClass = ACADEMIC_CLASS_SET.has(ann.type) ? ann.type
    : (ACADEMIC_CLASS_SET.has(ann.academicClass) ? ann.academicClass : '');
  let academicSubclass = ann.academicSubclass || null;
  const text = [
    ann.subject || '',
    ann.note || '',
    ann.procedureStep || '',
    ann.herbClassical || '',
    ann.herbModern || '',
    ann.meridian || '',
    ...(Array.isArray(ann.points) ? ann.points : []),
  ].join(' ');
  if (!academicClass && legacyType) {
    switch (legacyType) {
      case 'PLANT':
      case 'ANIMAL':
      case 'MINERAL':
        academicClass = '药物图';
        academicSubclass = '药物形态图';
        break;
      case 'PROCESSED':
        if (/炉|鼎|臼|钵|杵|碾|磨|筛|锅/.test(text) && !ann.procedureStep) {
          academicClass = '器具图';
          academicSubclass = null;
        } else {
          academicClass = '药物图';
          academicSubclass = inferDrugAcademicSubclassFromAnnotation(ann, academicSubclass);
        }
        break;
      case 'HUMAN_BODY':
        if ((Array.isArray(ann.points) && ann.points.length) || ann.meridian || /穴|经/.test(text)) {
          academicClass = '经穴图';
          academicSubclass = '穴位图';
        } else if (/脏|腑|心|肝|脾|肺|肾/.test(text)) {
          academicClass = '脏腑图';
          academicSubclass = '脏腑图';
        } else {
          academicClass = '部位图';
          academicSubclass = '体表部位图';
        }
        break;
      case 'MEDICAL_PRACTICE':
        if (/脉|诊|望闻问切/.test(text)) {
          academicClass = '诊法图';
          academicSubclass = /脉/.test(text) ? '脉诊图' : '望诊图';
        } else {
          academicClass = '医疗图';
          academicSubclass = '疗法图';
        }
        break;
      case 'LIFESTYLE':
        academicClass = '养生图';
        academicSubclass = null;
        break;
      case 'PERSON_SCENE':
        academicClass = '人物图';
        academicSubclass = /作者|像/.test(text) ? '作者像' : '历史人物';
        break;
      default:
        break;
    }
  }
  if (academicClass === '药物图') {
    academicSubclass = inferDrugAcademicSubclassFromAnnotation(ann, academicSubclass);
  }
  academicSubclass = normalizeAcademicSubclass(academicClass, academicSubclass);
  return {
    type: academicClass || '',
    academicClass: academicClass || null,
    academicSubclass,
    legacyType,
  };
}
// 类型 → 专属字段 的严谨判定：字段只在该出现的插图类型下出现，避免串类。
function isDrugLikeAnnotation(ann = {}) {
  // 药材名/现代名 仅药物图
  return ann.type === '药物图' ||
    ['PLANT','ANIMAL','MINERAL','PROCESSED'].includes(ann.legacyType || '');
}
function isBodyLikeAnnotation(ann = {}) {
  // 经脉/穴位 仅经穴图
  return ann.type === '经穴图' ||
    (ann.legacyType || '') === 'HUMAN_BODY';
}
function isProcedureRelevantAnnotation(ann = {}) {
  // 工序 仅药物炮制图细类
  return ann.academicSubclass === '药物炮制图';
}
const STATUSES = {
  todo:    { label: '待标注', pill: 'todo' },
  running: { label: '标注中', pill: 'running' },
  review:  { label: '待审核', pill: 'review' },
  ok:      { label: '已确认', pill: 'ok' },
  bad:     { label: '有问题', pill: 'bad' },
};

/* mock seed data with deterministic SVG placeholder thumbs */
function placeholderImg(seed, label) {
  // a quiet striped placeholder labeled with the entry name
  const h1 = (seed * 47) % 360;
  const c1 = `hsl(${h1}, 18%, 86%)`;
  const c2 = `hsl(${h1}, 16%, 78%)`;
  const svg = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 800' width='600' height='800'>
  <defs>
    <pattern id='p' patternUnits='userSpaceOnUse' width='16' height='16' patternTransform='rotate(45)'>
      <rect width='16' height='16' fill='${c1}'/>
      <rect width='8' height='16' fill='${c2}'/>
    </pattern>
  </defs>
  <rect width='600' height='800' fill='${c1}'/>
  <rect x='40' y='40' width='520' height='720' fill='url(#p)' opacity='0.6'/>
  <rect x='40' y='40' width='520' height='720' fill='none' stroke='#8a7a4a' stroke-width='2' stroke-dasharray='6 6'/>
  <g font-family='Songti SC, SimSun, serif' fill='#5a4a2a' text-anchor='middle'>
    <text x='300' y='370' font-size='44'>${label}</text>
    <text x='300' y='420' font-size='20' opacity='0.7'>古籍插图占位</text>
  </g>
  <g font-family='Cascadia Code, monospace' fill='#5a4a2a' font-size='13' opacity='0.6'>
    <text x='300' y='740' text-anchor='middle'>illustration placeholder · seed ${seed}</text>
  </g>
</svg>`.trim();
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const MOCK_FACTS = {}; // 演示数据已清除

function seedImages() { return []; } // 演示数据已清除，从「+ 添加图片」或「导入书籍」开始

let state;
let config;
let _bridgeSaveTail = Promise.resolve(true);
let _bridgeSaveFailedAt = 0;
let _deferPersistTimer = null;
let _bridgeRetryTimer = null;
let _bridgeRetryAttempt = 0;
function deferPersist() {
  clearTimeout(_deferPersistTimer);
  _deferPersistTimer = setTimeout(persist, 600);
}

// 脏标记：只 POST 真正发生变化的书，避免每次翻页序列化全量 state
const _dirtyBookIds = new Set();
let   _globalDirty  = false;
const _lastBookSnapshots = {};   // bookId -> last JSON string sent, 用于跳过内容未变的书

function markBookDirty(bookId) { if (bookId) _dirtyBookIds.add(bookId); }
function markGlobalDirty()     { _globalDirty = true; }
let _bridgeSaveFailureShown = false;

function bridgePostJson(url, body, timeoutMs = 15000) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function buildDefaultState() {
  return {
    project: '中医古籍插图标注',
    illustrations: seedImages(),
    selectedId: null,
    rightTab: 'form',
    filter: 'all',
    imageBookFilter: 'all',
    search: '',
    crossrefCollapsed: false,
    books: [],
    leftTab: 'images',
    mainView: 'home',
    currentBookId: null,
    currentBookPage: null,
    pageDetailMode: 'illust',
    pageBrowseScope: 'illustrations',
    pageRectEditing: false,
    bookTemplateEditing: false,
    bookTemplateBookId: null,
    bookTemplatePageNum: null,
    galleryFilter: 'all',
    gallerySort: 'page',
    galleryView: 'grid',
    galleryScope: 'illustrations',
    gallerySelection: [],
    annotateSelection: [],
    pdfZoom: 1,
    mergeMode: false,
    mergeSelected: [],
    previewBookId: null,
    previewGroupId: null,
    groupCollapsed: {},
    leftCollapsed: false,
    rightCollapsed: false,
    rightPaneWidth: null,
    mergePreview: null,
    pageIllustViewFull: false,
    illustCropEditing: false,
    illustCropEditingPage: null,
    illustCropEditingImageId: null,
    showcaseFeaturedIds: [],
  };
}

function buildUiSnapshot() {
  return {
    __kind: 'ui_snapshot_v2',
    project: state.project,
    selectedId: state.selectedId,
    rightTab: state.rightTab,
    filter: state.filter,
    imageBookFilter: state.imageBookFilter,
    search: state.search,
    crossrefCollapsed: state.crossrefCollapsed,
    leftTab: state.leftTab,
    mainView: state.mainView,
    currentBookId: state.currentBookId,
    currentBookPage: state.currentBookPage,
    pageDetailMode: state.pageDetailMode,
    pageBrowseScope: state.pageBrowseScope,
    pageRectEditing: state.pageRectEditing,
    bookTemplateEditing: state.bookTemplateEditing,
    bookTemplateBookId: state.bookTemplateBookId,
    bookTemplatePageNum: state.bookTemplatePageNum,
    galleryFilter: state.galleryFilter,
    gallerySort: state.gallerySort,
    galleryView: state.galleryView,
    galleryScope: state.galleryScope,
    gallerySelection: state.gallerySelection,
    showcaseFeaturedIds: state.showcaseFeaturedIds,
    annotateSelection: state.annotateSelection,
    pdfZoom: state.pdfZoom,
    leftCollapsed: state.leftCollapsed,
    rightCollapsed: state.rightCollapsed,
    rightPaneWidth: state.rightPaneWidth,
    bookPanelCollapsed: state.bookPanelCollapsed,
  };
}

function applyUiSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const fields = [
    'project', 'selectedId', 'rightTab', 'filter', 'imageBookFilter', 'search', 'crossrefCollapsed',
    'leftTab', 'mainView', 'currentBookId', 'currentBookPage', 'pageDetailMode',
    'pageBrowseScope', 'pageRectEditing', 'bookTemplateEditing', 'bookTemplateBookId', 'bookTemplatePageNum', 'galleryFilter', 'gallerySort',
    'galleryView', 'galleryScope', 'gallerySelection', 'showcaseFeaturedIds', 'annotateSelection', 'pdfZoom', 'leftCollapsed', 'rightCollapsed', 'rightPaneWidth',
    'bookPanelCollapsed',
  ];
  for (const key of fields) {
    if (snapshot[key] !== undefined) state[key] = snapshot[key];
  }
}

function noteBridgeSaveFailure() {
  const now = Date.now();
  if (now - _bridgeSaveFailedAt < 8000 && _bridgeSaveFailureShown) return;
  _bridgeSaveFailedAt = now;
  _bridgeSaveFailureShown = true;
  toast(isDataSourceReadOnly()
    ? '当前是只读历史生产库，修改未保存；请切换到新版重标库。'
    : '保存尚未完成，系统正在自动重试；请暂勿刷新页面。', 'warning');
}

function scheduleBridgeRetry() {
  if (_bridgeRetryTimer || !_bridgeAvailable || isDataSourceReadOnly()) return;
  const delay = Math.min(30000, 1500 * (2 ** _bridgeRetryAttempt));
  _bridgeRetryAttempt = Math.min(_bridgeRetryAttempt + 1, 5);
  _bridgeRetryTimer = setTimeout(() => {
    _bridgeRetryTimer = null;
    enqueueBridgeFlush().catch(() => {});
  }, delay);
}

async function flushBridgeState() {
  if (!_bridgeAvailable) return false;
  if (isDataSourceReadOnly()) {
    _dirtyBookIds.clear();
    _globalDirty = false;
    return false;
  }
  if (!_dirtyBookIds.size && !_globalDirty) return true;  // 无变更，跳过

  // 快照本次要刷新的脏集合，清空旗标（即使失败也不重复入队相同内容）
  const dirtyBooks = [..._dirtyBookIds];
  const doGlobal   = _globalDirty;
  _dirtyBookIds.clear();
  _globalDirty = false;

  const failedBooks = [];
  let   globalFailed = false;

  try {
    const tasks = [];

    // 全局 state（非书图像 + 项目名）
    if (doGlobal) {
      const globalIllustrations = state.illustrations.filter(img => !img.pdfSource?.bookId);
      const payload = JSON.stringify({
        project: state.project,
        images: globalIllustrations,
        showcaseFeaturedIds: Array.isArray(state.showcaseFeaturedIds) ? state.showcaseFeaturedIds : [],
      });
      tasks.push(
        bridgePostJson(BRIDGE_GLOBAL_URL, payload).then(r => { if (!r.ok) globalFailed = true; })
          .catch(() => { globalFailed = true; })
      );
    }

    // 各脏书单独 POST
    for (const bookId of dirtyBooks) {
      const book = state.books.find(b => b.id === bookId);
      if (!book) continue;
      const bookIllustrations = state.illustrations.filter(img => img.pdfSource?.bookId === bookId);
      const payload = JSON.stringify({ book, images: bookIllustrations });
      // 内容未变则跳过网络请求
      if (payload === _lastBookSnapshots[bookId]) continue;
      tasks.push(
        bridgePostJson(BRIDGE_BOOK_URL(bookId), payload).then(r => {
          if (r.ok) _lastBookSnapshots[bookId] = payload;
          else failedBooks.push(bookId);
        }).catch(() => failedBooks.push(bookId))
      );
    }

    await Promise.all(tasks);

    // 把失败的重新标脏，等下次 flush
    if (globalFailed) _globalDirty = true;
    failedBooks.forEach(id => _dirtyBookIds.add(id));

    if (globalFailed || failedBooks.length) {
      noteBridgeSaveFailure();
      scheduleBridgeRetry();
      return false;
    }
    _bridgeSaveFailureShown = false;
    _bridgeRetryAttempt = 0;
    return true;
  } catch (e) {
    console.warn('bridge session save failed', e);
    noteBridgeSaveFailure();
    if (doGlobal) _globalDirty = true;
    dirtyBooks.forEach(id => _dirtyBookIds.add(id));
    scheduleBridgeRetry();
    return false;
  }
}

function enqueueBridgeFlush() {
  const run = () => flushBridgeState();
  const next = _bridgeSaveTail.then(run, run);
  _bridgeSaveTail = next.catch(() => false);
  return next;
}
async function storeModelRunSnapshot(illust, annotation, { provider, model, hasMultiple = false } = {}) {
  if (!illust?.pdfSource || !annotation || typeof annotation !== 'object') return null;
  const bridgeOk = await checkBridge();
  if (!bridgeOk) return null;
  const ta = getPageTextAsset(illust) || {};
  const payload = {
    provider: provider || config.provider || '',
    model: model || illust.modelUsed || '',
    image_id: illust.id,
    book_id: illust.pdfSource.bookId || '',
    book_title: illust.pdfSource.bookTitle || '',
    page_num: illust.pdfSource.pageNum || null,
    selection_mode: illust.pdfSource.selectionMode || '',
    status: illust.status || '',
    has_multiple_illustrations: !!hasMultiple,
    text_asset: {
      full_text: ta.fullText || '',
      associated_text: ta.associatedText || '',
      text_source: ta.textSource || '',
      text_status: ta.textStatus || '',
      verified: !!ta.verified,
    },
    crossref: illust.crossref || {},
    annotation,
  };
  const r = await fetch(BRIDGE_STORE_MODEL_RUN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `模型归档失败（HTTP ${r.status}）`);
  return data;
}
async function logClientRuntimeFailure(kind, error, extra = {}) {
  try {
    const bridgeOk = await checkBridge();
    if (!bridgeOk) return false;
    const provider = extra.provider || config.provider || '';
    const modelMap = {
      qwen: config.qwenModel, openai: config.openaiModel, deepseek: config.deepseekModel, kimi: config.kimiModel,
      doubao: config.doubaoModel, zhipu: config.zhipuModel, gemini: config.geminiModel, baidu: config.baiduModel,
    };
    const message = error?.message || String(error || '');
    const stack = error?.stack || '';
    const payload = {
      kind,
      provider,
      model: extra.model || modelMap[provider] || '',
      message,
      stack,
      extra: {
        ...extra,
        mainView: state.mainView,
        currentBookId: state.currentBookId || '',
        currentBookPage: state.currentBookPage || null,
        selectedId: state.selectedId || '',
      },
    };
    const r = await fetch(BRIDGE_CLIENT_ERROR_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}
async function fetchModelRunsForImage(illust) {
  if (!illust?.id || !illust?.pdfSource?.bookId) return [];
  const bridgeOk = await checkBridge();
  if (!bridgeOk) throw new Error('bridge.py 未启动，无法读取模型归档');
  const qs = new URLSearchParams({
    image_id: illust.id,
    book_id: illust.pdfSource.bookId,
  });
  const r = await fetch(`${BRIDGE_MODEL_RUNS_URL}?${qs.toString()}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `模型归档读取失败（HTTP ${r.status}）`);
  return Array.isArray(data.records) ? data.records : [];
}
function hasRecoverableCurrentResult(illust) {
  if (!illust) return false;
  const annCount = illust.annotation && typeof illust.annotation === 'object' ? Object.keys(illust.annotation).length : 0;
  const aiCount = illust.aiDraft && typeof illust.aiDraft === 'object' ? Object.keys(illust.aiDraft).length : 0;
  return annCount > 0 || aiCount > 0;
}

// 全书库版本化重标：重新运行 AI 前，把当前人工确认版本完整保存到记录内。
// 日常界面仍只显示一份“当前标注”，历史版本不另拆数据源，但可追溯、可恢复。
function archiveConfirmedVersionBeforeRerun(img, previousStatus) {
  if (!img || previousStatus !== 'ok' || !img.annotation) return null;
  img.reviewMeta = img.reviewMeta || {};
  const existingArchives = Array.isArray(img.reviewMeta.modelArchives)
    ? img.reviewMeta.modelArchives.slice()
    : [];
  const versionContext = img.versionContext ? deepClone(img.versionContext) : null;
  const snapshot = {
    snapshotSchema: 'annotation-version-v1',
    source: 'human_confirmed',
    datasetId: versionContext?.datasetId || 'legacy-production',
    confirmedAt: img.verifiedAt || Date.now(),
    model: img.modelUsed || '',
    status: 'ok',
    canonicalId: img.canonicalId || '',
    annotatedAt: img.annotatedAt || null,
    draftRunId: img.draftRunId || null,
    reviewCycleId: typeof img.reviewCycleId === 'number' ? img.reviewCycleId : null,
    aiDraft: deepClone(img.aiDraft || img.annotation),
    annotation: deepClone(img.annotation),
    reviewDiff: deepClone(img.reviewDiff || {}),
    reviewEvents: deepClone(img.reviewEvents || []),
    fieldReviewReasons: deepClone(img.fieldReviewReasons || {}),
    reviewSessions: deepClone(img.reviewSessions || []),
    versionContext,
    annotationEvidence: deepClone(img.annotationEvidence || null),
    note: '重新运行 AI 前的人工确认版本',
  };
  img.reviewMeta.modelArchives = [snapshot, ...existingArchives].slice(0, 12);
  return snapshot;
}

function restoreConfirmedVersionSnapshot(img, snapshot) {
  if (!img || !snapshot?.annotation) throw new Error('历史版本缺少人工终稿');
  img.annotation = deepClone(snapshot.annotation);
  img.aiDraft = deepClone(snapshot.aiDraft || snapshot.annotation);
  img.reviewDiff = deepClone(snapshot.reviewDiff || {});
  img.reviewEvents = deepClone(snapshot.reviewEvents || []);
  img.fieldReviewReasons = deepClone(snapshot.fieldReviewReasons || {});
  img.reviewSessions = deepClone(snapshot.reviewSessions || []);
  if (snapshot.versionContext) img.versionContext = deepClone(snapshot.versionContext);
  else delete img.versionContext;
  if (snapshot.annotationEvidence) img.annotationEvidence = deepClone(snapshot.annotationEvidence);
  else delete img.annotationEvidence;
  if (snapshot.draftRunId) img.draftRunId = snapshot.draftRunId;
  else delete img.draftRunId;
  if (typeof snapshot.reviewCycleId === 'number') img.reviewCycleId = snapshot.reviewCycleId;
  else delete img.reviewCycleId;
  img.modelUsed = snapshot.model || '';
  img.annotatedAt = snapshot.annotatedAt || null;
  img.canonicalId = snapshot.canonicalId || generateCanonicalId(img);
  img.status = 'ok';
  img.verifiedAt = snapshot.confirmedAt || Date.now();
  return img;
}
function inferProviderFromModelName(modelName = '') {
  const text = String(modelName || '').toLowerCase();
  if (!text) return config.provider || '';
  if (text.includes('qwen')) return 'qwen';
  if (text.includes('gpt') || text.includes('openai')) return 'openai';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('moonshot') || text.includes('kimi')) return 'kimi';
  if (text.includes('doubao') || text.includes('ark')) return 'doubao';
  if (text.includes('glm') || text.includes('zhipu')) return 'zhipu';
  if (text.includes('ernie') || text.includes('baidu')) return 'baidu';
  return config.provider || '';
}
async function archiveCurrentSessionModelRun(illust, { providerHint = '' } = {}) {
  if (!illust || !illust.annotation || typeof illust.annotation !== 'object' || !illust.modelUsed) {
    throw new Error('当前图片没有可归档的模型结果');
  }
  const archived = await storeModelRunSnapshot(illust, deepClone(illust.annotation), {
    provider: providerHint || inferProviderFromModelName(illust.modelUsed),
    model: illust.modelUsed,
    hasMultiple: !!illust.hasMultipleIllustrations,
  });
  if (archived?.relative_path) {
    illust.reviewMeta = illust.reviewMeta || {};
    illust.reviewMeta.modelArchivePath = archived.relative_path;
    const archiveList = Array.isArray(illust.reviewMeta.modelArchives) ? illust.reviewMeta.modelArchives.slice() : [];
    const nextItem = {
      provider: config.provider,
      model: illust.modelUsed,
      relative_path: archived.relative_path,
      stored_at: new Date().toISOString(),
    };
    // 不再按 provider+model 去重，同一模型多次标注均保留（靠 stored_at 区分），上限 12 条
    illust.reviewMeta.modelArchives = [nextItem, ...archiveList].slice(0, 12);
  }
  persistImage(illust);
  return archived;
}
function restoreArchivedModelRun(img, rec) {
  if (!img || !rec?.annotation || typeof rec.annotation !== 'object') {
    throw new Error('归档记录缺少可恢复的标注结果');
  }
  const annotation = normalizeAnnotationShape(deepClone(rec.annotation)) || {};
  img.aiDraft = deepClone(annotation);
  img.annotation = deepClone(annotation);
  img.reviewMeta = img.reviewMeta || {};
  img.reviewMeta.aiGeneratedAt = rec.stored_at ? new Date(rec.stored_at).getTime() : Date.now();
  img.reviewMeta.aiModel = rec.model || '';
  img.reviewMeta.humanEditedAt = null;
  if (rec.relative_path) img.reviewMeta.modelArchivePath = rec.relative_path;
  img.reviewDiff = {};
  img.modelUsed = rec.model || img.modelUsed || '';
  img.status = 'review';
  img.annotatedAt = rec.stored_at ? new Date(rec.stored_at).getTime() : Date.now();
  img.hasMultipleIllustrations = !!rec.has_multiple_illustrations;
  if (rec.crossref && typeof rec.crossref === 'object') {
    img.crossref = deepClone(rec.crossref);
  }

  const ta = getPageTextAsset(img);
  const archivedText = rec.text_asset || {};
  if (ta) {
    if (!ta.fullText && archivedText.full_text) ta.fullText = archivedText.full_text;
    if (!ta.associatedText && archivedText.associated_text) ta.associatedText = archivedText.associated_text;
    if (!ta.textSource && archivedText.text_source) ta.textSource = archivedText.text_source;
    if (!ta.textStatus && archivedText.text_status) ta.textStatus = archivedText.text_status;
    if (archivedText.verified) ta.verified = true;
    ta.updatedAt = new Date().toISOString();
  }
  refreshReviewDiff(img);
}
function openModelRunDialog(img) {
  const body = el('div', { class: 'modal-body', style: 'display:grid; gap:12px; max-height:68vh; overflow:auto;' },
    el('div', { style: 'font-size:13px; color:var(--c-text-soft);' }, '正在读取当前图片的模型归档…')
  );
  const modal = el('div', { class: 'modal', style: 'max-width:760px;' },
    el('div', { class: 'modal-head' },
      el('h3', null, '模型归档'),
      el('button', { class: 'modal-close', onclick: close }, '×'),
    ),
    body,
    el('div', { class: 'modal-foot' },
      el('button', { class: 'btn', onclick: close }, '关闭'),
    ),
  );
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } }, modal);
  $('#overlay-root').appendChild(scrim);
  function close() { scrim.remove(); }

  (async () => {
    try {
      const records = await fetchModelRunsForImage(img);
      body.innerHTML = '';
      body.appendChild(el('div', { style: 'font-size:12.5px; color:var(--c-text-soft); line-height:1.7;' },
        `当前图片：${img.id}${img.pdfSource?.pageNum ? ` · 第 ${img.pdfSource.pageNum} 页` : ''}`));
      body.appendChild(el('div', {
        style: 'padding:10px 12px; border-radius:8px; background:#f7f9fc; border:1px solid var(--c-border); display:grid; gap:6px;'
      },
        el('div', { style: 'font-size:12px; color:var(--c-text-mute);' }, '当前主会话显示'),
        el('div', { style: 'font-size:13px; color:var(--c-text); font-weight:600;' }, `${img.modelUsed || '未记录模型'}${img.annotatedAt ? ` · ${fmtDate(img.annotatedAt)}` : ''}`),
        el('div', { style: 'font-size:12px; color:var(--c-text-soft); line-height:1.7;' },
          `类型：${img.annotation?.type || '—'} ｜ 主体：${img.annotation?.subject || '—'} ｜ 原文标签：${img.annotation?.herbClassical || '—'}`)
      ));
      // 人工确认版本历史快照（modelArchives 中 source=human_confirmed 的条目）
      const confirmedSnapshots = (img.reviewMeta?.modelArchives || []).filter(a => a.source === 'human_confirmed');
      if (confirmedSnapshots.length) {
        body.appendChild(el('div', {
          style: 'font-size:11.5px; color:var(--c-text-mute); margin:4px 0 2px; letter-spacing:.5px;'
        }, '── 人工确认版本历史 ──'));
        confirmedSnapshots.forEach((snap, idx) => {
          const ann = snap.annotation || {};
          const snapCard = el('div', {
            style: 'padding:12px 14px; border:1px solid #d4e0c8; border-radius:10px; background:#f7fbf3; display:grid; gap:6px;'
          },
            el('div', { style: 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;' },
              el('span', { class: 'pill ok' }, el('span', { class: 'dot' }), '人工确认'),
              snap.model ? el('span', { class: 'small', style: 'color:var(--c-text-mute);' }, snap.model) : null,
              el('span', { class: 'small', style: 'margin-left:auto;' }, snap.confirmedAt ? fmtDate(snap.confirmedAt) : '—'),
            ),
            el('div', { style: 'font-size:12.5px; color:var(--c-text-soft); line-height:1.8;' },
              `类型：${ann.type || '—'} ｜ 主体：${ann.subject || '—'} ｜ 原文标签：${ann.herbClassical || '—'}`),
            el('div', { style: 'font-size:11.5px; color:var(--c-text-mute);' }, snap.note || ''),
          );
          snapCard.appendChild(el('div', { style: 'display:flex; justify-content:flex-end; margin-top:4px;' },
            el('button', {
              class: 'btn primary',
              onclick: () => {
                restoreConfirmedVersionSnapshot(img, snap);
                persistImage(img); renderAll(); close();
                toast(`已恢复为第 ${idx + 1} 条人工确认版本`, 'success');
              }
            }, '恢复此版本')
          ));
          body.appendChild(snapCard);
        });
      }

      if (!records.length) {
        if (img.annotation && Object.keys(img.annotation).length && img.modelUsed) {
          body.appendChild(el('div', {
            style: 'padding:12px 14px; border:1px dashed #d8c48a; border-radius:10px; background:#fffaf0; display:grid; gap:8px;'
          },
            el('div', { style: 'font-size:13px; color:#7a5c10; font-weight:600;' }, '当前主会话已有结果，但这页是在模型归档功能上线前标注的'),
            el('div', { style: 'font-size:12.5px; color:#8a7a4a; line-height:1.8;' },
              '所以当前模型结果只存在于主会话里，还没有写入模型归档。点下面按钮可把这页当前结果补归档，之后就能按模型查看与切换。'),
            el('div', { style: 'display:flex; justify-content:flex-end; gap:8px;' },
              el('button', {
                class: 'btn primary',
                onclick: async () => {
                  try {
                    await archiveCurrentSessionModelRun(img);
                    toast('已将当前主会话结果补归档', 'success');
                    close();
                    openModelRunDialog(img);
                  } catch (err) {
                    toast(`补归档失败：${err.message || err}`, 'error');
                  }
                }
              }, '归档当前结果')
            )
          ));
        }
        body.appendChild(el('div', { class: 'placeholder-state', style: 'height:180px' },
          el('div', { class: 'sub' }, '当前还没有可查看的模型归档')));
        return;
      }
      records.forEach(rec => {
        const ann = rec.annotation || {};
        const card = el('div', {
          style: 'padding:12px 14px; border:1px solid #e5e7eb; border-radius:10px; background:#fff; display:grid; gap:8px;'
        },
          el('div', { style: 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;' },
            el('span', { class: 'pill review' }, el('span', { class: 'dot' }), rec.provider || '—'),
            el('span', { class: 'pill ok' }, el('span', { class: 'dot' }), rec.model || '—'),
            el('span', { class: 'small', style: 'margin-left:auto;' }, rec.stored_at ? fmtDate(rec.stored_at) : '—'),
          ),
          el('div', { style: 'font-size:12.5px; color:var(--c-text-soft); line-height:1.8;' },
            `类型：${ann.type || '—'} ｜ 主体：${ann.subject || '—'} ｜ 原文标签：${ann.herbClassical || '—'}`),
          el('div', { style: 'font-size:12.5px; color:var(--c-text-soft); line-height:1.8;' },
            `图文互证：${ann.aiVerdict || '—'} ｜ 说明：${ann.aiVerdictNote || ann.note || '—'}`),
          el('div', { style: 'font-size:11.5px; color:var(--c-text-mute); line-height:1.7; word-break:break-all;' },
            `归档位置：${rec.relative_path || '—'}`),
        );
        card.appendChild(el('div', { style: 'display:flex; justify-content:flex-end; gap:8px; margin-top:2px;' },
          el('button', {
            class: 'btn primary',
            onclick: () => {
              try {
                restoreArchivedModelRun(img, rec);
                persistImage(img);
                renderAll();
                close();
                toast(`已切换为 ${rec.provider || '—'} / ${rec.model || '—'} 的历史标注结果`, 'success');
              } catch (err) {
                toast(`恢复模型归档失败：${err.message || err}`, 'error');
              }
            }
          }, '设为当前显示')
        ));
        body.appendChild(card);
      });
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'placeholder-state', style: 'height:180px' },
        el('div', { class: 'sub' }, `读取模型归档失败：${e.message || e}`)));
    }
  })();
}
const AI_PARSE_FAILURE_MARKERS = new Set(['parse failed, see raw_text', '解析失败']);
const AI_RESPONSE_TYPE_MAP = {
  PLANT: 'PLANT', ANIMAL: 'ANIMAL', MINERAL: 'MINERAL', PROCESSED: 'PROCESSED',
  HUMAN_BODY: 'HUMAN_BODY', MEDICAL_PRACTICE: 'MEDICAL_PRACTICE',
  LIFESTYLE: 'LIFESTYLE', PERSON_SCENE: 'PERSON_SCENE',
  herb_illustration: 'PLANT',
  acupuncture_point: 'HUMAN_BODY',
  meridian_chart: 'HUMAN_BODY',
  surgical_procedure: 'MEDICAL_PRACTICE',
  case_diagram: 'MEDICAL_PRACTICE',
  text_only: '', unknown: '',
};
const AI_RESPONSE_CONF_MAP = { '高': 'high', '中': 'mid', '低': 'low', high: 'high', mid: 'mid', low: 'low' };

function isAIParseFailureText(value) {
  return typeof value === 'string' && AI_PARSE_FAILURE_MARKERS.has(value.trim().toLowerCase());
}

function looksLikeRecoverableBrokenAnnotation(ann) {
  if (!ann || typeof ann !== 'object') return false;
  return (
    (isAIParseFailureText(ann.illustrationName) || isAIParseFailureText(ann.subject)) &&
    typeof ann._rawText === 'string' &&
    ann._rawText.includes('raw_text')
  );
}

function decodeAIRecoveryText(text) {
  if (typeof text !== 'string') return '';
  let decoded = text.trim();
  for (let i = 0; i < 3; i++) {
    const next = decoded
      .replace(/\\r/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"');
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function extractRecoveredField(text, key) {
  if (!text) return '';
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...text.matchAll(new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]*)"`, 'gu'))];
  if (!matches.length) return '';
  return (matches[matches.length - 1]?.[1] || '').trim();
}

function recoverAnnotationFromRawText(rawText) {
  const text = decodeAIRecoveryText(rawText);
  if (!text) return null;
  const academicClass = extractRecoveredField(text, 'academic_class');
  const academicSubclass = extractRecoveredField(text, 'academic_subclass');
  const legacyType = AI_RESPONSE_TYPE_MAP[extractRecoveredField(text, 'legacy_type_guess')] || '';
  const mainSubject = extractRecoveredField(text, 'primary_subject') || extractRecoveredField(text, 'main_subject');
  const explicitIllustrationName = extractRecoveredField(text, 'illustration_name');
  const ancientName = extractRecoveredField(text, 'source_label') || extractRecoveredField(text, 'herb_name_ancient');
  const herbModern = extractRecoveredField(text, 'herb_name_modern');
  const drawingStyle = extractRecoveredField(text, 'drawing_style');
  const layout = extractRecoveredField(text, 'layout');
  const preservation = extractRecoveredField(text, 'preservation');
  const description = extractRecoveredField(text, 'description');
  const confidence = AI_RESPONSE_CONF_MAP[extractRecoveredField(text, 'confidence')] || 'mid';
  const illustrationName = cleanIllustrationName(explicitIllustrationName || ancientName || mainSubject);

  if (!academicClass && !legacyType && !illustrationName && !description) return null;

  const recovered = {
    type: academicClass || '',
    academicClass: academicClass || null,
    academicSubclass: normalizeAcademicSubclass(academicClass, academicSubclass || null),
    legacyType: legacyType || null,
    illustrationName,
    subject: mainSubject || '',
    style: drawingStyle || '',
    preservation: preservation || '',
    confidence,
    herbClassical: ancientName || '',
    herbModern: herbModern || '',
    species: '',
    parts: [],
    meridian: '',
    points: [],
    note: '',
    procedureStep: '',
    blockType: '',
    textImageRelation: '',
    textDirection: '',
    readingOrderAssumed: '',
    titleLabelDirection: '',
    aiVerdict: '',
    aiVerdictNote: '',
    correspondingText: '',
    textEvidenceExcerpt: '',
    aiInterpretation: '',
    visualDescription: description || '',
    _description: description || '',
    _textInImage: '',
    _layout: layout || '',
    _rawText: rawText || '',
  };
  const migrated = inferAcademicClassificationFromAnnotation(recovered);
  recovered.type = migrated.type || recovered.type;
  recovered.academicClass = migrated.academicClass || recovered.academicClass;
  recovered.academicSubclass = migrated.academicSubclass || recovered.academicSubclass;
  recovered.legacyType = migrated.legacyType || recovered.legacyType;
  return recovered;
}

function normalizeAnnotationShape(ann) {
  if (!ann || typeof ann !== 'object') return ann;
  if (looksLikeRecoverableBrokenAnnotation(ann)) {
    const recovered = recoverAnnotationFromRawText(ann._rawText);
    if (recovered) Object.assign(ann, recovered);
  }
  const verdictValues = ['一致', '存疑', '矛盾'];
  const legacyVerdict = ann.textImageRelation;
  if (!ann.aiVerdict && verdictValues.includes(legacyVerdict)) {
    ann.aiVerdict = legacyVerdict;
    ann.aiVerdictNote = ann.aiVerdictNote || ann.textImageNote || '';
    ann.textImageRelation = ann._layout || '';
  }
  if (!ann.aiVerdictNote && ann.textImageNote) {
    ann.aiVerdictNote = ann.textImageNote;
  }
  const migrated = inferAcademicClassificationFromAnnotation(ann);
  ann.type = migrated.type || '';
  ann.academicClass = migrated.academicClass || null;
  ann.academicSubclass = migrated.academicSubclass || null;
  if (migrated.legacyType) ann.legacyType = migrated.legacyType;
  return ann;
}

// 新重标的一句话画面事实。优先读取正式字段；旧草稿仍可从内部 description / 旧 AI 解读显示，
// 但不在加载时静默改写 aiDraft，避免破坏原始候选。
function getVisualDescription(ann = {}) {
  // 一旦正式字段存在（即使被人工清空），就不得再从旧兼容值“复活”。
  if (Object.prototype.hasOwnProperty.call(ann, 'visualDescription')) {
    return String(ann.visualDescription || '').trim();
  }
  return String(ann._description || ann.aiInterpretation || '').trim();
}
const REVIEW_TRACK_FIELDS = [
  'type', 'subject', 'style', 'preservation', 'confidence',
  'herbClassical', 'herbModern', 'species', 'parts',
  'meridian', 'points', 'note', 'procedureStep',
  'blockType', 'textImageRelation', 'textDirection', 'readingOrderAssumed',
  'aiVerdict', 'aiVerdictNote', 'academicSubclass',
  'multiIllustrationRelation', 'multiIllustrationNote',
  'illustrationNamePinyin',  // 人工纠正的拼音须进审核 diff（自动拼音同写 aiDraft 基线，不产生噪声 diff）
  'illustrationName',        // Task 21 Gate 2.1：补全 display 层主键字段
  'correspondingText',       // Task 21 Gate 2.1：补全 evidence 层原文对照字段
  'visualDescription',       // 画面中可直接观察的主体、动作、器具和必要环境
];

// 显式不追踪的自由文本字段（不进入 v2 统计，不写 reviewEvent）
// supplement 是合并研究/描述自由文本，无字段级归因意义；仅走 legacy noteHumanEdit 刷新 diff 标记。
const UNTRACKED_FREE_TEXT_FIELDS = new Set(['supplement']);

// aiVerdict / confidence 是 AI 质量评估原始字段，仍用于论文和导出统计
// （如图文互证一致率、高置信/可用性比例）。UI 可做显示层映射，但不要随意删除或改写底层取值。
function aiVerdictDisplayLabel(verdict) {
  if (verdict === '一致') return '原文匹配可用';
  if (verdict === '存疑' || verdict === '矛盾') return '需修正原文匹配';
  return '未判断';
}

function deepClone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}
function normalizeCompareValue(v) {
  if (Array.isArray(v)) return JSON.stringify(v.map(x => String(x)).sort());
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function buildReviewDiff(illust) {
  illust = getAnnotationOwnerRecord(illust);
  const draft = illust?.aiDraft || null;
  const final = illust?.annotation || null;
  if (!draft || !final) return { changed: 0, fields: {} };
  const fields = {};
  for (const key of REVIEW_TRACK_FIELDS) {
    const a = draft[key];
    const b = final[key];
    if (normalizeCompareValue(a) !== normalizeCompareValue(b)) {
      fields[key] = { ai: a ?? null, human: b ?? null };
    }
  }
  return { changed: Object.keys(fields).length, fields };
}
function refreshReviewDiff(illust) {
  const diff = buildReviewDiff(illust);
  illust.reviewDiff = diff.fields;
  return diff;
}
function ensureEditableAnnotation(illust) {
  illust = getAnnotationOwnerRecord(illust);
  if (!illust.annotation) {
    illust.annotation = illust.aiDraft ? deepClone(illust.aiDraft) : {};
  }
  illust.annotation = normalizeAnnotationShape(illust.annotation) || {};
  return illust.annotation;
}
// Task 21 v2: noteHumanEdit 现在支持字段级原因记录
// 调用方式 1（兼容旧）: noteHumanEdit(illust) —— 仅刷新 diff，不记录原因
// 调用方式 2（v2）: noteHumanEdit(illust, { field, reason, before, after, sessionId }) —— 追加 reviewEvent
function noteHumanEdit(illust, opts = {}) {
  illust = getAnnotationOwnerRecord(illust);
  illust.reviewMeta = illust.reviewMeta || {};
  illust.reviewMeta.humanEditedAt = Date.now();
  // v2: 若提供 field 且有变更，追加 append-only 事件
  if (opts.field && HUMAN_REVIEW_REASONS.includes(opts.reason)) {
    appendReviewEvent(illust, {
      field: opts.field,
      reason: opts.reason,
      actorType: 'human',
      before: opts.before,
      after: opts.after,
      sessionId: opts.sessionId || illust._activeSessionId || null,
    });
  }
  return refreshReviewDiff(illust);
}

/* ============================================================
   Task 21 Gate 2：标注评价契约 v2
   - 字段级归因 reviewEvents[] + fieldReviewReasons 投影
   - 版本/来源上下文 versionContext
   - 有效审核时间 reviewSessions[] + effectiveReviewSeconds
   - reviewMode 保留为系统按文字证据推导的兼容投影，不由审核人选择
   - 统计导出 JSON + TXT
   不修改既有冻结数据；新字段缺失的历史记录标为 legacy_unattributed。
   ============================================================ */

// v2 schema 版本标识
const ANNOTATION_EVAL_SCHEMA_VERSION = 'annotation-eval-v2';
// 分类版本（与 ACADEMIC_CLASSES 12 类体系绑定）
const CLASSIFICATION_VERSION = 'academic-12class-v1';
// 空闲超时阈值（秒）；v2 试验默认 120
const REVIEW_IDLE_TIMEOUT_SECONDS = 120;

// 字段层级映射（契约 §3）。运行时键名 → 层级。
const FIELD_TIER = {
  academicClass: 'core', academicSubclass: 'core', subject: 'core', type: 'core',
  // herbClassical 是历史存储键；新标注只把它作为“原文标签/原书称谓”的兼容落点。
  herbClassical: 'evidence', correspondingText: 'evidence', visualDescription: 'evidence', textImageRelation: 'evidence',
  // procedureStep 自重标规范 v1 起停止生成和审核，仅为旧记录保留读取兼容。
  procedureStep: 'legacy',
  herbModern: 'extended', style: 'extended', preservation: 'extended', note: 'extended',
  meridian: 'extended', points: 'extended',  // Gate 2.1 A：补全经穴图扩展字段层级
  species: 'extended', parts: 'extended',
  confidence: 'other', blockType: 'other', textDirection: 'other', readingOrderAssumed: 'other',
  aiVerdict: 'other', aiVerdictNote: 'other',
  multiIllustrationRelation: 'other', multiIllustrationNote: 'other',
  illustrationName: 'display', illustrationNamePinyin: 'display',
};

// 人工可选原因（不含 schema_migration / system_generated，两者只能系统写入）
const HUMAN_REVIEW_REASONS = [
  'model_error', 'model_omission', 'evidence_enrichment',
  'ocr_correction', 'normalization', 'other',
];
// 全部原因（含系统自动）
const ALL_REVIEW_REASONS = [...HUMAN_REVIEW_REASONS, 'schema_migration', 'system_generated', 'legacy_unattributed'];
// 系统专属原因
const SYSTEM_REVIEW_REASONS = new Set(['schema_migration', 'system_generated', 'legacy_unattributed']);

// reviewMode 保留为导出兼容字段，但不再由审核人手选；系统按文字证据状态推导。
const REVIEW_MODES = ['strict', 'fast', 'no_text_review'];
const DEFAULT_REVIEW_MODE = 'fast';
const REVIEW_MODE_ALIASES = { image: 'no_text_review' }; // v2.2 前已写入记录的兼容别名

function normalizeReviewMode(value) {
  const normalized = REVIEW_MODE_ALIASES[value] || value;
  return REVIEW_MODES.includes(normalized) ? normalized : '';
}

function deriveReviewModeFromEvidence(img) {
  img = getAnnotationOwnerRecord(img);
  const vc = img.versionContext || {};
  const ann = img.annotation || img.aiDraft || {};
  const textSourceStatus = vc.textSourceStatus || img.annotationEvidence?.textSourceStatus || 'missing';
  const hasVisibleText = [
    ann._textInImage, ann.herbClassical, ann.correspondingText,
    img.aiDraft?._textInImage, img.aiDraft?.herbClassical, img.aiDraft?.correspondingText,
  ].some(value => String(value || '').trim());
  if (textSourceStatus === 'verified') return 'strict';
  if (textSourceStatus === 'ocr' || textSourceStatus === 'pdf_text' || hasVisibleText) return 'fast';
  return 'no_text_review';
}

function describeDerivedReviewMode(img) {
  const mode = deriveReviewModeFromEvidence(img);
  const textSourceStatus = img.versionContext?.textSourceStatus || img.annotationEvidence?.textSourceStatus || 'missing';
  if (mode === 'strict') return '文字已人工校准';
  if (textSourceStatus === 'ocr') return 'OCR 文字尚未人工校准';
  if (textSourceStatus === 'pdf_text') return 'PDF 文字层尚未人工校准';
  if (mode === 'fast') return '仅有图中文字线索，尚未人工校准';
  return '没有可用文字证据';
}

// ── Task 21 Gate 2.1：textAsset → textSourceStatus / ocrStatus 唯一映射 ──
// Gate 2.2 B 收紧：verified 只能由 textAsset.verified === true 或 textStatus === 'reviewed' 产生；
//   manual / manual_corrected 但未 verified/reviewed 时不得映射 verified，按保守口径映射 missing/unavailable。
// 唯一映射函数；任何写入 versionContext 的代码都必须用这两个函数，不得内联推断。
// textSourceStatus: verified / ocr / pdf_text / missing
function deriveTextSourceStatus(textAsset) {
  if (!textAsset) return 'missing';
  // 唯一 verified 判定：verified===true 或 textStatus==='reviewed'
  if (textAsset.verified === true || textAsset.textStatus === 'reviewed') return 'verified';
  const src = String(textAsset.textSource || '').trim();
  const hasText = String(textAsset.fullText || textAsset.correctedText || '').trim();
  if (!hasText) return 'missing';
  if (src === 'ai_ocr' || src === 'ai_annotation_byproduct') return 'ocr';
  if (src === 'pdf_text_layer') return 'pdf_text';
  // manual / manual_corrected / none / 未知 且未 verified/reviewed → 保守归 missing（不伪造 verified）
  return 'missing';
}
// ocrStatus: not_needed / candidate / verified / unavailable
function deriveOcrStatus(textAsset) {
  if (!textAsset) return 'unavailable';
  // 唯一 verified 判定：verified===true 或 textStatus==='reviewed'
  if (textAsset.verified === true || textAsset.textStatus === 'reviewed') return 'verified';
  const src = String(textAsset.textSource || '').trim();
  const hasText = String(textAsset.fullText || textAsset.correctedText || '').trim();
  if (src === 'ai_ocr' || src === 'ai_annotation_byproduct') return hasText ? 'candidate' : 'unavailable';
  if (src === 'pdf_text_layer') return 'not_needed';
  // manual / manual_corrected / none / 未知 且未 verified/reviewed → 保守归 unavailable
  return 'unavailable';
}

// 构建版本/来源上下文（AI 初稿写入时调用）
function buildVersionContext({
  provider, model, evidenceMode, textSourceStatus, ocrStatus,
  contextRadius = 0, contextPages = [], pinnedEvidenceRefs = [], outputQualityFlags = [],
  annotationImageMode = '',
}) {
  return {
    datasetId: currentDatasetId(),
    schemaVersion: ANNOTATION_EVAL_SCHEMA_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    classificationSchemeSha256: CLASSIFICATION_SCHEME_SHA256,
    promptVersion: PROMPT_VERSION,
    promptContentSha256: PROMPT_CONTENT_SHA256,
    model: { provider: provider || '', name: model || '' },
    evidenceMode: evidenceMode || '',
    annotationImageMode: annotationImageMode || '',
    textSourceStatus: textSourceStatus || 'missing',
    ocrStatus: ocrStatus || 'unavailable',
    contextRadius: Number.isFinite(Number(contextRadius)) ? Number(contextRadius) : 0,
    contextPages: [...new Set((contextPages || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b),
    pinnedEvidenceRefs: Array.isArray(pinnedEvidenceRefs) ? deepClone(pinnedEvidenceRefs) : [],
    outputQualityFlags: [...new Set((outputQualityFlags || []).filter(Boolean))],
    createdAt: new Date().toISOString(),
  };
}

// 计算单条 hash（用于变更前后安全快照；非加密用途）
function fieldHash(value) {
  const s = normalizeCompareValue(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(36);
}

// 追加一条 reviewEvent（append-only）
// Gate 2.1：事件必须关联当前 draftRunId / reviewCycleId（重跑隔离）
function appendReviewEvent(illust, { field, reason, actorType, before, after, sessionId }) {
  illust = getAnnotationOwnerRecord(illust);
  illust.reviewEvents = Array.isArray(illust.reviewEvents) ? illust.reviewEvents : [];
  const event = {
    field,
    reason,
    actorType: actorType === 'system' ? 'system' : 'human',
    at: new Date().toISOString(),
    sessionId: sessionId || illust._activeSessionId || null,
    draftRunId: illust.draftRunId || null,
    reviewCycleId: illust.reviewCycleId || 0,
    beforeHash: fieldHash(before),
    afterHash: fieldHash(after),
  };
  illust.reviewEvents.push(event);
  // 维护最新原因投影（仅当前周期有效；buildEvalRecord 会按周期过滤重算）
  illust.fieldReviewReasons = illust.fieldReviewReasons || {};
  illust.fieldReviewReasons[field] = reason;
  return event;
}

// 系统迁移事件（schema_migration / system_generated，不计人工）
function appendSystemEvent(illust, { field, reason, sessionId, before, after }) {
  if (!SYSTEM_REVIEW_REASONS.has(reason)) {
    throw new Error(`system event reason must be one of ${[...SYSTEM_REVIEW_REASONS].join(',')}, got ${reason}`);
  }
  return appendReviewEvent(illust, { field, reason, actorType: 'system', sessionId, before, after });
}

// 系统批量改写（例如合并草稿）必须逐字段留下事件，不能把差异伪装成“无记录差异”。
function appendSystemGeneratedTrackedChanges(illust, beforeAnnotation = {}, afterAnnotation = {}, sessionId) {
  const events = [];
  for (const field of REVIEW_TRACK_FIELDS) {
    const before = beforeAnnotation[field];
    const after = afterAnnotation[field];
    if (normalizeCompareValue(before) !== normalizeCompareValue(after)) {
      events.push(appendSystemEvent(illust, { field, reason: 'system_generated', sessionId, before, after }));
    }
  }
  return events;
}

// legacy 记录标记（Gate 2.1：仅当记录缺 versionContext 时标为 legacy_unattributed）
function markLegacyUnattributed(illust) {
  if (!illust || illust._legacyMarked) return;
  if (!illust.versionContext) {
    illust.fieldReviewReasons = illust.fieldReviewReasons || {};
    for (const f of REVIEW_TRACK_FIELDS) {
      if (!illust.fieldReviewReasons[f]) {
        illust.fieldReviewReasons[f] = 'legacy_unattributed';
      }
    }
    illust._legacyMarked = true;
  }
}

// 人工字段级编辑：必须显式选择 pendingReason，否则拒绝（不静默写 normalization）
// 返回 { ok: bool, reason: string, restored: bool }
//   - ok=true：事件已写入，调用方应清空 pendingReason
//   - ok=false：未写事件；若 restored=true，调用方应把字段恢复为 before 并提示用户选原因
function humanEditField(img, field, before, after) {
  img = getAnnotationOwnerRecord(img);
  if (before === after) return { ok: false, reason: '', restored: false };
  const reason = img.reviewMeta && img.reviewMeta.pendingReason;
  if (!reason || !HUMAN_REVIEW_REASONS.includes(reason)) {
    // 没有有效人工原因：拒绝写入，要求恢复原值并提示
    return { ok: false, reason: '', restored: true };
  }
  noteHumanEdit(img, { field, reason, before, after });
  return { ok: true, reason, restored: false };
}

// 设置当前待用的人工归因原因（影响下一次字段编辑的事件）
function setPendingReason(img, reason) {
  img = getAnnotationOwnerRecord(img);
  img.reviewMeta = img.reviewMeta || {};
  if (reason === '') {
    img.reviewMeta.pendingReason = '';
    persist();
    return;
  }
  if (!HUMAN_REVIEW_REASONS.includes(reason)) return;
  img.reviewMeta.pendingReason = reason;
  persist();
}

// 清空 pendingReason（一次变更成功归因后调用，避免无意复用到下一字段）
function clearPendingReason(img) {
  img = getAnnotationOwnerRecord(img);
  if (img.reviewMeta) {
    img.reviewMeta.pendingReason = '';
    persist();
  }
}

// Gate 2.2 A：统一提交受追踪字段编辑
// 必须先验证 pendingReason；无原因时不得修改 annotation、不得写 reviewEvent、不得 persist/bridge。
// apply: (editable) => void  在 editable（img.annotation）上设置字段值
// 返回 { committed, restored, reason }
//   - committed=true：已写 annotation + reviewEvent + persist，调用方应 clearPendingReason（本函数已调）+ 刷新 UI
//   - restored=true：未做任何模型/持久化变化，调用方应把输入框恢复为 before 并提示
function commitTrackedFieldEdit(img, field, before, after, apply) {
  img = getAnnotationOwnerRecord(img);
  if (before === after) return { committed: false, restored: false, reason: '' };
  const reason = img.reviewMeta && img.reviewMeta.pendingReason;
  if (!reason || !HUMAN_REVIEW_REASONS.includes(reason)) {
    // 无原因：不触碰 annotation/reviewEvents/localStorage/bridge
    return { committed: false, restored: true, reason: '' };
  }
  const editable = ensureEditableAnnotation(img);
  apply(editable);
  noteHumanEdit(img, { field, reason, before, after });
  clearPendingReason(img); // 内部已 persist
  return { committed: true, restored: false, reason };
}

// 审核表单采用“先编辑 → 再归因 → 最后保存”的事务式动线。
// 草稿只存在当前页面内存中；未选择原因时不会写入 annotation/reviewEvents/bridge。
const REVIEW_FORM_DRAFTS = new Map();

function reviewFormDraftKey(img) {
  const owner = getAnnotationOwnerRecord(img);
  return owner?.id || owner;
}

function getReviewFormDraftEntry(img, { create = false } = {}) {
  const owner = getAnnotationOwnerRecord(img);
  const key = reviewFormDraftKey(owner);
  let entry = REVIEW_FORM_DRAFTS.get(key);
  if (!entry && create) {
    const source = owner.annotation || owner.aiDraft || {};
    // 仅复制当前正式值，不在草稿建立阶段顺带迁移/归一，避免产生无事件的隐式字段变化。
    const base = deepClone(source) || {};
    entry = { owner, base, annotation: deepClone(base) };
    REVIEW_FORM_DRAFTS.set(key, entry);
    // 每批新修改都必须重新选择原因，不能复用刷新前或上一批遗留的 pendingReason。
    owner.reviewMeta = owner.reviewMeta || {};
    owner.reviewMeta.pendingReason = '';
  }
  return entry || null;
}

function getReviewFormAnnotation(img) {
  return getReviewFormDraftEntry(img)?.annotation || ensureEditableAnnotation(img);
}

function getPendingReviewChanges(img) {
  const entry = getReviewFormDraftEntry(img);
  if (!entry) return [];
  return REVIEW_TRACK_FIELDS.flatMap(field => {
    const before = entry.base[field];
    const after = entry.annotation[field];
    return normalizeCompareValue(before) === normalizeCompareValue(after)
      ? []
      : [{ field, before: deepClone(before), after: deepClone(after) }];
  });
}

function stageTrackedFieldEdit(img, field, before, after, apply) {
  if (normalizeCompareValue(before) === normalizeCompareValue(after)) {
    return { staged: false, pendingCount: getPendingReviewChanges(img).length };
  }
  const entry = getReviewFormDraftEntry(img, { create: true });
  apply(entry.annotation);
  const changes = getPendingReviewChanges(img);
  if (!changes.length) REVIEW_FORM_DRAFTS.delete(reviewFormDraftKey(img));
  return { staged: true, pendingCount: changes.length };
}

async function savePendingTrackedEdits(img, { blocking = true } = {}) {
  const owner = getAnnotationOwnerRecord(img);
  const entry = getReviewFormDraftEntry(owner);
  const changes = getPendingReviewChanges(owner);
  if (!entry || !changes.length) {
    REVIEW_FORM_DRAFTS.delete(reviewFormDraftKey(owner));
    return { saved: true, changed: false, pendingCount: 0 };
  }
  const reason = owner.reviewMeta?.pendingReason || '';
  if (!HUMAN_REVIEW_REASONS.includes(reason)) {
    return { saved: false, changed: true, needsReason: true, pendingCount: changes.length };
  }

  const previous = {
    annotation: owner.annotation ? deepClone(owner.annotation) : null,
    aiDraft: owner.aiDraft ? deepClone(owner.aiDraft) : null,
    reviewEvents: Array.isArray(owner.reviewEvents) ? deepClone(owner.reviewEvents) : null,
    fieldReviewReasons: owner.fieldReviewReasons ? deepClone(owner.fieldReviewReasons) : null,
    reviewMeta: owner.reviewMeta ? deepClone(owner.reviewMeta) : null,
  };

  owner.annotation = deepClone(entry.annotation);
  owner.reviewMeta = owner.reviewMeta || {};
  owner.reviewMeta.humanEditedAt = Date.now();
  for (const change of changes) {
    appendReviewEvent(owner, {
      ...change,
      reason,
      actorType: 'human',
      sessionId: owner._activeSessionId || null,
    });
  }
  owner.reviewMeta.pendingReason = '';
  refreshReviewDiff(owner);

  // 名称变化后沿用现有拼音播种逻辑；人工校正过的拼音不会被覆盖。
  if (changes.some(change => change.field === 'illustrationName')) {
    await seedNamePinyin(owner);
  }

  const saved = blocking ? await persistImageBlocking(owner) : (persistImage(owner), true);
  if (!saved) {
    if (previous.annotation) owner.annotation = previous.annotation;
    else delete owner.annotation;
    if (previous.aiDraft) owner.aiDraft = previous.aiDraft;
    else delete owner.aiDraft;
    if (previous.reviewEvents) owner.reviewEvents = previous.reviewEvents;
    else delete owner.reviewEvents;
    if (previous.fieldReviewReasons) owner.fieldReviewReasons = previous.fieldReviewReasons;
    else delete owner.fieldReviewReasons;
    if (previous.reviewMeta) owner.reviewMeta = previous.reviewMeta;
    else delete owner.reviewMeta;
    return { saved: false, changed: true, pendingCount: changes.length };
  }

  REVIEW_FORM_DRAFTS.delete(reviewFormDraftKey(owner));
  return { saved: true, changed: true, pendingCount: 0, reason, changes };
}

// Gate 2.1 E：AI 重跑隔离 —— 每次新 AI 初稿生成不可变 draftRunId + 递增 reviewCycleId
function startNewDraftRun(img) {
  img = getAnnotationOwnerRecord(img);
  const now = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  img.draftRunId = 'dr-' + now.toString(36) + '-' + rnd;
  img.reviewCycleId = (typeof img.reviewCycleId === 'number' ? img.reviewCycleId : 0) + 1;
  return { draftRunId: img.draftRunId, reviewCycleId: img.reviewCycleId };
}

// 重新运行 AI 必须形成一个全新的当前审核草稿。
// 旧人工修改、待选原因和旧审核模式不得进入新草稿；仅保留后台版本归档用于审计。
// reviewEvents/reviewSessions 继续由 draftRunId/reviewCycleId 隔离，不参与当前周期投影。
function resetCurrentReviewStateForFreshDraft(img, model) {
  img = getAnnotationOwnerRecord(img);
  const archives = Array.isArray(img.reviewMeta?.modelArchives)
    ? deepClone(img.reviewMeta.modelArchives)
    : [];
  const annotationRuns = Array.isArray(img.reviewMeta?.annotationRuns)
    ? deepClone(img.reviewMeta.annotationRuns)
    : [];
  img.reviewMeta = {
    ...(archives.length ? { modelArchives: archives } : {}),
    ...(annotationRuns.length ? { annotationRuns } : {}),
    aiGeneratedAt: Date.now(),
    aiModel: model || '',
    humanEditedAt: null,
    pendingReason: '',
  };
  img.reviewDiff = {};
  img.fieldReviewReasons = {};
  REVIEW_FORM_DRAFTS.delete(reviewFormDraftKey(img));
  return img.reviewMeta;
}

// Gate 2.1 E：取当前周期的 reviewEvents（过滤掉旧草稿周期的事件）
function currentCycleEvents(img) {
  img = getAnnotationOwnerRecord(img);
  const events = Array.isArray(img.reviewEvents) ? img.reviewEvents : [];
  const runId = img.draftRunId || null;
  const cyc = typeof img.reviewCycleId === 'number' ? img.reviewCycleId : null;
  if (runId == null && cyc == null) return events; // 无周期标识的 legacy 记录，返回全部
  return events.filter(e => (e.draftRunId || null) === runId && (e.reviewCycleId || 0) === (cyc || 0));
}

// Gate 2.1 E：基于当前周期事件重算 fieldReviewReasons 投影（不信任旧周期投影）
function currentCycleReasons(img) {
  const events = currentCycleEvents(img);
  const frr = {};
  for (const e of events) {
    frr[e.field] = e.reason;
  }
  return frr;
}

// ── 有效审核时间 ──────────────────────────────────────
// 每个 illust 维护 reviewSessions[]，含 sessionId/reviewMode/startedAt/endedAt/activeSeconds/idleTimeoutSeconds/segments[]
// segments[]: { start, end, reason } —— reason ∈ active/pause/resume/blur/focus/switch/save/idle_timeout

function startReviewSession(illust) {
  illust = getAnnotationOwnerRecord(illust);
  illust.reviewSessions = Array.isArray(illust.reviewSessions) ? illust.reviewSessions : [];
  const now = Date.now();
  const effectiveMode = illust.versionContext
    ? deriveReviewModeFromEvidence(illust)
    : (normalizeReviewMode(illust.reviewMeta?.reviewMode) || DEFAULT_REVIEW_MODE);
  // 新记录的 reviewMode 是系统根据证据状态生成的兼容投影，不允许人工选择。
  illust.reviewMeta = illust.reviewMeta || {};
  illust.reviewMeta.reviewMode = effectiveMode;
  const session = {
    sessionId: 'rs-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    reviewMode: illust.reviewMeta.reviewMode,
    startedAt: new Date(now).toISOString(),
    endedAt: null,
    activeSeconds: 0,
    idleTimeoutSeconds: REVIEW_IDLE_TIMEOUT_SECONDS,
    segments: [{ start: now, end: null, reason: 'active' }],
  };
  illust.reviewSessions.push(session);
  illust._activeSessionId = session.sessionId;
  return session;
}

function getCurrentSession(illust) {
  illust = getAnnotationOwnerRecord(illust);
  if (!illust._activeSessionId) return null;
  return (illust.reviewSessions || []).find(s => s.sessionId === illust._activeSessionId) || null;
}

// 结算当前 segment（暂停/失焦/切换/保存/空闲），累加 activeSeconds
function settleCurrentSegment(illust, reason) {
  illust = getAnnotationOwnerRecord(illust);
  const session = getCurrentSession(illust);
  if (!session) return null;
  const segs = session.segments;
  const last = segs[segs.length - 1];
  const now = Date.now();
  if (last && last.end === null) {
    last.end = now;
    const delta = Math.max(0, Math.round((now - last.start) / 1000));
    if (last.reason === 'active') {
      session.activeSeconds += delta;
    }
  }
  // 若 reason 是终结性的，结束整个 session
  const TERMINAL = new Set(['switch', 'save']);
  if (TERMINAL.has(reason)) {
    session.endedAt = new Date(now).toISOString();
    illust._activeSessionId = null;
  } else {
    // 非终结：开始新的非 active segment（如 pause/blur/idle_timeout）
    segs.push({ start: now, end: null, reason });
  }
  return session;
}

// 恢复 active segment（从暂停/失焦恢复）
function resumeActiveSegment(illust) {
  illust = getAnnotationOwnerRecord(illust);
  const session = getCurrentSession(illust);
  if (!session) return null;
  const segs = session.segments;
  const last = segs[segs.length - 1];
  const now = Date.now();
  if (last && last.end === null && last.reason !== 'active') {
    last.end = now;
  }
  segs.push({ start: now, end: null, reason: 'active' });
  return session;
}

// 计算单条记录的有效审核秒数（所有 session 的 activeSeconds 之和）
function effectiveReviewSeconds(illust) {
  return (illust?.reviewSessions || []).reduce((sum, s) => sum + (s.activeSeconds || 0), 0);
}

// 分位数计算（P50/P75/P90）
function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, idx))];
}

// ── 统计导出 ──────────────────────────────────────────
// 按字段层级/原因/证据模式/文字来源状态/审核模式/版本分组
// 输入：records[]（buildEvalRecord 生成的 v2 记录数组）
function buildEvalStats(records) {
  const stats = {
    total: records.length,
    note: '候选—终稿差异及归因，不是没有独立参考答案时的 AI 准确率',
    byTier: {},
    byReason: {},
    byEvidenceMode: {},
    byTextSourceStatus: {},
    byReviewMode: {},
    byModel: {},
    bySchemaVersion: {},
    byDatasetId: {},
    effectiveTime: { median: 0, p75: 0, p90: 0, mean: 0, values: [] },
    warnings: [],
    coreFieldNoRecordedDiff: 0,
    coreFieldModelError: 0,
    coreFieldModelOmission: 0,
  };
  const effSecs = [];
  for (const r of records) {
    const tier = FIELD_TIER[r.field] || 'other';
    const reason = r.reason || 'legacy_unattributed';
    const em = r.evidenceMode || '';
    const tss = r.textSourceStatus || '';
    const rm = r.reviewMode || '';
    const model = r.model || '';
    const sv = r.schemaVersion || '';
    const datasetId = r.datasetId || '';
    stats.byTier[tier] = (stats.byTier[tier] || 0) + 1;
    stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
    stats.byEvidenceMode[em] = (stats.byEvidenceMode[em] || 0) + 1;
    stats.byTextSourceStatus[tss] = (stats.byTextSourceStatus[tss] || 0) + 1;
    stats.byReviewMode[rm] = (stats.byReviewMode[rm] || 0) + 1;
    stats.byModel[model] = (stats.byModel[model] || 0) + 1;
    stats.bySchemaVersion[sv] = (stats.bySchemaVersion[sv] || 0) + 1;
    stats.byDatasetId[datasetId] = (stats.byDatasetId[datasetId] || 0) + 1;
    if (r.effectiveSeconds != null) effSecs.push(r.effectiveSeconds);
    if (tier === 'core') {
      // 只有“本周期无事件 + 无追踪字段差异”才计为未记录差异；系统事件、legacy 和
      // unattributed_diff 都不能进入该桶，更不能被表述成 AI 正确。
      if (reason === 'no_recorded_change' && r.reviewDiff === 0) stats.coreFieldNoRecordedDiff++;
      if (reason === 'model_error') stats.coreFieldModelError++;
      if (reason === 'model_omission') stats.coreFieldModelOmission++;
    }
  }
  effSecs.sort((a, b) => a - b);
  stats.effectiveTime.values = effSecs;
  stats.effectiveTime.median = percentile(effSecs, 50);
  stats.effectiveTime.p75 = percentile(effSecs, 75);
  stats.effectiveTime.p90 = percentile(effSecs, 90);
  stats.effectiveTime.mean = effSecs.length ? Math.round(effSecs.reduce((a, b) => a + b, 0) / effSecs.length) : 0;
  const unattributedCount = stats.byReason.unattributed_diff || 0;
  if (unattributedCount > 0) {
    stats.warnings.push(`数据完整性警告：${unattributedCount} 个字段存在候选—终稿差异但缺少当前草稿周期事件（unattributed_diff）；不得计入无记录差异。`);
  }
  return stats;
}

// 把一条 illustration 转为 v2 评估记录（用于统计导出）
// Gate 2.3：按当前 draftRunId/reviewCycleId 过滤事件；有差异但无事件必须单列 unattributed_diff，
// 不得混入 no_recorded_change。
function buildEvalRecord(img) {
  img = getAnnotationOwnerRecord(img);
  const diff = buildReviewDiff(img);
  const vc = img.versionContext || {};
  const hasV2 = !!img.versionContext;
  // 仅取当前周期的事件与投影（重跑隔离）
  const cycleFrr = hasV2 ? currentCycleReasons(img) : (img.fieldReviewReasons || {});
  const records = [];
  const eff = effectiveReviewSeconds(img);
  for (const f of REVIEW_TRACK_FIELDS) {
    const tier = FIELD_TIER[f] || 'other';
    const hasDiff = diff.fields[f] !== undefined;
    let reason;
    if (hasV2) {
      // v2 记录：有当前周期事件 → 取事件原因；无事件且有 diff → 数据完整性异常；
      // 只有无事件且无 diff 才是 no_recorded_change（仍不表示 AI 正确）。
      reason = cycleFrr[f] || (hasDiff ? 'unattributed_diff' : 'no_recorded_change');
    } else {
      // legacy 记录（缺 versionContext）：legacy_unattributed
      reason = cycleFrr[f] || 'legacy_unattributed';
    }
    records.push({
      imageId: img.id,
      field: f,
      tier,
      reason,
      reviewDiff: hasDiff ? 1 : 0,
      evidenceMode: vc.evidenceMode || img.annotationEvidence?.mode || '',
      textSourceStatus: vc.textSourceStatus || img.annotationEvidence?.textSourceStatus || '',
      reviewMode: hasV2 ? deriveReviewModeFromEvidence(img) : (normalizeReviewMode(img.reviewMeta?.reviewMode) || ''),
      schemaVersion: vc.schemaVersion || '',
      datasetId: vc.datasetId || img.task21Trial?.trialId || '',
      classificationVersion: vc.classificationVersion || '',
      promptVersion: vc.promptVersion || img.annotationEvidence?.promptVersion || '',
      model: vc.model?.name || img.modelUsed || '',
      effectiveSeconds: eff,
      draftRunId: img.draftRunId || null,
      reviewCycleId: img.reviewCycleId || 0,
    });
  }
  return records;
}

// 把多条 illustration 的 v2 记录汇总为 JSON + TXT
function buildEvalExport(images) {
  const allRecords = [];
  for (const img of images) {
    if (img.mergedInto) continue;
    allRecords.push(...buildEvalRecord(img));
  }
  const stats = buildEvalStats(allRecords);
  const json = JSON.stringify(stats, null, 2);
  const txt = formatEvalStatsTxt(stats);
  return { stats, json, txt, recordCount: allRecords.length };
}

function formatEvalStatsTxt(stats) {
  const lines = [];
  lines.push('标注评价统计（候选—终稿差异及归因，非 AI 准确率）');
  lines.push('==========================================');
  lines.push(`总记录数: ${stats.total}`);
  lines.push('');
  lines.push('按字段层级:');
  for (const [k, v] of Object.entries(stats.byTier).sort()) lines.push(`  ${k}: ${v}`);
  lines.push('');
  lines.push('按原因:');
  for (const [k, v] of Object.entries(stats.byReason).sort()) lines.push(`  ${k}: ${v}`);
  if (stats.warnings?.length) {
    lines.push('');
    lines.push('数据完整性警告:');
    stats.warnings.forEach(warning => lines.push(`  ⚠ ${warning}`));
  }
  lines.push('');
  lines.push('按证据模式 (annotationEvidence.mode):');
  for (const [k, v] of Object.entries(stats.byEvidenceMode).sort()) lines.push(`  ${k || '(空)'}: ${v}`);
  lines.push('');
  lines.push('按文字来源状态 (textSourceStatus):');
  for (const [k, v] of Object.entries(stats.byTextSourceStatus).sort()) lines.push(`  ${k || '(空)'}: ${v}`);
  lines.push('');
  lines.push('按审核模式 (reviewMode):');
  for (const [k, v] of Object.entries(stats.byReviewMode).sort()) lines.push(`  ${k || '(空)'}: ${v}`);
  lines.push('');
  lines.push('按数据集 (datasetId):');
  for (const [k, v] of Object.entries(stats.byDatasetId || {}).sort()) lines.push(`  ${k || '(空/历史)'}: ${v}`);
  lines.push('');
  lines.push('有效审核时间（秒）:');
  lines.push(`  中位数: ${stats.effectiveTime.median}`);
  lines.push(`  P75: ${stats.effectiveTime.p75}`);
  lines.push(`  P90: ${stats.effectiveTime.p90}`);
  lines.push(`  平均: ${stats.effectiveTime.mean}`);
  lines.push('');
  lines.push('核心字段:');
  lines.push(`  无记录差异（当前周期无事件且 reviewDiff=0）: ${stats.coreFieldNoRecordedDiff}（不等于 AI 正确）`);
  lines.push(`  model_error: ${stats.coreFieldModelError}`);
  lines.push(`  model_omission: ${stats.coreFieldModelOmission}`);
  return lines.join('\n');
}

// 导出审核评价统计（JSON + TXT），触发浏览器下载
function exportEvalStats() {
  const imgs = state.illustrations.filter(shouldUseIllustrationRecord);
  const { stats, json, txt, recordCount } = buildEvalExport(imgs);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  download(`annotation_eval_stats_${stamp}.json`, json, 'application/json;charset=utf-8');
  download(`annotation_eval_stats_${stamp}.txt`, txt, 'text/plain;charset=utf-8');
  toast(`已导出 ${recordCount} 条评价记录（JSON + TXT）。统计为候选—终稿差异及归因，非 AI 准确率。`);
  return stats;
}

function isSplitIllustrationRecord(img) {
  return !!(img?.isSplitIllustration || img?.isSubRecord || img?.parentId);
}
function isFigureIllustrationRecord(img) {
  return !!(img && (isSplitIllustrationRecord(img) || getFigureOrder(img) > 0));
}
function getSiblingFigureRecords(img) {
  const bookId = img?.pdfSource?.bookId;
  const pageNum = Number(img?.pdfSource?.pageNum);
  if (!bookId || !Number.isFinite(pageNum)) return [];
  return sortFigureRecords(state.illustrations.filter(item =>
    item?.id !== img.id &&
    item?.pdfSource?.bookId === bookId &&
    Number(item?.pdfSource?.pageNum) === pageNum &&
    isFigureIllustrationRecord(item)
  ));
}
function getPageFigureRecords(bookId, pageNum) {
  if (!bookId || !Number.isFinite(Number(pageNum))) return [];
  return sortFigureRecords(state.illustrations.filter(item =>
    item?.pdfSource?.bookId === bookId &&
    Number(item?.pdfSource?.pageNum) === Number(pageNum) &&
    isFigureIllustrationRecord(item)
  ));
}
function getIllustrationPageEntry(book, pageNum) {
  return (Array.isArray(book?.illustrationPages) ? book.illustrationPages : [])
    .find(p => Number(p?.pageNum) === Number(pageNum)) || null;
}
function pageHasMultipleIllustrations(book, pageNum) {
  const entry = getIllustrationPageEntry(book, pageNum);
  if (entry?.hasMultipleIllustrations || entry?.hasMultiple) return true;
  return getQueuedImagesForPage(book, pageNum).some(img => !!img?.hasMultipleIllustrations || isSplitIllustrationRecord(img));
}
function getPageIllustrationGroupId(book, pageNum) {
  if (!book?.id || pageNum == null) return '';
  return `${book.id}_p${String(Number(pageNum)).padStart(3, '0')}_figures`;
}
function getFigureOrder(img) {
  return Number(img?.figureIndex || img?.subIndex) || 0;
}
function sortFigureRecords(records) {
  return records.slice().sort((a, b) => {
    const ai = getFigureOrder(a);
    const bi = getFigureOrder(b);
    if (ai && bi && ai !== bi) return ai - bi;
    if (ai && !bi) return -1;
    if (!ai && bi) return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

function normalizeFigureIndexesForPage(book, pageNum) {
  if (!book) return [];
  const childRecords = getQueuedImagesForPage(book, pageNum)
    .filter(img => isSplitIllustrationRecord(img))
    .slice()
    .sort((a, b) => {
      const at = Number(a?.createdAt) || 0;
      const bt = Number(b?.createdAt) || 0;
      if (at && bt && at !== bt) return at - bt;
      const ai = getFigureOrder(a);
      const bi = getFigureOrder(b);
      if (ai && bi && ai !== bi) return ai - bi;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  let changed = false;
  childRecords.forEach((img, idx) => {
    const figureIndex = idx + 1;
    const expectedName = `第${pageNum}页（图${figureIndex}）`;
    const expectedBookRef = `${book.title} · 第${pageNum}页 · 图${figureIndex}`;
    if (Number(img.figureIndex) !== figureIndex) { img.figureIndex = figureIndex; changed = true; }
    if (Number(img.subIndex) !== figureIndex) { img.subIndex = figureIndex; changed = true; }
    if (img.name !== expectedName) { img.name = expectedName; changed = true; }
    if (img.bookRef !== expectedBookRef) { img.bookRef = expectedBookRef; changed = true; }
  });
  if (changed) {
    sortQueuedImages();
    markBookDirty(book.id);
    deferPersist();
  }
  return sortFigureRecords(childRecords);
}
function getParentIllustrationRecord(img) {
  if (!img) return null;
  if (!img.parentId) return img;
  return state.illustrations.find(item => item?.id === img.parentId) || null;
}
function getChildIllustrationRecordsByParent(parentImg) {
  if (!parentImg?.id) return [];
  return state.illustrations
    .filter(item => item?.parentId === parentImg.id)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function getMultiIllustrationRelationLabel(value) {
  return {
    independent: '页面候选不导出，仅导出图项',
    related_set: '相关组图，分别导出',
    composite_single: '整页合图，仅导出整页记录',
  }[value] || '';
}
function getMultiIllustrationMeta(img) {
  if (!img) {
    return {
      parent: null,
      childRecords: [],
      isChild: false,
      hasChildren: false,
      isGroup: false,
      relation: '',
      note: '',
      role: 'single',
      shouldExport: false,
      groupId: null,
    };
  }
  const isChild = isFigureIllustrationRecord(img);
  const bookId = img?.pdfSource?.bookId;
  const pageNum = Number(img?.pdfSource?.pageNum);
  const samePageFigures = bookId && Number.isFinite(pageNum) ? getPageFigureRecords(bookId, pageNum) : [];
  const explicitParent = img.parentId ? getParentIllustrationRecord(img) : null;
  const book = bookId ? getBook(bookId) : null;
  const pageContainer = isChild && bookId && Number.isFinite(pageNum)
    ? state.illustrations.find(item =>
        item?.id !== img.id &&
        !isFigureIllustrationRecord(item) &&
        item?.pdfSource?.bookId === bookId &&
        Number(item?.pdfSource?.pageNum) === pageNum
      ) || null
    : null;
  const parent = isChild ? (explicitParent || pageContainer || null) : img;
  const legacyChildren = parent ? getChildIllustrationRecordsByParent(parent) : [];
  const childRecords = sortFigureRecords([...new Map(
    [...legacyChildren, ...samePageFigures.filter(item => item.id !== img.id || isChild)]
      .map(item => [item.id, item])
  ).values()]);
  const hasChildren = childRecords.length > 0;
  // 页面上的“多图”旧标记只能作提示，不能覆盖实际裁图结果。
  // 只有真实存在子图记录时，页面容器才退出标注队列；否则该页当前
  // 选择的整图仍是一张有效插图，必须可以浏览、标注和审核。
  const isGroup = isChild || hasChildren;
  const relationOwner = parent || img;
  const ownerAnn = relationOwner?.annotation || relationOwner?.aiDraft || {};
  const relation = isGroup ? (ownerAnn.multiIllustrationRelation || 'independent') : '';
  const note = isGroup ? (ownerAnn.multiIllustrationNote || '') : '';
  const role = isChild ? 'child' : (hasChildren ? 'container' : 'single');
  const shouldExport = role === 'child' || role === 'single';
  return {
    parent,
    childRecords,
    isChild,
    hasChildren,
    isGroup,
    relation,
    note,
    role,
    shouldExport,
    groupId: parent?.id || img.parentId || img.id || null,
  };
}
function getContinuationGroupItems(img) {
  const bookId = img?.pdfSource?.bookId;
  const groupId = String(img?.continuationGroupId || '').trim();
  if (!bookId || !groupId) return [];
  return state.illustrations
    .filter(item => item?.pdfSource?.bookId === bookId && String(item?.continuationGroupId || '').trim() === groupId)
    .slice()
    .sort((a, b) => {
      const ao = Number(a?.continuationOrder);
      const bo = Number(b?.continuationOrder);
      const av = Number.isFinite(ao) && ao > 0 ? ao : Number.MAX_SAFE_INTEGER;
      const bv = Number.isFinite(bo) && bo > 0 ? bo : Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      const ap = Number(a?.pdfSource?.pageNum) || 0;
      const bp = Number(b?.pdfSource?.pageNum) || 0;
      if (ap !== bp) return ap - bp;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}
function getContinuationMeta(img) {
  if (!img) {
    return {
      groupId: '',
      items: [],
      owner: null,
      isGrouped: false,
      isOwner: false,
      shouldUse: true,
      order: null,
      note: '',
    };
  }
  const groupId = String(img.continuationGroupId || '').trim();
  if (!groupId) {
    return {
      groupId: '',
      items: [img],
      owner: img,
      isGrouped: false,
      isOwner: true,
      shouldUse: true,
      order: Number(img?.continuationOrder) || null,
      note: '',
    };
  }
  const items = getContinuationGroupItems(img);
  const owner = items[0] || img;
  const isGrouped = items.length > 1;
  const isOwner = owner?.id === img.id;
  const ownerAnn = owner?.annotation || owner?.aiDraft || {};
  return {
    groupId,
    items: items.length ? items : [img],
    owner,
    isGrouped,
    isOwner,
    shouldUse: !isGrouped || isOwner,
    order: Number(img?.continuationOrder) || null,
    note: ownerAnn.continuationNote || '',
  };
}
function getAnnotationOwnerRecord(img) {
  if (img?.mergedInto) {
    return state.illustrations.find(item => item?.id === img.mergedInto) || img;
  }
  const meta = getContinuationMeta(img);
  return meta.owner || img;
}
function getDisplayIllustrationItems(img) {
  const owner = getAnnotationOwnerRecord(img);
  const mergeIds = Array.isArray(owner?.imageMerge?.items) ? owner.imageMerge.items : [];
  if (mergeIds.length > 1) {
    const items = mergeIds
      .map(id => state.illustrations.find(item => item?.id === id))
      .filter(Boolean);
    if (items.length > 1) return items;
  }
  const meta = getContinuationMeta(owner || img);
  return meta.isGrouped ? meta.items : [img];
}

// 合并图不是“多张来源图的列表”，而是一张由多个已确认裁图按既定顺序拼成的整体。
// 该布局函数保持纯计算，便于固定测试；items 的先后顺序即界面“交换顺序”后的左右顺序。
function calculateMergeCompositeLayout(sizes, maxLong = 1800, gap = 2) {
  const valid = (sizes || [])
    .map(size => ({ width: Number(size?.width) || 0, height: Number(size?.height) || 0 }))
    .filter(size => size.width > 0 && size.height > 0);
  if (!valid.length) return { width: 0, height: 0, gap: 0, items: [] };
  const commonHeight = Math.max(...valid.map(size => size.height));
  const rawGap = valid.length > 1 ? Math.max(0, Number(gap) || 0) : 0;
  let x = 0;
  const rawItems = valid.map(size => {
    const width = size.width * commonHeight / size.height;
    const item = { x, y: 0, width, height: commonHeight };
    x += width + rawGap;
    return item;
  });
  const rawWidth = x - (valid.length > 1 ? rawGap : 0);
  const limit = Math.max(1, Number(maxLong) || 1800);
  const scale = Math.min(1, limit / Math.max(rawWidth, commonHeight));
  return {
    width: Math.max(1, Math.round(rawWidth * scale)),
    height: Math.max(1, Math.round(commonHeight * scale)),
    gap: rawGap * scale,
    items: rawItems.map(item => ({
      x: item.x * scale,
      y: 0,
      width: item.width * scale,
      height: item.height * scale,
    })),
  };
}
function shouldExportIllustrationRecord(img) {
  if (img?.mergedInto) return false;
  return getMultiIllustrationMeta(img).shouldExport;
}
function shouldUseIllustrationRecord(img) {
  return shouldExportIllustrationRecord(img) && getContinuationMeta(img).shouldUse;
}
function getVisibleIllustrationRecords() {
  return state.illustrations.filter(shouldUseIllustrationRecord);
}
function getReviewQueueItems() {
  return state.illustrations.filter(i => i.status === 'review' && shouldUseIllustrationRecord(i));
}

// 新版重标库只保留裁图时，记录可能尚未写入 status；它们不是“已完成”，
// 应回到待标注。已有 AI 初稿但状态缺失的记录则进入待审核。
function normalizeIllustrationWorkflowStatus(illust) {
  const known = new Set(['todo', 'running', 'review', 'ok', 'bad']);
  if (!illust || known.has(illust.status)) return false;
  const hasDraft = !!(illust.annotatedAt
    || illust.reviewMeta?.aiGeneratedAt
    || (illust.aiDraft && Object.keys(illust.aiDraft).length)
    || (illust.annotation && Object.keys(illust.annotation).length));
  illust.status = hasDraft ? 'review' : 'todo';
  return true;
}
function normalizeImageReviewState(illust) {
  let changed = false;
  if (!illust || typeof illust !== 'object') return false;
  if (illust.annotation) {
    const before = looksLikeRecoverableBrokenAnnotation(illust.annotation) ? JSON.stringify(illust.annotation) : null;
    illust.annotation = normalizeAnnotationShape(illust.annotation);
    if (before && JSON.stringify(illust.annotation) !== before) changed = true;
  }
  if (illust.aiDraft) {
    const before = looksLikeRecoverableBrokenAnnotation(illust.aiDraft) ? JSON.stringify(illust.aiDraft) : null;
    illust.aiDraft = normalizeAnnotationShape(illust.aiDraft);
    if (before && JSON.stringify(illust.aiDraft) !== before) changed = true;
  }
  illust.crossref = illust.crossref || { classical: '', verdict: '', note: '' };
  illust.reviewMeta = illust.reviewMeta || {};
  if (normalizeIllustrationWorkflowStatus(illust)) changed = true;
  if (!illust.aiDraft && illust.annotation && illust.annotatedAt) {
    illust.aiDraft = deepClone(illust.annotation);
    illust.reviewMeta.aiGeneratedAt = illust.reviewMeta.aiGeneratedAt || illust.annotatedAt;
    illust.reviewMeta.migratedLegacy = true;
    changed = true;
  }
  // 存量记录回填 ocrRiskNote（派生自已有信号，不改 promptVersion，避免给旧 prompt 误贴 quick_search_v1）
  if ((illust.annotation || illust.aiDraft) && illust.annotationEvidence?.ocrRiskNote === undefined) {
    illust.annotationEvidence = illust.annotationEvidence || {};
    illust.annotationEvidence.ocrRiskNote = deriveOcrRiskNote(illust);
    changed = true;
  }
  // 拼音对称化（防伪 diff）：自动拼音属 AI 基线，一侧有、另一侧空（且两侧均非人工锁定）时
  // 把缺失侧补齐为同值 auto，避免 refreshReviewDiff 把存量不对称误判为人工改过。
  // 若来源侧是 human（人工纠正），则保留不对称——那是真实的人工 diff，应当显示。
  if (illust.aiDraft && illust.annotation) {
    const A = illust.annotation, D = illust.aiDraft;
    const ap = (A.illustrationNamePinyin || '').trim();
    const dp = (D.illustrationNamePinyin || '').trim();
    if (A.pinyinSource !== 'human' && D.pinyinSource !== 'human') {
      if (ap && !dp) { D.illustrationNamePinyin = A.illustrationNamePinyin; D.pinyinSource = D.pinyinSource || 'auto'; changed = true; }
      else if (dp && !ap) { A.illustrationNamePinyin = D.illustrationNamePinyin; A.pinyinSource = A.pinyinSource || 'auto'; changed = true; }
    }
  }
  if (illust.aiDraft && illust.annotation) refreshReviewDiff(illust);
  return changed;
}
let savedUiSnapshot = null;
try {
  const saved = JSON.parse(localStorage.getItem(LS_KEY));
  if (saved && (saved.illustrations || saved.images)) state = saved;
  else if (saved && typeof saved === 'object') savedUiSnapshot = saved;
} catch (e) { /* ignore */ }
if (!state) state = buildDefaultState();
applyUiSnapshot(savedUiSnapshot);
// migrate legacy 'images' key → 'illustrations'
if (!state.illustrations && Array.isArray(state.images)) {
  state.illustrations = state.images;
}
state.illustrations = Array.isArray(state.illustrations) ? state.illustrations : [];
if (Array.isArray(state.illustrations) && state.illustrations.length && !state.selectedId) {
  state.selectedId = state.illustrations[0].id;
}
// hydrate missing v1.1 fields on older saved state
state.books = state.books || [];
state.leftTab = state.leftTab || 'images';
state.mainView = state.mainView || 'home';
state.pageDetailMode = state.pageDetailMode || 'illust';
state.pageBrowseScope = state.pageBrowseScope || 'illustrations';
state.pageRectEditing = false;   // 逐页正文框选已退休（正文统一用预处理「统一剪裁规格」）；清除残留持久化，避免页面模式显示正文框/编辑器
state.bookTemplateEditing = !!state.bookTemplateEditing;
state.bookTemplateBookId = state.bookTemplateBookId || null;
state.bookTemplatePageNum = state.bookTemplatePageNum || null;
state.illustCropEditing = !!state.illustCropEditing;
state.illustCropEditingPage = state.illustCropEditingPage || null;
state.illustCropEditingImageId = state.illustCropEditingImageId || null;
state.galleryFilter = state.galleryFilter || 'all';
state.gallerySort = state.gallerySort || 'page';
state.galleryView = state.galleryView || 'grid';
state.galleryScope = state.galleryScope || 'illustrations';
// 缩略图默认只浏览；多选只在“扫描 / 确认插图 / 标注”任务中临时开启。
state.gallerySelection = [];
state.galleryActionMode = null;
state.galleryScanRange = 'all';
// 只在通过 openGallery 明确指定页码时定位一次；任务中的选择/重绘不能抢走用户滚动位置。
let _galleryFocusRequestPageNum = null;
state.showcaseFeaturedIds = Array.isArray(state.showcaseFeaturedIds) ? state.showcaseFeaturedIds : [];
state.annotateSelection = state.annotateSelection || [];
state.pdfZoom = state.pdfZoom || 1;
state.mergeMode = false;   // always reset merge UI on page load
state.mergeSelected = [];
state.imageBookFilter = state.imageBookFilter || 'all';
state.previewBookId  = state.previewBookId  || null;
state.previewGroupId = state.previewGroupId || null;
state.groupCollapsed = state.groupCollapsed || {};
state.bookPanelCollapsed = state.bookPanelCollapsed || {};
if (state.leftCollapsed  === undefined) state.leftCollapsed  = false;
if (state.rightCollapsed === undefined) state.rightCollapsed = false;
if (state.rightPaneWidth !== null && state.rightPaneWidth !== undefined && !Number.isFinite(Number(state.rightPaneWidth))) state.rightPaneWidth = null;
sortQueuedImages();
let repairedIllustrationsOnBoot = false;
state.illustrations.forEach(img => {
  if (normalizeImageReviewState(img)) repairedIllustrationsOnBoot = true;
  // 启动时清除残留的 running 状态（页面崩溃/刷新导致）
  if (img.status === 'running') {
    img.status = (img.aiDraft || img.annotation?.type) ? 'review' : 'todo';
  }
});
if (repairedIllustrationsOnBoot) deferPersist();
state.annotateSelection = state.annotateSelection.filter(id => state.illustrations.some(img => img.id === id));
if (!['home','annotate','gallery','page-detail','review-queue','batch-monitor','archive-manager','run-history','showcase','asset-desk'].includes(state.mainView)) {
  state.mainView = 'home';
}
if (state.mainView === 'annotate' && !state.selectedId && !state.currentBookId) {
  state.mainView = 'home';
}

// in-memory: PDF documents (not persisted)
const pdfDocs = {}; // bookId -> pdfjs document
const pdfDocPromises = {}; // bookId -> loading promise
const bookDetectJobs = {}; // bookId -> transient illustration-detection progress
const bookTextScanJobs = {}; // bookId -> transient full-book text-layer scan progress
const selectedPageOcrJobs = {}; // bookId -> transient user-selected OCR progress
try {
  config = JSON.parse(localStorage.getItem(LS_CFG)) || null;
} catch (e) {}
if (!config) {
  config = {
    provider: 'mock',
    qwenKey: '',
    openaiKey: '',
    deepseekKey: '',
    kimiKey: '',
    doubaoKey: '',
    zhipuKey: '',
    geminiKey: '',
    baiduKey: '',
    qwenModel: 'qwen3.6-plus',
    openaiModel: 'gpt-4o',
    deepseekModel: 'deepseek-v4-flash',
    kimiModel: 'moonshot-v1-8k',
    doubaoModel: 'doubao-vision-pro-32k',
    zhipuModel: 'glm-4v-plus',
    geminiModel: 'gemini-1.5-flash',
    baiduModel: 'ERNIE-Bot-Vision',
    crossCheck: false,
    batchConcurrency: 1,
    scanConcurrency: 1,
    scanProvider: '',
    scanModel: '',
    contextRadius: 5,   // AI 标注读取上下文：本页 + 前后各 N 页
    scanContextRadius: 2, // 局部扫描范围：以插图/选中页为中心的前后页数
  };
}
config.batchConcurrency = Math.max(1, Math.min(20, Number(config.batchConcurrency) || 1));
config.scanConcurrency  = Math.max(1, Math.min(20, Number(config.scanConcurrency)  || 1));
{ const _r = Number(config.contextRadius); config.contextRadius = Number.isFinite(_r) ? Math.max(0, Math.min(20, _r)) : 5; }
{ const _sr = Number(config.scanContextRadius); config.scanContextRadius = Number.isFinite(_sr) ? Math.max(0, Math.min(10, _sr)) : 2; }

function persist(bookId) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(buildUiSnapshot())); } catch (e) {}
  if (_bridgeAvailable) {
    // 明确传入 bookId 时只标该书；否则按当前上下文自动标。
    // 审核队列/批量标注经常跨书操作，不能只依赖 currentBookId。
    const selectedImg = state.illustrations?.find(img => img.id === state.selectedId);
    const bookIds = new Set();
    if (bookId) bookIds.add(bookId);
    if (!bookId && state.currentBookId) bookIds.add(state.currentBookId);
    if (!bookId && selectedImg?.pdfSource?.bookId) bookIds.add(selectedImg.pdfSource.bookId);
    if (bookIds.size) bookIds.forEach(markBookDirty);
    else markGlobalDirty();
    enqueueBridgeFlush().catch(() => {});
  }
}

function persistImage(img) {
  if (!_bridgeAvailable) noteBridgeSaveFailure();
  if (img?.pdfSource?.bookId) persist(img.pdfSource.bookId);
  else persist();
}

function persistImages(imgs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(buildUiSnapshot())); } catch (e) {}
  if (!_bridgeAvailable) {
    noteBridgeSaveFailure();
    return;
  }
  const bookIds = new Set();
  let hasGlobal = false;
  (imgs || []).forEach(img => {
    const bid = img?.pdfSource?.bookId;
    if (bid) bookIds.add(bid);
    else hasGlobal = true;
  });
  bookIds.forEach(markBookDirty);
  if (hasGlobal || !bookIds.size) markGlobalDirty();
  enqueueBridgeFlush().catch(() => {});
}

function persistGlobalState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(buildUiSnapshot())); } catch (e) {}
  if (!_bridgeAvailable) {
    noteBridgeSaveFailure();
    return;
  }
  markGlobalDirty();
  enqueueBridgeFlush().catch(() => {});
}

async function persistImageBlocking(img) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(buildUiSnapshot())); } catch (e) {}
  if (img?.pdfSource?.bookId) markBookDirty(img.pdfSource.bookId);
  else markGlobalDirty();
  if (!_bridgeAvailable) {
    noteBridgeSaveFailure();
    return false;
  }
  return await enqueueBridgeFlush();
}
function persistConfig() {
  try { localStorage.setItem(LS_CFG, JSON.stringify(config)); } catch (e) {}
  // 同步写入 bridge config.json（静默，不阻塞）
  const _CFG_FIELDS = ['provider','qwenKey','openaiKey','deepseekKey','kimiKey',
    'doubaoKey','zhipuKey','geminiKey','baiduKey',
    'qwenModel','openaiModel','deepseekModel','kimiModel',
    'doubaoModel','zhipuModel','geminiModel','baiduModel',
    'scanProvider','scanModel','batchConcurrency','scanConcurrency','crossCheck','contextRadius','scanContextRadius'];
  const payload = {};
  _CFG_FIELDS.forEach(k => { if (config[k] !== undefined) payload[k] = config[k]; });
  fetch(BRIDGE_SAVE_CONFIG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

async function restoreConfigFromBridge() {
  // 如果 localStorage 里没有任何密钥，尝试从 bridge config.json 恢复
  const hasAnyKey = ['qwenKey','openaiKey','kimiKey','doubaoKey','zhipuKey','geminiKey','baiduKey']
    .some(k => config[k]?.trim());
  if (hasAnyKey) return;
  try {
    const resp = await fetch(BRIDGE_GET_CONFIG_URL);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data.ok) return;
    let restored = false;
    ['provider','qwenKey','openaiKey','deepseekKey','kimiKey','doubaoKey',
     'zhipuKey','geminiKey','baiduKey','qwenModel','openaiModel','deepseekModel',
     'kimiModel','doubaoModel','zhipuModel','geminiModel','baiduModel',
     'scanProvider','scanModel','batchConcurrency','scanConcurrency','crossCheck','contextRadius','scanContextRadius'].forEach(k => {
      if (data[k] !== undefined && data[k] !== '') {
        config[k] = data[k];
        restored = true;
      }
    });
    if (restored) {
      config._userConfigured = true;
      try { localStorage.setItem(LS_CFG, JSON.stringify(config)); } catch (e) {}
      toast('已从本地配置文件恢复 API 设置', 'info');
    }
  } catch (e) {}
}

function providerSupportsVisionTasks(provider = config.provider) {
  return provider !== 'deepseek';
}

function getVisionUnsupportedMessage(taskLabel = '图像标注', provider = config.provider) {
  if (provider === 'deepseek') {
    return `DeepSeek 官方当前仅公开文本模型接口，无法执行${taskLabel}。请切换到 Qwen、OpenAI、Gemini 等视觉模型。`;
  }
  return `当前模型不支持${taskLabel}。请切换到支持视觉输入的模型。`;
}

async function guardVisionTask(taskLabel, extra = {}) {
  if (providerSupportsVisionTasks()) return true;
  const message = getVisionUnsupportedMessage(taskLabel);
  await logClientRuntimeFailure('vision_unsupported', new Error(message), {
    task: taskLabel,
    provider: config.provider || '',
    ...extra,
  });
  toast(message, 'warn');
  return false;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && _bridgeAvailable) {
    enqueueBridgeFlush().catch(() => {});
  }
  // Task 21 v2: 页面失焦/恢复结算有效审核时间
  const cur = state.selectedId ? state.illustrations.find(i => i.id === state.selectedId) : null;
  if (cur && cur._activeSessionId) {
    if (document.visibilityState === 'hidden') {
      settleCurrentSegment(cur, 'blur');
      persistImage(cur);
    } else if (document.visibilityState === 'visible') {
      resumeActiveSegment(cur);
    }
  }
});
window.addEventListener('pagehide', () => {
  if (_bridgeAvailable) {
    enqueueBridgeFlush().catch(() => {});
  }
  // Task 21 v2: 离开页面时结算当前 session
  const cur = state.selectedId ? state.illustrations.find(i => i.id === state.selectedId) : null;
  if (cur && cur._activeSessionId) {
    settleCurrentSegment(cur, 'save');
  }
});

// Task 21 v2: 空闲超时（120 秒无操作自动暂停）
let _reviewIdleTimer = null;
function _resetReviewIdleTimer() {
  if (_reviewIdleTimer) clearTimeout(_reviewIdleTimer);
  _reviewIdleTimer = setTimeout(() => {
    const cur = state.selectedId ? state.illustrations.find(i => i.id === state.selectedId) : null;
    if (cur && cur._activeSessionId) {
      settleCurrentSegment(cur, 'idle_timeout');
      persistImage(cur);
      toast('⏸ 审核已因空闲超时暂停，继续操作将恢复计时', 'info');
    }
    _reviewIdleTimer = null;
  }, REVIEW_IDLE_TIMEOUT_SECONDS * 1000);
}
['click', 'keydown', 'input'].forEach(evt => {
  document.addEventListener(evt, () => {
    const cur = state.selectedId ? state.illustrations.find(i => i.id === state.selectedId) : null;
    if (cur && cur._activeSessionId) {
      const session = getCurrentSession(cur);
      if (session) {
        const lastSeg = session.segments[session.segments.length - 1];
        if (lastSeg && lastSeg.end !== null && lastSeg.reason !== 'active') {
          resumeActiveSegment(cur);
        }
      }
    }
    _resetReviewIdleTimer();
  }, { passive: true });
});

function getSensitivityThreshold(book) {
  // midtone ratio 阈值（百分比）：
  // low  = 高灵敏，更多候选页
  // mid  = 标准
  // high = 低灵敏，更少误检
  return { low: 25, mid: 40, high: 50 }[book?.sensitivity || 'mid'] || 40;
}

// legacy: use getBookIllustrations() for new code
function getQueuedIllustrationPages(book) {
  const pages = Array.isArray(book?.illustrationPages) ? book.illustrationPages : [];
  const added = new Set(Array.isArray(book?.queueAdded) ? book.queueAdded : []);
  return pages.filter(page => added.has(page.pageNum));
}

// legacy: use getBookIllustrations() for new code
function getQueuedBookPages(book) {
  const pageNums = new Set();
  for (const img of state.illustrations) {
    if (img?.pdfSource?.bookId === book?.id && Number.isFinite(Number(img.pdfSource.pageNum))) {
      pageNums.add(Number(img.pdfSource.pageNum));
    }
  }
  return Array.from(pageNums)
    .map(pageNum => getBookPageRecord(book, pageNum))
    .filter(Boolean)
    .sort((a, b) => a.pageNum - b.pageNum);
}

function getQueuedImageForPage(book, pageNum) {
  return state.illustrations.find(img =>
    img?.pdfSource?.bookId === book?.id &&
    Number(img?.pdfSource?.pageNum) === Number(pageNum)
  ) || null;
}

function getQueuedImagesForPage(book, pageNum) {
  return state.illustrations.filter(img =>
    img?.pdfSource?.bookId === book?.id &&
    Number(img?.pdfSource?.pageNum) === Number(pageNum)
  );
}

// 插图页批量操作的唯一目标解析：按"页"选择，但会保留一页中的全部有效裁图。
// mergedInto 子图不应再次进入模型任务，避免合并图被重复标注。
function getQueuedIllustrationsForPages(book, pageNums, { exportableOnly = true } = {}) {
  const selected = new Set((pageNums || [])
    .map(n => Number(n))
    .filter(Number.isFinite));
  if (!selected.size) return [];
  return state.illustrations.filter(img =>
    img?.pdfSource?.bookId === book?.id &&
    selected.has(Number(img?.pdfSource?.pageNum)) &&
    (!exportableOnly || shouldExportIllustrationRecord(img))
  );
}

function getMainQueuedImageForPage(book, pageNum) {
  const pageImages = getQueuedImagesForPage(book, pageNum);
  return pageImages.find(img => !isSplitIllustrationRecord(img)) || pageImages[0] || null;
}

function getPageQueuedImageForPage(book, pageNum) {
  return getQueuedImagesForPage(book, pageNum).find(img => !isSplitIllustrationRecord(img)) || null;
}

function getChildQueuedImagesForPage(book, pageNum) {
  return normalizeFigureIndexesForPage(book, pageNum);
}

function getActiveQueuedImageForPage(book, pageNum, preferredId = state.selectedId) {
  if (!book) return null;
  const pageImages = getQueuedImagesForPage(book, pageNum);
  if (!pageImages.length) return null;
  if (preferredId) {
    const preferred = pageImages.find(img => img?.id === preferredId);
    if (preferred) return preferred;
  }
  return pageImages.find(img => !isSplitIllustrationRecord(img)) || pageImages[0] || null;
}

function getIllustrationNavItems(book) {
  if (!book) return [];
  const confirmedPages = getVisibleConfirmedIllustrations(book);
  const confirmedSet = new Set(confirmedPages.map(p => Number(p.pageNum)));
  const byPage = new Map();
  state.illustrations
    .filter(img => img?.pdfSource?.bookId === book.id && img?.pdfSource?.pageNum != null)
    .filter(img => !img?.mergedInto)
    .forEach(img => {
      const pageNum = Number(img.pdfSource.pageNum);
      if (!byPage.has(pageNum)) byPage.set(pageNum, []);
      byPage.get(pageNum).push(img);
      confirmedSet.add(pageNum);
    });

  const items = [];
  Array.from(confirmedSet).sort((a, b) => a - b).forEach(pageNum => {
    const page = getBookPageRecord(book, pageNum);
    if (!page) return;
    const records = byPage.get(pageNum) || [];
    const childRecords = sortFigureRecords(records.filter(img => isSplitIllustrationRecord(img)));
    if (childRecords.length) {
      childRecords.forEach(img => items.push({ pageNum, page, imageId: img.id, img }));
      return;
    }
    const pageRecord = records.find(img => !isSplitIllustrationRecord(img)) || null;
    items.push({ pageNum, page, imageId: pageRecord?.id || null, img: pageRecord });
  });
  return items;
}

function getQueuedSelectionMode(book, pageNum) {
  return getPageQueuedImageForPage(book, pageNum)?.pdfSource?.selectionMode || '';
}

function getGalleryPageAnnotationSummary(book, pageNum) {
  const allRecords = getQueuedImagesForPage(book, pageNum).filter(img => !img?.mergedInto);
  const figureRecords = sortFigureRecords(allRecords.filter(isFigureIllustrationRecord));
  const exportRecords = figureRecords.length
    ? figureRecords
    : allRecords.filter(shouldExportIllustrationRecord);
  const records = exportRecords.length ? exportRecords : allRecords;
  const counts = records.reduce((acc, img) => {
    const st = img?.status || 'todo';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});
  const total = records.length;
  let status = 'todo';
  if (total === 0) status = 'todo';
  else if ((counts.review || 0) > 0) status = 'review';
  else if ((counts.todo || 0) > 0 || (counts.running || 0) > 0) status = 'todo';
  else if ((counts.ok || 0) === total) status = 'ok';
  else if ((counts.bad || 0) === total) status = 'bad';
  else if ((counts.ok || 0) > 0) status = 'review';
  const isSplit = figureRecords.length > 0;
  const mode = isSplit ? 'crop' : getQueuedSelectionMode(book, pageNum);
  const label = isSplit
    ? `多图 ${counts.ok || 0}/${total} 已确认`
    : (mode === 'full_page' ? '整页待确认' : '裁图');
  return { records, figureRecords, counts, total, status, mode, label, isSplit };
}

// 插图页只是页面记录的引用：OCR 以 book.pages 的实时文字资产为准，不能用
// illustrationPages 中创建插图时遗留的空副本来判断“缺原文”。
function getGalleryPageTextAsset(book, illustrationPage) {
  const pageNum = Number(illustrationPage?.pageNum);
  const livePage = Number.isFinite(pageNum) ? getBookPageRecord(book, pageNum) : null;
  return livePage?.textAsset || illustrationPage?.textAsset || {};
}

function getGallerySummaryTagStyle(status) {
  if (status === 'ok') return 'background:#f5fff7; color:#287a35; border-color:#8fc99b;';
  if (status === 'review') return 'background:#fff8e1; color:#8a6d1f; border-color:#efd58b;';
  if (status === 'bad') return 'background:#f5f5f5; color:#777; border-color:#cfcfcf;';
  return 'background:#eef7ff; color:#1f6fb8; border-color:#95c8f0;';
}

function getConfirmedIllustrations(book) {
  // 唯一来源：book.illustrationPages 中 confirmed=true 的条目
  return (Array.isArray(book?.illustrationPages) ? book.illustrationPages : [])
    .filter(p => p?.pageNum != null && p.confirmed)
    .sort((a, b) => a.pageNum - b.pageNum);
}

// 合并后的子图仍保留原页与裁图，供“拆分合并”和来源追溯使用；但它不是一张可单独
// 浏览、审核或展示的插图。这里按页判断，专门处理“该页所有记录都已并入另一主图”的
// 跨页合并情形，避免旧 confirmed 页清单把隐藏子图又带回插图导航。
function isMergedChildOnlyIllustrationPage(book, pageNum) {
  const records = getQueuedImagesForPage(book, pageNum);
  return records.length > 0 && records.every(record => !!record?.mergedInto);
}

function getVisibleConfirmedIllustrations(book) {
  return getConfirmedIllustrations(book)
    .filter(page => !isMergedChildOnlyIllustrationPage(book, page.pageNum));
}

function syncPageAssetIntoQueuedImages(book, page) {
  const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } });
  const text = (ta?.associatedText || getEffectivePageText(ta) || '').trim();
  for (const img of state.illustrations) {
    if (img?.pdfSource?.bookId !== book.id || img?.pdfSource?.pageNum !== page.pageNum) continue;
    img.crossref = img.crossref || { classical: '', verdict: '', note: '' };
    img.crossref.classical = text;
    if (isSplitIllustrationRecord(img)) {
      img.pdfSource.contentRect = page.contentRect || null;
      img.pdfSource.selectionMode = img.pdfSource.selectionMode || 'crop';
      continue;
    }
    const nextSelectionMode = page.cropRect ? 'crop' : (img.pdfSource.selectionMode || 'full_page');
    img.pdfSource.cropRect = page.cropRect || null;
    img.pdfSource.cropQuad = normalizeQuad(page.cropQuad) || null;
    img.pdfSource.contentRect = page.contentRect || null;
    img.pdfSource.selectionMode = nextSelectionMode;
    img.pdfSource.annotateRect = getPageAnnotateRect(page, nextSelectionMode) || null;
    img.pdfSource.annotateQuad = normalizeQuad(page.cropQuad) || null;
    img.pdfSource.rotationDeg = clampCropRotationDeg(page.cropRotationDeg || page.rotationDeg || 0);
    img.url = getPagePreviewUrl(page, nextSelectionMode);
    if (page.cropRect && img.name?.includes('整页待确认')) {
      img.name = `第${page.pageNum}页`;
      img.bookRef = `${book.title} · 第${page.pageNum}页`;
    }
  }
}

async function ensurePdfDoc(book) {
  if (!book) return null;
  if (pdfDocs[book.id]) return pdfDocs[book.id];
  if (pdfDocPromises[book.id]) return pdfDocPromises[book.id];
  if (typeof pdfjsLib === 'undefined') return null;
  const url = book.pdfStorage?.url;
  if (!url) return null;
  pdfDocPromises[book.id] = (async () => {
    try {
      const doc = await pdfjsLib.getDocument({ url }).promise;
      pdfDocs[book.id] = doc;
      return doc;
    } finally {
      delete pdfDocPromises[book.id];
    }
  })();
  return pdfDocPromises[book.id];
}

function hasStoredPageScanSource(book) {
  return book?.imageBookImport?.schema === 'image-book-import-v1'
    && book.imageBookImport.originalsPreserved === true
    && Array.isArray(book.pages)
    && book.pages.length > 0;
}

async function uploadPdfToBridge(file, bookId) {
  const ok = await checkBridge();
  if (!ok || !file) return null;
  const book = getBook(bookId);
  const fd = new FormData();
  fd.append('file', file, file.name || 'book.pdf');
  fd.append('book_id', bookId);
  if (book) {
    fd.append('title', book.title || '');
    fd.append('dynasty', book.dynasty || '');
    fd.append('version', book.version || '');
  }
  const r = await fetch(BRIDGE_UPLOAD_PDF_URL, {
    method: 'POST',
    body: fd,
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `PDF 上传失败（HTTP ${r.status}）`);
  return data;
}

function buildBookMetaPayload(book) {
  if (!book?.id) return null;
  return {
    book_id: book.id,
    title: book.title || '',
    dynasty: book.dynasty || '',
    version: book.version || '',
    page_count: Array.isArray(book.pages) ? book.pages.length : (Number(book.totalPages) || 0),
    illustration_page_count: Array.isArray(book.illustrationPages) ? book.illustrationPages.length : 0,
  };
}

async function maybeSyncBookMeta(book) {
  const payload = buildBookMetaPayload(book);
  if (!payload) return false;
  const ok = await checkBridge();
  if (!ok) return false;
  try {
    const r = await fetch(BRIDGE_UPDATE_BOOK_META_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
    return true;
  } catch (e) {
    console.warn('sync book meta failed', book.id, e);
    return false;
  }
}

function getBridgeFilenameFromUrl(url, marker) {
  if (!url || typeof url !== 'string') return '';
  const idx = url.indexOf(marker);
  if (idx < 0) return '';
  const raw = url.slice(idx + marker.length).split('?')[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function deleteBookFromState(bookId) {
  const book = getBook(bookId);
  if (!book) return;
  const relatedIllustrations = state.illustrations.filter(img => img?.pdfSource?.bookId === bookId);
  const ok = await openConfirm(
    `删除《${book.title}》？\n这会同时移除该书的插图、已加入队列的 ${relatedIllustrations.length} 张图片，以及本地保存的关联 PDF/裁图。`
  );
  if (!ok) return;

  const pdfFilename =
    book.pdfStorage?.filename ||
    getBridgeFilenameFromUrl(book.pdfStorage?.url, '/data/pdfs/');
  const imageFilenames = relatedIllustrations
    .map(img => getBridgeFilenameFromUrl(img.url, '/data/images/'))
    .filter(Boolean);

  const bridgeOk = await checkBridge();
  if (bridgeOk && (book.id || pdfFilename || imageFilenames.length)) {
    try {
      const r = await fetch(BRIDGE_DELETE_BOOK_ASSETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: book.id,
          pdf_filename: pdfFilename,
          image_filenames: imageFilenames,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    } catch (e) {
      toast(`已删除前端记录，但清理本地文件失败：${e.message || e}`, 'warn');
    }
  }

  state.books = state.books.filter(b => b.id !== bookId);
  state.illustrations = state.illustrations.filter(img => img?.pdfSource?.bookId !== bookId);
  delete pdfDocs[bookId];
  delete pdfDocPromises[bookId];

  if (state.currentBookId === bookId) {
    state.currentBookId = null;
    state.currentBookPage = null;
    if (state.mainView === 'gallery' || state.mainView === 'page-detail') {
      state.mainView = 'annotate';
    }
  }
  state.gallerySelection = [];
  if (!state.illustrations.some(img => img.id === state.selectedId)) {
    state.selectedId = state.illustrations.length ? state.illustrations[0].id : null;
  }

  // 书目录已由 delete-book-assets 清理；清除快照缓存，标全局脏以更新 global.json
  delete _lastBookSnapshots[bookId];
  markGlobalDirty();
  persist();
  refreshBookCount();
  renderNavStat();
  renderAll();
  if (state.leftTab === 'books') renderBooksList();
  toast(`已删除《${book.title}》及其关联数据`, 'success');
}

/* ── Bridge 图像上传 ─────────────────────────────────────────────────── */
async function maybePersistImage(id, dataUrl) {
  // 若 url 已是 http（含 bridge url），无需上传
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  const ok = await checkBridge();
  if (!ok) return dataUrl;
  try {
    const ext = dataUrl.startsWith('data:image/jpeg') ? 'jpg'
              : dataUrl.startsWith('data:image/webp') ? 'webp' : 'png';
    const r = await fetch(BRIDGE_UPLOAD_IMAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: dataUrl, id, ext })
    });
    const j = await r.json();
    if (j.ok && j.url) return j.url;
  } catch {}
  return dataUrl; // fallback: keep dataURL
}

/* ── Bridge 会话加载（启动时调用）──────────────────────────────────── */
async function initFromBridge() {
  const ok = await checkBridge();
  if (!ok) return false;
  try {
    const r = await fetch(BRIDGE_SESSION_URL,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const j = await r.json();
    if (!j.ok || !j.state || (!j.state.illustrations && !j.state.images)) return false;
    // 合并 bridge 状态（bridge 优先，因为它跨页面持久）
    const s = j.state;
    Object.assign(state, s);
    // migrate legacy 'images' key → 'illustrations' (bridge may return old format)
    // 注意：state.illustrations 默认是 []，不能用 !state.illustrations 判断
    if (Array.isArray(state.images) && state.images.length > 0 &&
        (!Array.isArray(state.illustrations) || state.illustrations.length === 0)) {
      state.illustrations = state.images;
    }
    state.illustrations = Array.isArray(state.illustrations) ? state.illustrations : [];
    // 瘦身下发的 /api/ 相对地址统一补成 BRIDGE_BASE 绝对地址（异源/file:// 打开不裂图）。
    // 保存时 bridge 护栏按「含 /api/img | /api/page-image 的占位地址」识别并恢复 base64，绝对形式同样被识别。
    for (const b of (state.books || [])) {
      for (const key of ['pages', 'illustrationPages']) {
        const lst = Array.isArray(b?.[key]) ? b[key] : [];
        for (const pg of lst) {
          if (!pg || typeof pg !== 'object') continue;
          for (const f of ['thumb', 'thumbHi', 'contentThumb', 'contentThumbHi', 'cropThumb', 'cropThumbHi'])
            if (typeof pg[f] === 'string' && pg[f].startsWith('/api/')) pg[f] = BRIDGE_BASE + pg[f];
        }
      }
    }
    for (const im of state.illustrations) {
      if (typeof im?.url === 'string' && im.url.startsWith('/api/')) im.url = BRIDGE_BASE + im.url;
    }
    applyUiSnapshot(savedUiSnapshot);
    // 补全可能缺失的 v1.1 字段
    state.books            = state.books            || [];
    state.leftTab          = state.leftTab          || 'images';  // 与 buildDefaultState 默认值统一
    state.mainView         = state.mainView         || 'home';
    // 首次载入统一回到图片列表；进入书籍页/画廊后的内部导航仍可显式切到“书籍”。
    // 这同时迁移此前持久化为 leftTab=books 的旧浏览器会话。
    state.leftTab = 'images';
    state.pageDetailMode   = state.pageDetailMode   || 'illust';
    state.galleryFilter    = state.galleryFilter    || 'all';
    state.gallerySort      = state.gallerySort      || 'page';
    state.galleryView      = state.galleryView      || 'grid';
    state.gallerySelection = state.gallerySelection || [];
    state.showcaseFeaturedIds = Array.isArray(state.showcaseFeaturedIds) ? state.showcaseFeaturedIds : [];
    state.annotateSelection = state.annotateSelection || [];
    state.pdfZoom          = state.pdfZoom          || 1;
    // 重置残留的 running 状态（页面刷新或中断批次后可能遗留）
    let repairedIllustrations = false;
    state.illustrations.forEach(img => {
      if (normalizeImageReviewState(img)) repairedIllustrations = true;
      if (img.status === 'running') {
        img.status = (img.aiDraft || img.annotation?.type) ? 'review' : 'todo';
      }
    });
    sortQueuedImages();
    state.annotateSelection = state.annotateSelection.filter(id => state.illustrations.some(img => img.id === id));
    if (repairedIllustrations) deferPersist();
    return true;
  } catch { return false; }
}

/* ============================================================
   UTIL
   ============================================================ */
function $(sel, root) { return (root || document).querySelector(sel); }
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'style') e.setAttribute('style', attrs[k]);
    else if (k.startsWith('on') && typeof attrs[k] === 'function') {
      e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    } else if (k === 'html') e.innerHTML = attrs[k];
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function getCurrent() {
  return state.illustrations.find(i => i.id === state.selectedId) || null;
}
// ── 集中式视图路由：所有视图切换的唯一入口 ──────────────────────────────────
// 统一"设字段 → 前置校验 → persist → renderAll → 左Tab同步"，消除散落的顺序/同步不一致。
const _VIEW_NAV_FIELDS = ['currentBookId', 'currentBookPage', 'selectedId', 'leftTab', 'rightTab',
  'filter', 'imageBookFilter', 'galleryScope', 'pageBrowseScope', 'pageDetailMode', 'galleryFilter', 'gallerySelection'];

function _viewRedirect(view) {
  // 前置校验：把原本散在 render 里的防御性重定向上移到导航时。
  // 返回应改投的安全视图，或 null（校验通过）。
  if (view === 'gallery') {
    if (!getCurrentBook()) return 'annotate';
  } else if (view === 'page-detail') {
    const book = getCurrentBook();
    if (!book) return 'annotate';
    if (!getBookPageRecord(book, state.currentBookPage)) return 'gallery';
  }
  return null;
}

function navigateTo(view, params = {}) {
  // 1) 应用传入的导航字段（未传的保持原值）
  state.mainView = view;
  for (const k of _VIEW_NAV_FIELDS) {
    if (k in params) state[k] = params[k];
  }
  // 2) 回到首页时清掉书/页/选中（与旧 openBooksShelf 一致）
  if (view === 'home') {
    state.currentBookId = null;
    state.currentBookPage = null;
    state.selectedId = null;
  }
  // 3) 前置校验：必要字段缺失则改投安全视图（render 兜底仍保留作最后防线）
  const to = _viewRedirect(view);
  if (to && to !== view) return navigateTo(to, {});
  // 4) persist（在设完字段之后）→ renderAll → 仅当本次显式改了 leftTab 时同步其 DOM
  persist();
  renderAll();
  if ('leftTab' in params) activateLeftTab(state.leftTab);
}

function openBooksShelf() {
  navigateTo('home', { leftTab: 'books' });
}
function scrollToBrowse() {
  setTimeout(() => {
    document.getElementById('gallery-browse-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}
function setMainHeader(...els) {
  const hdr = $('#main-header');
  if (!hdr) return;
  hdr.innerHTML = '';
  els.forEach(e => e && hdr.appendChild(e));
}

function captureReturnContext() {
  if (['batch-monitor', 'review-queue', 'archive-manager', 'run-history', 'showcase'].includes(state.mainView)) return;
  state._returnCtx = {
    mainView: state.mainView,
    leftTab: state.leftTab,
    rightTab: state.rightTab,
    filter: state.filter,
    imageBookFilter: state.imageBookFilter,
    galleryScope: state.galleryScope,
    pageBrowseScope: state.pageBrowseScope,
    pageDetailMode: state.pageDetailMode,
    currentBookId: state.currentBookId,
    currentBookPage: state.currentBookPage,
    selectedId: state.selectedId,
  };
}

function goBackToReturnContext() {
  const ctx = state._returnCtx || state._reviewEntryCtx;
  if (!ctx?.mainView) {
    navigateTo('home', { leftTab: 'books' });
    return;
  }
  if (ctx.mainView === 'archive-manager') {
    _archiveView = ctx.archiveView || 'browse';
    _showcaseBookId = ctx.showcaseBookId || '';
    _archiveBrowseMode = ctx.archiveBrowseMode || 'grid';
    _archiveDetailLayout = ctx.archiveDetailLayout || 'single';
  }
  const params = {
    leftTab: ctx.leftTab || 'books',
    rightTab: ctx.rightTab || 'form',
    filter: ctx.filter || 'all',
    imageBookFilter: ctx.imageBookFilter || 'all',
    galleryScope: ctx.galleryScope,
    pageBrowseScope: ctx.pageBrowseScope,
    pageDetailMode: ctx.pageDetailMode,
    currentBookId: ctx.currentBookId,
    currentBookPage: ctx.currentBookPage,
    selectedId: ctx.selectedId,
  };
  state._returnCtx = null;
  if (state._reviewEntryCtx === ctx) state._reviewEntryCtx = null;
  navigateTo(ctx.mainView, params);
}

function renderReturnButton(label = '← 返回') {
  return el('button', {
    class: 'btn return-context-btn',
    onclick: goBackToReturnContext,
  }, label);
}
function buildStepBar(currentStep, book = null) {
  const stepLabels = { 1: '全书扫描', 2: '插图确认', 3: '批量标注', 4: '审核确认' };
  const stepDone = { 1: false, 2: false, 3: false, 4: false };
  try {
    if (book) {
      const pages = getBookPages(book) || [];
      const scanned = pages.filter(p => p?.textAsset?.fullScanDone).length;
      const illustPages = Array.isArray(book.illustrationPages) ? book.illustrationPages : [];
      const confirmedIllust = getConfirmedIllustrations(book).length;
      const queued = (Array.isArray(state.illustrations) ? state.illustrations : [])
        .filter(img => img?.pdfSource?.bookId === book.id)
        .filter(img => {
          try { return shouldExportIllustrationRecord(img); }
          catch (e) { return true; }
        });
      const todoAnnotate = queued.filter(img => img.status === 'todo').length;
      const reviewCount = queued.filter(img => img.status === 'review').length;
      const okCount = queued.filter(img => img.status === 'ok').length;

      stepLabels[1] = pages.length
        ? (scanned >= pages.length ? `已扫描 ${scanned}/${pages.length}` : `扫描 ${scanned}/${pages.length}`)
        : '全书扫描';
      stepLabels[2] = illustPages.length
        ? (confirmedIllust >= illustPages.length ? `插图已确认 ${confirmedIllust}` : `确认插图 ${confirmedIllust}/${illustPages.length}`)
        : '插图确认';
      stepLabels[3] = queued.length
        ? (todoAnnotate === 0 ? `标注完成 ${queued.length}` : `待标注 ${todoAnnotate}/${queued.length}`)
        : '批量标注';
      stepLabels[4] = reviewCount > 0
        ? `待审核 ${reviewCount}`
        : (queued.length ? `已审核 ${okCount}` : '审核确认');

      stepDone[1] = pages.length > 0 && scanned >= pages.length;
      stepDone[2] = illustPages.length > 0 && confirmedIllust >= illustPages.length;
      stepDone[3] = queued.length > 0 && todoAnnotate === 0;
      stepDone[4] = queued.length > 0 && reviewCount === 0 && okCount > 0;
    }
  } catch (e) {
    console.warn('buildStepBar dynamic labels failed', e);
  }
  const navMap = {
    1: book ? () => { openGallery(book.id, 'pages');         scrollToBrowse(); } : null,
    2: book ? () => { openGallery(book.id, 'illustrations'); scrollToBrowse(); } : null,
    3: book ? () => { openGallery(book.id, 'illustrations'); scrollToBrowse(); } : null,
    4: book ? () => {
      state.imageBookFilter = book.id;
      captureReturnContext();
      enterReviewMode();
    } : null,
  };

  // 图文切割已取消（AI 改读「本页±N页窗口」并自挑对应原文），不再显示切割进度
  const step2SubNote = null;

  const bar = el('div', { class: 'step-bar' });
  [1, 2, 3, 4].forEach((n, idx) => {
    const label = stepLabels[n];
    const onClick = navMap[n] || null;
    const isDone = n < currentStep || stepDone[n];
    let cls = 'step-item' + (n === currentStep ? ' active' : isDone ? ' done' : '');
    if (onClick) cls += ' clickable';
    // Step 2：可能带切割子注
    const labelEls = n === 2 && step2SubNote
      ? [
          el('span', null, label),
          el('span', {
            style: 'display:block; font-size:10px; color:' + (step2SubNote.startsWith('⚠') ? '#c2680a' : '#4caf50') + '; line-height:1.2; margin-top:1px;'
          }, step2SubNote),
        ]
      : [el('span', null, label)];
    bar.appendChild(el('div', { class: cls, ...(onClick ? { onclick: onClick } : {}) },
      el('div', { class: 'step-num' }, isDone ? '✓' : String(n)),
      ...labelEls,
    ));
    if (idx < 3)
      bar.appendChild(el('span', { class: 'step-arrow' }, '›'));
  });
  return bar;
}

function buildBreadcrumbBar(items, actionEl = null) {
  const crumb = el('div', { class: 'crumb' });
  items.filter(Boolean).forEach((item, idx) => {
    const node = item.onClick
      ? el('button', { class: 'crumb-link', onclick: item.onClick }, item.label)
      : el('span', item.current ? { class: 'light' } : null, item.label);
    crumb.appendChild(node);
    if (idx < items.length - 1) crumb.appendChild(el('span', { class: 'crumb-sep' }, '>'));
  });
  const leftBtn = el('button', {
    class: 'crumb-panel-btn crumb-panel-btn-left',
    id: 'btn-left-collapse',
    title: state.leftCollapsed ? '展开左侧栏' : '折叠左侧栏',
    onclick: () => { state.leftCollapsed = !state.leftCollapsed; applyLeftCollapsed(); persist(); },
  }, state.leftCollapsed ? '▯▏' : '▏▯');
  const rightBtn = el('button', {
    class: 'crumb-panel-btn crumb-panel-btn-right',
    id: 'btn-right-collapse',
    title: state.mainView === 'page-detail' && state.pageDetailMode === 'text'
      ? (isReferencePaneCollapsed() ? '展开参考文本栏' : '折叠参考文本栏')
      : (state.rightCollapsed ? '展开右侧栏' : '折叠右侧栏'),
    onclick: () => {
      if (state.mainView === 'page-detail' && state.pageDetailMode === 'text') {
        setReferencePaneCollapsed(!isReferencePaneCollapsed());
        return;
      }
      state.rightCollapsed = !state.rightCollapsed;
      applyRightCollapsed();
      persist();
    },
  }, state.mainView === 'page-detail' && state.pageDetailMode === 'text'
    ? (isReferencePaneCollapsed() ? '▏▯' : '▯▏')
    : (state.rightCollapsed ? '▏▯' : '▯▏'));
  const barRight = actionEl
    ? el('div', { class: 'gallery-bar-actions' }, actionEl)
    : null;
  const barLeftAction = actionEl?.classList?.contains('return-context-btn') ? actionEl : null;
  return el('div', { class: 'gallery-bar' },
    leftBtn,
    barLeftAction,
    crumb,
    rightBtn,
    barLeftAction ? null : barRight
  );
}
function getFiltered() {
  const f = state.filter;
  const bookFilter = state.imageBookFilter || 'all';
  const q = state.search.trim().toLowerCase();
  return state.illustrations.filter(img => {
    if (!shouldUseIllustrationRecord(img)) return false;
    if (bookFilter !== 'all') {
      if (bookFilter === '__no_book__') {
        if (img.pdfSource?.bookId) return false;
      } else if (img.pdfSource?.bookId !== bookFilter) {
        return false;
      }
    }
    if (!matchesImageStatusFilter(img, f)) return false;
    if (!matchesImageSearchQuery(img, q)) return false;
    return true;
  });
}
function matchesImageStatusFilter(img, filter = state.filter) {
  const f = filter || 'all';
  return f === 'all' || img?.status === f;
}
function matchesImageSearchQuery(img, query = state.search) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = (img.id + ' ' + img.name + ' ' + (img.annotation?.subject || '')).toLowerCase();
  return hay.includes(q);
}
function hasExistingAIResult(img) {
  if (!img) return false;
  if (img.annotatedAt) return true;
  if (img.reviewMeta?.aiGeneratedAt) return true;
  if (img.aiDraft && Object.keys(img.aiDraft).length) return true;
  if (img.annotation && Object.keys(img.annotation).length && img.status !== 'todo') return true;
  return false;
}
function isPendingBatchImage(illust) {
  return !!illust && illust.status === 'todo' && !hasExistingAIResult(illust);
}
function getTodoImages(ids = null) {
  const idSet = ids ? new Set(ids) : null;
  return state.illustrations.filter(img => shouldUseIllustrationRecord(img) && isPendingBatchImage(img) && (!idSet || idSet.has(img.id)));
}
function getBatchScopeTodoImages(ids = null) {
  const scoped = getTodoImages(ids);
  const inBookWorkspace = state.mainView === 'gallery' || state.mainView === 'page-detail';
  if (!inBookWorkspace || !state.currentBookId) return scoped;
  return scoped.filter(img => img?.pdfSource?.bookId === state.currentBookId);
}
function sanitizeAnnotateSelection() {
  const valid = new Set(getTodoImages().map(img => img.id));
  state.annotateSelection = state.annotateSelection.filter(id => valid.has(id));
}
function toggleAnnotateSelection(id) {
  const img = state.illustrations.find(item => item.id === id);
  if (!img || !isPendingBatchImage(img)) return;
  const set = new Set(state.annotateSelection);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  state.annotateSelection = [...set];
  persist();
  renderLeftList();
}
function syncAnnotateSelectionButtons() {
  sanitizeAnnotateSelection();
  const selectedTodoCount = getBatchScopeTodoImages(state.annotateSelection).length;
  const totalTodoCount = getBatchScopeTodoImages().length;
  const visionSupported = providerSupportsVisionTasks();
  const visionAnnotateMsg = getVisionUnsupportedMessage('批量图像标注');
  const note = $('#left-batch-note');
  if (note) {
    note.textContent = selectedTodoCount > 0
      ? `已选择 ${selectedTodoCount} 项待标注`
      : (totalTodoCount > 0 ? `当前共有 ${totalTodoCount} 项待标注` : '没有待标注项');
  }
  const runSelectedBtn = $('#btn-run-selected');
  const runAllBtn = $('#btn-run-all-todo');
  const clearBtn = $('#btn-clear-image-selection');
  const selectAllBtn = $('#btn-select-all-todo');
  if (runSelectedBtn) {
    runSelectedBtn.disabled = selectedTodoCount === 0 || !visionSupported;
    runSelectedBtn.title = !visionSupported ? visionAnnotateMsg : '';
    runSelectedBtn.textContent = selectedTodoCount > 0 ? `标注所选（${selectedTodoCount}）` : '标注所选';
  }
  if (runAllBtn) {
    runAllBtn.disabled = totalTodoCount === 0 || !visionSupported;
    runAllBtn.title = !visionSupported ? visionAnnotateMsg : '';
    runAllBtn.textContent = totalTodoCount > 0 ? `标注全部待标注（${totalTodoCount}）` : '标注全部待标注';
  }
  if (clearBtn) clearBtn.disabled = state.annotateSelection.length === 0;
  if (selectAllBtn) selectAllBtn.disabled = totalTodoCount === 0;
}

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, type) {
  const wrap = $('#toasts');
  const t = el('div', { class: 'toast ' + (type || '') }, msg);
  wrap.appendChild(t);
  setTimeout(() => { t.style.transition='opacity .25s'; t.style.opacity='0'; }, 2400);
  setTimeout(() => t.remove(), 2800);
}

/* ============================================================
   RENDER: NAV STATS
   ============================================================ */
function renderNavStat() {
  const ok = state.illustrations.filter(i => i.status === 'ok' && shouldUseIllustrationRecord(i)).length;
  const rv = getReviewQueueItems().length;
  const isHome = state.mainView === 'home';
  $('#project-name').textContent = state.project;
  const _archBtn = $('#btn-archive-manager');
  if (_archBtn) _archBtn.style.display = isHome ? 'none' : '';
  const rvBtn = $('#btn-review-queue');
  if (!isHome && rv > 0) {
    rvBtn.textContent = `审核（${rv}）`;
    rvBtn.style.display = '';
  } else {
    rvBtn.style.display = 'none';
    if (state.mainView === 'review-queue') exitReviewMode();
  }
}

/* ============================================================
   RENDER: LEFT LIST
   ============================================================ */
// 懒加载缩略图：图片以 base64 内嵌（数据层 52MB），一次性渲染会卡死浏览器。
// 只给滚动进可视区的 <img> 设真实 src，其余先占位；display:none 的元素永不触发，天然不解码。
const _LAZY_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23f0ece2"/></svg>');
const _thumbObserver = ('IntersectionObserver' in window)
  ? new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const im = e.target;
        const real = im.dataset.src;
        if (real) { im.src = real; im.removeAttribute('data-src'); }
        obs.unobserve(im);
      }
    }, { rootMargin: '300px 0px' })
  : null;
// 返回一个挂到懒加载观察器上的 <img>；无 IO 支持则退化为直接加载。
function lazyImg(url, attrs = {}) {
  const im = el('img', { ...attrs });
  if (_thumbObserver && url) {
    im.src = _LAZY_PLACEHOLDER;
    im.dataset.src = url;
    im.loading = 'lazy';
    im.decoding = 'async';
    _thumbObserver.observe(im);
  } else {
    im.src = url || _LAZY_PLACEHOLDER;
  }
  attachImgRetry(im, url);   // 端点图加载失败时自动重试，避免后端瞬时抖动留下永久裂图
  return im;
}

// 给 <img> 挂自动重试：加载失败时带退避重试几次（覆盖后端瞬时抖动/重启，避免留下永久裂图）。
// 只对端点 url 生效；data: url 不重试。
function attachImgRetry(imgEl, url, maxRetries = 4) {
  if (!imgEl || !url || String(url).startsWith('data:')) return imgEl;
  let tries = 0;
  imgEl.addEventListener('error', () => {
    if (tries >= maxRetries) return;
    tries++;
    setTimeout(() => {
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      imgEl.src = url + sep + '_retry=' + tries;   // cache-bust，强制重新拉取
    }, 500 * tries);
  });
  return imgEl;
}

function syncImageBookFilterOptions() {
  const sel = $('#image-book-filter');
  if (!sel) return;
  const currentFilter = state.filter || 'all';
  const currentQuery = state.search || '';
  const visibleImages = state.illustrations.filter(img =>
    shouldUseIllustrationRecord(img)
    && matchesImageStatusFilter(img, currentFilter)
    && matchesImageSearchQuery(img, currentQuery)
  );
  const counts = visibleImages.reduce((acc, img) => {
    const bid = img.pdfSource?.bookId || '__no_book__';
    acc[bid] = (acc[bid] || 0) + 1;
    return acc;
  }, {});
  const valid = new Set(['all']);
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: 'all' }, `全部书籍（${visibleImages.length}）`));
  state.books
    .filter(book => counts[book.id])
    .forEach(book => {
      valid.add(book.id);
      sel.appendChild(el('option', { value: book.id }, `${book.title || book.id}（${counts[book.id]}）`));
    });
  if (counts.__no_book__) {
    valid.add('__no_book__');
    sel.appendChild(el('option', { value: '__no_book__' }, `未归入书籍（${counts.__no_book__}）`));
  }
  if (!valid.has(state.imageBookFilter || 'all')) state.imageBookFilter = 'all';
  sel.value = state.imageBookFilter || 'all';
}

function getVisibleAssetSourceRecords() {
  return getFiltered().filter(img => img?.id && !img.mergedInto && shouldUseIllustrationRecord(img));
}

function toggleAssetSourceRecord(id) {
  const allowed = new Set(getVisibleAssetSourceRecords().map(img => img.id));
  if (!allowed.has(id)) return;
  if (assetSourceExportTask.selectedIds.has(id)) assetSourceExportTask.selectedIds.delete(id);
  else assetSourceExportTask.selectedIds.add(id);
  renderLeftList();
}

function renderAssetSourceControls() {
  const root = $('#left-asset-source-controls');
  if (!root) return;
  root.innerHTML = '';
  const available = getVisibleAssetSourceRecords();
  if (!assetSourceExportTask.active) {
    root.appendChild(el('button', {
      class: 'btn', style: 'width:100%;',
      title: '选择插图后，从原始 PDF 的当前裁图导出源素材包；不显示或审核下游分层包。',
      onclick: () => { assetSourceExportTask.active = true; assetSourceExportTask.selectedIds.clear(); renderLeftList(); },
    }, '导出源素材'));
    return;
  }
  const selected = [...assetSourceExportTask.selectedIds]
    .map(id => state.illustrations.find(img => img.id === id))
    .filter(Boolean);
  root.appendChild(el('div', { style: 'padding:7px 8px; border:1px solid #c8d9e8; border-radius:7px; background:#f5faff; font-size:12px; line-height:1.55;' },
    el('div', { style: 'font-weight:600; margin-bottom:5px;' }, `源素材导出：已选 ${selected.length} 张`),
    el('div', { style: 'color:var(--c-text-mute); margin-bottom:7px;' }, '点击整张插图卡片选择；素材包将交给下游分层 Agent，标注系统不展示分层状态。'),
    el('div', { style: 'display:flex; flex-wrap:wrap; gap:5px;' },
      el('button', { class: 'btn', style: 'font-size:11px;', onclick: () => { assetSourceExportTask.selectedIds = new Set(available.map(img => img.id)); renderLeftList(); } }, `全选当前（${available.length}）`),
      el('button', { class: 'btn', style: 'font-size:11px;', onclick: () => { assetSourceExportTask.selectedIds.clear(); renderLeftList(); } }, '清除'),
      el('button', { class: 'btn primary', style: 'font-size:11px;', disabled: selected.length ? null : '', onclick: async () => {
        const result = await exportAssetSourceRecords(selected);
        if (result) { assetSourceExportTask.selectedIds.clear(); assetSourceExportTask.active = false; renderLeftList(); }
      } }, `导出所选（${selected.length}）`),
      el('button', { class: 'btn', style: 'font-size:11px;', onclick: () => { assetSourceExportTask.active = false; assetSourceExportTask.selectedIds.clear(); renderLeftList(); } }, '退出'),
    )
  ));
}

function renderLeftList() {
  const list = $('#left-list');
  list.innerHTML = '';
  const filterSel = $('#filter');
  if (filterSel) filterSel.value = state.filter || 'all';
  const searchInput = $('#search');
  if (searchInput && searchInput.value !== (state.search || '')) searchInput.value = state.search || '';
  syncImageBookFilterOptions();
  renderAssetSourceControls();
  sanitizeAnnotateSelection();
  syncAnnotateSelectionButtons();
  const items = getFiltered();
  if (items.length === 0) {
    list.appendChild(el('div', { class: 'empty-list' },
      state.illustrations.length === 0
        ? '尚未添加图片。点击右上角"+ 添加图片"开始。'
        : '没有匹配筛选条件的图片。'));
    return;
  }
  for (const img of items) {
    const st = STATUSES[img.status];
    const modeLabel = img.pdfSource?.selectionMode === 'full_page' ? '整页' : (img.pdfSource?.selectionMode === 'crop' ? '裁图' : '');
    const isTodo = isPendingBatchImage(img);
    const isChecked = state.annotateSelection.includes(img.id);
    const assetMode = assetSourceExportTask.active;
    const assetSelected = assetSourceExportTask.selectedIds.has(img.id);
    const thumbSrc = getIllustrationViewUrl(img, 360);
    const card = el('div', {
      class: 'img-card' + (assetMode && assetSelected ? ' active' : (img.id === state.selectedId ? ' active' : '')),
      title: assetMode ? (img.mergedInto ? '已合并的子图不能单独导出' : '点击选择或取消选择源素材') : '',
      onclick: () => assetMode ? toggleAssetSourceRecord(img.id) : selectImage(img.id),
    },
      el('div', { class: 'thumb' },
        lazyImg(thumbSrc, { alt: img.name || '缩略图' })
      ),
      el('div', { class: 'meta' },
        el('div', { class: 'id' }, img.id),
        el('div', { class: 'img-card-head' },
          assetMode
            ? el('button', {
              class: 'img-card-check' + (assetSelected ? ' active' : ''),
              disabled: img.mergedInto ? '' : null,
              title: img.mergedInto ? '该子图已并入合并图，请选择合并后的主记录' : '加入源素材导出',
              onclick: (e) => { e.stopPropagation(); toggleAssetSourceRecord(img.id); }
            }, assetSelected ? '✓' : '')
            : el('button', {
              class: 'img-card-check' + (isChecked ? ' active' : ''),
              disabled: isTodo ? null : '',
              title: isTodo ? '加入批量标注' : (img.status === 'todo' ? '该项已有标注结果，批量时会自动跳过' : '仅待标注项可加入批量标注'),
              onclick: (e) => {
                e.stopPropagation();
                toggleAnnotateSelection(img.id);
              }
            }, isChecked ? '✓' : ''),
          el('div', { class: 'title' }, img.bookRef || img.name),
        ),
        modeLabel ? el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:4px;' }, modeLabel) : null,
        el('span', { class: 'pill ' + st.pill },
          el('span', { class: 'dot' }),
          st.label),
      ),
    );
    list.appendChild(card);
  }
}

/* ============================================================
   RENDER: MAIN WORKSPACE — DISPATCHER
   ============================================================ */
function renderMain() {
  setMainHeader(); // 切换视图时先清空 header
  $('#main-scroll')?.classList.remove('archive-browse-scroll');
  if (state.mainView === 'home') return renderHomeView();
  if (state.mainView === 'group-overview') return renderGroupOverviewView();
  if (state.mainView === 'gallery') return renderGalleryView();
  if (state.mainView === 'page-detail') return renderPageDetailView();
  if (state.mainView === 'review-queue') return renderReviewQueueView();
  if (state.mainView === 'batch-monitor') return renderBatchMonitorView();
  if (state.mainView === 'archive-manager') return renderArchiveManagerView();
  if (state.mainView === 'run-history') return renderRunHistoryView();
  if (state.mainView === 'asset-desk') return renderAssetDeskView();
  // 成果展示已并入「标注数据」的"浏览展示"视图；旧的 showcase 入口重定向过去
  if (state.mainView === 'showcase') { state.mainView = 'archive-manager'; _archiveView = 'browse'; return renderArchiveManagerView(); }
  // 标注台已退休：每图工作区统一用审核台（改版原文对照 + 表单），不再有独立标注台/旧证据页面板
  return renderReviewQueueView();
}

/* ── 模型运行历史（技术追溯，只读；不等于当前插图记录）── */
const ARCHIVE_ALL_URL    = `${BRIDGE_BASE}/api/model-runs/all`;
const ARCHIVE_BULK_URL   = `${BRIDGE_BASE}/api/model-runs/bulk`;
const ARCHIVE_EXPORT_URL = `${BRIDGE_BASE}/api/model-runs/export`;
let _archiveData = null;          // {records, models, providers, books}
let _archiveSel  = new Set();     // 选中的 run_key
let _archiveFilter = { model:'', provider:'', bookId:'', dateFrom:'', dateTo:'', kw:'', showHidden:true };
const ARCHIVE_ROW_CAP = 400;
const ILLUST_NEW_FIGURE_TOKEN = '__new_figure__';
let _illustCropUiRestore = null;

async function loadArchiveData() {
  const r = await fetch(ARCHIVE_ALL_URL);
  _archiveData = await r.json();
  return _archiveData;
}

function getCurrentIllustrationForArchiveRecord(record) {
  if (!record?.image_id) return null;
  return state.illustrations.find(img => img.id === record.image_id) || null;
}
function shouldShowArchiveRecord(record) {
  const current = getCurrentIllustrationForArchiveRecord(record);
  return current ? shouldUseIllustrationRecord(current) : true;
}

function _archiveFiltered() {
  if (!_archiveData || !_archiveData.records) return [];
  const f = _archiveFilter;
  return _archiveData.records.filter(r => {
    if (!shouldShowArchiveRecord(r)) return false;
    if (f.model && r.model !== f.model) return false;
    if (f.provider && r.provider !== f.provider) return false;
    if (f.bookId && r.book_id !== f.bookId) return false;
    if (!f.showHidden && r.hidden) return false;
    if (f.dateFrom && (r.stored_at || '') < f.dateFrom) return false;
    if (f.dateTo && (r.stored_at || '') > f.dateTo + 'T23:59:59') return false;
    if (f.kw) {
      const k = f.kw.toLowerCase();
      if (!`${r.image_id} ${r.subject} ${r.academic_class} ${r.model}`.toLowerCase().includes(k)) return false;
    }
    return true;
  });
}

function renderArchiveManagerView() {
  setMainHeader(el('div', { class: 'crumb-bar' },
    renderReturnButton(),
    el('span', { style:'font-weight:600;' }, '🗂 插图记录')
  ));
  const scroll = $('#main-scroll');
  scroll.classList.remove('home-scroll');
  scroll.innerHTML = '';
  const wrap = el('div', { style: 'padding:4px 0 24px;' });
  scroll.appendChild(wrap);
  // 日常入口只读当前规范插图库；不依赖、也不混入可重复的模型运行历史。
  _renderArchiveBrowse(wrap);
}

function assetDeskSources() {
  const raw = assetDeskState.sourceIndex?.sources || {};
  return Object.entries(raw).map(([sourceId, item]) => {
    const latest = (item.revisions || []).find(rev => rev.source_revision === item.latest_revision) || item.revisions?.[0] || {};
    const packagePath = latest.package_path || '';
    return {
      sourceId,
      recordId: item.record_id || '',
      canonicalId: item.canonical_id || '',
      packageCount: Number(item.package_count) || 0,
      layerCount: Number(item.layer_count) || 0,
      hasLayerPackage: item.has_layer_package === true || Number(item.package_count) > 0,
      hasRestorationReference: item.has_restoration_reference === true,
      sourcePath: packagePath ? `${packagePath}/source.png` : '',
      // 左侧目录使用轻量预览；完整 source.png 只在中间工作区按需加载。
      previewPath: packagePath ? `${packagePath}/preview.webp` : '',
    };
  }).sort((a, b) => a.canonicalId.localeCompare(b.canonicalId, 'zh-Hans-CN'));
}

function assetDeskVisibleSources(sources) {
  const query = String(assetDeskState.search || '').trim().toLocaleLowerCase();
  return sources.filter(source => {
    const matchesFilter = assetDeskState.catalogFilter === 'all' || source.hasLayerPackage;
    if (!matchesFilter) return false;
    if (!query) return true;
    return [source.canonicalId, source.sourceId, source.recordId]
      .some(value => String(value || '').toLocaleLowerCase().includes(query));
  });
}

function assetDeskSourceBadge(source) {
  if (!source.hasLayerPackage) return '暂无分层素材';
  const packageLabel = `${source.packageCount} 包`;
  const layerLabel = source.layerCount ? ` · ${source.layerCount} 层` : '';
  return packageLabel + layerLabel;
}

function assetDeskLabel(source) {
  return source?.canonicalId || source?.sourceId || '未命名插图';
}

function assetDeskLayerTypeLabel(layer) {
  return ASSET_LAYER_TYPE_LABELS[layer?.asset_type] || '组合片段';
}

function assetDeskLayerVisible(packageId, layer) {
  const saved = assetDeskState.layerVisibility?.[packageId] || {};
  if (Object.prototype.hasOwnProperty.call(saved, layer.id)) return saved[layer.id] !== false;
  return layer.default_visible !== false;
}

function setAssetDeskLayerVisible(packageId, layerId, visible) {
  if (!assetDeskState.layerVisibility[packageId]) assetDeskState.layerVisibility[packageId] = {};
  assetDeskState.layerVisibility[packageId][layerId] = visible;
}

function assetDeskCanvasStyle(canvas) {
  const width = Number(canvas?.width) || 1;
  const height = Number(canvas?.height) || 1;
  return `--canvas-ratio:${width} / ${height};`;
}

function assetDeskLayerBBox(layer, purpose = 'render') {
  const candidate = purpose === 'source'
    ? (layer?.source_bbox || layer?.bbox)
    : (layer?.render_bbox || layer?.bbox);
  return Array.isArray(candidate) ? candidate.map(Number) : [0, 0, 0, 0];
}

function assetDeskObjectPosition(layer) {
  const kind = layer?.anchor?.kind || 'center';
  return ({
    bottom_center: 'center bottom', top_center: 'center top', left_center: 'left center', right_center: 'right center',
  })[kind] || 'center center';
}

function assetDeskBBoxStyle(layer, canvas, purpose = 'render') {
  const [x, y, width, height] = assetDeskLayerBBox(layer, purpose);
  const canvasWidth = Number(canvas?.width) || 1;
  const canvasHeight = Number(canvas?.height) || 1;
  const objectPosition = purpose === 'render' ? `object-position:${assetDeskObjectPosition(layer)};` : '';
  return `left:${(x / canvasWidth) * 100}%;top:${(y / canvasHeight) * 100}%;width:${(width / canvasWidth) * 100}%;height:${(height / canvasHeight) * 100}%;${objectPosition}`;
}

function loadAssetDeskSources() {
  if (assetDeskState.loading) return;
  assetDeskState.loading = true;
  assetDeskState.error = '';
  fetch(`${BRIDGE_BASE}/api/asset-sources`)
    .then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || '正式素材索引读取失败');
      return payload.index || { sources: {} };
    })
    .then(index => { assetDeskState.sourceIndex = index; })
    .catch(error => { assetDeskState.error = error.message || String(error); })
    .finally(() => { assetDeskState.loading = false; if (state.mainView === 'asset-desk') renderAssetDeskView(); });
}

// 素材包元数据在当前会话内缓存；切换模式/图层时不重复请求同一记录。
function loadAssetDeskPackage(recordId) {
  const key = String(recordId || '').trim();
  if (!key) return Promise.reject(new Error('缺少插图记录 ID'));
  const cached = assetDeskState.packageCache.get(key);
  if (cached) return cached;
  const pending = fetch(BRIDGE_ILLUSTRATION_ASSET_PACKAGES_URL(key))
    .then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || '素材信息读取失败');
      return payload;
    })
    .catch(error => {
      // 失败请求不缓存，允许用户重试；成功结果在本次会话内复用。
      assetDeskState.packageCache.delete(key);
      throw error;
    });
  assetDeskState.packageCache.set(key, pending);
  return pending;
}

function openAssetDeskFor(img) {
  assetDeskState.requestedRecordId = img?.id || '';
  assetDeskState.selectedSourceId = '';
  assetDeskState.packageId = '';
  assetDeskState.selectedLayerId = '';
  captureReturnContext();
  navigateTo('asset-desk');
}

function renderAssetDeskView() {
  setMainHeader(el('div', { class: 'crumb-bar' }, renderReturnButton('← 返回'), el('span', { style:'font-weight:600;' }, '✦ 插图素材档案')));
  const scroll = $('#main-scroll');
  scroll.classList.remove('home-scroll');
  scroll.innerHTML = '';
  if (!assetDeskState.sourceIndex && !assetDeskState.loading) loadAssetDeskSources();
  const sources = assetDeskSources();
  const visibleSources = assetDeskVisibleSources(sources);
  if (!sources.some(source => source.sourceId === assetDeskState.selectedSourceId)) {
    assetDeskState.selectedSourceId = sources.find(source => source.recordId === assetDeskState.requestedRecordId)?.sourceId
      || visibleSources[0]?.sourceId || sources[0]?.sourceId || '';
    assetDeskState.packageId = '';
  }
  const desk = el('div', { class: 'asset-desk' });
  const layout = el('div', { class: 'asset-desk-layout' });
  const index = el('aside', { class: 'asset-desk-index' },
    el('div', { class: 'asset-desk-index-head' },
      el('strong', null, '素材目录'),
      el('span', null, '默认只显示已有分层素材'),
      el('div', { class: 'asset-desk-index-stats' },
        el('span', null, `已有素材 ${sources.filter(source => source.hasLayerPackage).length}`),
        el('span', null, `全部 ${sources.length}`)
      ),
      el('div', { class: 'asset-desk-filter-tabs', role: 'tablist', 'aria-label': '素材目录筛选' },
        el('button', { class: assetDeskState.catalogFilter === 'with_layers' ? 'active' : '', role: 'tab', 'aria-selected': assetDeskState.catalogFilter === 'with_layers', onclick: () => {
          assetDeskState.catalogFilter = 'with_layers';
          const next = assetDeskVisibleSources(sources);
          if (!next.some(source => source.sourceId === assetDeskState.selectedSourceId)) {
            assetDeskState.selectedSourceId = next[0]?.sourceId || '';
            assetDeskState.packageId = '';
          }
          renderAssetDeskView();
        } }, '已有素材'),
        el('button', { class: assetDeskState.catalogFilter === 'all' ? 'active' : '', role: 'tab', 'aria-selected': assetDeskState.catalogFilter === 'all', onclick: () => {
          assetDeskState.catalogFilter = 'all';
          renderAssetDeskView();
        } }, '全部插图')
      ),
      el('div', { class: 'asset-desk-search' },
        el('input', { value: assetDeskState.searchDraft, placeholder: '搜索名称或编号', 'aria-label': '搜索插图名称或编号', oninput: event => { assetDeskState.searchDraft = event.target.value; }, onkeydown: event => {
          if (event.key === 'Enter') { assetDeskState.search = assetDeskState.searchDraft; renderAssetDeskView(); }
        } }),
        el('button', { class: 'btn ghost', title: '按名称或编号筛选', onclick: () => { assetDeskState.search = assetDeskState.searchDraft; renderAssetDeskView(); } }, '查找'),
        assetDeskState.search ? el('button', { class: 'asset-desk-search-clear', title: '清除搜索', onclick: () => { assetDeskState.search = ''; assetDeskState.searchDraft = ''; renderAssetDeskView(); } }, '×') : null
      )
    )
  );
  const list = el('div', { class: 'asset-desk-index-list' });
  if (assetDeskState.loading) {
    list.appendChild(el('div', { class:'asset-desk-empty', style:'margin:7px;' }, '正在读取素材索引…'));
  } else if (assetDeskState.error) {
    list.appendChild(el('div', { class:'asset-desk-empty', style:'margin:7px;' }, `读取失败：${assetDeskState.error}`));
  } else if (!sources.length) {
    list.appendChild(el('div', { class:'asset-desk-empty', style:'margin:7px;' }, '尚无正式源图。请从图片列表导出第一条素材源。'));
  } else if (!visibleSources.length) {
    list.appendChild(el('div', { class:'asset-desk-empty', style:'margin:7px;' }, assetDeskState.search ? '没有匹配的插图。' : '还没有已导入的分层素材。可切换“全部插图”查看完整目录。'));
  } else for (const source of visibleSources) {
    list.appendChild(el('button', { class:`asset-desk-index-item${source.sourceId === assetDeskState.selectedSourceId ? ' active' : ''}`, onclick:() => {
      assetDeskState.selectedSourceId = source.sourceId;
      assetDeskState.packageId = '';
      assetDeskState.selectedLayerId = '';
      renderAssetDeskView();
    } },
      lazyImg(BRIDGE_ASSET_FILE_URL(source.previewPath || source.sourcePath), { alt:assetDeskLabel(source) }),
      el('span', null, el('b', null, assetDeskLabel(source)), el('small', null, source.sourceId), el('em', { class: source.hasLayerPackage ? 'has-assets' : '' }, assetDeskSourceBadge(source)))
    ));
  }
  index.appendChild(list);
  layout.appendChild(index);
  const sheet = el('section', { class: 'asset-desk-sheet' });
  layout.appendChild(sheet);
  const rail = el('aside', { class: 'asset-desk-layer-rail' });
  layout.appendChild(rail);
  desk.appendChild(layout);
  scroll.appendChild(desk);
  const source = sources.find(item => item.sourceId === assetDeskState.selectedSourceId);
  if (!source) {
    sheet.appendChild(el('div', { class:'asset-desk-empty' }, assetDeskState.loading ? '正在准备素材档案…' : '从左侧选择一张插图开始浏览。'));
    rail.appendChild(el('div', { class:'asset-desk-layer-rail-head' }, el('strong', null, '素材图层'), el('span', null, '选择插图后显示')));
    return;
  }
  renderAssetDeskSheet(sheet, rail, source);
}

function renderAssetDeskSheet(sheet, rail, sourceItem) {
  sheet.innerHTML = '';
  const header = el('div', { class:'asset-desk-sheet-head' },
    el('div', null,
      el('div', { class:'asset-desk-eyebrow' }, 'ILLUSTRATION ASSET ARCHIVE'),
      el('h1', { class:'asset-desk-title' }, assetDeskLabel(sourceItem)),
      el('div', { class:'asset-desk-sub' }, sourceItem.sourceId)
    ),
    el('button', { class:'btn', title:'重新读取素材目录中的分层包。', onclick:async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = '刷新中…';
      try {
        const response = await fetch(BRIDGE_LAYER_PACKAGE_SCAN_URL, { method:'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || '刷新失败');
        toast(`已刷新 ${payload.scanned || 0} 个分层包`, 'success');
      } catch (error) { toast('刷新素材失败：' + (error.message || error), 'error'); }
      finally { assetDeskState.sourceIndex = null; assetDeskState.packageCache.clear(); renderAssetDeskView(); }
    } }, '刷新素材')
  );
  sheet.appendChild(header);
  const toolbar = el('div', { class:'asset-desk-toolbar' },
    el('div', { class:'asset-desk-mode-switch', role:'group', 'aria-label':'素材台展示模式' },
      el('button', { class:assetDeskState.viewMode === 'browse' ? 'active' : '', onclick:() => { assetDeskState.viewMode = 'browse'; renderAssetDeskView(); } }, '素材浏览'),
      el('button', { class:assetDeskState.viewMode === 'reference' ? 'active' : '', onclick:() => { assetDeskState.viewMode = 'reference'; renderAssetDeskView(); } }, '原图 · 修复参考'),
      el('button', { class:assetDeskState.viewMode === 'compare' ? 'active' : '', onclick:() => { assetDeskState.viewMode = 'compare'; renderAssetDeskView(); } }, '叠层对比')
    ),
    el('span', { class:'asset-desk-toolbar-note' }, assetDeskState.viewMode === 'compare'
      ? '原图与素材按原始坐标回放'
      : assetDeskState.viewMode === 'reference'
        ? '修复图仅供制作参考；原图始终是证据基准'
        : '点击右侧素材可定位其原图位置')
  );
  sheet.appendChild(toolbar);
  const stage = el('div', { class:'asset-desk-stage' }, el('div', { class:'asset-desk-empty' }, '正在读取原图与素材…'));
  sheet.appendChild(stage);
  rail.innerHTML = '';
  rail.appendChild(el('div', { class:'asset-desk-layer-rail-head' }, el('strong', null, '素材图层'), el('span', null, '透明 PNG · 勾选后参与叠层回放')));
  const railList = el('div', { class:'asset-desk-layer-list' }, el('div', { class:'asset-desk-empty', style:'margin:7px;' }, '正在读取素材…'));
  rail.appendChild(railList);
  const requestId = `${sourceItem.sourceId}:${Date.now()}`;
  sheet.dataset.assetRequestId = requestId;
  loadAssetDeskPackage(sourceItem.recordId)
    .then(payload => {
      if (sheet.dataset.assetRequestId !== requestId) return;
      const source = payload.source;
      const packages = Array.isArray(payload.packages) ? payload.packages : [];
      if (!assetDeskState.packageId || !packages.some(item => item.package_id === assetDeskState.packageId)) {
        assetDeskState.packageId = packages[0]?.package_id || '';
      }
      const selected = packages.find(item => item.package_id === assetDeskState.packageId) || null;
      const originalUrl = source ? BRIDGE_ASSET_FILE_URL(source.source_path) : BRIDGE_ASSET_FILE_URL(sourceItem.sourcePath);
      stage.innerHTML = '';
      railList.innerHTML = '';
      const railHead = rail.querySelector('.asset-desk-layer-rail-head');
      if (packages.length > 1) {
        railHead.appendChild(el('div', { class:'asset-desk-layer-tools' }, el('select', { onchange:event => {
          assetDeskState.packageId = event.target.value;
          assetDeskState.selectedLayerId = '';
          renderAssetDeskView();
        } }, ...packages.map(item => el('option', { value:item.package_id, ...(item.package_id === selected?.package_id ? { selected:'' } : {}) }, item.package_id)))));
      }
      renderAssetDeskStage(stage, originalUrl, sourceItem, selected);
      renderAssetDeskLayerRail(railList, selected);
    })
    .catch(error => {
      if (sheet.dataset.assetRequestId !== requestId) return;
      stage.innerHTML = '';
      stage.appendChild(el('div', { class:'asset-desk-empty' }, '素材信息读取失败：' + (error.message || error)));
      railList.innerHTML = '';
      railList.appendChild(el('div', { class:'asset-desk-empty', style:'margin:7px;' }, '暂无可显示素材'));
    });
}

function renderAssetDeskSourceFrame(originalUrl, sourceItem, canvas, selectedLayer) {
  const frame = el('div', { class:'asset-desk-canvas-frame', style:assetDeskCanvasStyle(canvas) });
  if (originalUrl) frame.appendChild(el('img', { src:originalUrl, alt:assetDeskLabel(sourceItem), onclick:() => openLightbox(originalUrl) }));
  else frame.appendChild(el('div', { class:'asset-desk-empty' }, '当前插图没有可显示的原图。'));
  if (selectedLayer) frame.appendChild(el('div', { class:'asset-desk-bbox', style:assetDeskBBoxStyle(selectedLayer, canvas, 'source'), title:'此素材在原图中的证据位置' }));
  return frame;
}

function renderAssetDeskCompositeFrame(selectedPackage) {
  const canvas = selectedPackage.canvas || { width:1, height:1 };
  const frame = el('div', { class:'asset-desk-canvas-frame asset-desk-composite-frame', style:assetDeskCanvasStyle(canvas) });
  for (const layer of selectedPackage.layers || []) {
    const visible = assetDeskLayerVisible(selectedPackage.package_id, layer);
    const className = `asset-desk-composite-layer${visible ? '' : ' is-hidden'}${assetDeskState.selectedLayerId === layer.id ? ' is-selected' : ''}`;
    frame.appendChild(el('img', {
      class:className, src:BRIDGE_ASSET_FILE_URL(layer.file), alt:layer.label || layer.id,
      style:assetDeskBBoxStyle(layer, canvas), onclick:() => { assetDeskState.selectedLayerId = layer.id; renderAssetDeskView(); },
    }));
  }
  return frame;
}

function renderAssetDeskProductionReferenceFrame(referenceUrl, sourceItem, canvas) {
  const frame = el('div', { class:'asset-desk-canvas-frame', style:assetDeskCanvasStyle(canvas) });
  if (referenceUrl) frame.appendChild(el('img', { src:referenceUrl, alt:`${assetDeskLabel(sourceItem)}整图制作参考`, onclick:() => openLightbox(referenceUrl) }));
  else frame.appendChild(el('div', { class:'asset-desk-empty' }, '当前素材包没有整图制作参考。'));
  return frame;
}

function renderAssetDeskSourceOnly(originalUrl, sourceItem, note = '') {
  const sourceOnly = el('div', { class:'asset-desk-source-only' });
  if (originalUrl) {
    sourceOnly.appendChild(el('img', {
      src: originalUrl,
      alt: assetDeskLabel(sourceItem),
      onclick: () => openLightbox(originalUrl),
    }));
  } else {
    sourceOnly.appendChild(el('div', { class:'asset-desk-empty' }, '当前插图没有可显示的正式源图。'));
  }
  if (note) sourceOnly.appendChild(el('div', { class:'asset-desk-empty' }, note));
  return sourceOnly;
}

function renderAssetDeskStage(stage, originalUrl, sourceItem, selectedPackage) {
  if (!selectedPackage) {
    if (assetDeskState.viewMode === 'browse') {
      stage.appendChild(renderAssetDeskSourceOnly(originalUrl, sourceItem, '正式源图已就绪，等待分层任务交回单件素材。'));
    } else {
      const isReference = assetDeskState.viewMode === 'reference';
      const compare = el('div', { class:'asset-desk-compare-stage' },
        el('div', { class:'asset-desk-compare-panel' },
          el('b', null, '权威原图 · 证据基准'),
          renderAssetDeskSourceOnly(originalUrl, sourceItem)),
        el('div', { class:'asset-desk-compare-panel' },
          el('b', null, isReference ? '修复整图 · 制作参考' : '素材叠层 · 可开关'),
          el('div', { class:'asset-desk-empty' }, isReference
            ? '当前插图暂无修复整图参考。'
            : '当前插图暂无可叠加的分层素材。'))
      );
      stage.appendChild(compare);
    }
    return;
  }
  const selectedLayer = (selectedPackage.layers || []).find(layer => layer.id === assetDeskState.selectedLayerId) || null;
  if (assetDeskState.viewMode === 'reference') {
    const referencePath = selectedPackage.files?.production_reference;
    if (!referencePath) {
      stage.appendChild(el('div', { class:'asset-desk-empty' }, '当前版本没有整图修复参考。请选择含修复参考的素材版本，或回到素材浏览。'));
      return;
    }
    const referenceUrl = BRIDGE_ASSET_FILE_URL(referencePath);
    const reference = el('div', { class:'asset-desk-compare-stage' },
      el('div', { class:'asset-desk-compare-panel' }, el('b', null, '权威原图 · 证据基准'), renderAssetDeskSourceFrame(originalUrl, sourceItem, selectedPackage.canvas, null)),
      el('div', { class:'asset-desk-compare-panel' }, el('b', null, '修复整图 · 制作参考（非史料）'), renderAssetDeskProductionReferenceFrame(referenceUrl, sourceItem, selectedPackage.canvas)),
    );
    stage.appendChild(reference);
  } else if (assetDeskState.viewMode === 'compare') {
    const compare = el('div', { class:'asset-desk-compare-stage' },
      el('div', { class:'asset-desk-compare-panel' }, el('b', null, '原图 · 定位框'), renderAssetDeskSourceFrame(originalUrl, sourceItem, selectedPackage.canvas, selectedLayer)),
      el('div', { class:'asset-desk-compare-panel' }, el('b', null, '素材叠层 · 可开关'), renderAssetDeskCompositeFrame(selectedPackage)),
    );
    stage.appendChild(compare);
  } else {
    stage.appendChild(el('div', { class:'asset-desk-browse-stage' }, renderAssetDeskSourceFrame(originalUrl, sourceItem, selectedPackage.canvas, selectedLayer)));
  }
}

function renderAssetDeskLayerRail(list, selectedPackage) {
  if (!selectedPackage) {
    list.appendChild(el('div', { class:'asset-desk-empty', style:'margin:7px;' }, '此插图暂无单件素材。'));
    return;
  }
  for (const layer of selectedPackage.layers || []) {
    const layerUrl = BRIDGE_ASSET_FILE_URL(layer.file);
    const selected = layer.id === assetDeskState.selectedLayerId;
    const toggle = el('input', { type:'checkbox', checked:assetDeskLayerVisible(selectedPackage.package_id, layer) ? '' : null, title:'显示/隐藏此图层', onchange:event => {
      setAssetDeskLayerVisible(selectedPackage.package_id, layer.id, event.currentTarget.checked);
      renderAssetDeskView();
    } });
    const card = el('article', { class:`asset-desk-layer-card${selected ? ' active' : ''}`, onclick:event => {
      if (event.target === toggle) return;
      assetDeskState.selectedLayerId = selected ? '' : layer.id;
      renderAssetDeskView();
    } },
      toggle,
      el('img', { src:layerUrl, alt:layer.label || layer.id, onclick:event => { event.stopPropagation(); openLightbox(layerUrl); } }),
      el('span', null,
        el('b', { title:layer.label || layer.id }, layer.label || layer.id),
        el('small', null, `${assetDeskLayerTypeLabel(layer)} · 图层 ${layer.z_index}`),
        el('em', { title:layer.attachment_point ? `挂点：${layer.attachment_point}` : layer.id }, layer.attachment_point ? `↳ ${layer.attachment_point}` : layer.id),
      )
    );
    list.appendChild(card);
  }
}

function renderRunHistoryView() {
  setMainHeader(el('div', { class: 'crumb-bar' },
    renderReturnButton(),
    el('span', { style:'font-weight:600;' }, '🧾 运行历史')
  ));
  const scroll = $('#main-scroll');
  scroll.classList.remove('home-scroll');
  scroll.innerHTML = '';
  const wrap = el('div', { style: 'padding:4px 0 24px;' });
  scroll.appendChild(wrap);
  if (!_archiveData) {
    wrap.appendChild(el('div', { class:'placeholder-state', style:'height:200px' }, el('div',{class:'sub'},'加载归档数据中…')));
    loadArchiveData()
      .then(() => renderRunHistoryView())
      .catch(() => { wrap.innerHTML=''; wrap.appendChild(el('div',{class:'placeholder-state'}, el('div',{class:'sub'},'加载失败——确认 bridge.py 正常运行'))); });
    return;
  }
  _archiveView = 'manage';
  _renderArchiveContent(wrap);
}

function _renderArchiveContent(wrap) {
  wrap.innerHTML = '';
  wrap.classList.toggle('archive-browse-full', _archiveView === 'browse');
  $('#main-scroll')?.classList.toggle('archive-browse-scroll', _archiveView === 'browse');
  // 运行历史是技术追溯，不等于当前插图记录；日常记录已独立为顶部“插图记录”。
  const viewBar = el('div', { style:'display:flex; gap:8px; margin-bottom:14px;' },
    el('button', { class:'btn primary', disabled:'', title:'同一插图可能有多次模型运行；此处不代表当前标注数。' }, '🧾 运行历史'),
    el('button', { class:'btn', onclick:()=>navigateTo('archive-manager') }, '🗂 返回插图记录'));
  wrap.appendChild(viewBar);
  const d = _archiveData, f = _archiveFilter;
  wrap.appendChild(el('div', { class:'status-card', style:'margin-bottom:12px; color:var(--c-text-mute); line-height:1.65;' },
    el('strong', { style:'color:var(--c-text);' }, '只读技术追溯。'),
    ' 同一插图每次运行 AI 都会产生一条历史记录，因此这里的数量可能高于“插图记录”。日常查看、审核与发布请回到“插图记录”。'
  ));
  const FS = 'display:inline-flex; flex-direction:column; gap:3px; font-size:11px; color:var(--c-text-mute);';
  const ctl = 'height:30px; border:1px solid var(--c-border-strong); border-radius:6px; padding:0 8px; font-size:13px; background:#fff;';
  const mkSel = (label, cur, opts, onCh) => el('label', { style:FS }, el('span',null,label),
    el('select', { style:ctl, onchange:e=>onCh(e.target.value) },
      el('option', { value:'', ...(cur===''?{selected:''}:{}) }, '全部'),
      ...opts.map(o => el('option', { value:o.v, ...(cur===o.v?{selected:''}:{}) }, o.t))));

  const bar = el('div', { style:'display:flex; flex-wrap:wrap; gap:12px 14px; align-items:flex-end; background:#fff; border:1px solid var(--c-border); border-radius:10px; padding:14px 16px; margin-bottom:12px;' });
  bar.appendChild(mkSel('模型', f.model, (d.models||[]).map(m=>({v:m,t:m})), v=>{f.model=v;_renderArchiveContent(wrap);}));
  bar.appendChild(mkSel('提供商', f.provider, (d.providers||[]).map(m=>({v:m,t:m})), v=>{f.provider=v;_renderArchiveContent(wrap);}));
  bar.appendChild(mkSel('书', f.bookId, (d.books||[]).map(b=>({v:b.id,t:b.title||b.id})), v=>{f.bookId=v;_renderArchiveContent(wrap);}));
  bar.appendChild(el('label',{style:FS}, el('span',null,'起始日期'), el('input',{type:'date',style:ctl,value:f.dateFrom,onchange:e=>{f.dateFrom=e.target.value;_renderArchiveContent(wrap);}})));
  bar.appendChild(el('label',{style:FS}, el('span',null,'结束日期'), el('input',{type:'date',style:ctl,value:f.dateTo,onchange:e=>{f.dateTo=e.target.value;_renderArchiveContent(wrap);}})));
  bar.appendChild(el('label',{style:FS}, el('span',null,'搜索'), el('input',{type:'text',style:ctl+'min-width:160px;',placeholder:'图片id / 主体 / 类别',value:f.kw,oninput:e=>{f.kw=e.target.value;_renderArchiveContent(wrap);}})));
  bar.appendChild(el('label',{style:'display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--c-text-soft); height:30px;'},
    el('input',{type:'checkbox',...(f.showHidden?{checked:''}:{}),onchange:e=>{f.showHidden=e.target.checked;_renderArchiveContent(wrap);}}), el('span',null,'显示已隐藏')));
  bar.appendChild(el('button',{class:'btn',style:'height:30px;',onclick:()=>{_archiveFilter={model:'',provider:'',bookId:'',dateFrom:'',dateTo:'',kw:'',showHidden:true};_renderArchiveContent(wrap);}},'重置筛选'));
  wrap.appendChild(bar);

  const rows = _archiveFiltered();
  const selInView = rows.filter(r=>_archiveSel.has(r.run_key)).length;

  // 只读选择与导出条
  const act = el('div', { style:'display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:10px;' });
  act.appendChild(el('span',{style:'font-size:13px; color:var(--c-text-soft);'}, `筛选出 ${rows.length} 条 · 已选 ${_archiveSel.size} 条`));
  act.appendChild(el('button',{class:'btn',onclick:()=>{rows.forEach(r=>_archiveSel.add(r.run_key));_renderArchiveContent(wrap);}},'全选(当前筛选)'));
  act.appendChild(el('button',{class:'btn',onclick:()=>{_archiveSel.clear();_renderArchiveContent(wrap);}},'清除选择'));
  act.appendChild(el('span',{style:'flex:1'}));
  act.appendChild(el('span',{style:'display:inline-flex; gap:6px; align-items:center; border-left:1px solid var(--c-border); padding-left:10px; margin-left:4px;'},
    el('span',{style:'font-size:12px; color:var(--c-text-mute);'},'📤 导出所选:'),
    el('button',{class:'btn',disabled:_archiveSel.size?null:'',onclick:()=>_archiveExport('jsonl')},'JSONL'),
    el('button',{class:'btn',disabled:_archiveSel.size?null:'',onclick:()=>_archiveExport('csv')},'CSV'),
    el('button',{class:'btn',disabled:_archiveSel.size?null:'',onclick:()=>_archiveExport('html')},'HTML 报告'),
  ));
  wrap.appendChild(act);

  // 表格
  const capped = rows.slice(0, ARCHIVE_ROW_CAP);
  const table = el('table',{style:'width:100%; border-collapse:collapse; font-size:12.5px; background:#fff; border:1px solid var(--c-border); border-radius:10px; overflow:hidden;'});
  const allChecked = capped.length>0 && capped.every(r=>_archiveSel.has(r.run_key));
  const th = (t,w)=>el('th',{style:`text-align:left; padding:8px 10px; background:#f4f6f8; color:var(--c-text-soft); font-weight:600; border-bottom:1px solid var(--c-border);${w?'width:'+w+';':''}`}, t);
  const headRow = el('tr', null,
    el('th',{style:'padding:8px 10px; background:#f4f6f8; width:34px; border-bottom:1px solid var(--c-border);'},
      el('input',{type:'checkbox',...(allChecked?{checked:''}:{}),onchange:e=>{ if(e.target.checked) capped.forEach(r=>_archiveSel.add(r.run_key)); else capped.forEach(r=>_archiveSel.delete(r.run_key)); _renderArchiveContent(wrap); }})),
    th('插图 / 书·页'), th('模型',null), th('时间',null), th('类别',null), th('状态',null), th('隐藏','60px'));
  table.appendChild(el('thead',null,headRow));
  const tb = el('tbody');
  for (const r of capped) {
    const checked = _archiveSel.has(r.run_key);
    const td = (c)=>el('td',{style:'padding:7px 10px; border-bottom:1px solid #f0f1f3; vertical-align:top;'}, c);
    const currentImg = getCurrentIllustrationForArchiveRecord(r);
    const currentStatus = currentImg?.status || r.status;
    const currentBookTitle = currentImg ? getImageBookTitle(currentImg, r.book_title || r.book_id || '') : (r.book_title || r.book_id || '');
    const tr = el('tr',{style: r.hidden?'opacity:0.5;':''},
      el('td',{style:'padding:7px 10px; border-bottom:1px solid #f0f1f3;'}, el('input',{type:'checkbox',...(checked?{checked:''}:{}),onchange:e=>{ if(e.target.checked)_archiveSel.add(r.run_key); else _archiveSel.delete(r.run_key); tr.style.background=e.target.checked?'#eef5ff':''; }})),
      td(el('div',{title: r.image_id ? `记录 ID：${r.image_id}` : ''},
        el('div',{style:'color:var(--c-text); font-weight:600;'}, r.subject || r.image_id || '—'),
        el('div',{style:'color:var(--c-text-mute); font-size:11px;'}, `${currentBookTitle}${r.page_num!=null?' · 第'+r.page_num+'页':''}`),
        r.merged_into ? el('div', { style:'margin-top:3px; color:#9a6a2a; font-size:11px;' }, `已合并 → ${r.current_owner_id || r.merged_into}`) : null)),
      td(el('span',{style:'font-family:var(--f-mono);'}, r.model||'—')),
      td(fmtDate(r.stored_at)),
      td(r.academic_class||'—'),
      td(el('span',{class:'st-pill '+(STATUS_CLASS[currentStatus]||'st-todo'), style:'font-size:11px; padding:2px 8px;'}, statusLabel(currentStatus))),
      td(r.hidden?el('span',{style:'color:var(--c-warning);'},'已隐藏'):'—'),
    );
    if (checked) tr.style.background = '#eef5ff';
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  wrap.appendChild(table);
  if (rows.length > ARCHIVE_ROW_CAP) {
    wrap.appendChild(el('div',{style:'margin-top:10px; font-size:12px; color:var(--c-text-mute);'}, `仅显示前 ${ARCHIVE_ROW_CAP} 条（共 ${rows.length}），请用上方筛选缩小范围。`));
  }
  if (!rows.length) {
    wrap.appendChild(el('div',{class:'placeholder-state',style:'height:160px'}, el('div',{class:'sub'},'没有匹配的归档记录')));
  }
}

async function _archiveBulk(action) {
  const keys = [..._archiveSel];
  if (!keys.length) { toast('请先勾选记录', 'warn'); return; }
  if (action === 'delete') {
    const ok = await openConfirm(`确定永久删除选中的 ${keys.length} 条归档记录？\n\n· 改前会自动备份原 runs.jsonl 到 backups/model_runs/\n· 当前标注结果（annotation）不受影响`);
    if (!ok) return;
  } else if (keys.length > 30) {
    // 大批量 hide/unhide 也二次确认，防"全选→隐藏"误操作一次性影响上千条
    const label = action === 'hide' ? '隐藏' : '取消隐藏';
    const ok = await openConfirm(`确定${label}选中的 ${keys.length} 条记录？`);
    if (!ok) return;
  }
  try {
    const r = await fetch(ARCHIVE_BULK_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action, keys }) });
    const j = await r.json();
    if (!r.ok || j.error) { toast(j.error || '操作失败', 'error'); return; }
    toast(action==='delete' ? `已删除 ${j.deleted} 条（已备份）` : (action==='hide' ? `已隐藏 ${j.affected} 条` : `已取消隐藏 ${j.affected} 条`), 'success');
    _archiveSel.clear();
    await loadArchiveData();
    renderArchiveManagerView();
  } catch (e) {
    toast('操作失败：' + (e.message || e), 'error');
  }
}

async function _archiveExport(format) {
  const keys = [..._archiveSel];
  if (!keys.length) { toast('请先勾选要导出的记录', 'warn'); return; }
  try {
    const r = await fetch(ARCHIVE_EXPORT_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ keys, format }) });
    const j = await r.json();
    if (!r.ok || j.error) { toast(j.error || '导出失败', 'error'); return; }
    const blob = new Blob([j.content], { type: (j.mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = j.filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已导出 ${j.count} 条 → ${j.filename}`, 'success');
  } catch (e) {
    toast('导出失败：' + (e.message || e), 'error');
  }
}

/* ── 导出到展示站：服务端打包（/api/showcase-export），全量覆盖语义 ── */
function openShowcaseExportModal() {
  // 各书已确认条数（数据源 = state.illustrations，与导出端点同口径）
  const okByBook = {};
  for (const img of state.illustrations) {
    if (img.status !== 'ok' || !img.pdfSource?.bookId) continue;
    okByBook[img.pdfSource.bookId] = (okByBook[img.pdfSource.bookId] || 0) + 1;
  }
  const books = state.books.filter(b => okByBook[b.id]);
  if (!books.length) { toast('当前没有已确认（status=ok）的标注，先去审核确认', 'warn'); return; }

  const sel = { bookIds: new Set(books.map(b => b.id)), subclass: '',
                onlyChecked: false, thumbs: true, hires: true, pdf: false, mode: 'local' };
  const featuredIds = getShowcaseFeaturedIds();
  // 表格勾选 → 去重 image_id（一图可能多条 run 记录）
  const checkedImageIds = [...new Set((_archiveData?.records || [])
    .filter(r => _archiveSel.has(r.run_key) && r.image_id).map(r => r.image_id))];

  const cnt = el('span', { style: 'color:var(--c-primary); font-weight:600;' });
  function updateCnt() {
    let n = 0;
    for (const img of state.illustrations) {
      if (img.status !== 'ok' || !sel.bookIds.has(img.pdfSource?.bookId)) continue;
      if (sel.subclass && (img.annotation?.academicSubclass || '') !== sel.subclass) continue;
      if (sel.onlyChecked && !checkedImageIds.includes(img.id)) continue;
      n++;
    }
    cnt.textContent = String(n);
    return n;
  }

  const bookList = el('div', { style: 'display:grid; gap:6px; max-height:160px; overflow-y:auto; border:1px solid var(--c-border); border-radius:8px; padding:10px 12px;' },
    books.map(b => el('label', { style: 'display:flex; align-items:center; gap:8px; font-size:13px;' },
      el('input', { type: 'checkbox', checked: '', onchange: e => {
        if (e.target.checked) sel.bookIds.add(b.id); else sel.bookIds.delete(b.id);
        updateCnt();
      } }),
      el('span', { style: 'flex:1;' }, b.title || b.id),
      el('span', { style: 'color:var(--c-text-mute); font-size:12px;' }, `${okByBook[b.id]} 条已确认`))));

  const mkCheck = (label, key, hint) => el('label', { style: 'display:flex; align-items:center; gap:8px; font-size:13px;' },
    el('input', { type: 'checkbox', ...(sel[key] ? { checked: '' } : {}),
      onchange: e => { sel[key] = e.target.checked; updateCnt(); } }),
    el('span', null, label),
    hint ? el('span', { style: 'color:var(--c-text-mute); font-size:12px;' }, hint) : null);

  const body = el('div', { class: 'modal-body', style: 'display:grid; gap:14px;' },
    el('div', { style: 'font-size:13px; color:var(--c-text-soft);' },
      '导出当前所选范围内全部「已确认」标注的完整快照（图片 + 标注 JSON + 页缩略图），',
      '直接替换展示站旧数据；展示站 videos/ 目录（AI 视频）不受影响。'),
    el('div', null,
      el('div', { style: 'font-size:12px; color:var(--c-text-mute); margin-bottom:6px;' }, '书籍范围'),
      bookList),
    el('div', { style: 'display:flex; gap:14px; align-items:center; flex-wrap:wrap;' },
      el('label', { style: 'display:flex; align-items:center; gap:8px; font-size:13px;' },
        el('span', null, '分类'),
        el('select', { style: 'height:30px; border:1px solid var(--c-border-strong); border-radius:6px; padding:0 8px;',
          onchange: e => { sel.subclass = e.target.value; updateCnt(); } },
          el('option', { value: '' }, '全部'),
          el('option', { value: UNSPECIFIED_ACADEMIC_SUBCLASS }, UNSPECIFIED_ACADEMIC_SUBCLASS),
          el('option', { value: '药物形态图' }, '药物形态图'),
          el('option', { value: '药物炮制图' }, '药物炮制图'))),
      checkedImageIds.length ? el('label', { style: 'display:flex; align-items:center; gap:8px; font-size:13px;' },
        el('input', { type: 'checkbox', onchange: e => { sel.onlyChecked = e.target.checked; updateCnt(); } }),
        el('span', null, `仅表格中勾选的条目（${checkedImageIds.length} 图）`)) : null),
    el('div', { style: 'display:grid; gap:8px;' },
      mkCheck('包含全书页缩略图', 'thumbs', '缩略图轨用，建议保持勾选'),
      mkCheck('包含高清原书页（仅含插图的页）', 'hires', '阅读器用；只有前端打开过的页才有缓存'),
      mkCheck('包含原书 PDF', 'pdf', '大文件；首次导出或 PDF 变更时才需要')),
    el('div', { style: 'font-size:13px; color:var(--c-text-soft);' },
      `精选案例：${featuredIds.length} 条`,
      featuredIds.length ? '（将生成 featured.json；不在本次导出范围内的条目会自动跳过）' : '（可在「浏览展示」里手动加入）'),
    el('div', { style: 'display:flex; gap:18px; font-size:13px;' },
      ...[['local', '直接写入本地展示站（showcase/data/）'], ['zip', '下载 showcase_data.zip']].map(([v, label]) =>
        el('label', { style: 'display:flex; align-items:center; gap:6px;' },
          el('input', { type: 'radio', name: 'sc-mode', ...(sel.mode === v ? { checked: '' } : {}),
            onchange: () => { sel.mode = v; } }),
          el('span', null, label)))),
    el('div', { style: 'font-size:13px; color:var(--c-text-soft);' }, '将导出 ', cnt, ' 条已确认标注'));

  const exportBtn = el('button', { class: 'btn primary', onclick: doExport }, '🚀 导出');
  const modal = el('div', { class: 'modal', style: 'max-width:560px;' },
    el('div', { class: 'modal-head' },
      el('h3', null, '导出到展示站'),
      el('button', { class: 'modal-close', onclick: close }, '×')),
    body,
    el('div', { class: 'modal-foot' },
      el('button', { class: 'btn', onclick: close }, '取消'),
      exportBtn));
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } }, modal);
  $('#overlay-root').appendChild(scrim);
  function close() { scrim.remove(); }
  updateCnt();

  async function doExport() {
    if (!updateCnt()) { toast('当前范围没有可导出的记录', 'warn'); return; }
    exportBtn.disabled = true;
    exportBtn.textContent = '导出中…';
    try {
      const payload = {
        book_ids: [...sel.bookIds],
        subclass: sel.subclass,
        image_ids: sel.onlyChecked ? checkedImageIds : [],
        include_page_thumbs: sel.thumbs,
        include_hires_pages: sel.hires,
        include_pdf: sel.pdf,
        featured_ids: getShowcaseFeaturedIds(),
        mode: sel.mode,
      };
      const r = await fetch(`${BRIDGE_BASE}/api/showcase-export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (sel.mode === 'zip') {
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.status); }
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'showcase_data.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast(`已下载 showcase_data.zip（${r.headers.get('X-Export-Count') || '?'} 条）`, 'success');
      } else {
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || r.status);
        const warn = j.manifest?.warnings?.length;
        toast(`已写入展示站：${j.manifest?.count} 条${warn ? `（${warn} 条警告，见 export_manifest.json）` : ''}`, warn ? 'warn' : 'success');
      }
      close();
    } catch (e) {
      toast('导出失败：' + (e.message || e), 'error');
      exportBtn.disabled = false;
      exportBtn.textContent = '🚀 导出';
    }
  }
}

/* ── 成果浏览（标注数据 → 浏览展示）：已确认插图 = 插图 + 标注结果 + 对应原文 ──
   版式仿"导出数据 HTML 报告"：左图 + 右元信息（dl）+ 对应原文。 */
let _showcaseBookId = '';
let _archiveView = 'browse';   // 兼容旧返回上下文；日常入口固定为当前插图记录
let _archiveBrowseMode = 'grid'; // 'grid' 网格 | 'list' 列表 | 'detail' 详情
let _archiveDetailLayout = 'single'; // 'single' 单条全宽 | 'double' 双列并排
let _archiveRecordStatus = ''; // 当前插图记录状态筛选；空值表示全部

// 书名码映射表：用 ASCII 码做检索/数字化主键。书可手填 book.code 覆盖；否则按书名规则派生。
function getBookCode(book) {
  if (!book) return 'BK';
  if (book.code) return book.code;
  const t = book.title || book.idShort || book.name || '';
  if (/雷公炮制便览/.test(t)) {
    const m = t.match(/卷\s*(\d+)/);
    return 'BYLGJ' + (m ? String(m[1]).padStart(2, '0') : '00');
  }
  if (/内镜/.test(t)) return 'NJ';
  if (/素问入式运气论奥/.test(t)) return 'SWYQ';
  if (/医学指归/.test(t)) return 'YXZG';
  // 兜底：由 id/书名生成稳定 ASCII 短码，避免中文进文件名/URL/主键
  let h = 0; const s = book.id || t;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'BK' + (h % 9000 + 1000);
}

function getImageBookTitle(img, fallback = '') {
  const bookId = img?.pdfSource?.bookId || img?.book_id || '';
  const book = bookId ? getBook(bookId) : null;
  return (book?.title || img?.pdfSource?.bookTitle || img?.book_title || fallback || bookId || '').trim();
}

// 结构化编号：书名码_pNNNN_iII（页号 4 位、同页第几图 2 位）
function _showcaseId(img, book) {
  const code = getBookCode(book);
  const pn = img?.pdfSource?.pageNum;
  const idx = Number(img.figureIndex || img.subIndex) || 0;
  const suffix = isFigureIllustrationRecord(img) && idx
    ? `_i${String(idx).padStart(2, '0')}`
    : '';
  return `${code}_p${String(pn || 0).padStart(4, '0')}${suffix}`;
}

// 合并图继续沿用主记录 ID，以保持引用稳定；界面额外展示全部来源编号，避免用户误以为
// 主记录仍是一张普通子图，或误判隐藏来源为数据丢失。
function getMergeIdentityMeta(img) {
  const sourceIds = Array.isArray(img?.imageMerge?.items)
    ? [...new Set(img.imageMerge.items.filter(Boolean))]
    : [];
  if (sourceIds.length < 2) return null;
  const sources = sourceIds.map(id => {
    const record = state.illustrations.find(item => item?.id === id) || (id === img.id ? img : null);
    const book = record ? getBook(record?.pdfSource?.bookId) : null;
    return {
      id,
      code: record ? _showcaseId(record, book) : id,
      isOwner: id === img.id,
    };
  });
  return { count: sources.length, sources };
}

function renderIllustrationIdentityCard(img) {
  const book = getBook(img?.pdfSource?.bookId);
  const primaryCode = _showcaseId(img, book);
  const mergeIdentity = getMergeIdentityMeta(img);
  const card = el('div', {
    class: 'illustration-identity-card',
    title: '结构化编号（自动生成，可复制，用于检索/数字化）',
  },
    el('div', { class: 'illustration-identity-primary' },
      el('span', { class: 'illustration-identity-code' }, primaryCode),
      mergeIdentity
        ? el('span', { class: 'illustration-identity-badge' }, `合并图 · ${mergeIdentity.count} 个来源`)
        : null));
  if (mergeIdentity) {
    card.appendChild(el('div', { class: 'illustration-identity-sources' },
      el('span', { class: 'illustration-identity-label' }, '来源编号'),
      el('div', { class: 'illustration-identity-source-list' },
        ...mergeIdentity.sources.map(source => el('span', {
          class: `illustration-identity-source${source.isOwner ? ' owner' : ''}`,
          title: source.id,
        }, source.code, source.isOwner ? el('small', null, '主记录') : null)))));
  }
  return card;
}

async function exportAssetSourceRecords(records) {
  const targets = (records || []).filter(record => record?.id && !record?.mergedInto);
  const recordIds = [...new Set(targets.map(record => record.id))];
  if (!recordIds.length) {
    toast('没有可导出的插图记录；合并子图需从主记录导出。', 'warn');
    return null;
  }
  const provisionalRecords = targets.filter(record => record.status !== 'ok');
  let allowProvisional = false;
  if (provisionalRecords.length) {
    allowProvisional = window.confirm(
      `${provisionalRecords.length} 张插图尚未审核确认。继续导出会明确标记 provisional，不能作为正式素材。是否继续？`
    );
    if (!allowProvisional) return null;
  }
  try {
    const response = await fetch(BRIDGE_ASSET_SOURCE_EXPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record_ids: recordIds, allow_provisional: allowProvisional }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `素材源导出失败（HTTP ${response.status}）`);
    }
    const reused = (payload.sources || []).filter(item => item.idempotent).length;
    const paths = (payload.sources || []).map(item => item.package_path).join('；');
    toast(`已导出 ${payload.count} 个素材源包${reused ? `（${reused} 个复用既有版本）` : ''}：${paths}`, 'success');
    return payload;
  } catch (error) {
    toast(error.message || String(error), 'error');
    return null;
  }
}

// 可读名称只取插图名称。主要描绘对象可带解释/异名/推测，不再回退成标题。
function _showcaseName(img) {
  const owner = getAnnotationOwnerRecord(img);
  const ann = owner.annotation || owner.aiDraft || {};
  return (ann.illustrationName || '').trim() || '（未命名插图）';
}

// 展示名 + 拼音的统一口径（②段公共 helper，避免标题/拼音拼接逻辑在各处散落）。
function displayName(img) { return _showcaseName(img); }
function displayNamePinyin(img) {
  const owner = getAnnotationOwnerRecord(img);
  const ann = owner.annotation || owner.aiDraft || {};
  return (ann.illustrationNamePinyin || '').trim();
}

function getShowcaseFeaturedIds() {
  if (!Array.isArray(state.showcaseFeaturedIds)) state.showcaseFeaturedIds = [];
  const seen = new Set();
  state.showcaseFeaturedIds = state.showcaseFeaturedIds
    .map(id => String(id || '').trim())
    .filter(id => id && !seen.has(id) && (seen.add(id), true));
  return state.showcaseFeaturedIds;
}

function isShowcaseFeatured(imgOrId) {
  const id = typeof imgOrId === 'string' ? imgOrId : imgOrId?.id;
  return !!id && getShowcaseFeaturedIds().includes(id);
}

function toggleShowcaseFeatured(img) {
  if (!img?.id) return false;
  const ids = getShowcaseFeaturedIds();
  const idx = ids.indexOf(img.id);
  if (idx >= 0) {
    ids.splice(idx, 1);
    toast('已移出精选案例', 'info');
  } else {
    ids.push(img.id);
    toast(`已加入精选案例（第 ${ids.length} 条）`, 'success');
  }
  persistGlobalState();
  return true;
}

function getShowcaseFeaturedItems() {
  const byId = new Map(state.illustrations.map(img => [img.id, img]));
  return getShowcaseFeaturedIds()
    .map(id => byId.get(id))
    .filter(img => img && img.status === 'ok' && shouldUseIllustrationRecord(img));
}

function getShowcaseFeaturedBookOrderKey(img, originalIndex = 0) {
  const bookId = img?.pdfSource?.bookId || img?.bookId || '';
  const bookIndex = state.books.findIndex(book => book.id === bookId);
  const pageNum = Number(img?.pdfSource?.pageNum || img?.pageNum);
  const figureIndex = Number(img?.figureIndex || img?.subIndex || img?.imageIndex);
  return {
    bookIndex: bookIndex >= 0 ? bookIndex : Number.MAX_SAFE_INTEGER,
    pageNum: Number.isFinite(pageNum) ? pageNum : Number.MAX_SAFE_INTEGER,
    figureIndex: Number.isFinite(figureIndex) ? figureIndex : Number.MAX_SAFE_INTEGER,
    originalIndex,
    id: String(img?.id || '')
  };
}

function compareShowcaseFeaturedBookOrder(a, b) {
  return a.key.bookIndex - b.key.bookIndex
    || a.key.pageNum - b.key.pageNum
    || a.key.figureIndex - b.key.figureIndex
    || a.key.originalIndex - b.key.originalIndex
    || a.key.id.localeCompare(b.key.id);
}

function sortShowcaseFeaturedByBookOrder() {
  const ids = getShowcaseFeaturedIds();
  if (ids.length < 2) return false;
  const byId = new Map(state.illustrations.map(img => [img.id, img]));
  const sorted = ids
    .map((id, originalIndex) => {
      const img = byId.get(id);
      const key = img
        ? getShowcaseFeaturedBookOrderKey(img, originalIndex)
        : {
            bookIndex: Number.MAX_SAFE_INTEGER,
            pageNum: Number.MAX_SAFE_INTEGER,
            figureIndex: Number.MAX_SAFE_INTEGER,
            originalIndex,
            id
          };
      return { id, key };
    })
    .sort(compareShowcaseFeaturedBookOrder)
    .map(item => item.id);
  state.showcaseFeaturedIds = sorted;
  persistGlobalState();
  return true;
}

function openShowcaseFeaturedPreviewModal() {
  const selectedCount = getShowcaseFeaturedIds().length;
  const items = getShowcaseFeaturedItems();
  if (!selectedCount) {
    toast('还没有选择精选案例', 'info');
    return;
  }
  const body = el('div', { class: 'modal-body', style: 'display:grid; gap:12px; max-height:70vh; overflow:auto;' });
  const renderItems = () => {
    const current = getShowcaseFeaturedItems();
    body.replaceChildren(
      el('div', { style:'font-size:13px; color:var(--c-text-soft);' },
        `已选 ${getShowcaseFeaturedIds().length} 条；当前可预览 ${current.length} 条。`,
        current.length < getShowcaseFeaturedIds().length ? '部分条目不在当前数据或已非确认状态，导出时会自动跳过。' : ''),
      current.length
        ? el('div', { style:'display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px;' },
            ...current.map((img, idx) => {
              const m = _browseMeta(img);
              return el('article', { style:'border:1px solid var(--c-border); border-radius:10px; background:#fff; overflow:hidden;' },
                el('div', { style:'height:150px; background:#f7f4ea; display:flex; align-items:center; justify-content:center; cursor:zoom-in;', onclick:()=>m.src&&openLightbox(m.src) },
                  m.src ? lazyImg(m.src, { style:'max-width:100%; max-height:150px; object-fit:contain;' }) : el('span', null, '无图像')),
                el('div', { style:'padding:10px 12px; display:grid; gap:6px;' },
                  el('div', { style:'font-size:12px; color:#9a6a2a; font-family:var(--f-mono);' }, `#${idx + 1} · ${m.code}`),
                  el('div', { style:'font-weight:700; color:var(--c-text); line-height:1.5;' }, m.title),
                  el('div', { style:'font-size:12px; color:var(--c-text-mute);' }, `${m.book?.title || '未知书籍'} · 第${m.page || '—'}页`),
                  el('div', { style:'display:flex; gap:6px; flex-wrap:wrap;' },
                    el('button', { class:'btn tiny', onclick:()=>m.src&&openLightbox(m.src) }, '预览'),
                    el('button', { class:'btn tiny', onclick:()=>_editFromArchiveBrowse(img) }, '修改'),
                    el('button', { class:'btn tiny danger-ghost', onclick:()=>{ toggleShowcaseFeatured(img); renderItems(); renderArchiveManagerView(); } }, '移出'))));
            }))
        : el('div', { class:'placeholder-state', style:'height:160px;' }, el('div', { class:'sub' }, '已选条目当前不可预览')));
  };
  const modal = el('div', { class: 'modal', style: 'max-width:860px;' },
    el('div', { class: 'modal-head' },
      el('h3', null, '精选案例预览'),
      el('button', { class: 'modal-close', onclick: close }, '×')),
    body,
    el('div', { class: 'modal-foot' },
      el('button', {
        class:'btn',
        disabled: selectedCount < 2 ? 'disabled' : null,
        onclick: () => {
          if (!sortShowcaseFeaturedByBookOrder()) return;
          toast('已按书籍插图顺序重排精选案例', 'success');
          renderItems();
          renderArchiveManagerView();
        }
      }, '按书籍顺序排列'),
      el('button', { class:'btn', onclick: close }, '关闭')));
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } }, modal);
  function close() { scrim.remove(); }
  $('#overlay-root').appendChild(scrim);
  renderItems();
}

// 名称 + 灰字小拼音的 DOM 片段；无拼音时退化为纯文本节点（调用处行为不变）。
function renderNameWithPinyin(name, pinyin) {
  if (!pinyin) return document.createTextNode(name || '');
  return el('span', { class: 'name-with-pinyin', style: 'display:inline-flex; align-items:baseline; gap:7px; flex-wrap:wrap;' },
    el('span', null, name || ''),
    el('span', { class: 'name-pinyin', style: 'font-size:0.7em; color:#9aa7b5; font-weight:400; letter-spacing:.3px;' }, pinyin));
}

function _browseTextValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(_browseTextValue).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    const preferred = value.text || value.content || value.original || value.value || value.snippet || value.excerpt;
    if (preferred != null) return _browseTextValue(preferred);
    return Object.values(value).map(_browseTextValue).filter(Boolean).join('\n');
  }
  return String(value).trim();
}

function _renderArchiveBrowse(wrap) {
  $('#main-scroll')?.classList.add('archive-browse-scroll');
  const recordImgs = state.illustrations.filter(i => i
    && shouldUseIllustrationRecord(i)
    && (!_showcaseBookId || i?.pdfSource?.bookId === _showcaseBookId)
    && (!_archiveRecordStatus || i.status === _archiveRecordStatus));
  // 书籍下拉覆盖当前规范插图库，而非仅已确认展示记录。
  const bookMap = new Map();
  state.illustrations.filter(i => shouldUseIllustrationRecord(i) && i?.pdfSource?.bookId)
    .forEach(i => bookMap.set(i.pdfSource.bookId, getImageBookTitle(i)));
  wrap.classList.add('archive-browse-full');
  const bar = el('div', { class:'archive-browse-toolbar' });
  bar.appendChild(el('span', { style:'font-size:13px; color:var(--c-text-soft);' }, '书籍'));
  bar.appendChild(el('select', { style:'height:30px; border:1px solid var(--c-border-strong); border-radius:6px; padding:0 8px; font-size:13px; max-width:360px;',
      onchange: e => { _showcaseBookId = e.target.value; renderArchiveManagerView(); } },
    el('option', { value:'', ...(_showcaseBookId===''?{selected:''}:{}) }, '全部书籍'),
    ...[...bookMap].map(([id, t]) => el('option', { value:id, ...(_showcaseBookId===id?{selected:''}:{}) }, t))));
  bar.appendChild(el('select', { style:'height:30px; border:1px solid var(--c-border-strong); border-radius:6px; padding:0 8px; font-size:13px;',
      onchange: e => { _archiveRecordStatus = e.target.value; renderArchiveManagerView(); } },
    el('option', { value:'', ...(_archiveRecordStatus===''?{selected:''}:{}) }, '全部状态'),
    el('option', { value:'ok', ...(_archiveRecordStatus==='ok'?{selected:''}:{}) }, '已确认'),
    el('option', { value:'review', ...(_archiveRecordStatus==='review'?{selected:''}:{}) }, '待审核'),
    el('option', { value:'todo', ...(_archiveRecordStatus==='todo'?{selected:''}:{}) }, '待标注'),
    el('option', { value:'bad', ...(_archiveRecordStatus==='bad'?{selected:''}:{}) }, '异常')));
  bar.appendChild(el('span', { style:'font-size:13px; color:var(--c-text-mute);' }, `共 ${recordImgs.length} 张当前插图`));
  bar.appendChild(el('button', {
    class: 'btn',
    disabled: getShowcaseFeaturedIds().length ? null : '',
    title: '预览所有已选精选案例',
    onclick: openShowcaseFeaturedPreviewModal,
  }, `预览精选（${getShowcaseFeaturedIds().length}）`));
  bar.appendChild(el('span', { style:'flex:1' }));
  const modeSwitch = el('div', { class:'archive-browse-mode-switch', title:'切换浏览展示排版' });
  [['grid', '▦ 网格'], ['list', '☰ 列表'], ['detail', '▤ 详情']].forEach(([mode, label]) => {
    modeSwitch.appendChild(el('button', {
      class: 'archive-browse-mode-btn' + (_archiveBrowseMode === mode ? ' active' : ''),
      onclick: () => { _archiveBrowseMode = mode; renderArchiveManagerView(); },
    }, label));
  });
  bar.appendChild(modeSwitch);
  if (_archiveBrowseMode === 'detail') {
    const detailSwitch = el('div', { class:'archive-browse-mode-switch archive-detail-layout-switch', title:'详情模式：单条或双列展示' });
    [['single', '单条'], ['double', '双列']].forEach(([layout, label]) => {
      detailSwitch.appendChild(el('button', {
        class: 'archive-browse-mode-btn' + (_archiveDetailLayout === layout ? ' active' : ''),
        onclick: () => { _archiveDetailLayout = layout; renderArchiveManagerView(); },
      }, label));
    });
    bar.appendChild(detailSwitch);
  }
  const publishableImgs = recordImgs.filter(img => img.status === 'ok');
  bar.appendChild(el('button', { class:'btn', disabled: publishableImgs.length?null:'',
    onclick: () => {
      const html = buildHtmlReport(publishableImgs);
      download('成果展示_报告.html', html, 'text/html;charset=utf-8');
      toast(`已导出 HTML 报告（${publishableImgs.length} 张已确认插图）`, 'success');
    } }, '📄 导出为 HTML 报告'));
  bar.appendChild(el('button', {
    class:'btn primary',
    disabled: publishableImgs.length ? null : '',
    title:'仅导出已确认插图到展示站或下载展示包',
    onclick: openShowcaseExportModal,
  }, '🚀 发布展示数据'));
  wrap.appendChild(bar);

  if (!recordImgs.length) {
    wrap.appendChild(el('div', { class:'placeholder-state', style:'height:200px' },
      el('div', { class:'sub' }, '当前筛选下没有插图记录')));
    return;
  }
  if (_archiveBrowseMode === 'list') {
    const list = el('div', { class:'archive-browse-list' });
    for (const img of recordImgs) list.appendChild(_browseListCard(img));
    wrap.appendChild(list);
    return;
  }
  if (_archiveBrowseMode === 'detail') {
    const list = el('div', { class:'archive-browse-detail-list ' + (_archiveDetailLayout === 'double' ? 'detail-double' : 'detail-single') });
    for (const img of recordImgs) list.appendChild(_browseCard(img));
    wrap.appendChild(list);
    return;
  }
  const grid = el('div', { class:'archive-browse-grid' });
  for (const img of recordImgs) grid.appendChild(_browseGridCard(img));
  wrap.appendChild(grid);
}

function _editFromArchiveBrowse(img) {
  if (!img?.id) return;
  const bookId = img?.pdfSource?.bookId;
  const pageNum = Number(img?.pdfSource?.pageNum) || null;
  if (!bookId || !pageNum) {
    toast('该条记录缺少原书页信息，无法跳转到卷页', 'warn');
    return;
  }
  state._returnCtx = {
    mainView: 'archive-manager',
    leftTab: state.leftTab,
    rightTab: state.rightTab,
    filter: state.filter,
    imageBookFilter: state.imageBookFilter,
    selectedId: img.id,
    archiveView: _archiveView,
    showcaseBookId: _showcaseBookId,
    archiveBrowseMode: _archiveBrowseMode,
    archiveDetailLayout: _archiveDetailLayout,
  };
  openPageDetail(bookId, pageNum, 'illustrations', img.id);
}

function _browseMeta(img) {
  const annOwner = getAnnotationOwnerRecord(img);
  const ann = annOwner.annotation || annOwner.aiDraft || {};
  const book = getBook(img?.pdfSource?.bookId);
  const displayItems = getDisplayIllustrationItems(img);
  const first = displayItems[0] || img;
  return {
    ann,
    owner: annOwner,
    book,
    bookTitle: getImageBookTitle(img, book?.title || ''),
    displayItems,
    src: getIllustrationViewUrl(first, 560),
    mergeCount: displayItems.length,
    isImageMerge: Array.isArray(annOwner?.imageMerge?.items) && annOwner.imageMerge.items.length > 1,
    title: _showcaseName(img),
    pinyin: displayNamePinyin(img),
    code: _showcaseId(img, book),
    page: img?.pdfSource?.pageNum,
    classText: ann.academicClass ? ann.academicClass + (ann.academicSubclass ? ' · ' + ann.academicSubclass : '') : '—',
    subject: ann.subject || '—',
    herb: ann.herbClassical || '—',
    verdict: ann.aiVerdict || (img.crossref || {}).verdict || '—',
    confidence: confLabel(ann.confidence) || '—',
    note: ann.note || '',
    text: _browseTextValue(ann.correspondingText),
  };
}

function _browseImageElement(meta, style = '') {
  if (meta.isImageMerge) {
    return renderMergedIllustrationImage(meta.owner, {
      maxLong: 1200,
      alt: `${meta.title}（合并图）`,
      style,
    });
  }
  return meta.src ? lazyImg(meta.src, { alt: meta.title, ...(style ? { style } : {}) }) : el('span', null, '无图像');
}

function _openBrowseImage(meta) {
  return openIllustrationLightbox(meta.owner, meta.src);
}

function _browseGridCard(img) {
  const m = _browseMeta(img);
  const thumb = el('div', { class:'archive-grid-thumb', onclick:()=>_openBrowseImage(m) },
    _browseImageElement(m));
  const card = el('article', { class:'archive-grid-card' },
    thumb,
    el('div', { class:'archive-grid-body' },
      el('div', { class:'archive-grid-title', title:m.title }, renderNameWithPinyin(m.title, m.pinyin)),
      el('div', { class:'archive-grid-code', title:'结构化编号，可复制' }, m.code),
      el('div', { class:'archive-grid-meta' }, `${m.bookTitle || '未知书籍'} · 第${m.page || '—'}页`),
      el('div', { class:'archive-grid-tags' },
        el('span', null, m.classText),
        m.mergeCount > 1 ? el('span', null, `合并图 ${m.mergeCount}`) : null),
      el('div', { class:'archive-grid-actions' },
        el('button', {
          class:'btn tiny' + (isShowcaseFeatured(img) ? ' primary' : ''),
          onclick:()=>{ if (toggleShowcaseFeatured(img)) renderArchiveManagerView(); }
        }, isShowcaseFeatured(img) ? '已精选' : '精选'),
        el('button', { class:'btn tiny', onclick:()=>_openBrowseImage(m) }, '放大'),
        el('button', { class:'btn tiny', onclick:()=>viewOriginalPage(img) }, '原书页'),
        el('button', { class:'btn tiny primary', onclick:()=>_editFromArchiveBrowse(img) }, '修改标注'))));
  return card;
}

function _browseListCard(img) {
  const m = _browseMeta(img);
  const excerpt = m.text ? m.text.replace(/\s+/g, ' ').slice(0, 120) : '暂无对应原文';
  return el('article', { class:'archive-list-card' },
    el('div', { class:'archive-list-thumb', onclick:()=>_openBrowseImage(m) },
      _browseImageElement(m)),
    el('div', { class:'archive-list-main' },
      el('div', { class:'archive-list-title' }, renderNameWithPinyin(m.title, m.pinyin)),
      el('div', { class:'archive-list-code' }, m.code),
      el('div', { class:'archive-list-book' }, `${m.bookTitle || '未知书籍'} · 第${m.page || '—'}页`),
      el('div', { class:'archive-list-excerpt' }, excerpt)),
    el('div', { class:'archive-list-fields' },
      el('div', null, el('b', null, '类型'), el('span', null, m.classText)),
      el('div', null, el('b', null, '对象'), el('span', null, m.subject)),
      m.mergeCount > 1 ? el('div', null, el('b', null, '合并'), el('span', null, `${m.mergeCount} 张`)) : null),
    el('div', { class:'archive-list-actions' },
      el('button', {
        class:'btn tiny' + (isShowcaseFeatured(img) ? ' primary' : ''),
        onclick:()=>{ if (toggleShowcaseFeatured(img)) renderArchiveManagerView(); }
      }, isShowcaseFeatured(img) ? '已精选' : '精选'),
      el('button', { class:'btn tiny', onclick:()=>m.src&&openLightbox(m.src) }, '放大'),
      el('button', { class:'btn tiny', onclick:()=>viewOriginalPage(img) }, '原书页'),
      el('button', { class:'btn tiny primary', onclick:()=>_editFromArchiveBrowse(img) }, '修改标注')));
}

function _browseCard(img) {
  const annOwner = getAnnotationOwnerRecord(img);
  const ann = annOwner.annotation || annOwner.aiDraft || {};
  const book = getBook(img?.pdfSource?.bookId);
  const ct = _browseTextValue(ann.correspondingText);
  const IMG_H = '600px';
  const card = el('div', { class:'archive-detail-card' });
  // 顶部：名称（可读）+ 编号（检索主键）+ 出处
  card.appendChild(el('div', null,
    el('div', { style:'font-family:var(--f-serif); font-size:18px; font-weight:600; color:var(--c-text);' }, renderNameWithPinyin(_showcaseName(img), displayNamePinyin(img))),
    el('div', { style:'font-family:var(--f-mono); font-size:12.5px; color:#9a6a2a; margin-top:3px; user-select:all;', title:'结构化编号（可复制，用于检索/数字化）' }, _showcaseId(img, book)),
    el('div', { style:'display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px;' },
      el('span', { style:'font-size:11.5px; color:var(--c-text-mute);' }, `${getImageBookTitle(img, book?.title || '')} · 第${img?.pdfSource?.pageNum}页`),
      el('button', {
        class:'btn tiny' + (isShowcaseFeatured(img) ? ' primary' : ''),
        onclick:()=>{ if (toggleShowcaseFeatured(img)) renderArchiveManagerView(); }
      }, isShowcaseFeatured(img) ? '已精选' : '加入精选'),
      el('button', { class:'btn tiny primary', onclick:()=>_editFromArchiveBrowse(img) }, '修改标注'))));
  // 画册版：左侧大图，右侧上审核重点、下原文摘要
  const row = el('div', { class:'archive-detail-row' });
  const displayItems = getDisplayIllustrationItems(img);
  const illustrationSrc = getIllustrationViewUrl(displayItems[0], 900);
  const isMergedArchiveImage = Array.isArray(getAnnotationOwnerRecord(img)?.imageMerge?.items)
    && getAnnotationOwnerRecord(img).imageMerge.items.length > 1;
  const archiveImage = isMergedArchiveImage
    ? renderMergedIllustrationImage(img, {
        maxLong: 1800,
        alt: `${_showcaseName(img)}（合并图）`,
        style: `max-width:100%; max-height:${IMG_H}; object-fit:contain;`,
      })
    : (displayItems.length > 1
      ? el('div', { style:'display:flex; flex-direction:column; gap:12px; align-items:center; width:100%; padding:12px; overflow:auto;' },
          ...displayItems.map((item, idx) => el('div', { style:'display:flex; flex-direction:column; gap:6px; align-items:center; width:100%;' },
            el('div', { style:'font-size:12px; color:#7b8ba1; font-weight:600;' }, `连图 ${idx + 1} · 第 ${item?.pdfSource?.pageNum || '—'} 页`),
            getIllustrationViewUrl(item, 900)
              ? lazyImg(getIllustrationViewUrl(item, 900), { style:'max-width:100%; max-height:240px; object-fit:contain;' })
              : el('div', { style:'color:var(--c-text-mute); font-size:12px;' }, '无图像')
          )))
    : (illustrationSrc
        ? lazyImg(illustrationSrc, { style:`max-width:100%; max-height:${IMG_H}; object-fit:contain;` })
        : el('div', { style:'color:var(--c-text-mute); font-size:12px;' }, '无图像')));
  row.appendChild(el('div', {
    style:`background:#faf8f0; border:1px solid #ece6d6; border-radius:8px; height:${IMG_H}; display:flex; align-items:center; justify-content:center; overflow:hidden; cursor:zoom-in;`,
    onclick:()=>openIllustrationLightbox(img, illustrationSrc),
  }, archiveImage));

  const sideCol = el('div', { style:'display:flex; flex-direction:column; gap:12px; min-height:0;' });
  const focusCard = el('div', { style:'border:1px solid #d7e3f4; background:#fbfdff; border-radius:8px; padding:14px 16px; overflow:auto; flex:1 1 auto;' });
  const focusGrid = el('div', { style:'display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px 14px;' });
  const focusRow = (label, value) => {
    const cell = el('div', { style:'min-width:0;' });
    cell.appendChild(el('div', { style:'font-size:12.5px; color:#7b8ba1; margin-bottom:3px;' }, label));
    cell.appendChild(el('div', { style:'font-size:14.5px; color:#203246; font-weight:600; line-height:1.6; word-break:break-word;' }, value || '—'));
    return cell;
  };
  focusGrid.appendChild(focusRow('插图类型', ann.academicClass ? ann.academicClass + (ann.academicSubclass ? ' · ' + ann.academicSubclass : '') : '—'));
  focusGrid.appendChild(focusRow('主要对象', ann.subject || '—'));
  // 审核证据层：图文互证（一致/存疑/矛盾，带颜色区分），与审核重点卡口径一致。
  const _bVerdict = ann.aiVerdict || '';
  const _bVerdictColor = _bVerdict === '一致' ? '#2f7d4f'
    : _bVerdict === '矛盾' ? '#b03a2e'
    : _bVerdict === '存疑' ? '#9a6a2a'
    : '#7b8ba1';
  const _bvRow = el('div', { style:'min-width:0;' });
  _bvRow.appendChild(el('div', { style:'font-size:12.5px; color:#7b8ba1; margin-bottom:3px;' }, '图文互证'));
  _bvRow.appendChild(el('div', { style:`font-size:14.5px; font-weight:700; line-height:1.6; color:${_bVerdictColor};` }, _bVerdict || '—'));
  focusGrid.appendChild(_bvRow);
  focusCard.appendChild(focusGrid);
  // 证据层：画面描述（通栏单行；绘制风格/保存状态等研究扩展不在此堆叠）。
  const _bDesc = getVisualDescription(ann);
  if (_bDesc) {
    const bDescRow = el('div', { style:'margin-top:12px; padding-top:10px; border-top:1px dashed #d7e3f4;' });
    bDescRow.appendChild(el('div', { style:'font-size:12.5px; color:#7b8ba1; margin-bottom:3px;' }, '画面描述'));
    bDescRow.appendChild(el('div', { style:'font-size:14px; color:#203246; line-height:1.7; word-break:break-word;' }, _bDesc));
    focusCard.appendChild(bDescRow);
  }

  const ctBox = el('details', { open: '', style:'background:#fffbf0; border:1px solid #e8dcae; border-left:3px solid #c6a84b; border-radius:8px; overflow:hidden; flex:0 0 auto;' });
  ctBox.appendChild(el('summary', { style:'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 12px; cursor:pointer; user-select:none;' },
    el('span', { style:'font-size:12px; color:#8a7a4a; font-weight:600; letter-spacing:0.5px;' }, '本图对应原文（点击展开）'),
    el('button', { class:'icon-btn', style:'font-size:11px; padding:2px 8px;', title:'翻阅原书整页', onclick:(e)=>{ e.stopPropagation(); viewOriginalPage(img); } }, '📖 翻阅原书')));
  const ctInner = el('div', { style:'max-height:260px; overflow:auto; padding:12px 14px 16px; border-top:1px solid #ecdca5; font-size:16px; line-height:2; color:#3a3020; white-space:pre-wrap; word-break:break-word; font-family:var(--f-serif);' });
  if (ct) ctInner.appendChild(document.createTextNode(ct));
  else ctInner.appendChild(el('div', { style:'font-size:14px; color:#b3a980;' }, '（暂无对应原文，待 AI 重标或人工补充）'));
  ctBox.appendChild(ctInner);
  sideCol.appendChild(focusCard);
  sideCol.appendChild(ctBox);
  row.appendChild(sideCol);
  card.appendChild(row);
  return card;
}

function renderHomeView() {
  const scroll = $('#main-scroll');
  scroll.classList.add('home-scroll');
  scroll.innerHTML = '';
  const stage = el('div', { class: 'home-stage' });
  stage.appendChild(el('div', { class: 'home-kicker' }, '中医古籍插图整理工作台'));
  const hero = el('div', { class: 'home-hero' });
  hero.appendChild(el('div', { class: 'home-actions' },
    el('button', { class: 'btn primary', onclick: openBookImport }, '📖 导入书籍'),
    el('button', { class: 'btn', onclick: () => navigateTo('annotate', { leftTab: 'books' }) }, '进入书籍列表'),
  ));

  const booksWrap = el('div', { class: 'home-books' });

  // 头部：标题 + 书本数 + 列表按钮
  const listBtn = el('button', { class: 'home-list-btn', title: '切换到书籍列表',
    onclick: () => navigateTo('annotate', { leftTab: 'books' })   // 离开首页，左侧面板才会显示
  }, '📋 列表');
  booksWrap.appendChild(el('div', { class: 'home-books-head' },
    el('h3', null, '书籍'),
    listBtn
  ));

  if (!state.books.length) {
    booksWrap.appendChild(el('div', { class: 'home-empty' },
      '当前还没有导入书籍。', el('br'),
      '点击上方「导入书籍」开始建立全书页面索引，再按需识别插图与进入标注。'));
  } else {
    // ── 分组 ──────────────────────────────────────────────
    const groups   = {};   // groupId → { title, books[] }
    const ungrouped = [];
    for (const book of state.books) {
      if (book.groupId) {
        if (!groups[book.groupId]) groups[book.groupId] = { title: book.groupTitle || book.groupId, books: [] };
        groups[book.groupId].books.push(book);
      } else {
        ungrouped.push(book);
      }
    }

    function makeBookCard(book) {
      const pageCount  = getBookPages(book).length;
      const queueCount = state.illustrations.filter(i => i?.pdfSource?.bookId === book.id).length;

      const card = el('div', { class: 'home-book-card', onclick: () => openBookLandingPage(book.id) });
      card.appendChild(el('button', { class: 'home-book-card-edit', title: '书籍操作',
        onclick: (e) => { e.stopPropagation(); openHomeBookCardMenu(book); }
      }, '编辑'));
      card.appendChild(el('div', { class: 'home-book-title' }, `📗 ${bookDisplayTitle(book)}`));
      card.appendChild(el('div', { class: 'home-book-meta' },
        el('span', { class: 'home-book-pill' }, `${pageCount} 页`),
        el('span', { class: 'home-book-pill' }, `${queueCount} 个插图页`),
        book.dynasty ? el('span', { class: 'home-book-pill' }, book.dynasty) : null
      ));
      return card;
    }

    function makeGroupHomeCard(groupId, group) {
      const bookIds = new Set(group.books.map(b => b.id));
      const pageCount = group.books.reduce((sum, book) => sum + getBookPages(book).length, 0);
      const groupIllusts = state.illustrations.filter(img => bookIds.has(img?.pdfSource?.bookId));
      const queueCount = groupIllusts.length;

      const card = el('div', { class: 'home-book-card group', onclick: () => openGroupOverview(groupId) });
      card.appendChild(el('button', { class: 'home-book-card-edit', title: '书组管理',
        onclick: (e) => { e.stopPropagation(); openGroupOverview(groupId); }
      }, '管理'));
      card.appendChild(el('div', { class: 'home-book-title' }, `📚 ${group.title}`));
      card.appendChild(el('div', { class: 'home-book-meta' },
        el('span', { class: 'home-book-pill' }, `${group.books.length} 卷`),
        el('span', { class: 'home-book-pill' }, `${pageCount} 页`),
        el('span', { class: 'home-book-pill' }, `${queueCount} 个插图页`)
      ));
      return card;
    }

    // ── 书组与普通书籍统一卡片；首页不展开组内卷册 ───────────────
    const grid = el('div', { class: 'home-book-grid' });
    for (const [groupId, group] of Object.entries(groups)) {
      grid.appendChild(makeGroupHomeCard(groupId, group));
    }
    ungrouped.forEach(b => grid.appendChild(makeBookCard(b)));
    if (grid.children.length) {
      booksWrap.appendChild(grid);
    }
  }
  hero.appendChild(booksWrap);
  stage.appendChild(hero);
  scroll.appendChild(stage);
}

/* ============================================================
   REVIEW QUEUE VIEW
   ============================================================ */
/**
 * 在变更状态前先记住审核队列里的下一个目标，避免保存完成后因当前项已出队而跳回队首。
 */
function getReviewQueueAdvanceTargetId(currentId) {
  const reviewItems = getReviewQueueItems();
  if (!reviewItems.length) return null;
  const pos = reviewItems.findIndex(i => i.id === currentId);
  if (pos < 0) return reviewItems[0]?.id || null;
  return reviewItems[pos + 1]?.id || reviewItems[pos - 1]?.id || null;
}

/**
 * 审核队列公共"处理完一条"收尾：自动跳下一条，或在最后一条时退出。
 * 由横幅按钮和右侧表单按钮共用，保证两处语义一致。
 */
function _reviewQueueDone(doneId, preferredNextId = null) {
  if (state.mainView !== 'review-queue') return;
  const reviewItems = getReviewQueueItems();
  const next = (preferredNextId ? reviewItems.find(i => i.id === preferredNextId) : null)
    || reviewItems[0]
    || null;
  if (!next) {
    exitReviewMode();
  } else {
    state.selectedId = next.id;
    persist();
    renderAll();
  }
}

async function commitReviewQueueDecision(id, action) {
  if (state.mainView !== 'review-queue') {
    if (action === 'confirm') return await confirmAnnotation(id, { blocking: true });
    return await setStatus(id, action, { blocking: true });
  }

  const nextId = getReviewQueueAdvanceTargetId(id);
  const ok = action === 'confirm'
    ? await confirmAnnotation(id, { skipRender: true })
    : await setStatus(id, action, { skipRender: true });
  if (ok) _reviewQueueDone(id, nextId);
  return ok;
}

function enterReviewMode() {
  const reviewItems = getReviewQueueItems();
  if (!reviewItems.length) { toast('当前没有待审核的图片', 'warn'); return; }
  const reviewBookId = state.currentBookId || getCurrent()?.pdfSource?.bookId || '';
  if (reviewBookId) state.imageBookFilter = reviewBookId;
  const scopedReviewItems = reviewBookId
    ? reviewItems.filter(item => item.pdfSource?.bookId === reviewBookId)
    : reviewItems;
  const hasScopedReviewItems = scopedReviewItems.length > 0;
  const queueItems = hasScopedReviewItems ? scopedReviewItems : reviewItems;
  if (reviewBookId && !hasScopedReviewItems) state.imageBookFilter = 'all';
  // 保存进入前的上下文，退出时恢复（含 book/page，便于退回详情页时校验通过）
  state._reviewEntryCtx = {
    mainView:        state.mainView,
    leftTab:         state.leftTab,
    filter:          state.filter,
    imageBookFilter: state.imageBookFilter,
    selectedId:      state.selectedId,
    rightTab:        state.rightTab,
    currentBookId:   state.currentBookId,
    currentBookPage: state.currentBookPage,
  };
  const cur = getCurrent();
  const curInQueue = cur && cur.status === 'review' && shouldUseIllustrationRecord(cur)
    && (!(reviewBookId && hasScopedReviewItems) || cur.pdfSource?.bookId === reviewBookId);
  const selectedId = curInQueue ? state.selectedId : queueItems[0].id;
  $('#filter').value = 'review';
  navigateTo('review-queue', { leftTab: 'images', filter: 'review', imageBookFilter: state.imageBookFilter, rightTab: 'form', selectedId });
}

function exitReviewMode() {
  const ctx = state._reviewEntryCtx;
  const targetView = ctx?.mainView || 'home';
  const params = { filter: ctx?.filter || 'all', imageBookFilter: ctx?.imageBookFilter || state.imageBookFilter || 'all', leftTab: state.leftTab || 'books' };
  if (ctx) {
    params.selectedId = ctx.selectedId || state.selectedId;
    params.rightTab   = ctx.rightTab   || state.rightTab || 'form';
    // 还原进入审核前的书/页，使退回 page-detail 时前置校验能通过
    if (ctx.currentBookId !== undefined)   state.currentBookId   = ctx.currentBookId;
    if (ctx.currentBookPage !== undefined) state.currentBookPage = ctx.currentBookPage;
    state._reviewEntryCtx = null;
  }
  $('#filter').value = params.filter;
  navigateTo(targetView, params);
}

function selectAndReview(id) {
  navigateTo('review-queue', { selectedId: id, rightTab: 'form' });
}

/* ============================================================
   RENDER: 批量标注监控视图
   ============================================================ */
function renderBatchMonitorView() {
  const scroll = $('#main-scroll');
  scroll.innerHTML = '';
  const wrap = el('div', { class: 'bmon-wrap' });
  scroll.appendChild(wrap);

  const job = _batchJob;

  setMainHeader(el('div', { class: 'crumb-bar' },
    renderReturnButton(),
    el('span', { style:'font-weight:600;' }, '⚡ 标注队列')
  ));

  // ── 标题 ──────────────────────────────────────────────────
  wrap.appendChild(el('div', { class: 'bmon-title' }, '⚡ 标注队列'));
  wrap.appendChild(el('div', { class: 'bmon-subtitle' },
    job ? `批次开始：${job.startedAt.toLocaleTimeString()} · ${job.targets.length} 张任务` : '当前没有进行中的批次。'));

  // ── 当前批次状态卡 ─────────────────────────────────────────
  if (job) {
    const pct = Math.round(job.completed / Math.max(1, job.targets.length) * 100);
    const statusLabel = job.cancelled ? '已取消' : job.paused ? '⏸ 已暂停' : `⚙ 标注中（并发 ${job.concurrency}）`;
    const card = el('div', { class: 'bmon-job-card' });

    card.appendChild(el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' },
      el('span', { style: 'font-size:14px; font-weight:600;' }, statusLabel),
      el('span', { style: 'font-size:13px; color:var(--c-text-soft);' },
        `完成 ${job.completed} · 失败 ${job.failed} · 跳过 ${job.skipIds.size} · 剩余 ${Math.max(0, job.targets.length - job.cursor)}`),
    ));

    card.appendChild(el('div', { class: 'bmon-job-bar-wrap' },
      el('div', { class: 'bmon-job-bar' },
        el('div', { class: 'bmon-job-bar-fill', style: `width:${pct}%` }),
      ),
      el('div', { class: 'bmon-job-stat' }, `${pct}%`),
    ));

    const acts = el('div', { class: 'bmon-job-actions' });
    if (!job.cancelled) {
      if (job.paused) {
        acts.appendChild(el('button', { class: 'btn primary', onclick: () => { batchResume(); renderBatchMonitorView(); } }, '▶ 继续'));
      } else {
        acts.appendChild(el('button', { class: 'btn', onclick: () => { batchPause(); renderBatchMonitorView(); } }, '⏸ 暂停'));
      }
      acts.appendChild(el('button', { class: 'btn danger-ghost', onclick: async () => {
        const ok = await openConfirm('确认取消当前批量标注？已完成的记录不受影响。');
        if (ok) { batchCancel(); renderBatchMonitorView(); }
      } }, '✕ 取消批次'));
    }
    card.appendChild(acts);
    wrap.appendChild(card);
  }

  // ── 图像列表 ───────────────────────────────────────────────
  // 筛选条件
  const FILTERS = [
    { k: 'all',     label: '全部' },
    { k: 'running', label: '标注中' },
    { k: 'todo',    label: '待标注' },
    { k: 'review',  label: '待确认' },
    { k: 'ok',      label: '已确认' },
  ];
  if (!state._bmonFilter) state._bmonFilter = 'all';
  const filterBar = el('div', { class: 'bmon-filters' });
  filterBar.appendChild(el('span', { style: 'font-size:12px; color:var(--c-text-mute);' }, '筛选：'));
  FILTERS.forEach(f => {
    filterBar.appendChild(el('button', {
      class: 'btn' + (state._bmonFilter === f.k ? ' primary' : ''),
      style: 'font-size:12px; padding:3px 10px;',
      onclick: () => { state._bmonFilter = f.k; renderBatchMonitorView(); },
    }, f.label));
  });
  // 书籍筛选
  const bookIds = [...new Set(state.illustrations.map(i => i.pdfSource?.bookId).filter(Boolean))];
  if (bookIds.length > 1) {
    filterBar.appendChild(el('span', { style: 'font-size:12px; color:var(--c-text-mute); margin-left:8px;' }, '书籍：'));
    const bkSel = el('select', { style: 'font-size:12px; padding:3px 8px; border-radius:6px; border:1px solid var(--c-border);',
      onchange: e => { state._bmonBook = e.target.value; renderBatchMonitorView(); } });
    bkSel.appendChild(el('option', { value: '' }, '全部'));
    bookIds.forEach(id => {
      const b = getBook(id);
      const opt = el('option', { value: id }, b?.title || id);
      if (state._bmonBook === id) opt.selected = true;
      bkSel.appendChild(opt);
    });
    filterBar.appendChild(bkSel);
  }
  wrap.appendChild(filterBar);

  // ── 图像数据（按书分组）──────────────────────────────────────
  const ST_CLASS = { running: 'st-running', todo: 'st-todo', review: 'st-review', ok: 'st-ok', bad: 'st-bad' };
  const ST_LABEL = { running: '标注中', todo: '待标注', review: '待确认', ok: '已确认', bad: '已跳过' };

  function makeImgRow(img) {
    const book = img.pdfSource?.bookId ? getBook(img.pdfSource.bookId) : null;
    const isInBatch = job && job.targets.some(t => t.id === img.id);
    const isSkipped = job && job.skipIds.has(img.id);
    const statusCls = ST_CLASS[img.status] || 'st-todo';
    const tr = el('tr');
    const td0 = el('td');
    if (img.url || img.dataUrl) {
      const src = img.url || img.dataUrl;
      td0.appendChild(el('button', {
        type: 'button',
        title: '点击查看插图详情',
        style: 'padding:0; border:0; background:transparent; cursor:zoom-in; display:inline-flex;',
        onclick: (e) => {
          e.stopPropagation();
          openQueueImageDetail(img);
        },
      }, el('img', { src, style: 'width:52px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--c-border); display:block;' })));
    }
    tr.appendChild(td0);
    tr.appendChild(el('td', null, el('span', { style: 'font-size:13px;' }, img.name || img.id)));
    tr.appendChild(el('td', { style: 'font-size:12px;color:var(--c-text-soft);' },
      img.pdfSource?.pageNum ? `第 ${img.pdfSource.pageNum} 页` : (img.page || '')));
    const stPill = el('span', { class: `st-pill ${statusCls}` },
      img.status === 'running' ? '⟳ 标注中…' : ST_LABEL[img.status] || img.status);
    if (isSkipped) stPill.textContent = '⏭ 已跳过';
    tr.appendChild(el('td', null, stPill));
    tr.appendChild(el('td', { style: 'font-size:11.5px;color:var(--c-text-mute);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, img.modelUsed || '—'));
    const actTd = el('td');
    const actWrap = el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;' });
    if (img.status !== 'running')
      actWrap.appendChild(el('button', { class: 'btn', style: 'font-size:11px;padding:3px 8px;', title: '单张重新标注',
        onclick: () => { runAI(img.id); setTimeout(() => renderBatchMonitorView(), 300); } }, '▶ 标注'));
    if (isInBatch && !isSkipped && img.status === 'todo')
      actWrap.appendChild(el('button', { class: 'btn', style: 'font-size:11px;padding:3px 8px;',
        onclick: () => { batchSkipItem(img.id); renderBatchMonitorView(); } }, '⏭ 跳过'));
    if (['review', 'ok', 'bad'].includes(img.status))
      actWrap.appendChild(el('button', { class: 'btn', style: 'font-size:11px;padding:3px 8px;', title: '重置为待标注',
        onclick: async () => {
          if (!await openConfirm(`将"${img.name}"重置为待标注？将清除现有标注。`)) return;
          img.status = 'todo'; img.aiDraft = null; img.annotation = null;
          img.reviewDiff = {}; img.modelUsed = '';
          persist(); renderBatchMonitorView();
        } }, '↺ 重置'));
    if (img.status !== 'running')
      actWrap.appendChild(el('button', { class: 'btn danger-ghost', style: 'font-size:11px;padding:3px 8px;', title: '从队列删除这张（误入的插图）',
        onclick: async () => {
          if (!await openConfirm(`从标注队列删除"${img.name || img.id}"？\n会移除该插图记录${isSplitIllustrationRecord(img) ? '（单个图项）' : '（含该页候选）'}，不可撤销。`)) return;
          deleteIllustFromQueue(img);
          renderBatchMonitorView();
          toast('已从队列删除', 'success');
        } }, '🗑 删除'));
    actTd.appendChild(actWrap);
    tr.appendChild(actTd);
    return tr;
  }

  // 按书分组
  const allImgs = state.illustrations.filter(shouldUseIllustrationRecord);
  const groupedByBook = {};
  const noBookImgs = [];
  for (const img of allImgs) {
    const bid = img.pdfSource?.bookId;
    if (bid) { (groupedByBook[bid] = groupedByBook[bid] || []).push(img); }
    else noBookImgs.push(img);
  }
  // 如有书籍筛选，只保留选中书
  const booksToRender = state._bmonBook ? [state._bmonBook] : Object.keys(groupedByBook);

  let totalRendered = 0;
  for (const bid of booksToRender) {
    const book = getBook(bid);
    const allBookImgs = groupedByBook[bid] || [];
    const filtered = state._bmonFilter && state._bmonFilter !== 'all'
      ? allBookImgs.filter(i => i.status === state._bmonFilter) : allBookImgs;
    if (filtered.length === 0) continue;
    totalRendered += filtered.length;

    const okCnt  = allBookImgs.filter(i => i.status === 'ok').length;
    const revCnt = allBookImgs.filter(i => i.status === 'review').length;
    const todoCnt= allBookImgs.filter(i => i.status === 'todo' || i.status === 'running').length;
    const pct    = allBookImgs.length > 0 ? Math.round(okCnt / allBookImgs.length * 100) : 0;

    // 书籍分组标题
    const groupHead = el('div', { class: 'bmon-book-group-head',
      onclick: () => openBookLandingPage(bid), title: '打开书籍主页' });
    groupHead.appendChild(el('span', { class: 'bmon-book-name' }, `📗 ${book?.title || bid}`));
    const badges = el('div', { class: 'bmon-book-badges' });
    if (okCnt)   badges.appendChild(el('span', { class: 'st-pill st-ok',     style: 'font-size:11px;padding:2px 7px;' }, `✓ ${okCnt}`));
    if (revCnt)  badges.appendChild(el('span', { class: 'st-pill st-review', style: 'font-size:11px;padding:2px 7px;' }, `审 ${revCnt}`));
    if (todoCnt) badges.appendChild(el('span', { class: 'st-pill st-todo',   style: 'font-size:11px;padding:2px 7px;' }, `待 ${todoCnt}`));
    badges.appendChild(el('span', { style: 'font-size:11px;color:var(--c-text-mute);' }, `${pct}%`));
    groupHead.appendChild(badges);
    const progBar = el('div', { class: 'bmon-book-prog-bar' },
      el('div', { class: 'bmon-book-prog-fill', style: `width:${pct}%` }));
    groupHead.appendChild(progBar);
    wrap.appendChild(groupHead);

    // 图像表格
    const table = el('table', { class: 'bmon-table' });
    table.appendChild(el('thead', null, el('tr', null,
      el('th', null, '插图'), el('th', null, '名称'), el('th', null, '页码'),
      el('th', null, '状态'), el('th', null, '模型'), el('th', null, '操作'),
    )));
    const tbody = el('tbody');
    filtered.forEach(img => tbody.appendChild(makeImgRow(img)));
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  // 无书归属的图像
  if (!state._bmonBook) {
    const freeImgs = state._bmonFilter && state._bmonFilter !== 'all'
      ? noBookImgs.filter(i => i.status === state._bmonFilter) : noBookImgs;
    if (freeImgs.length > 0) {
      totalRendered += freeImgs.length;
      wrap.appendChild(el('div', { class: 'bmon-book-group-head', style: 'cursor:default;' },
        el('span', { class: 'bmon-book-name' }, '📎 其他图片')));
      const table = el('table', { class: 'bmon-table' });
      table.appendChild(el('thead', null, el('tr', null,
        el('th', null, '插图'), el('th', null, '名称'), el('th', null, '页码'),
        el('th', null, '状态'), el('th', null, '模型'), el('th', null, '操作'),
      )));
      const tbody = el('tbody');
      freeImgs.forEach(img => tbody.appendChild(makeImgRow(img)));
      table.appendChild(tbody);
      wrap.appendChild(table);
    }
  }

  if (totalRendered === 0)
    wrap.appendChild(el('div', { class: 'bmon-empty' }, '暂无符合条件的记录'));
}

function renderReviewQueueView() {
  const scroll = $('#main-scroll');
  scroll.innerHTML = '';

  const reviewItems = getReviewQueueItems();
  let img = getCurrent();
  if (!img || img.status !== 'review' || !shouldUseIllustrationRecord(img)) {
    img = reviewItems[0] || null;
    if (img) state.selectedId = img.id;
  }
  if (!img) {
    scroll.appendChild(el('div', { class: 'placeholder-state' },
      el('div', { class: 'glyph' }, '卷'),
      el('div', { class: 'title' }, '请从左侧选择一张图片'),
    ));
    return;
  }

  // 面包屑
  if (img.pdfSource?.bookId && Number.isFinite(Number(img.pdfSource.pageNum))) {
    const book = getBook(img.pdfSource.bookId);
    if (book) {
      setMainHeader(
        buildBreadcrumbBar([
          { label: book.title, onClick: () => openGallery(book.id, 'pages') },
          { label: `第 ${img.pdfSource.pageNum} 页`, onClick: () => openPageDetail(book.id, img.pdfSource.pageNum, 'pages') },
          { label: '审核台', current: true },
        ], renderReturnButton()),
      );
      scroll.appendChild(el('div', { class: 'step-bar-content' }, buildStepBar(4, book)));
    }
  }

  // 待审核导航栏（有待审核项时显示）
  const reviewIdx = reviewItems.findIndex(i => i.id === img.id);
  const prevReview = reviewItems[reviewIdx - 1];
  const nextReview = reviewItems[reviewIdx + 1];
  if (reviewItems.length > 0) {
    const bannerActions = el('div', { class: 'review-banner-actions' },
      el('button', {
        class: 'btn', disabled: prevReview ? null : '',
        onclick: () => prevReview && selectAndReview(prevReview.id),
      }, '← 上一待审'),
      el('button', {
        class: 'btn', disabled: nextReview ? null : '',
        onclick: () => nextReview && selectAndReview(nextReview.id),
      }, '下一待审 →'),
    );
    if (img.status === 'review') {
      bannerActions.appendChild(el('button', {
        class: 'btn success',
        onclick: async () => { await commitReviewQueueDecision(img.id, 'confirm'); },
      }, '✓ 确认'));
    }
    bannerActions.appendChild(el('button', { class: 'btn', onclick: exitReviewMode }, '✕ 退出审核'));
    scroll.appendChild(el('div', { class: 'review-banner' },
      el('div', { class: 'review-banner-title' },
        '🔍 审核',
        el('span', { class: 'review-banner-count' },
          `${reviewIdx >= 0 ? reviewIdx + 1 + ' / ' : ''}${reviewItems.length} 待审`
        ),
        el('span', { style: 'font-size:11px; color:var(--c-text-mute); margin-left:10px; font-weight:400;' },
          'Enter 确认 · N 下一条'),
      ),
      bannerActions,
    ));
  }

  // --- Image stage：左图右文并排（图文互证对照，利用两侧留白）---
  const displayItems = getDisplayIllustrationItems(img);
  const isImageMergeDisplay = Array.isArray(getAnnotationOwnerRecord(img)?.imageMerge?.items)
    && getAnnotationOwnerRecord(img).imageMerge.items.length > 1;
  const reviewImgSrc = getIllustrationViewUrl(displayItems[0], 1400);
  const _imgEl = isImageMergeDisplay
    ? renderMergedIllustrationImage(img, {
        maxLong: 1800,
        alt: `${img.name || _showcaseName(img)}（合并图）`,
        style: 'max-width:100%; max-height:min(680px, calc(100vh - 250px)); width:auto; height:auto; object-fit:contain; display:block;',
      })
    : attachImgRetry(el('img', { src: reviewImgSrc, alt: img.name }), reviewImgSrc);
  const { toggleBtn: _enhToggle, enhBar: _enhBar } = buildImgEnhanceSection(() => _imgEl);

  // 左列：书页图 + 操作 + 导航
  const imgCol = el('div', { class: 'review-img-col' });
  const _book = getBook(img?.pdfSource?.bookId);
  imgCol.appendChild(el('div', { style: 'margin-bottom:8px;' },
    el('div', { style:'font-family:var(--f-serif); font-size:16px; font-weight:600; color:var(--c-text);' }, renderNameWithPinyin(_showcaseName(img), displayNamePinyin(img))),
    el('div', { style:'font-family:var(--f-mono); font-size:12px; color:#9a6a2a; margin-top:2px; user-select:all;', title:'结构化编号（可复制）' }, _showcaseId(img, _book))));
  imgCol.appendChild(el('div', { class: 'img-source' },
    el('div', { class: 'src-text' }, `${img.source || ''} · ${img.page || ''}`),
    el('div', { style: 'display:flex; gap:6px; align-items:center;' },
      _enhToggle,
      el('button', { class: 'icon-btn', onclick: () => openIllustrationLightbox(img, reviewImgSrc) }, '🔍 放大查看'),
    ),
  ));
  const imgFrame = el('div', { class: 'img-frame', style: displayItems.length > 1 ? 'overflow:auto; padding:10px;' : '' });
  if (displayItems.length > 1 && isImageMergeDisplay) {
    imgFrame.appendChild(el('div', { class: 'merged-composite-frame' }, _imgEl));
  } else if (displayItems.length > 1) {
    const stack = el('div', { style: 'display:flex; flex-direction:column; gap:12px; align-items:center; width:100%;' });
    displayItems.forEach((item, idx) => {
      const src = getIllustrationViewUrl(item, 1400);
      const figureImg = attachImgRetry(el('img', {
        src,
        alt: item.name || item.id,
        style: 'max-width:100%; max-height:420px; object-fit:contain; display:block;'
      }), src);
      stack.appendChild(el('div', { style: 'display:flex; flex-direction:column; gap:6px; align-items:center; width:100%;' },
        el('div', { style: 'font-size:12px; color:#7b8ba1; font-weight:600;' }, `连图 ${idx + 1} · 第 ${item?.pdfSource?.pageNum || '—'} 页`),
        figureImg,
      ));
    });
    imgFrame.appendChild(stack);
  } else {
    imgFrame.appendChild(_imgEl);
  }
  imgCol.appendChild(imgFrame);
  imgCol.appendChild(_enhBar);
  const visibleIllustrations = state.mainView === 'review-queue' ? reviewItems : getVisibleIllustrationRecords();
  const _idx = visibleIllustrations.findIndex(item => item.id === img.id);
  imgCol.appendChild(el('div', { class: 'img-nav' },
    el('button', { onclick: () => goRel(-1), disabled: _idx === 0 ? '' : null }, '← 上一张'),
    el('span', { class: 'img-counter' }, `${_idx + 1} / ${visibleIllustrations.length}`),
    el('button', { onclick: () => goRel(1), disabled: _idx === visibleIllustrations.length - 1 ? '' : null }, '下一张 →'),
  ));

  const ann = img.annotation || img.aiDraft || {};

  // 审核重点卡：放在右列，原位置与「原文对照」互换
  const summaryCard = el('div', {
    class: 'status-card review-text-col review-focus-card',
    style: 'border:1px solid #d7e3f4; background:#fbfdff; display:flex; flex-direction:column;'
  });
  summaryCard.appendChild(el('div', {
    style: 'font-size:16px; font-weight:700; color:#28476b; margin-bottom:8px;'
  }, '审核重点'));

  const summaryGrid = el('div', {
    style: 'display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px 14px;'
  });
  const summaryRow = (label, value) => {
    const row = el('div', { style: 'min-width:0;' });
    row.appendChild(el('div', { style: 'font-size:12.5px; color:#7b8ba1; margin-bottom:3px;' }, label));
    row.appendChild(el('div', {
      style: 'font-size:14.5px; color:#203246; font-weight:600; line-height:1.6; word-break:break-word;'
    }, value || '—'));
    return row;
  };
  summaryGrid.appendChild(summaryRow('插图类型', ann.type || '—'));
  summaryGrid.appendChild(summaryRow('具体分类', ann.academicSubclass || '—'));
  summaryGrid.appendChild(summaryRow('主要描绘对象', ann.subject || '—'));
  // 审核证据层：图文互证（一致/存疑/矛盾，带颜色区分），审核核心判据。
  const _verdict = ann.aiVerdict || '';
  const _verdictColor = _verdict === '一致' ? '#2f7d4f'
    : _verdict === '矛盾' ? '#b03a2e'
    : _verdict === '存疑' ? '#9a6a2a'
    : '#7b8ba1';
  const _vRow = el('div', { style: 'min-width:0;' });
  _vRow.appendChild(el('div', { style: 'font-size:12.5px; color:#7b8ba1; margin-bottom:3px;' }, '图文互证'));
  _vRow.appendChild(el('div', { style: `font-size:14.5px; font-weight:700; line-height:1.6; color:${_verdictColor};` }, _verdict || '—'));
  summaryGrid.appendChild(_vRow);
  summaryCard.appendChild(summaryGrid);
  // 证据层：画面描述（通栏单行；旧研究扩展字段不再进入新版审核界面）。
  const _desc = getVisualDescription(ann);
  if (_desc) {
    const descRow = el('div', { style: 'margin-top:12px; padding-top:10px; border-top:1px dashed #d7e3f4;' });
    descRow.appendChild(el('div', { style: 'font-size:12.5px; color:#7b8ba1; margin-bottom:3px;' }, '画面描述'));
    descRow.appendChild(el('div', { style: 'font-size:14px; color:#203246; line-height:1.7; word-break:break-word;' }, _desc));
    summaryCard.appendChild(descRow);
  }

  // 原文对照：跟随审核重点放在右侧，避免在中间区域挤压插图高度。
  const textCol = el('div', { class: 'status-card', style: 'margin-top:12px; display:flex; flex-direction:column;' });
  const goTextProof = () => {
    if (!img?.pdfSource?.bookId || !Number.isFinite(Number(img?.pdfSource?.pageNum))) return;
    state._reviewEntryCtx = state._reviewEntryCtx || {
      mainView: state.mainView,
      leftTab: state.leftTab,
      rightTab: state.rightTab,
      filter: state.filter,
      galleryScope: state.galleryScope,
      pageBrowseScope: state.pageBrowseScope,
      pageDetailMode: state.pageDetailMode,
      currentBookId: state.currentBookId,
      currentBookPage: state.currentBookPage,
      selectedId: state.selectedId,
    };
    openPageDetail(img.pdfSource.bookId, Number(img.pdfSource.pageNum), 'text');
  };
  const riskNote = img.annotationEvidence?.ocrRiskNote || '';
  textCol.appendChild(el('div', { class: 'review-text-col-head', style: 'display:flex; align-items:center; justify-content:space-between; gap:8px;' },
    el('span', null, '原文对照'),
    el('div', { style: 'display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end;' },
      el('button', { class: 'icon-btn', style: 'font-size:12px; padding:3px 9px;', title: `从第 ${img?.pdfSource?.pageNum ?? ''} 页起翻阅原书整页（可 ‹ › / ←→ 翻页），核对 AI 摘录`, onclick: () => viewOriginalPage(img) }, '📖 翻阅原书'),
      img?.pdfSource?.bookId ? el('button', { class: 'icon-btn', style: 'font-size:12px; padding:3px 9px;', title: '打开本页文字校核', onclick: goTextProof }, '校核本页文字') : null
    )));
  const _ctText = (getReviewFormAnnotation(img)?.correspondingText || img.aiDraft?.correspondingText || '');
  const ctBox = el('div', { style: 'flex:1; min-height:260px; max-height:520px; display:flex; flex-direction:column; padding:14px 16px; background:#fffbf0; border:1px solid #e8dcae; border-left:3px solid #c6a84b; border-radius:6px;' });
  if (riskNote) {
    ctBox.appendChild(el('div', {
      style: 'margin-bottom:8px; padding:7px 9px; border:1px solid #ead8a4; background:#fff8e6; border-radius:7px; color:#7a5b1c; font-size:12px; line-height:1.6;'
    }, `OCR/证据风险：${riskNote}`));
  }
  ctBox.appendChild(el('div', { style: 'font-size:12px; color:#8a7a4a; font-weight:600; margin-bottom:8px; letter-spacing:0.5px;' }, '本图对应原文'));
  const ctTa = el('textarea', {
    style: 'flex:1; width:100%; box-sizing:border-box; border:1px dashed #e0d4a8; background:rgba(255,255,255,0.5); border-radius:4px; resize:vertical; outline:none; padding:8px 10px; font-size:18px; color:#3a3020; line-height:2.1; white-space:pre-wrap; word-break:break-all; font-family:var(--f-serif); min-height:240px;',
    placeholder: '（暂无对应原文，可在此手动补充/粘贴；修改先暂存，随后在右侧选择原因并保存）',
  });
  ctTa.value = _ctText;
  const ctSaveBtn = el('button', { class: 'btn', style: 'font-size:12px; padding:3px 12px;', onclick: () => { if (_saveCt()) toast('原文修改已暂存，请在右侧选择原因并保存', 'info'); } }, '暂存原文修改');
  // correspondingText 与右侧核心字段共用同一审核草稿；这里只暂存，不落正式数据。
  const _saveCt = () => {
    const v = ctTa.value;
    const cur = (getReviewFormAnnotation(img)?.correspondingText ?? img.aiDraft?.correspondingText ?? '');
    if (v === cur) return false;
    stageTrackedFieldEdit(img, 'correspondingText', cur, v, ed => { ed.correspondingText = v; });
    renderForm();
    return true;
  };
  ctTa.addEventListener('change', () => { if (_saveCt()) toast('原文修改已暂存，请在右侧选择原因并保存', 'info'); });
  ctTa.addEventListener('focus', e => { e.target._v2Before = e.target.value; });
  ctBox.appendChild(ctTa);
  ctBox.appendChild(el('div', { style: 'display:flex; justify-content:flex-end; margin-top:6px;' },
    ctSaveBtn));
  textCol.appendChild(ctBox);
  // 审核模式只保留「原文对照」，不再展示全页原文（全页文字未必对应本图，易干扰核查）

  const stage = el('div', { class: 'img-stage' });
  const stageRow = el('div', { class: 'review-stage-row' });
  const reviewSideCol = el('div', { class: 'review-side-col' });
  reviewSideCol.appendChild(summaryCard);
  reviewSideCol.appendChild(textCol);
  stageRow.appendChild(imgCol);
  stageRow.appendChild(reviewSideCol);
  stage.appendChild(stageRow);
  scroll.appendChild(stage);

  scroll.appendChild(renderAiReferencePanel(img, ann, { includeContext: false }));

  const ctxBlock = buildAiCtxRefBlock(img);
  if (ctxBlock) scroll.appendChild(ctxBlock);

}


function goRel(d) {
  const current = state.illustrations.find(i => i.id === state.selectedId) || null;
  if (state.mainView === 'review-queue') {
    const anchor = getAnnotationOwnerRecord(current);
    const queue = getReviewQueueItems();
    const idx = queue.findIndex(i => i.id === anchor?.id);
    const t = idx + d;
    if (idx < 0 || t < 0 || t >= queue.length) return;
    selectAndReview(queue[t].id);
    return;
  }
  const anchor = current && shouldUseIllustrationRecord(current)
    ? current
    : (current ? (getContinuationMeta(current).owner || current) : null);
  const visible = state.illustrations.filter(shouldUseIllustrationRecord);
  const idx = visible.findIndex(i => i.id === anchor?.id);
  const t = idx + d;
  if (idx < 0 || t < 0 || t >= visible.length) return;
  selectImage(visible[t].id);
}

/* ============================================================
   RIGHT PANEL: FORM TAB
   ============================================================ */
function assetStatusLabel(status) {
  return ({
    pending: '待审查', approved: '已通过', needs_revision: '需修改', rejected: '已拒绝', stale: '已过期',
  })[status] || '未扫描';
}

function getAssetLayerVisibility(packageInfo) {
  const key = packageInfo?.package_id || '';
  const saved = assetPanelState.visibleLayers[key] || {};
  const solo = assetPanelState.soloLayerId || '';
  return Object.fromEntries((packageInfo?.layers || []).map(layer => [
    layer.id,
    solo ? layer.id === solo : (Object.prototype.hasOwnProperty.call(saved, layer.id) ? saved[layer.id] !== false : layer.default_visible !== false),
  ]));
}

function renderAssetLayerStage(packageInfo) {
  const canvas = packageInfo.canvas || {};
  const width = Number(canvas.width) || 1;
  const height = Number(canvas.height) || 1;
  const visible = getAssetLayerVisibility(packageInfo);
  const stage = el('div', {
    class: 'asset-layer-stage',
    style: `aspect-ratio:${width}/${height};`,
    title: '按 bbox 与 z_index 临时组合；不会修改任何 PNG 或标注数据。',
  });
  for (const layer of packageInfo.layers || []) {
    if (!visible[layer.id]) continue;
    const [x, y, w, h] = assetDeskLayerBBox(layer, 'render');
    stage.appendChild(el('img', {
      src: BRIDGE_ASSET_FILE_URL(layer.file),
      style: `${assetDeskBBoxStyle(layer, canvas, 'render')} z-index:${Number(layer.z_index) || 0};`,
      alt: layer.label || layer.id,
    }));
  }
  return stage;
}

function renderAssetRecordTabs(root, img) {
  if (assetPanelState.recordId !== img.id) {
    assetPanelState.recordId = img.id;
    assetPanelState.packageId = '';
    assetPanelState.soloLayerId = '';
    assetPanelState.detailView = 'info';
  }
  const tabs = el('div', {
    style: 'padding:10px 12px 0; border-bottom:1px solid var(--c-border); display:flex; align-items:center; gap:5px; background:#fbfaf6;'
  });
  tabs.appendChild(el('span', { style: 'margin-right:auto; color:var(--c-text-mute); font-size:11px; letter-spacing:.08em;' }, '插图记录'));
  for (const [view, label] of [['info', '基础信息'], ['assets', '素材']]) {
    tabs.appendChild(el('button', {
      class: 'btn',
      style: `font-size:12px; padding:3px 9px; border-color:${assetPanelState.detailView === view ? 'var(--c-primary)' : 'var(--c-border)'}; color:${assetPanelState.detailView === view ? 'var(--c-primary)' : 'var(--c-text-soft)'}; background:${assetPanelState.detailView === view ? '#eef6fb' : '#fff'};`,
      onclick: () => { assetPanelState.detailView = view; renderForm(); },
    }, label));
  }
  root.appendChild(tabs);
}

function renderAssetTab(root, img) {
  if (!root) return;
  if (!img) {
    root.appendChild(el('div', { class: 'placeholder-state', style: 'height:200px' },
      el('div', { class: 'sub' }, '请选择一张插图后查看素材包')));
    return;
  }
  assetPanelState.recordId = img.id;
  const header = el('div', { class: 'asset-bridge-head' },
    el('div', null,
      el('div', { class: 'form-section-title', style: 'margin:0' }, '素材'),
      el('div', { class: 'asset-bridge-kicker' }, '当前插图可直接交给分层任务')),
    el('button', {
      class: 'btn', style: 'font-size:11px; padding:0 8px;',
      title: '重新读取素材目录中的分层包。',
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true; button.textContent = '扫描中…';
        try {
          const response = await fetch(BRIDGE_LAYER_PACKAGE_SCAN_URL, { method: 'POST' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.ok) throw new Error(payload.error || '扫描失败');
          toast(`已刷新 ${payload.scanned || 0} 个分层包`, 'success');
        } catch (error) {
          toast('扫描分层包失败：' + (error.message || error), 'error');
        } finally {
          renderForm();
        }
      },
    }, '刷新素材'));
  root.appendChild(header);
  const content = el('div', { class: 'status-card', style: 'margin:0;' },
    el('div', { class: 'small' }, '正在读取素材…'));
  root.appendChild(content);

  fetch(BRIDGE_ILLUSTRATION_ASSET_PACKAGES_URL(img.id))
    .then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || '素材信息读取失败');
      return payload;
    })
    .then(payload => {
      if (assetPanelState.recordId !== img.id || assetPanelState.detailView !== 'assets') return;
      content.innerHTML = '';
      const source = payload.source;
      const packages = Array.isArray(payload.packages) ? payload.packages : [];
      if (!source) {
        content.appendChild(el('div', { class: 'small', style: 'line-height:1.7;' },
          '尚无素材。先生成当前插图的正式源图，再把这条插图记录交给分层任务。'));
        content.appendChild(el('button', {
          class: 'btn primary', style: 'margin-top:10px;',
          onclick: () => exportAssetSourceRecords([img]),
        }, '生成正式源图'));
        return;
      }
      if (!assetPanelState.packageId || !packages.some(item => item.package_id === assetPanelState.packageId)) {
        assetPanelState.packageId = packages[0]?.package_id || '';
      }
      const selected = packages.find(item => item.package_id === assetPanelState.packageId) || null;
      const compare = el('div', { class: 'asset-compare' },
        el('div', { class: 'asset-preview-card' },
          el('b', null, '分层源图'),
          el('img', { src: BRIDGE_ASSET_FILE_URL(source.source_path), alt: '正式插图裁图', onclick: () => openLightbox(BRIDGE_ASSET_FILE_URL(source.source_path)) })),
        el('div', { class: 'asset-preview-card' },
          el('b', null, selected ? '素材组合预览' : '尚无素材'),
          selected
            ? el('img', { src: BRIDGE_ASSET_FILE_URL(selected.files.composite_preview), alt: '分层组合预览', onclick: () => openLightbox(BRIDGE_ASSET_FILE_URL(selected.files.composite_preview)) })
            : el('div', { class: 'small', style: 'padding:16px 8px; line-height:1.7;' }, '正式源图已就绪，等待分层任务交回素材。')),
      );
      content.appendChild(compare);
      if (!selected) return;

      const select = el('select', { style: 'width:100%; margin:2px 0 8px;', onchange: event => {
        assetPanelState.packageId = event.target.value;
        assetPanelState.soloLayerId = '';
        renderForm();
      } }, ...packages.map(item => el('option', {
        value: item.package_id,
        ...(item.package_id === selected.package_id ? { selected: '' } : {}),
      }, item.package_id)));
      content.appendChild(field('素材版本', select));
      content.appendChild(el('div', { class: 'small', style: 'margin:9px 0 4px;' },
        `画布 ${selected.canvas?.width}×${selected.canvas?.height} · ${selected.derivation?.type || '—'}`));
      content.appendChild(renderAssetLayerStage(selected));

      const layerActions = el('div', { style: 'display:flex; flex-wrap:wrap; gap:5px; margin:7px 0;' },
        el('button', { class: 'btn', style: 'font-size:11px;', onclick: () => { assetPanelState.soloLayerId = ''; assetPanelState.visibleLayers[selected.package_id] = Object.fromEntries((selected.layers || []).map(layer => [layer.id, true])); renderForm(); } }, '全部显示'),
        el('button', { class: 'btn', style: 'font-size:11px;', onclick: () => { assetPanelState.soloLayerId = ''; assetPanelState.visibleLayers[selected.package_id] = Object.fromEntries((selected.layers || []).map(layer => [layer.id, false])); renderForm(); } }, '全部隐藏'),
        el('a', { class: 'btn', style: 'font-size:11px; line-height:28px;', href: BRIDGE_ASSET_PACKAGE_DOWNLOAD_URL(payload.source_id, selected.package_id) }, '下载分层包'),
      );
      content.appendChild(layerActions);
      const visible = getAssetLayerVisibility(selected);
      for (const layer of selected.layers || []) {
        const row = el('div', { class: 'asset-layer-row' });
        row.appendChild(el('input', {
          type: 'checkbox', ...(visible[layer.id] ? { checked: '' } : {}),
          onchange: event => { assetPanelState.soloLayerId = ''; assetPanelState.visibleLayers[selected.package_id] = {...(assetPanelState.visibleLayers[selected.package_id] || {}), [layer.id]: event.target.checked}; renderForm(); },
        }));
        row.appendChild(el('div', null,
          el('b', null, layer.label || layer.id),
          el('small', null, `z=${layer.z_index} · bbox=[${(layer.bbox || []).join(', ')}] · ${layer.derivation_type}`)));
        row.appendChild(el('div', { style: 'display:flex; gap:3px;' },
          el('button', { class: 'btn', style: 'font-size:10px; padding:0 6px;', title: '仅显示这一层', onclick: () => { assetPanelState.soloLayerId = layer.id; renderForm(); } }, '独显'),
          el('a', { class: 'btn', style: 'font-size:10px; padding:0 6px; line-height:28px;', href: BRIDGE_ASSET_FILE_URL(layer.file, true), title: '下载 PNG 图层' }, '下载')));
        content.appendChild(row);
      }
    })
    .catch(error => {
      if (assetPanelState.recordId !== img.id || assetPanelState.detailView !== 'assets') return;
      content.innerHTML = '';
      content.appendChild(el('div', { class: 'small', style: 'color:var(--c-danger); line-height:1.7;' },
        '素材信息读取失败：' + (error.message || error)));
    });
}

function renderRightTab() {
  const isGallery = state.mainView === 'gallery';
  const tabsEl = document.querySelector('.pane-right .tabs');
  const bwPanel = $('#book-workspace-right');

  // 素材生产不属于标注界面；历史会话若停在 assets，一律回到基础信息。
  if (!['form', 'stats'].includes(state.rightTab)) state.rightTab = 'form';

  if (tabsEl) tabsEl.style.display = isGallery ? 'none' : '';
  document.querySelectorAll('.pane-right .tab-body').forEach(b => {
    b.style.display = isGallery ? 'none' : (b.id === 'tab-' + state.rightTab ? '' : 'none');
  });
  if (bwPanel) bwPanel.style.display = isGallery ? 'flex' : 'none';

  if (isGallery) { renderBookWorkspacePanel(); return; }

  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.rightTab));
  if (state.rightTab === 'form') renderForm();
  else renderStats();
}

function previewBookInRight(bookId) {
  state.previewBookId  = bookId;
  state.previewGroupId = null;
  state.rightTab = 'form';
  persist();
  renderRightTab();
  renderBooksList();
}

function previewGroupInRight(groupId) {
  state.previewGroupId = groupId;
  state.previewBookId  = null;
  state.rightTab = 'form';
  persist();
  renderRightTab();
  renderBooksList();
}

function openGroupOverview(groupId) {
  state.previewGroupId = groupId;
  state.previewBookId = null;
  state.currentBookId = null;
  state.currentBookPage = null;
  state.selectedId = null;
  state.mainView = 'group-overview';
  state.leftTab = 'books';
  state.rightTab = 'form';
  state.groupCollapsed = state.groupCollapsed || {};
  state.groupCollapsed[groupId] = false;
  persist();
  renderAll();
}

function toggleGroupCollapse(groupId) {
  if (!state.groupCollapsed) state.groupCollapsed = {};
  state.groupCollapsed[groupId] = !state.groupCollapsed[groupId];
  persist();
  renderBooksList();
}

async function renderBookWorkspacePanel() {
  const root = $('#book-workspace-right');
  if (!root) return;
  root.innerHTML = '';

  const book = getCurrentBook();
  if (!book) {
    root.appendChild(el('div', { class: 'placeholder-state', style: 'height:200px' },
      el('div', { class: 'sub' }, '未选择书籍')));
    return;
  }

  const pages       = getBookPages(book);
  const scanDone    = pages.filter(p => p.textAsset?.fullScanDone).length;
  const allIllust   = Array.isArray(book.illustrationPages) ? book.illustrationPages : [];
  const illustCount = allIllust.length;                          // 全部候选（含待确认）
  const confirmedCount = getConfirmedIllustrations(book).length; // 已确认
  const pendingCount   = illustCount - confirmedCount;           // 待确认
  const annCount    = state.illustrations.filter(img => img.pdfSource?.bookId === book.id).length;
  const scanJob     = bookDetectJobs[book.id];

  const wrap = el('div', { style: 'padding:14px; display:flex; flex-direction:column; gap:14px;' });

  // ── 当前选中页信息（非插图页时显示页面文字 + 切割关联） ──
  const curPageNum = state.currentBookPage;
  if (curPageNum) {
    const curPage    = getBookPageRecord(book, curPageNum);
    const isIllustP  = (book.illustrationPages || []).some(ip => Number(ip.pageNum) === Number(curPageNum));
    const curIp      = (book.illustrationPages || []).find(ip => Number(ip.pageNum) === Number(curPageNum));
    const pageDisplayText = (curPage?.textAsset?.associatedText || getEffectivePageText(curPage?.textAsset || curPage) || curPage?.text || '').trim();
    const assocNums  = Array.isArray(curIp?.textAsset?.associatedPageNums) ? curIp.textAsset.associatedPageNums : [];

    const pageBlock = el('div', { style: 'background:#f7f9fc; border:1px solid var(--c-border); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;' });
    pageBlock.appendChild(el('div', { style: 'font-size:12px; font-weight:600; color:var(--c-text);' },
      `第 ${curPageNum} 页  ${isIllustP ? '🖼 插图页' : '📝 文字页'}`));

    if (assocNums.length) {
      const assocLabel = assocNums.length <= 5
        ? assocNums.map(n => `第${n}页`).join('、')
        : `第${assocNums[0]}–${assocNums[assocNums.length - 1]}页（共${assocNums.length}页）`;
      pageBlock.appendChild(el('div', { style: 'font-size:11px; color:#7a5c10; background:#fffbf0; border-radius:4px; padding:2px 6px;' },
        `📄 图文切割关联：${assocLabel}`));
    } else if (isIllustP) {
      pageBlock.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute);' }, '📄 尚未运行图文切割'));
    }

    if (pageDisplayText) {
      const textDiv = el('div', { style: 'font-size:12px; color:var(--c-text); line-height:1.8; white-space:pre-wrap; font-family:var(--f-serif); max-height:200px; overflow-y:auto; background:#fff; border:1px solid var(--c-border); border-radius:4px; padding:6px 8px;' });
      textDiv.textContent = pageDisplayText;
      pageBlock.appendChild(textDiv);
    } else {
      pageBlock.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute);' }, '该页暂无识别文字'));
    }
    wrap.appendChild(pageBlock);
  }

  // ── 封面 + 书籍信息 ──
  const coverWrap = el('div', { style: 'width:100%; max-height:180px; background:#f0ece4; border-radius:6px; overflow:hidden; display:flex; align-items:center; justify-content:center;' });
  const loadingEl = el('div', { style: 'font-size:12px; color:#aaa;' }, '封面加载中…');
  coverWrap.appendChild(loadingEl);
  wrap.appendChild(coverWrap);
  // ── 统计卡片 2×2 ──
  const mkCard = (label, val, note, color) => el('div', {
    style: 'background:var(--c-bg); border:1px solid var(--c-border); border-radius:6px; padding:10px 12px;'
  },
    el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:2px;' }, label),
    el('div', { style: `font-size:20px; font-weight:700; color:${color || 'var(--c-text)'};` }, String(val)),
    note ? el('div', { style: 'font-size:11px; color:var(--c-text-soft); margin-top:2px;' }, note) : null,
  );

  const grid = el('div', { style: 'display:grid; grid-template-columns:1fr 1fr; gap:8px;' });
  grid.appendChild(mkCard('总页数', pages.length || book.totalPages || '—', ''));
  grid.appendChild(mkCard('已扫描',
    scanDone,
    scanJob?.running ? `${getScanJobLabel(scanJob)} ${scanJob.current}/${scanJob.total}` : scanDone === pages.length && pages.length > 0 ? '已全部完成' : `剩余 ${pages.length - scanDone} 页`,
    scanDone > 0 ? 'var(--c-success)' : 'var(--c-text-mute)',
  ));
  grid.appendChild(mkCard('已确认插图', confirmedCount,
    pendingCount > 0 ? `待确认 ${pendingCount}` : '全部已确认',
    confirmedCount > 0 ? 'var(--c-primary)' : 'var(--c-text-mute)'));
  grid.appendChild(mkCard('已标注', annCount, '', annCount > 0 ? 'var(--c-primary)' : 'var(--c-text-mute)'));
  wrap.appendChild(grid);

  // ── 扫描进度条（运行中才显示）──
  if (scanJob?.running && scanJob.total > 0) {
    const pct = Math.round((scanJob.current / scanJob.total) * 100);
    const bar = el('div');
    bar.appendChild(el('div', { style: 'font-size:12px; color:var(--c-text-soft); margin-bottom:5px;' },
      `${getScanJobLabel(scanJob)}中…  ${scanJob.current}/${scanJob.total} 页，新增插图 ${scanJob.newIllust ?? 0}`));
    const track = el('div', { style: 'height:6px; background:var(--c-border); border-radius:3px; overflow:hidden;' });
    track.appendChild(el('div', { style: `height:100%; width:${pct}%; background:var(--c-primary); border-radius:3px;` }));
    bar.appendChild(track);
    wrap.appendChild(bar);
  }

  // ── 插图候选列表 ──────────────────────────────────────────────
  const illustPages = Array.isArray(book.illustrationPages) ? [...book.illustrationPages] : [];
  // ── 插图页列表（候选 + 已确认统一管理）──────────────────────────────
  const pending   = illustPages.filter(p => !p.confirmed &&
    !state.illustrations.find(img => img.pdfSource?.bookId === book.id && Number(img.pdfSource?.pageNum) === Number(p.pageNum)));
  const confirmed = illustPages.filter(p => p.confirmed ||
    !!state.illustrations.find(img => img.pdfSource?.bookId === book.id && Number(img.pdfSource?.pageNum) === Number(p.pageNum)));

  function makeIllustRow(ip, isConfirmed) {
    const livePage = getBookPageRecord(book, ip.pageNum) || ip;
    const textFull = (getEffectivePageText(livePage.textAsset || livePage) || getEffectivePageText(ip.textAsset || ip) || '').trim();
    const note = livePage.illustScanNote || ip.illustScanNote || '';
    const row = el('div', { style: `border:1px solid ${isConfirmed ? '#b8d8b0' : 'var(--c-border)'}; border-radius:6px; padding:6px 9px; background:${isConfirmed ? '#f4fbf2' : 'var(--c-bg)'}; display:flex; flex-direction:column; gap:3px;` });
    const topRow = el('div', { style: 'display:flex; align-items:center; gap:4px;' });
    topRow.appendChild(el('span', { style: 'font-size:12px; font-weight:600; color:var(--c-text); flex-shrink:0;' }, `第 ${ip.pageNum} 页`));
    if (note) topRow.appendChild(el('span', { style: 'font-size:10px; color:var(--c-text-soft); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }, note));
    // 跳转
    topRow.appendChild(el('button', {
      class: 'btn', style: 'padding:1px 7px; font-size:11px; margin-left:auto; flex-shrink:0;',
      onclick: () => openPageDetail(book.id, ip.pageNum, 'pages'),
    }, '→'));
    if (!isConfirmed) {
      // 确认按钮
      topRow.appendChild(el('button', {
        class: 'btn', style: 'padding:1px 7px; font-size:11px; color:#2d7a2d; border-color:#7bc47b; flex-shrink:0;',
        onclick: () => { confirmIllustPage(book, ip.pageNum); renderBookWorkspacePanel(); renderGalleryView(); },
      }, '✓'));
    }
    // 删除
    topRow.appendChild(el('button', {
      class: 'btn', style: 'padding:1px 6px; font-size:11px; color:var(--c-danger,#c0392b); flex-shrink:0;',
      onclick: () => { removeIllustPage(book, ip.pageNum); renderBookWorkspacePanel(); renderGalleryView(); },
    }, '×'));
    row.appendChild(topRow);
    // 图文切割关联页可视化
    const assocNums = Array.isArray(ip.textAsset?.associatedPageNums) ? ip.textAsset.associatedPageNums : [];
    if (assocNums.length) {
      const assocLabel = assocNums.length <= 4
        ? assocNums.map(n => `第${n}页`).join('、')
        : `第${assocNums[0]}–${assocNums[assocNums.length - 1]}页（${assocNums.length}页）`;
      row.appendChild(el('div', { style: 'font-size:10px; color:#7a5c10; background:#fffbf0; border-radius:3px; padding:1px 5px; line-height:1.6;' },
        `📄 关联：${assocLabel}`));
    } else {
      row.appendChild(el('div', { style: 'font-size:10px; color:var(--c-text-mute);' }, '📄 未切割'));
    }
    if (textFull) row.appendChild(el('div', { style: 'font-size:10px; color:var(--c-text-soft); line-height:1.5; word-break:break-all;' },
      textFull.slice(0, 60) + (textFull.length > 60 ? '…' : '')));
    return row;
  }

  // 待确认区
  if (pending.length > 0) {
    const pendingHead = el('div', { style: 'display:flex; align-items:center; gap:6px; padding-top:4px; border-top:1px solid var(--c-border); margin-bottom:6px;' });
    pendingHead.appendChild(el('span', { style: 'font-size:12px; font-weight:600; color:#8a6a20;' }, `待确认（${pending.length}）`));
    pendingHead.appendChild(el('button', {
      class: 'btn', style: 'margin-left:auto; font-size:11px; padding:2px 10px; color:#2d7a2d; border-color:#7bc47b;',
      onclick: async () => { await confirmAllIllustPages(book); renderBookWorkspacePanel(); renderGalleryView(); },
    }, '全部确认'));
    wrap.appendChild(pendingHead);
    const listWrap = el('div', { style: 'display:flex; flex-direction:column; gap:5px; margin-bottom:10px;' });
    for (const ip of pending) listWrap.appendChild(makeIllustRow(ip, false));
    wrap.appendChild(listWrap);
  }

  // 已确认区
  if (confirmed.length > 0) {
    wrap.appendChild(el('div', { style: 'font-size:12px; font-weight:600; color:#2d7a2d; padding-top:4px; border-top:1px solid var(--c-border); margin-bottom:6px;' },
      `已确认插图（${confirmed.length}）`));
    const listWrap = el('div', { style: 'display:flex; flex-direction:column; gap:5px; margin-bottom:10px;' });
    for (const ip of confirmed) listWrap.appendChild(makeIllustRow(ip, true));
    wrap.appendChild(listWrap);
  }

  // 手动添加
  wrap.appendChild(el('div', { style: 'border-top:1px solid var(--c-border); padding-top:8px;' },
    el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:4px;' }, '手动添加插图页'),
    (() => {
      const row = el('div', { style: 'display:flex; gap:4px;' });
      const inp = el('input', { type: 'number', min: '1', placeholder: '页码', style: 'flex:1; height:28px; border:1px solid var(--c-border-strong); border-radius:5px; padding:0 8px; font-size:12px;' });
      row.appendChild(inp);
      row.appendChild(el('button', {
        class: 'btn primary', style: 'font-size:12px; padding:0 10px;',
        onclick: () => {
          const pn = parseInt(inp.value);
          if (!pn) { toast('请输入有效页码', 'warn'); return; }
          if (addIllustPageManual(book, pn)) {
            toast(`第 ${pn} 页已加入插图列表`, 'success');
            renderBookWorkspacePanel(); renderGalleryView();
          } else {
            toast(`第 ${pn} 页不存在`, 'warn');
          }
        },
      }, '+ 加入'));
      return row;
    })(),
  ));

  root.appendChild(wrap);

  // 封面异步加载
  (async () => {
    try {
      const doc = await ensurePdfDoc(book).catch(() => null);
      if (!doc) { loadingEl.textContent = '无 PDF'; return; }
      const firstPage = pages.length ? pdfPageOf(pages[0]) : 1;
      const dataUrl = await renderThumbnail(doc, firstPage, 260);
      coverWrap.innerHTML = '';
      coverWrap.appendChild(el('img', { src: dataUrl, style: 'width:100%; height:100%; object-fit:contain;' }));
    } catch { loadingEl.textContent = '封面加载失败'; }
  })();
}

async function renderBookPreviewTab() {
  const root = $('#tab-form');
  root.innerHTML = '';
  const book = getBook(state.previewBookId) || getBook(state.currentBookId);
  if (!book) {
    root.appendChild(el('div', { class: 'placeholder-state', style: 'height:200px' },
      el('div', { class: 'sub' }, '未选择书籍，点击左侧书卡预览')));
    return;
  }

  const wrap = el('div', { style: 'padding: 12px 14px' });
  root.appendChild(wrap);

  // Cover thumbnail (async — placeholder first)
  const coverWrap = el('div', { class: 'book-preview-cover-wrap' });
  const loadingEl = el('div', { class: 'book-preview-cover-loading' }, '封面加载中…');
  coverWrap.appendChild(loadingEl);
  wrap.appendChild(coverWrap);

  // Title & meta
  wrap.appendChild(el('div', { class: 'book-preview-title' }, book.title || '（未命名）'));
  if (book.dynasty) wrap.appendChild(el('div', { class: 'book-preview-meta' }, `朝代：${book.dynasty}`));
  if (book.groupTitle) wrap.appendChild(el('div', { class: 'book-preview-meta' },
    el('span', null, `📚 书籍组：`), el('strong', null, book.groupTitle)));

  // Stats
  const pages = getBookPages(book);
  const queued = state.illustrations.filter(i => i?.pdfSource?.bookId === book.id).length;
  const annCount = state.illustrations.filter(img => img.pdfSource?.bookId === book.id).length;
  const statsRow = el('div', { class: 'book-preview-stats' });
  const makeStat = (num, lbl) => {
    const s = el('div', { class: 'book-preview-stat' });
    s.appendChild(el('div', { class: 'num' }, String(num)));
    s.appendChild(el('div', { class: 'lbl' }, lbl));
    return s;
  };
  statsRow.appendChild(makeStat(pages.length || book.totalPages || '—', '总页数'));
  statsRow.appendChild(makeStat(queued, '已识别'));
  statsRow.appendChild(makeStat(annCount, '标注数'));
  wrap.appendChild(statsRow);

  // Action button — 已在该书内则不显示
  const alreadyInside = state.currentBookId === book.id &&
    (state.mainView === 'gallery' || state.mainView === 'page-detail');
  if (!alreadyInside) {
    const btnRow = el('div', { style: 'display:flex; gap:6px' });
    btnRow.appendChild(el('button', {
      class: 'btn primary',
      style: 'flex:1',
      onclick: () => openBookLandingPage(book.id),
    }, '进入书籍 →'));
    wrap.appendChild(btnRow);
  }

  // Async cover render
  (async () => {
    try {
      const doc = await ensurePdfDoc(book);
      if (!doc) { loadingEl.textContent = '无 PDF 文件'; return; }
      const coverPages = getBookPages(book);
      const firstPageNum = coverPages.length ? pdfPageOf(coverPages[0]) : 1;
      const dataUrl = await renderThumbnail(doc, firstPageNum, 280);
      coverWrap.innerHTML = '';
      coverWrap.appendChild(el('img', { src: dataUrl, class: 'book-preview-cover' }));
    } catch {
      loadingEl.textContent = '封面加载失败';
    }
  })();
}

function renderGroupPreviewTab(groupId) {
  const root = $('#tab-form');
  root.innerHTML = '';

  // Reconstruct group from state.books
  const groupBooks = state.books.filter(b => b.groupId === groupId);
  if (!groupBooks.length) {
    root.appendChild(el('div', { class: 'placeholder-state', style: 'height:160px' },
      el('div', { class: 'sub' }, '书籍组不存在或已解散')));
    return;
  }
  const groupTitle = groupBooks[0].groupTitle || groupId;
  const groupMeta  = groupBooks[0].groupMeta  || {};

  const wrap = el('div', { style: 'padding: 12px 14px' });
  root.appendChild(wrap);

  // Header badge
  wrap.appendChild(el('div', { style: 'display:flex; align-items:center; gap:8px; margin-bottom:10px' },
    el('span', { style: 'font-size:22px' }, '📚'),
    el('div', null,
      el('div', { class: 'book-preview-title', style: 'margin:0 0 2px' }, groupTitle),
      el('div', { class: 'book-preview-meta', style: 'margin:0' }, `共 ${groupBooks.length} 卷`)
    )
  ));

  // Editable fields
  const titleInput = el('input', { type: 'text', value: groupTitle, placeholder: '书籍组名称' });
  const dynastyInput = el('input', { type: 'text', value: groupMeta.dynasty || '', placeholder: '如：明代、宋代' });
  const versionInput = el('input', { type: 'text', value: groupMeta.version || '', placeholder: '如：四库全书本、万历刻本' });
  const descArea = el('textarea', { placeholder: '总介绍：概述内容、学术价值、版本沿革…' });
  descArea.value = groupMeta.description || '';

  const mkField = (lbl, input) => {
    const f = el('div', { class: 'group-meta-field' });
    f.appendChild(el('label', null, lbl));
    f.appendChild(input);
    return f;
  };
  wrap.appendChild(mkField('书籍组名称', titleInput));
  wrap.appendChild(mkField('朝代', dynastyInput));
  wrap.appendChild(mkField('版本', versionInput));
  wrap.appendChild(mkField('总介绍', descArea));

  // Save button
  const saveBtn = el('button', { class: 'btn primary full', style: 'margin-top: 2px' }, '保存');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    try {
      const r = await fetch(BRIDGE_UPDATE_GROUP_META_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          title: titleInput.value.trim() || groupTitle,
          meta: {
            dynasty:     dynastyInput.value.trim(),
            version:     versionInput.value.trim(),
            description: descArea.value.trim(),
          },
        }),
      });
      const result = await r.json();
      if (!result.ok) throw new Error(result.error || '保存失败');
      // Patch local state
      const newTitle = titleInput.value.trim() || groupTitle;
      const newMeta  = { dynasty: dynastyInput.value.trim(), version: versionInput.value.trim(), description: descArea.value.trim() };
      state.books.forEach(b => {
        if (b.groupId === groupId) { b.groupTitle = newTitle; b.groupMeta = newMeta; }
      });
      persist();
      renderBooksList();
      saveBtn.textContent = '✓ 已保存';
      setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = '保存'; }, 1800);
    } catch (e) {
      alert('保存失败：' + e.message);
      saveBtn.disabled = false; saveBtn.textContent = '保存';
    }
  });
  wrap.appendChild(saveBtn);

  // ── 卷册/章节：重命名 + 拖动排序 + 移出分组 ──
  groupBooks.sort((a, b) => (a.groupOrder ?? 1e9) - (b.groupOrder ?? 1e9));
  const volSection = el('div', { class: 'group-volumes-section' });
  volSection.appendChild(el('div', { class: 'group-volumes-head' }, `所含卷册 / 章节（${groupBooks.length}） · 拖动 ⠿ 排序`));
  groupBooks.forEach((book, i) => {
    const tInp = el('input', { type: 'text', value: book.title || book.id, style: 'flex:1; min-width:0;' });
    tInp.oninput = e => { book.title = e.target.value; };
    tInp.onchange = () => { persist(); renderBooksList(); };
    const handle = el('span', { style: 'cursor:grab; color:var(--c-text-mute); user-select:none; flex:0 0 auto;', title: '拖动排序',
      draggable: 'true', ondragstart: (e) => { state._volDrag = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (_) {} } }, '⠿');
    const row = el('div', { style: 'display:flex; gap:6px; align-items:center; padding:3px 0;',
      ondragover: (e) => { e.preventDefault(); e.currentTarget.style.boxShadow = 'inset 0 2px 0 var(--c-primary,#2b6cb0)'; },
      ondragleave: (e) => { e.currentTarget.style.boxShadow = ''; },
      ondrop: (e) => {
        e.preventDefault(); e.currentTarget.style.boxShadow = '';
        const from = state._volDrag;
        if (from == null || from === i) { state._volDrag = null; return; }
        const [m] = groupBooks.splice(from, 1); groupBooks.splice(i, 0, m);
        groupBooks.forEach((b, k) => { b.groupOrder = k; });
        state._volDrag = null; persist(); renderBooksList(); renderGroupPreviewTab(groupId);
      },
    },
      handle,
      el('span', { style: 'color:var(--c-text-mute); font-size:11px; width:18px; text-align:right; flex:0 0 auto;' }, `${i + 1}.`),
      tInp,
      el('button', { class: 'btn', style: 'padding:2px 7px; flex:0 0 auto;', title: '打开该卷', onclick: () => previewBookInRight(book.id) }, '↗'),
      el('button', { class: 'btn', style: 'padding:2px 7px; flex:0 0 auto;', title: '移出此书籍组（变回独立书）', onclick: async () => {
        if (!await openConfirm(`将「${book.title}」移出《${groupTitle}》？\n该卷会变回一本独立的书（数据不删）。`)) return;
        delete book.groupId; delete book.groupTitle; delete book.groupOrder;
        persist(); renderBooksList(); renderGroupPreviewTab(groupId);
      } }, '移出'));
    volSection.appendChild(row);
  });
  wrap.appendChild(volSection);

  // ── 目录（章节条目：名称 + 卷/页，可增删 + 拖动排序）──
  if (!Array.isArray(groupMeta.toc)) groupMeta.toc = [];
  const toc = groupMeta.toc;
  const saveToc = () => { state.books.forEach(b => { if (b.groupId === groupId) b.groupMeta = { ...(b.groupMeta || {}), toc: toc.slice() }; }); persist(); };
  const tocSection = el('div', { class: 'group-volumes-section', style: 'margin-top:14px;' });
  tocSection.appendChild(el('div', { class: 'group-volumes-head' }, `目录（${toc.length}）`));
  toc.forEach((entry, i) => {
    const nameInp = el('input', { type: 'text', value: entry.title || '', placeholder: '章节 / 篇目名', style: 'flex:1; min-width:0;' });
    nameInp.oninput = e => { entry.title = e.target.value; };
    nameInp.onchange = saveToc;
    const pageInp = el('input', { type: 'text', value: entry.page || '', placeholder: '卷/页', style: 'width:84px; flex:0 0 84px;' });
    pageInp.oninput = e => { entry.page = e.target.value; };
    pageInp.onchange = saveToc;
    const dragH = el('span', { style: 'cursor:grab; color:var(--c-text-mute); flex:0 0 auto;', title: '拖动排序',
      draggable: 'true', ondragstart: (e) => { state._tocDrag = i; try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {} } }, '⠿');
    const row = el('div', { style: 'display:flex; gap:6px; align-items:center; padding:2px 0;',
      ondragover: (e) => { e.preventDefault(); e.currentTarget.style.boxShadow = 'inset 0 2px 0 var(--c-primary,#2b6cb0)'; },
      ondragleave: (e) => { e.currentTarget.style.boxShadow = ''; },
      ondrop: (e) => { e.preventDefault(); e.currentTarget.style.boxShadow = ''; const from = state._tocDrag; if (from == null || from === i) { state._tocDrag = null; return; } const [m] = toc.splice(from, 1); toc.splice(i, 0, m); state._tocDrag = null; saveToc(); renderGroupPreviewTab(groupId); } },
      dragH,
      el('span', { style: 'color:var(--c-text-mute); font-size:11px; width:18px; text-align:right; flex:0 0 auto;' }, `${i + 1}.`),
      nameInp, pageInp,
      el('button', { class: 'btn', style: 'padding:2px 8px; flex:0 0 auto;', title: '删除', onclick: () => { toc.splice(i, 1); saveToc(); renderGroupPreviewTab(groupId); } }, '✕'));
    tocSection.appendChild(row);
  });
  tocSection.appendChild(el('button', { class: 'btn', style: 'margin-top:8px;', onclick: () => { toc.push({ title: '', page: '' }); saveToc(); renderGroupPreviewTab(groupId); } }, '+ 添加目录条目'));
  wrap.appendChild(tocSection);
}

function getSortedGroupBooks(groupId) {
  return state.books
    .filter(b => b.groupId === groupId)
    .sort((a, b) => (a.groupOrder ?? 1e9) - (b.groupOrder ?? 1e9));
}

// 自动卷名：从 version/title 抓「卷X」，否则按序号。供未设自定义名时回退 + 输入框 placeholder。
function getAutoVolumeLabel(book, index = 0) {
  const raw = (book?.version || book?.title || '').trim();
  const m = raw.match(/卷\s*([0-9一二三四五六七八九十百零]+)/);
  if (m && m[1]) return `卷${m[1]}`;
  return `卷${index + 1}`;
}
function getVolumeListLabel(book, index = 0) {
  const custom = (book?.volumeLabel || '').trim();
  return custom || getAutoVolumeLabel(book, index);
}

// 书组内卷次落盘：把当前排序固化为连续 groupOrder。
function _commitVolumeOrder(sorted) {
  sorted.forEach((b, idx) => { b.groupOrder = idx; markBookDirty(b.id); });
  persist();
  renderGroupOverviewView();
  renderBooksList();
}
// 拖拽重排：把 draggedId 移动到 targetId 当前所在位置。
function reorderVolumeInGroup(groupId, draggedId, targetId) {
  const sorted = getSortedGroupBooks(groupId);
  const from = sorted.findIndex(b => b.id === draggedId);
  const to = sorted.findIndex(b => b.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  _commitVolumeOrder(sorted);
}
// 置顶：把某卷移到首位。
function pinVolumeToTop(groupId, bookId) {
  const sorted = getSortedGroupBooks(groupId);
  const i = sorted.findIndex(b => b.id === bookId);
  if (i <= 0) return;
  const [moved] = sorted.splice(i, 1);
  sorted.unshift(moved);
  _commitVolumeOrder(sorted);
}
let _dragVolId = null;   // 当前被拖拽的卷 id（书组卷次拖拽排序）

function makeGroupBookProxy(groupId, groupBooks) {
  const base = groupBooks[0];
  const meta = base.groupMeta || {};
  const inheritedTemplateBook = groupBooks.find(book => normalizeRect(book.contentRectTemplate)) || base;
  const getMeta = () => base.groupMeta || meta || {};
  const sync = (patch = {}) => {
    const currentMeta = getMeta();
    const nextMeta = { ...currentMeta, ...patch.groupMeta };
    groupBooks.forEach(book => {
      if (patch.title !== undefined) book.groupTitle = patch.title;
      if (patch.dynasty !== undefined) book.dynasty = patch.dynasty;
      if (patch.version !== undefined) book.version = patch.version;
      if (patch.textLayout !== undefined) book.textLayout = patch.textLayout;
      if (patch.topicNote !== undefined) book.topicNote = patch.topicNote;
      if (patch.bookTraits !== undefined) book.bookTraits = deepClone(patch.bookTraits);
      if (patch.contentRectTemplate !== undefined) book.contentRectTemplate = patch.contentRectTemplate ? patch.contentRectTemplate.slice() : null;
      if (patch.contentRectTemplateSourceBookId !== undefined) book.contentRectTemplateSourceBookId = patch.contentRectTemplateSourceBookId;
      if (patch.contentRectTemplateSourcePageNum !== undefined) book.contentRectTemplateSourcePageNum = patch.contentRectTemplateSourcePageNum;
      book.groupMeta = { ...(book.groupMeta || {}), ...nextMeta };
    });
    persist(base.id);
    renderBooksList();
  };
  const proxy = {
    ...base,
    id: base.id,
    isGroupProxy: true,
    groupId,
    title: base.groupTitle || meta.title || base.title || groupId,
    dynasty: meta.dynasty || base.dynasty || '',
    version: meta.version || base.version || `共${groupBooks.length}卷`,
    topicNote: meta.topicNote || base.topicNote || '',
    textLayout: meta.textLayout || base.textLayout || 'auto',
    bookTraits: deepClone(meta.bookTraits || base.bookTraits || {}),
    contentRectTemplate: normalizeRect(meta.contentRectTemplate) || normalizeRect(inheritedTemplateBook.contentRectTemplate) || null,
    contentRectTemplateSourceBookId: meta.contentRectTemplateSourceBookId || inheritedTemplateBook.contentRectTemplateSourceBookId || inheritedTemplateBook.id || null,
    contentRectTemplateSourcePageNum: meta.contentRectTemplateSourcePageNum || inheritedTemplateBook.contentRectTemplateSourcePageNum || null,
  };
  Object.defineProperties(proxy, {
    title: { get: () => base.groupTitle || getMeta().title || base.title || groupId, set: v => sync({ title: v, groupMeta: { title: v } }) },
    dynasty: { get: () => getMeta().dynasty || base.dynasty || '', set: v => sync({ dynasty: v, groupMeta: { dynasty: v } }) },
    version: { get: () => getMeta().version || base.version || `共${groupBooks.length}卷`, set: v => sync({ version: v, groupMeta: { version: v } }) },
    topicNote: { get: () => getMeta().topicNote || base.topicNote || '', set: v => sync({ topicNote: v, groupMeta: { topicNote: v } }) },
    textLayout: { get: () => getMeta().textLayout || base.textLayout || 'auto', set: v => sync({ textLayout: v, groupMeta: { textLayout: v } }) },
    bookTraits: { get: () => getMeta().bookTraits || base.bookTraits || {}, set: v => sync({ bookTraits: v, groupMeta: { bookTraits: v } }) },
    contentRectTemplate: { get: () => normalizeRect(getMeta().contentRectTemplate) || normalizeRect(inheritedTemplateBook.contentRectTemplate) || null, set: v => sync({ contentRectTemplate: normalizeRect(v), groupMeta: { contentRectTemplate: normalizeRect(v) } }) },
    contentRectTemplateSourceBookId: { get: () => getMeta().contentRectTemplateSourceBookId || inheritedTemplateBook.contentRectTemplateSourceBookId || inheritedTemplateBook.id || null, set: v => sync({ contentRectTemplateSourceBookId: v || null, groupMeta: { contentRectTemplateSourceBookId: v || null } }) },
    contentRectTemplateSourcePageNum: { get: () => getMeta().contentRectTemplateSourcePageNum || inheritedTemplateBook.contentRectTemplateSourcePageNum || null, set: v => sync({ contentRectTemplateSourcePageNum: v, groupMeta: { contentRectTemplateSourcePageNum: v } }) },
  });
  return proxy;
}

function formatBookTemplateSource(book) {
  if (!book?.isGroupProxy) {
    return book?.contentRectTemplateSourcePageNum ? `第 ${book.contentRectTemplateSourcePageNum} 页` : '';
  }
  const groupBooks = getSortedGroupBooks(book.groupId);
  const sourceBookId = book.contentRectTemplateSourceBookId;
  const sourceBook = groupBooks.find(b => b.id === sourceBookId) || groupBooks[0];
  if (!sourceBook || !book.contentRectTemplateSourcePageNum) return '';
  const index = Math.max(0, groupBooks.findIndex(b => b.id === sourceBook.id));
  return `${getVolumeListLabel(sourceBook, index)} · 第 ${book.contentRectTemplateSourcePageNum} 页`;
}

function renderGroupOverviewView() {
  const scroll = $('#main-scroll');
  if (!scroll) return;
  scroll.innerHTML = '';

  const groupId = state.previewGroupId;
  const groupBooks = getSortedGroupBooks(groupId);
  if (!groupId || !groupBooks.length) {
    setMainHeader();
    scroll.appendChild(el('div', { class: 'placeholder-state', style: 'height:240px;' },
      el('div', { class: 'sub' }, '未选择书组')));
    return;
  }

  const groupTitle = groupBooks[0].groupTitle || groupId;
  const groupBook = makeGroupBookProxy(groupId, groupBooks);
  const totalPages = groupBooks.reduce((sum, book) => sum + (getBookPages(book).length || Number(book.totalPages) || 0), 0);
  const scanDone = groupBooks.reduce((sum, book) => sum + getBookPages(book).filter(p => p.textAsset?.fullScanDone).length, 0);
  const candidateCount = groupBooks.reduce((sum, book) => sum + ((book.illustrationPages || []).length), 0);
  const queuedCount = state.illustrations.filter(img => groupBooks.some(book => img?.pdfSource?.bookId === book.id)).length;
  const okCount = state.illustrations.filter(img => img.status === 'ok' && groupBooks.some(book => img?.pdfSource?.bookId === book.id)).length;

  setMainHeader(
    buildBreadcrumbBar([
      { label: groupTitle, onClick: () => openGroupOverview(groupId) },
      { label: '书组总览' },
    ]),
  );
  scroll.appendChild(el('div', { class: 'step-bar-content' }, buildStepBar(1, groupBooks[0])));

  const wrap = el('div', { style: 'display:flex; flex-direction:column; gap:14px;' });

  const metric = (label, value, note = '') => el('div', { class: 'book-metric-card' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value)),
    note ? el('div', { class: 'note' }, note) : null,
  );

  const infoSection = el('div', { class: 'workspace-section' });
  infoSection.appendChild(el('div', { class: 'workspace-section-head' },
    el('h3', null, '书籍信息'),
    el('button', {
      class: 'btn',
      title: '按卷和页码导出全书 OCR；不会修改现有数据',
      onclick: () => openBookOcrExportModal(groupBooks[0], { defaultScope: 'group' }),
    }, '导出 OCR'),
  ));
  infoSection.appendChild(el('div', { class: 'book-metrics-grid', style: 'margin-bottom:12px;' },
    metric('卷册数', groupBooks.length, '书组章节'),
    metric('总页数', totalPages, `${scanDone}/${totalPages} 页已扫描`),
    metric('插图候选', candidateCount, 'AI 预处理结果'),
    metric('已确认', okCount, `${queuedCount} 张在标注队列`),
  ));
  infoSection.appendChild(renderBookProfilePanel(groupBook, { collapsible: false }));
  wrap.appendChild(infoSection);

  const prepSection = el('div', { class: 'workspace-section' });
  prepSection.appendChild(el('div', { class: 'workspace-section-head' },
    el('h3', null, '预处理'),
  ));
  const prep = el('div', { class: 'ta-panel', style: 'margin:0' });
  const prepBody = el('div', { class: 'ta-panel-body' });
  const prepKey = `${groupId}_group_prep`;
  const prepInitCollapsed = !!(state.bookPanelCollapsed || {})[prepKey];
  prepBody.style.display = prepInitCollapsed ? 'none' : '';
  const prepColBtn = el('button', {
    class: 'btn',
    style: 'margin-left:auto; padding:2px 8px; font-size:12px;',
    onclick: () => {
      const nowCollapsed = prepBody.style.display !== 'none';
      prepBody.style.display = nowCollapsed ? 'none' : '';
      prepColBtn.textContent = nowCollapsed ? '展开 ▼' : '收起 ▲';
      state.bookPanelCollapsed = state.bookPanelCollapsed || {};
      state.bookPanelCollapsed[prepKey] = nowCollapsed;
      persist();
    }
  }, prepInitCollapsed ? '展开 ▼' : '收起 ▲');
  prep.appendChild(el('div', { class: 'ta-panel-head' },
    el('span', null, '书籍预处理'),
    el('span', { class: 'ta-badge st-reviewed' }, '当前：书组总览'),
    prepColBtn,
  ));
  prepBody.appendChild(el('div', {
    style: 'margin-bottom:10px; font-size:12px; color:var(--c-text-mute); line-height:1.8;'
  }, `AI 插图：${candidateCount}。该数字仅供预处理参考，不代表最终有效插图数量。`));
  const templateRect = ensureBookCropTemplate(groupBook);
  const cropSpec = el('div', {
    style: 'margin-bottom:12px; padding:10px 12px; border:1px dashed #d9cfb0; border-radius:8px; background:#fcfbf7;'
  });
  cropSpec.appendChild(el('div', { style: 'font-size:12.5px; color:#6b5c34; font-weight:600; margin-bottom:6px;' }, '统一剪裁规格（正文/版心 · 供 AI）'));
  cropSpec.appendChild(el('div', { style: 'font-size:12px; color:#8a7a4a; line-height:1.8;' },
    templateRect
      ? `当前规格：${formatRectSpec(templateRect)}${formatBookTemplateSource(groupBook) ? ` · 来源：${formatBookTemplateSource(groupBook)}` : ''}`
      : '尚未设置。建议先进入一页，在“页面”视图框选正文边框后，点击“设为全书统一规格”。'
  ));
  cropSpec.appendChild(el('div', { style: 'margin-top:6px; font-size:11.5px; color:#54708f; line-height:1.7;' },
    `扫描标准：优先从原始 PDF 裁取正文框，长边 ${SCAN_CONTENT_LONG_SIDE}px；正文框缺失时扫描前会提醒，可设置统一正文框或仅本次使用原始整页。最终插图标注只使用确认后的插图裁图。`));
  cropSpec.appendChild(renderBookTemplateEditor(groupBook));
  const _cropCount = groupBooks.reduce((sum, book) => sum + getBookPages(book).filter(p => p && p.forceCropRect && p.cropRect).length, 0);
  cropSpec.appendChild(el('div', { style: 'margin-top:10px; padding-top:10px; border-top:1px dashed #e3d9b8;' },
    el('div', { style: 'font-size:12.5px; color:#2e6b45; font-weight:600; margin-bottom:6px;' }, '插图裁切（逐页 · 供成果展示）'),
    el('div', { style: 'font-size:12px; color:#5c7a64; line-height:1.8;' },
      _cropCount ? `已框插图：${_cropCount} / ${totalPages} 页。` : '尚未框插图本体（成果/审核暂显示整页或版心）。')
  ));
  prepBody.appendChild(cropSpec);
  prepBody.appendChild(el('div', {
    style: 'font-size:12.5px; color:#6b5c34; font-weight:600; margin:4px 0 6px;'
  }, '卷次管理（自定义卷名 · 拖拽调整顺序）'));
  const volList = el('div', { style: 'display:grid; gap:8px;' });
  groupBooks.forEach((book, index) => {
    const pages = getBookPages(book);
    const done = pages.filter(p => p.textAsset?.fullScanDone).length;
    const candidates = (book.illustrationPages || []).length;
    const queued = state.illustrations.filter(img => img?.pdfSource?.bookId === book.id).length;
    const job = bookDetectJobs[book.id];

    // 自定义卷名输入框（留空回退自动卷名，占位显示自动卷名）
    const nameInput = el('input', { type: 'text', value: book.volumeLabel || '',
      placeholder: getAutoVolumeLabel(book, index),
      style: 'width:100%; height:30px; border:1px solid var(--c-border-strong); border-radius:6px; padding:0 8px; font-size:13px; font-weight:600;',
      onchange: e => {
        const v = e.target.value.trim();
        if (v) book.volumeLabel = v; else delete book.volumeLabel;
        persist(book.id);
        renderBooksList();   // 左侧书组列表卷名同步；不重绘总览，避免输入框跳动
      } });

    // 拖拽手柄（仅手柄可拖，不干扰卷名输入框文字选择）
    const handle = el('div', { class: 'vol-drag-handle', title: '拖拽调整卷次顺序',
      style: 'cursor:grab; color:var(--c-text-mute); font-size:17px; user-select:none; padding:0 4px; line-height:1;' }, '⠿');
    handle.draggable = true;
    handle.addEventListener('dragstart', e => {
      _dragVolId = book.id; e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', book.id); row.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      _dragVolId = null; row.classList.remove('dragging');
      document.querySelectorAll('.vol-row.drop-over').forEach(r => r.classList.remove('drop-over'));
    });

    const pinBtn = el('button', { class: 'btn', style: 'padding:4px 10px; font-size:12px;',
      disabled: index === 0 ? '' : null, title: '移到首位',
      onclick: () => pinVolumeToTop(groupId, book.id) }, '⤒ 置顶');

    const row = el('div', { class: 'vol-row',
      style: 'display:grid; grid-template-columns:auto 130px 1fr auto; gap:10px; align-items:center; padding:9px 10px; border:1px solid var(--c-border); border-radius:8px; background:#fff;'
    },
      handle,
      nameInput,
      el('div', null,
        el('div', { style: 'font-size:12px; color:var(--c-text); margin-bottom:4px;' },
          job?.running ? `扫描中 ${job.current}/${job.total}` : `扫描 ${done}/${pages.length || 0} 页 · 候选 ${candidates} · 队列 ${queued}`),
        el('div', { class: 'book-card-progress-bar', style: 'height:5px;' },
          el('div', { class: 'book-card-progress-fill', style: `width:${pages.length ? Math.round(done / pages.length * 100) : 0}%` })
        )
      ),
      el('div', { style: 'display:flex; gap:6px;' },
        pinBtn,
        el('button', { class: 'btn', onclick: () => openGallery(book.id, 'pages') }, '进入卷内容')
      )
    );
    // 整行作为放置目标
    row.addEventListener('dragover', e => {
      if (_dragVolId && _dragVolId !== book.id) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drop-over');
      }
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-over'));
    row.addEventListener('drop', e => {
      e.preventDefault(); row.classList.remove('drop-over');
      if (_dragVolId && _dragVolId !== book.id) reorderVolumeInGroup(groupId, _dragVolId, book.id);
    });
    volList.appendChild(row);
  });
  prepBody.appendChild(volList);
  prep.appendChild(prepBody);
  prepSection.appendChild(prep);
  wrap.appendChild(prepSection);

  scroll.appendChild(wrap);
}

function renderForm() {
  const root = $('#tab-form');
  root.innerHTML = '';
  const img = getCurrent();
  if (!img) {
    // 插图浏览模式：有当前页但尚无标注记录，展示插图基本信息
    if (state.mainView === 'page-detail' && state.pageDetailMode === 'illust') {
      const book = getCurrentBook();
      const pageNum = state.currentBookPage;
      const page = book ? getBookPageRecord(book, pageNum) : null;
      if (book && page) {
        // 来源行
        const srcBar = el('div', {
          style: 'padding:5px 12px; background:#f7f8fa; border-bottom:1px solid var(--c-border); font-size:12px; color:var(--c-text-mute); display:flex; gap:10px; flex-wrap:wrap;'
        });
        srcBar.appendChild(el('span', null, '📗 ' + book.title));
        srcBar.appendChild(el('span', null, '第 ' + pageNum + ' 页'));
        if (book.dynasty) srcBar.appendChild(el('span', null, book.dynasty));
        root.appendChild(srcBar);

        // 插图确认状态
        const illustPage = (book.illustrationPages || []).find(ip => Number(ip.pageNum) === Number(pageNum));
        const isConfirmed = !!(illustPage?.confirmed);
        const isMultiPage = pageHasMultipleIllustrations(book, pageNum);
        const card = el('div', { class: 'status-card' });
        card.appendChild(el('div', { class: 'meta-row' },
          isConfirmed
            ? el('span', { class: 'pill ok' }, el('span', { class: 'dot' }), '已确认插图')
            : el('span', { class: 'pill todo' }, el('span', { class: 'dot' }), '待确认'),
          el('span', { class: 'small' }, '暂无标注记录'),
        ));
        if (isMultiPage) {
          card.appendChild(el('div', { class: 'small', style: 'margin-top:6px; color:#8a7a4a; line-height:1.7;' },
            '该页已被标记为多图页。点击“+ 新增插图”后依次框出图1、图2……框好后会直接加入标注队列。'));
        }
        root.appendChild(card);

        // 加入标注队列
        const visionOk = providerSupportsVisionTasks();
        const actions = el('div', { class: 'status-actions' });
        if (isMultiPage) {
          actions.appendChild(el('button', {
            class: 'btn',
            onclick: () => {
              beginNewFigureSelection(book, page);
            }
          }, '+ 新增插图'));
        } else {
          actions.appendChild(el('button', {
            class: 'btn primary',
            ...(visionOk ? {} : { disabled: '', title: getVisionUnsupportedMessage('图像标注') }),
            onclick: () => {
              if (!visionOk) return;
              const newId = addImageFromBookPage(book, pageNum, { allowFullPage: true });
              persist();
              refreshPageDetailWorkspace(book.id, pageNum);
              if (newId) runAI(newId);
            }
          }, '▶ AI 标注'));
          actions.appendChild(el('button', {
            class: 'btn',
            onclick: () => {
              addImageFromBookPage(book, pageNum, { allowFullPage: true });
              persist();
              refreshPageDetailWorkspace(book.id, pageNum);
            }
          }, '+ 仅加入队列'));
        }
        root.appendChild(actions);

        // 页面识别文字
        const ta = page.textAsset;
        const displayText = (ta?.associatedText || getEffectivePageText(ta || page) || page.text || '').trim();
        root.appendChild(el('div', { class: 'form-section-title', style: 'margin-top:12px' }, '页面识别文字'));
        if (displayText) {
          const textEl = el('div', {
            style: 'font-size:13px; line-height:1.9; color:var(--c-text); background:#fafbfc; border:1px solid var(--c-border); border-radius:6px; padding:10px 12px; max-height:220px; overflow-y:auto; white-space:pre-wrap; font-family:var(--f-serif);'
          });
          textEl.textContent = displayText;
          root.appendChild(textEl);
        } else {
          root.appendChild(el('div', { class: 'form-hint', style: 'margin-top:4px' },
            '暂无识别文字（可在页面详情中提取）'));
        }

        // 审核入口
        const reviewCount = getReviewQueueItems().length;
        if (reviewCount > 0) {
          root.appendChild(el('button', {
            class: 'btn full',
            style: 'margin-top:14px; background:#fff8e8; border-color:#e0b84a; color:#7a5c10; font-weight:600;',
            onclick: () => enterReviewMode(),
          }, `🔍 进入审核模式（${reviewCount} 待审核）`));
        }
        return;
      }
    }
    // 全书页浏览模式：显示当前页（双页时显示两页）文字内容
    if (state.mainView === 'page-detail' && state.pageDetailMode === 'page') {
      const book = getCurrentBook();
      const pageNum = state.currentBookPage;
      const page = book ? getBookPageRecord(book, pageNum) : null;
      if (book && page) {
        // 计算双页展示的伴随页
        const allPages = getBookPages(book);
        const traits = getBookTraits(book) || {};
        const spreads = getSpreadSequence(allPages, traits.coverPageNum ?? null);
        const currentSpread = spreads.find(s => s.some(p => p.pageNum === page.pageNum)) || [page];
        const spreadPages = (!state.pageSoloMode && currentSpread.length === 2) ? currentSpread : [page];

        const srcBar = el('div', {
          style: 'padding:5px 12px; background:#f7f8fa; border-bottom:1px solid var(--c-border); font-size:12px; color:var(--c-text-mute); display:flex; gap:10px; flex-wrap:wrap;'
        });
        srcBar.appendChild(el('span', null, '📗 ' + book.title));
        const pageLabel = spreadPages.length === 2
          ? `第 ${spreadPages[0].pageNum}、${spreadPages[1].pageNum} 页`
          : `第 ${pageNum} 页`;
        srcBar.appendChild(el('span', null, pageLabel));
        if (book.dynasty) srcBar.appendChild(el('span', null, book.dynasty));
        root.appendChild(srcBar);

        // 辅助：获取某页的展示文字
        const getPageText = (pg) => {
          const ip2 = (book.illustrationPages || []).find(p => Number(p.pageNum) === Number(pg.pageNum));
          const assoc = ip2?.textAsset?.associatedText || '';
          return (assoc || getEffectivePageText(pg.textAsset || pg) || pg.text || '').trim();
        };

        // 每个 spread 页分别渲染
        spreadPages.forEach(pg => {
          const illustPage = (book.illustrationPages || []).find(ip => Number(ip.pageNum) === Number(pg.pageNum));
          const isIllustP = !!illustPage;

          const pageBlock = el('div', { style: 'margin: 10px 12px 0; border:1px solid var(--c-border); border-radius:8px; overflow:hidden;' });
          // 页码标题
          const pageHead = el('div', {
            style: 'padding:4px 10px; background:#f0f4f8; font-size:11px; font-weight:600; color:var(--c-text-mute); display:flex; align-items:center; gap:6px;'
          });
          pageHead.appendChild(document.createTextNode(`第 ${pg.pageNum} 页`));
          pageHead.appendChild(el('span', {
            style: `font-weight:400; padding:1px 6px; border-radius:999px; font-size:10px; background:${isIllustP ? '#e6f4ea' : '#eef2f6'}; color:${isIllustP ? '#2d7a2d' : '#4a5a6a'};`
          }, isIllustP ? '插图页' : '文字页'));
          if (isIllustP) {
            const jumpBtn = el('button', {
              class: 'btn',
              style: 'margin-left:auto; padding:1px 7px; font-size:10px;',
              onclick: () => openPageDetail(book.id, pg.pageNum, 'illustrations'),
            }, '查看插图 →');
            pageHead.appendChild(jumpBtn);
          } else {
            // 文字页：右侧加「重新扫描」，对本页重新执行文字 OCR
            const rescanBtn = el('button', {
              class: 'btn',
              style: 'margin-left:auto; padding:1px 7px; font-size:10px;',
              title: '对本页重新执行文字 OCR（覆盖现有文字）',
              onclick: async (ev) => {
                const btn = ev.currentTarget;
                if (btn.disabled) return;
                if (!(await guardVisionTask('页面 OCR', { book_id: book.id, page_num: pg.pageNum }))) return;
                const old = btn.textContent; btn.disabled = true; btn.textContent = '扫描中…';
                try {
                  const r = await extractTextForPage(book, pg, { force: true, forceOcr: true, refreshCrop: false, resetManualProof: false });
                  markBookDirty(book.id);
                  persist(book.id);
                  toast(`第 ${pg.pageNum} 页已重新 OCR（${r.textLength || 0} 字）`, 'success');
                  renderRightTab();
                } catch (err) {
                  toast('重新扫描失败：' + (err.message || err), 'error');
                  btn.disabled = false; btn.textContent = old;
                }
              },
            }, '🔄 重新扫描');
            pageHead.appendChild(rescanBtn);
          }
          pageBlock.appendChild(pageHead);

          const txt = getPageText(pg);
          if (txt) {
            const textEl = el('div', {
              style: 'font-size:13px; line-height:1.9; color:var(--c-text); background:#fafbfc; padding:8px 12px; max-height:220px; overflow-y:auto; white-space:pre-wrap; font-family:var(--f-serif);'
            });
            textEl.textContent = txt;
            pageBlock.appendChild(textEl);
          } else {
            pageBlock.appendChild(el('div', {
              style: 'padding:8px 12px; font-size:11px; color:var(--c-text-mute);'
            }, '该页暂无识别文字'));
          }
          root.appendChild(pageBlock);
        });
        return;
      }
    }
    // 无选中图片时，展示左侧点击的书籍/分组信息
    if (state.previewGroupId) { renderGroupPreviewTab(state.previewGroupId); return; }
    if (state.previewBookId)  { renderBookPreviewTab(); return; }
    root.appendChild(el('div', { class: 'placeholder-state', style: 'height:200px' },
      el('div', { class: 'sub' }, '尚未选择图片')));
    return;
  }

  // 审核模式：展示完整可编辑表单（右侧面板辅助审核）
  if (state.mainView === 'review-queue') {
    renderFullAnnotationForm(root, img);
    return;
  }

  // 普通浏览模式：简化基础信息视图
  renderAssetRecordTabs(root, img);
  if (assetPanelState.detailView === 'assets') {
    renderAssetTab(root, img);
    return;
  }
  renderBasicInfoView(root, img);
}

/* ── 简化基础信息视图（浏览模式）─────────────────────────────────── */
function renderBasicInfoView(root, img) {
  // 来源行
  if (img.source || img.page) {
    const srcBar = el('div', {
      style: 'padding:5px 12px; background:#f7f8fa; border-bottom:1px solid var(--c-border); font-size:12px; color:var(--c-text-mute); display:flex; gap:10px; flex-wrap:wrap;'
    });
    if (img.source) srcBar.appendChild(el('span', null, '📗 ' + img.source));
    if (img.page)   srcBar.appendChild(el('span', null, img.page));
    if (img.pdfSource?.dynasty) srcBar.appendChild(el('span', null, img.pdfSource.dynasty));
    root.appendChild(srcBar);
  }

  const st = STATUSES[img.status];
  const ann = img.annotation || img.aiDraft || {};
  const visionOk = providerSupportsVisionTasks();
  const visionMsg = getVisionUnsupportedMessage('图像标注');

  // 状态卡（简化）
  const card = el('div', { class: 'status-card' });
  card.appendChild(el('div', { class: 'meta-row' },
    el('span', { class: 'pill ' + st.pill }, el('span', { class: 'dot' }), st.label),
  ));
  if (img.annotatedAt) {
    card.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute)' },
      `AI 标注 ${fmtDate(img.annotatedAt)} · ${img.modelUsed || '—'}`));
  } else if (img.status === 'todo') {
    card.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute)' }, '尚未进行 AI 标注'));
  }
  if (img.reviewMeta?.humanEditedAt) {
    card.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute)' },
      `人工修改 ${fmtDate(img.reviewMeta.humanEditedAt)}`));
  }

  // 操作按钮
  const actions = el('div', { class: 'status-actions' });
  if (img.status === 'todo') {
    actions.appendChild(el('button', {
      class: 'btn primary',
      ...(visionOk ? {} : { disabled: '', title: visionMsg }),
      onclick: () => { if (visionOk) runAI(img.id); }
    }, visionOk ? '▶ AI 标注' : '当前模型不支持图像标注'));
  } else if (img.status === 'running') {
    actions.appendChild(el('button', { class: 'btn primary', disabled: '' }, '⟳ 标注中…'));
  } else if (img.status === 'review') {
    actions.appendChild(el('button', {
      class: 'btn primary', style: 'background:#fff3cd; border-color:#e0b84a; color:#7a5c10;',
      onclick: () => enterReviewMode()
    }, '🔍 进入审核'));
    actions.appendChild(el('button', {
      class: 'btn success',
      onclick: async () => {
        await commitReviewQueueDecision(img.id, 'confirm');
        if (state.mainView !== 'review-queue') renderForm();
      }
    }, '✓ 直接确认'));
    actions.appendChild(el('button', {
      class: 'btn', ...(visionOk ? {} : { disabled: '', title: visionMsg }),
      onclick: () => { if (visionOk) runAI(img.id); }
    }, '⟳ 重新标注'));
  } else if (img.status === 'ok') {
    actions.appendChild(el('button', {
      class: 'btn', onclick: async () => { await setStatus(img.id, 'review', { blocking: true }); renderForm(); }
    }, '↺ 重新审核'));
  } else if (img.status === 'bad') {
    actions.appendChild(el('button', {
      class: 'btn primary', ...(visionOk ? {} : { disabled: '', title: visionMsg }),
      onclick: () => { if (visionOk) runAI(img.id); }
    }, '↺ 重新标注'));
    actions.appendChild(el('button', {
      class: 'btn', onclick: async () => { await setStatus(img.id, 'review', { blocking: true }); renderForm(); }
    }, '标记为待审核'));
  }
  card.appendChild(actions);
  root.appendChild(card);

  // 标注摘要 badges（已标注时）
  if (img.status !== 'todo' && img.status !== 'running') {
    const badges = [];
    const typeLabel = ILLUSTRATION_TYPES.find(t => t.value === ann.type)?.label;
    badges.push(el('span', { class: 'ann-summary-badge' + (typeLabel ? '' : ' empty') },
      typeLabel ? '🖼 ' + typeLabel : '类型未填'));
    if (ann.subject) {
      badges.push(el('span', { class: 'ann-summary-badge subject', title: ann.subject }, '📌 ' + ann.subject));
    }
    if (badges.length) {
      const summaryRow = el('div', { class: 'ann-summary-row' });
      badges.forEach(b => summaryRow.appendChild(b));
      root.appendChild(summaryRow);
    }
  }

  // 完整标注信息（status !== todo/running 时显示）：浏览页也必须能看清所有关键字段
  if (img.status !== 'todo' && img.status !== 'running') {
    root.appendChild(renderAnnotationInfoPanel(img, ann));
  }

  // 全局审核入口（当前非 review 但有其他待审核项时显示）
  const reviewCount = getReviewQueueItems().length;
  if (reviewCount > 0 && img.status !== 'review') {
    root.appendChild(el('button', {
      class: 'btn full',
      style: 'margin-top:14px; background:#fff8e8; border-color:#e0b84a; color:#7a5c10; font-weight:600;',
      onclick: () => enterReviewMode(),
    }, `🔍 进入审核模式（${reviewCount} 待审核）`));
  }

  // 上下页导航
  const visibleIllustrations = getVisibleIllustrationRecords();
  const idx = visibleIllustrations.findIndex(item => item.id === img.id);
  root.appendChild(el('div', { class: 'bottom-actions' },
    el('button', { class: 'btn', onclick: () => goRel(-1), disabled: idx === 0 ? '' : null }, '← 上一张'),
    el('button', { class: 'btn', onclick: () => goRel(1), disabled: idx === visibleIllustrations.length-1 ? '' : null }, '下一张 →'),
  ));
}

function renderAnnotationInfoPanel(img, ann) {
  const panel = el('section', { class: 'annotation-info-panel' });
  panel.appendChild(el('div', { class: 'form-section-title', style: 'margin:0 0 8px;' }, '标注信息'));
  panel.appendChild(field('插图编号', renderIllustrationIdentityCard(img)));
  const grid = el('div', { class: 'annotation-info-grid' });
  const typeLabel = ILLUSTRATION_TYPES.find(t => t.value === ann.type)?.label || ann.academicClass || ann.type || '';
  const rows = [
    ['插图名称', ann.illustrationName],
    ['插图类型', [typeLabel, ann.academicSubclass].filter(Boolean).join(' · ')],
    ['主要对象', ann.subject],
  ];
  rows.forEach(([label, value]) => {
    if (!value) return;
    grid.appendChild(el('div', { class: 'annotation-info-item' },
      el('span', null, label),
      el('b', null, value),
    ));
  });
  panel.appendChild(grid);

  // 对应原文（对照用，只读展示）
  const corrText = _browseTextValue(ann.correspondingText);
  if (corrText) {
    panel.appendChild(el('details', { class: 'annotation-info-detail', open: true },
      el('summary', null, '对应原文'),
      el('div', null, corrText)));
  }

  // 经脉 / 穴位：仅经穴图类型展示
  if (isBodyLikeAnnotation(ann)) {
    const bodyBits = [];
    if (ann.meridian) bodyBits.push(`经脉：${ann.meridian}`);
    if (Array.isArray(ann.points) && ann.points.length) bodyBits.push(`穴位：${ann.points.join('、')}`);
    if (bodyBits.length) {
      panel.appendChild(el('details', { class: 'annotation-info-detail', open: true },
        el('summary', null, '经脉 / 穴位'),
        el('div', null, bodyBits.join('\n'))));
    }
  }

  panel.appendChild(renderAiReferencePanel(img, ann));
  return panel;
}

function renderAiReferencePanel(img, ann = {}, { includeContext = true } = {}) {
  // C 区：模型原始输出，只读、默认折叠、不参与日常审核。
  // 数据来自 aiDraft（冻结原始）；aiVerdict/confidence 仍供论文指标与导出统计。
  const raw = (img && img.aiDraft) ? img.aiDraft : ann;
  const panel = el('details', { class: 'annotation-info-detail ai-reference-panel' });
  panel.appendChild(el('summary', null, 'AI 原始输出'));
  const body = el('div', null);
  const lines = [
    `图文互证：${raw.aiVerdict || '未判断'}`,
    `置信度：${confLabel(raw.confidence) || raw.confidence || '未判断'}`,
  ];
  if (raw.correspondingText) lines.push(`对应原文（原始）：${_browseTextValue(raw.correspondingText)}`);
  const rawVisualDescription = getVisualDescription(raw);
  if (rawVisualDescription) lines.push(`画面描述（原始）：${rawVisualDescription}`);
  if (raw.aiVerdictNote) lines.push(`图文互证说明：${raw.aiVerdictNote}`);
  if (raw.aiInterpretation && raw.aiInterpretation !== rawVisualDescription) lines.push(`AI 解读：${raw.aiInterpretation}`);
  if (raw.note) lines.push(`模型备注：${raw.note}`);
  if (img?.annotationEvidence?.ocrRiskNote) lines.push(`OCR 风险提示：${img.annotationEvidence.ocrRiskNote}`);
  body.textContent = lines.filter(Boolean).join('\n\n');
  panel.appendChild(body);
  if (includeContext) {
    const ctx = buildAiCtxRefBlock(img);
    if (ctx) panel.appendChild(ctx);
  }
  return panel;
}

/* ── 完整标注表单（审核模式右侧面板）───────────────────────────────── */
function renderFullAnnotationForm(root, img) {
  // 来源行
  if (img.source || img.page) {
    const srcBar = el('div', {
      style: 'padding:5px 12px; background:#f7f8fa; border-bottom:1px solid var(--c-border); font-size:12px; color:var(--c-text-mute); display:flex; gap:10px; flex-wrap:wrap;'
    });
    if (img.source) srcBar.appendChild(el('span', null, '📗 ' + img.source));
    if (img.page)   srcBar.appendChild(el('span', null, img.page));
    if (img.pdfSource?.dynasty) srcBar.appendChild(el('span', null, img.pdfSource.dynasty));
    root.appendChild(srcBar);
  }

  const st = STATUSES[img.status];
  const ann = getReviewFormAnnotation(img);
  const visionSupported = providerSupportsVisionTasks();
  const visionMsg = getVisionUnsupportedMessage('图像标注');

  // status card
  const card = el('div', { class: 'status-card' });
  card.appendChild(el('div', { class: 'meta-row' },
    el('span', { class: 'pill ' + st.pill }, el('span', { class: 'dot' }), st.label),
    el('span', { class: 'small' }, img.id),
  ));
  if (img.bookRef) {
    card.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute)' },
      `来源：${img.bookRef}`));
  }
  card.appendChild(el('div', { class: 'small' },
    img.annotatedAt
      ? `AI 标注于 ${fmtDate(img.annotatedAt)} · 模型：${img.modelUsed || '—'}`
      : '尚未进行 AI 标注'));
  if (img.reviewMeta?.humanEditedAt) {
    card.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute)' },
      `人工最后修改于 ${fmtDate(img.reviewMeta.humanEditedAt)}`));
  }
  if (!visionSupported) {
    card.appendChild(el('div', {
      class: 'small',
      style: 'margin-top:8px; color:#8a7a4a; line-height:1.7;'
    }, '当前提供商仅支持文本接口，AI 标注、页面 OCR、批量标注已禁用。请先切换到 Qwen、OpenAI、Gemini 等视觉模型。'));
  }

  const actions = el('div', { class: 'status-actions' });
  if (img.status === 'todo') {
    actions.appendChild(el('button', {
      class: 'btn primary',
      ...(visionSupported ? {} : { disabled: '', title: visionMsg }),
      onclick: () => { if (visionSupported) runAI(img.id); }
    }, visionSupported ? '▶ 运行 AI 标注' : '当前模型不支持图像标注'));
  } else if (img.status === 'running') {
    actions.appendChild(el('button', { class: 'btn primary', disabled: '' }, '⟳ 标注中…'));
  } else {
    const hasPendingReviewDraft = getPendingReviewChanges(img).length > 0;
    if (img.status !== 'ok') {
      const confirmBlocked = hasPendingReviewDraft && !HUMAN_REVIEW_REASONS.includes(img.reviewMeta?.pendingReason || '');
      actions.appendChild(el('button', {
        class: 'btn success',
        ...(confirmBlocked ? { disabled: '', title: '请先在核心标注下方选择本次修改原因并保存' } : {}),
        onclick: async () => {
        await commitReviewQueueDecision(img.id, 'confirm');
      }}, confirmBlocked ? '需先归因保存' : '✓ 确认'));
    } else {
      actions.appendChild(el('button', { class: 'btn', onclick: async () => setStatus(img.id, 'review', { blocking: true }) }, '↺ 取消确认'));
    }
    actions.appendChild(el('button', {
      class: 'btn',
      ...(visionSupported && !hasPendingReviewDraft ? {} : { disabled: '', title: hasPendingReviewDraft ? '请先保存当前修改，再重新运行 AI' : visionMsg }),
      onclick: () => { if (visionSupported && !hasPendingReviewDraft) runAI(img.id); }
    }, visionSupported ? '⟳ 重新运行 AI（覆盖当前草稿）' : '当前模型不支持图像标注'));
  }
  card.appendChild(actions);
  root.appendChild(card);

  // ── 标注摘要行（已有标注结果时展示，一眼看出核心结论）──────────────────
  if (img.status !== 'todo' && img.status !== 'running') {
    const badges = [];
    // 插图类型
    const typeLabel = ILLUSTRATION_TYPES.find(t => t.value === ann.type)?.label;
    badges.push(el('span', { class: 'ann-summary-badge' + (typeLabel ? '' : ' empty') },
      typeLabel ? '🖼 ' + typeLabel : '类型未填'));
    // 描绘对象
    if (ann.subject) {
      badges.push(el('span', { class: 'ann-summary-badge subject', title: ann.subject },
        '📌 ' + ann.subject));
    }
    if (badges.length) {
      const summaryRow = el('div', { class: 'ann-summary-row' });
      badges.forEach(b => summaryRow.appendChild(b));
      root.appendChild(summaryRow);
    }
  }

  // form
  root.appendChild(el('div', { class: 'form-section-title' }, '核心标注'));

  // 插图编号（只读检索主键）+ 名称（可编辑，名称与主要描绘对象分离）
  root.appendChild(field('插图编号', renderIllustrationIdentityCard(img)));
  root.appendChild(field('插图名称',
    el('input', { type:'text', value: ann.illustrationName || '',
      placeholder: '只写图的主要内容；优先题签，不写解释、异名或推测说明',
      onfocus: e => { e.target._v2Before = e.target.value; },
      // Gate 2.2 A：oninput 不修改 annotation/aiDraft，不调用 noteHumanEdit/persist/bridge；仅由 onchange 统一提交
      onchange: e => {
        const before = e.target._v2Before != null ? e.target._v2Before : (ann.illustrationName || '');
        const after = e.target.value;
        stageTrackedFieldEdit(img, 'illustrationName', before, after, ed => { ed.illustrationName = after; });
        renderLeftList(); renderForm();
      } })));
  // 插图名称拼音：自动按名称生成（后端 pypinyin），多音字/生僻字可手改；手改后标 human 不被自动覆盖。
  root.appendChild(field('名称拼音',
    el('div', { style:'display:flex; gap:6px; align-items:center;' },
      el('input', { type:'text', style:'flex:1; min-width:0;', value: ann.illustrationNamePinyin || '',
        placeholder: '按名称自动生成；多音字/生僻字可手改',
        onfocus: e => { e.target._v2Before = e.target.value; },
        // Gate 2.2 A：oninput 不落盘；仅 onchange 统一提交
        onchange: e => {
          const before = e.target._v2Before != null ? e.target._v2Before : (ann.illustrationNamePinyin || '');
          const after = e.target.value;
          stageTrackedFieldEdit(img, 'illustrationNamePinyin', before, after, ed => { ed.illustrationNamePinyin = after; ed.pinyinSource = 'human'; });
          renderForm();
        } }),
      el('button', { class:'btn tiny', title:'按当前名称自动重新生成（覆盖人工值）',
        onclick: async () => { await seedNamePinyin(img, { force:true }); renderForm(); } }, '↻ 自动'))));

  // 插图类型（12类主分类）
  root.appendChild(field('插图类型', selectInput(ILLUSTRATION_TYPES, ann.type || '', v => {
    const before = ann.type || '';
    stageTrackedFieldEdit(img, 'type', before, v, ed => {
      ed.type = v;
      ed.academicClass = v || null;
      ed.academicSubclass = normalizeAcademicSubclass(v, ed.academicSubclass);
    });
    renderForm();
  })));
  const selectedAcademicClass = getAcademicClassMeta(ann.type || '');
  if (selectedAcademicClass && selectedAcademicClass.subclasses.length > 0) {
    const subtypeSel = selectInput(
      getSelectableAcademicSubclasses(selectedAcademicClass.value).map(s => ({
        value: s,
        label: s === UNSPECIFIED_ACADEMIC_SUBCLASS ? `（${s}）` : s,
      })),
      ann.academicSubclass || '',
      v => {
        const before = ann.academicSubclass || '';
        const newSub = normalizeAcademicSubclass(selectedAcademicClass.value, v);
        stageTrackedFieldEdit(img, 'academicSubclass', before, newSub, ed => { ed.academicSubclass = newSub; });
        renderForm();
      }
    );
    root.appendChild(field('具体分类 *', subtypeSel));
  }

  // 多图归属是导出策略字段，日常审核不再展示，避免干扰人工确认主字段。
  // 底层 multiIllustrationRelation / multiIllustrationNote 与导出逻辑仍保留。

  // 跨页连图功能暂时隐藏入口，后续重构（helper getContinuationMeta/getDisplayIllustrationItems 等保留为惰性：
  // 无 UI 可设置 continuationGroupId，故所有连图分支退化为单图，owner 漂移 bug 物理上不会触发）。

  // 主要描绘对象
  root.appendChild(field('主要描绘对象', el('input', { type:'text',
    value: ann.subject || '',
    placeholder: '与插图名称同一口径：短名/主要内容，不写解释或证据。',
    onfocus: e => { e.target._v2Before = e.target.value; },
    // Gate 2.2 A：oninput 不落盘；仅 onchange 统一提交
    onchange: e => {
      const before = e.target._v2Before != null ? e.target._v2Before : (ann.subject || '');
      const after = e.target.value;
      stageTrackedFieldEdit(img, 'subject', before, after, ed => { ed.subject = after; });
      renderLeftList(); renderForm();
    },
  })));

  // 画面描述：只写可直接观察的主体、人物数量、动作、器具与必要环境。
  // 仿刻来源、版本谱系和“仿某书某图”属于后续研究层，不进入基础数字化标注。
  const visualDescriptionInput = el('textarea', {
    placeholder: '1至2句，只描述画面事实。例如：图中二人在山石间持工具作业，旁置筐具。',
    onfocus: e => { e.target._v2Before = e.target.value; },
    onchange: e => {
      const before = e.target._v2Before != null ? e.target._v2Before : getVisualDescription(ann);
      const after = e.target.value.trim();
      stageTrackedFieldEdit(img, 'visualDescription', before, after, ed => {
        ed.visualDescription = after;
      });
      renderForm();
    },
  });
  // textarea 不支持通过 value HTML 属性设置初始文本，必须写 DOM value 属性。
  visualDescriptionInput.value = getVisualDescription(ann);
  root.appendChild(field('画面描述', visualDescriptionInput));

  // 经脉 / 穴位：仅经穴图类型出现（A 区可编辑，做好类型区分）
  // Gate 2.1 A / Gate 2.2 A：meridian/points 属 REVIEW_TRACK_FIELDS，编辑必须经 commitTrackedFieldEdit
  if (isBodyLikeAnnotation(ann)) {
    root.appendChild(field('经脉名称', el('input', { type:'text',
      value: ann.meridian || '',
      placeholder: '经脉名称',
      onfocus: e => { e.target._v2Before = e.target.value; },
      // Gate 2.2 A：oninput 不落盘；仅 onchange 统一提交
      onchange: e => {
        const before = e.target._v2Before != null ? e.target._v2Before : (ann.meridian || '');
        const after = e.target.value;
        stageTrackedFieldEdit(img, 'meridian', before, after, ed => { ed.meridian = after; });
        renderForm();
      },
    })));
    // chipInput 在 onChange 内捕获 before（chip 增删即提交）
    root.appendChild(field('穴位列表', chipInput(ann.points || [], (list, _meta) => {
      const before = ann.points || [];
      const beforeStr = JSON.stringify(before);
      const afterStr = JSON.stringify(list);
      if (beforeStr === afterStr) return;
      stageTrackedFieldEdit(img, 'points', before, list, ed => { ed.points = list; });
      renderForm();
    })));
  }

  // ── Task 21 v2：修改归因与保存（位于核心标注之后）──────────────────
  // 用户先完成字段编辑；只有选择原因并点击保存，草稿才写入正式数据。
  if (img.status !== 'todo' && img.status !== 'running') {
    img.reviewMeta = img.reviewMeta || {};
    const pendingChanges = getPendingReviewChanges(img);
    const pendingCount = pendingChanges.length;
    const curPending = img.reviewMeta.pendingReason || '';
    const reasonLabels = {
      model_error: '模型错误（写错/判错）',
      model_omission: '模型漏填',
      evidence_enrichment: '证据补充',
      ocr_correction: 'OCR 校字',
      normalization: '规范化（用语/格式）',
      other: '其他',
    };
    const rsCard = el('div', {
      class: 'status-card',
      style: `gap:8px; margin-top:12px;${pendingCount ? ' border-color:#d69b39; background:#fffaf0;' : ''}`,
    });
    rsCard.appendChild(el('div', { class: 'form-section-title', style: 'margin:0' }, '修改归因与保存'));
    rsCard.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute); line-height:1.6;' },
      `审核条件：${describeDerivedReviewMode(img)}（系统自动识别）`));
    rsCard.appendChild(el('div', {
      class: 'small',
      style: `font-weight:700; color:${pendingCount ? '#a96210' : 'var(--c-text-mute)'};`,
    }, pendingCount ? `已有 ${pendingCount} 个字段修改尚未保存` : '当前没有未保存的字段修改'));

    const reasonSel = el('select', {
      style: 'flex:1; min-width:0;' + (pendingCount && !curPending ? ' border-color:#c87918;' : ''),
      ...(pendingCount ? {} : { disabled: '', title: '请先修改字段' }),
      onchange: e => { setPendingReason(img, e.target.value); renderForm(); },
    },
      el('option', { value: '' }, pendingCount ? '请选择本次修改原因' : '请先修改字段'),
      ...HUMAN_REVIEW_REASONS.map(r => el('option', { value: r, ...(r === curPending ? { selected: '' } : {}) },
        reasonLabels[r] || r)));
    rsCard.appendChild(el('div', { class: 'field', style: 'margin:0' },
      el('label', { style: 'font-size:12px' }, pendingCount ? '本次修改原因（保存前必选）' : '本次修改原因'),
      reasonSel));

    const canSave = pendingCount > 0 && HUMAN_REVIEW_REASONS.includes(curPending);
    const saveBtn = el('button', {
      class: 'btn success',
      ...(canSave ? {} : { disabled: '', title: pendingCount ? '请先选择本次修改原因' : '没有需要保存的修改' }),
      onclick: async () => {
        const result = await savePendingTrackedEdits(img, { blocking: true });
        if (result.needsReason) {
          toast('⚠ 已修改字段，请先选择本次修改原因', 'warn');
          renderForm();
          return;
        }
        if (!result.saved) {
          toast('保存失败，草稿仍保留在当前页面，请重试', 'error');
          renderForm();
          return;
        }
        if (result.changed) toast(`✓ 已保存 ${result.changes.length} 个字段修改及归因`, 'success');
        renderAll();
        renderRightTab();
      },
    }, pendingCount ? `保存修改（${pendingCount}）` : '保存修改');
    rsCard.appendChild(el('div', { style: 'display:flex; justify-content:flex-end;' }, saveBtn));
    if (pendingCount && !curPending) {
      rsCard.appendChild(el('div', { class: 'small', style: 'color:#a96210; line-height:1.6;' },
        '⚠ 修改目前只保存在页面草稿中；选择原因后才能保存或确认。'));
    }
    rsCard.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute); line-height:1.6;' },
      '一次保存中的全部字段使用同一修改原因；系统会分别记录每个字段的变化。'));
    root.appendChild(rsCard);
  }

  // C 区：AI 原始输出（只读折叠，追溯 + 论文指标）
  root.appendChild(renderAiReferencePanel(img, ann));

}

function confLabel(k) {
  return { high: '高', mid: '中', low: '低' }[k] || '';
}
function confKey(label) {
  return { '高': 'high', '中': 'mid', '低': 'low' }[label] || '';
}

function field(label, control) {
  return el('div', { class: 'field' },
    el('label', null, label),
    control,
  );
}
function textInput(value, onChange, placeholder = '') {
  const inp = el('input', { type: 'text', value: value || '', placeholder, oninput: e => onChange(e.target.value) });
  return inp;
}
function selectInput(opts, value, onChange) {
  // opts 支持字符串数组或 {value, label} 对象数组
  const sel = el('select', { onchange: e => onChange(e.target.value) },
    el('option', { value: '' }, '— 请选择 —'),
    ...opts.map(o => {
      const v = (typeof o === 'object') ? o.value : o;
      const lbl = (typeof o === 'object') ? o.label : o;
      return el('option', { value: v, ...(v === value ? { selected: '' } : {}) }, lbl);
    }),
  );
  return sel;
}
function radioGroup(opts, value, onChange) {
  const wrap = el('div', { class: 'radio-group' });
  for (const o of opts) {
    const lab = el('label', { class: value === o ? 'on' : '', onclick: () => onChange(o) },
      el('input', { type: 'radio', ...(value === o ? { checked: '' } : {}) }),
      o,
    );
    wrap.appendChild(lab);
  }
  return wrap;
}
function multiTags(opts, value, onChange) {
  const wrap = el('div', { class: 'multi-tags' });
  for (const o of opts) {
    const on = value.includes(o);
    wrap.appendChild(el('label', {
      class: on ? 'on' : '',
      onclick: () => {
        const next = on ? value.filter(x => x !== o) : [...value, o];
        onChange(next);
        renderForm();
      },
    }, el('input', { type: 'checkbox' }), o));
  }
  return wrap;
}
function chipInput(value, onChange) {
  const wrap = el('div', { class: 'chip-input' });
  for (const v of value) {
    wrap.appendChild(el('span', { class: 'chip' },
      v,
      el('button', {
        title: '删除',
        onclick: () => { onChange(value.filter(x => x !== v)); renderForm(); },
      }, '×'),
    ));
  }
  const inp = el('input', {
    type: 'text', placeholder: '回车添加…',
    onkeydown: e => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        const next = [...value, e.target.value.trim()];
        e.target.value = '';
        onChange(next);
        renderForm();
      }
    },
  });
  wrap.appendChild(inp);
  return wrap;
}

/* ============================================================
   STATS TAB
   ============================================================ */
function renderStats() {
  const root = $('#tab-stats');
  root.innerHTML = '';
  const c = countByStatus();
  const total = state.illustrations.length || 1;
  const pct = Math.round(c.ok / total * 100);

  const grid = el('div', { class: 'stat-grid' },
    statCell('ok',     '已确认', c.ok),
    statCell('review', '待审核', c.review),
    statCell('bad',    '有问题', c.bad),
    statCell('todo',   '未标注', c.todo + c.running),
  );
  root.appendChild(grid);

  const prog = el('div', { class: 'progress-wrap' },
    el('div', { class: 'pct' },
      el('span', null, '总体进度'),
      el('span', null, `${pct}%`),
    ),
    el('div', { class: 'progress-bar' },
      el('div', { style: `width: ${pct}%` }),
    ),
  );
  root.appendChild(prog);

  // type chart
  root.appendChild(el('div', { class: 'chart-section' },
    el('h4', null, '插图类型分布'),
    ...typeBars(),
  ));

  // conf chart
  root.appendChild(el('div', { class: 'chart-section' },
    el('h4', null, '置信度分布'),
    ...confBars(),
  ));

  // quick actions
  const todoCount = c.todo;
  root.appendChild(el('h4', { style: 'margin-top:18px' }, '快速操作'));
  root.appendChild(el('button', {
    class: 'btn primary full lg',
    disabled: todoCount === 0 ? '' : null,
    onclick: () => runBatch(),
    style: 'margin-bottom:8px'
  }, todoCount > 0 ? `▶ 一键运行所有未标注（${todoCount}）` : '所有图片已标注'));

  root.appendChild(el('button', {
    class: 'btn full',
    onclick: () => exportData('html'),
  }, '📊 导出当前统计报告'));

  // Task 21 v2：审核评价统计导出（JSON + TXT，按字段层级/原因/证据模式/审核模式/版本分组）
  root.appendChild(el('h4', { style: 'margin-top:18px' }, '审核评价契约 v2'));
  root.appendChild(el('div', { class: 'small', style: 'color:var(--c-text-mute); margin-bottom:8px; line-height:1.7;' },
    '导出字段级归因、有效审核时间与版本上下文统计（JSON + TXT）。统计为候选—终稿差异及归因，reviewDiff=0 不等于 AI 正确，不构成准确率。'));
  root.appendChild(el('button', {
    class: 'btn primary full',
    onclick: () => exportEvalStats(),
  }, '📋 导出审核评价统计（JSON + TXT）'));
}
function countByStatus() {
  const c = { todo: 0, running: 0, review: 0, ok: 0, bad: 0 };
  for (const i of state.illustrations) c[i.status]++;
  return c;
}
function statCell(cls, label, value) {
  return el('div', { class: 'stat-cell ' + cls },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value)),
  );
}
function typeBars() {
  const counts = {};
  for (const t of ILLUSTRATION_TYPES) counts[t.value] = 0;
  for (const img of state.illustrations) {
    const t = img.annotation?.type;
    if (t && counts[t] !== undefined) counts[t]++;
  }
  const max = Math.max(1, ...Object.values(counts));
  return ILLUSTRATION_TYPES.map(t =>
    el('div', { class: 'bar-row' },
      el('span', { class: 'name' }, t.label),
      el('div', { class: 'bar' }, el('div', { style: `width: ${counts[t.value]/max*100}%` })),
      el('span', { class: 'n' }, String(counts[t.value])),
    ),
  );
}
function confBars() {
  const c = { high: 0, mid: 0, low: 0 };
  for (const img of state.illustrations) {
    const k = img.annotation?.confidence;
    if (k && c[k] !== undefined) c[k]++;
  }
  const labels = { high: '高', mid: '中', low: '低' };
  return ['high','mid','low'].map(k =>
    el('div', { class: 'conf-row' },
      el('span', { class: 'name' }, labels[k]),
      el('span', { class: 'dots' }, '●'.repeat(c[k]) || '·'),
      el('span', { class: 'n' }, String(c[k])),
    ),
  );
}

/* ============================================================
   ACTIONS
   ============================================================ */
function selectImage(id) {
  // Task 21 v2: 切换记录时结算前一条记录的有效审核时间
  const prevImg = state.selectedId ? state.illustrations.find(i => i.id === state.selectedId) : null;
  if (prevImg && prevImg._activeSessionId) {
    settleCurrentSegment(prevImg, 'switch');
    persistImage(prevImg);
  }
  state.selectedId = id;
  // 为新记录开启审核 session
  const nextImg = id ? state.illustrations.find(i => i.id === id) : null;
  if (nextImg) {
    startReviewSession(nextImg);
  }
  persist();
  renderAll();
}
async function setStatus(id, status, { blocking = false, skipRender = false } = {}) {
  const img = state.illustrations.find(i => i.id === id);
  if (!img) return false;
  const prevStatus = img.status;
  img.status = status;
  const saved = blocking ? await persistImageBlocking(img) : (persistImage(img), true);
  if (blocking && !saved) {
    img.status = prevStatus;
    try { localStorage.setItem(LS_KEY, JSON.stringify(buildUiSnapshot())); } catch (e) {}
  }
  if (!skipRender) {
    renderAll();
    renderRightTab();
  }
  return saved;
}
// 生成规范编号：{名称}_{书名简码}_{页码}_{页内序号}
function generateCanonicalId(img) {
  const ann = img.annotation || img.aiDraft || {};
  // 名称优先级：插图名称 > 繁体药名 > unknown；不再用主要描绘对象生成编号。
  const rawName = (ann.illustrationName || ann.herbClassical || 'unknown').trim();
  const name = rawName.replace(/[\s　·•·《》【】（）()[\]]/g, '').slice(0, 10) || 'unknown';
  // 书名简码：取 title 前4字（去标点）
  const book = img.pdfSource ? (state.books || []).find(b => b.id === img.pdfSource.bookId) : null;
  const bookCode = book
    ? (book.shortCode || (book.title || '').replace(/[《》\s\[\]【】（）()]/g, '').slice(0, 4) || 'BOOK')
    : 'BOOK';
  // 页码（3位补零）
  const pageNum = img.pdfSource?.pageNum ? String(img.pdfSource.pageNum).padStart(3, '0') : '000';
  // 页内序号（同书同页的图按内部 id 排序，1起步，2位补零）
  const samePageImgs = (state.illustrations || [])
    .filter(i => i.pdfSource?.bookId === img.pdfSource?.bookId && i.pdfSource?.pageNum === img.pdfSource?.pageNum)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const seqIdx = samePageImgs.findIndex(i => i.id === img.id);
  const seq = String(seqIdx >= 0 ? seqIdx + 1 : 1).padStart(2, '0');
  return `${name}_${bookCode}_p${pageNum}_${seq}`;
}

async function confirmAnnotation(id, { blocking = false, skipRender = false } = {}) {
  const img = state.illustrations.find(i => i.id === id);
  if (!img) return false;
  if (getPendingReviewChanges(img).length) {
    const pendingSave = await savePendingTrackedEdits(img, { blocking: true });
    if (pendingSave.needsReason) {
      toast('⚠ 已修改字段，请先在核心标注下方选择原因并保存', 'warn');
      renderForm();
      return false;
    }
    if (!pendingSave.saved) {
      toast('保存修改失败，草稿仍保留在当前页面，请重试', 'error');
      renderForm();
      return false;
    }
  }
  const prev = {
    status: img.status,
    canonicalId: img.canonicalId,
    verifiedAt: img.verifiedAt,
    hasCanonicalId: Object.prototype.hasOwnProperty.call(img, 'canonicalId'),
    hasVerifiedAt: Object.prototype.hasOwnProperty.call(img, 'verifiedAt'),
  };
  const annOwner = getAnnotationOwnerRecord(img);
  const ann = annOwner.annotation || annOwner.aiDraft || {};
  // 重标规范 v1：细分类仅在证据清楚时填写，缺失不再阻塞确认。
  // 赋规范编号
  img.canonicalId = generateCanonicalId(img);
  img.status = 'ok';
  img.verifiedAt = Date.now();
  // Task 21 v2: 确认保存时结算有效审核时间
  if (img._activeSessionId) {
    settleCurrentSegment(img, 'save');
  }
  const saved = blocking ? await persistImageBlocking(img) : (persistImage(img), true);
  if (blocking && !saved) {
    img.status = prev.status;
    if (prev.hasCanonicalId) img.canonicalId = prev.canonicalId;
    else delete img.canonicalId;
    if (prev.hasVerifiedAt) img.verifiedAt = prev.verifiedAt;
    else delete img.verifiedAt;
    try { localStorage.setItem(LS_KEY, JSON.stringify(buildUiSnapshot())); } catch (e) {}
  }
  if (!skipRender) {
    renderAll();
    renderRightTab();
  }
  toast(saved ? `✓ 已确认  ${img.canonicalId}` : `保存失败，已撤回本次确认，请检查 bridge.py 后重试`, saved ? 'success' : 'error');
  return saved;
}

/* ----- Mock AI ----- */
function mockAnnotate(img) {
  const key = img.name;
  const facts = MOCK_FACTS[key] || null;
  if (facts) {
    const migrated = inferAcademicClassificationFromAnnotation({
      legacyType: facts.typeKey,
      subject: img.name,
      herbClassical: ['PLANT','ANIMAL','MINERAL','PROCESSED'].includes(facts.typeKey) ? img.name : '',
      herbModern: ['PLANT','ANIMAL','MINERAL','PROCESSED'].includes(facts.typeKey) ? img.name : '',
      species: facts.species || '',
      parts: facts.parts || [],
      meridian: facts.meridian || '',
      points: facts.points || [],
      note: 'AI 自动生成，请人工审核。',
    });
    return {
      type: migrated.type,
      academicClass: migrated.academicClass,
      academicSubclass: migrated.academicSubclass,
      legacyType: migrated.legacyType,
      subject: img.name,
      illustrationName: img.name,
      confidence: facts.confidence,
      herbClassical: '',
      correspondingText: '',
      procedureStep: '',
      uncertaintyNote: 'Mock 仅用于界面演示，不含原文证据。',
    };
  }
  // generic fallback — 直接输出 12 类（药物图），不再经 legacyType 映射
  return {
    type: '药物图',
    academicClass: '药物图',
    academicSubclass: '药物形态图',
    legacyType: '',
    subject: img.name,
    illustrationName: img.name,
    confidence: 'mid',
    herbClassical: '',
    correspondingText: '',
    procedureStep: '',
    uncertaintyNote: 'Mock 仅用于界面演示，不含原文证据。',
  };
}

// ── AI 标注核心逻辑 ──────────────────────────────────────────────────────
let _bridgeAvailable = null; // null=未检测, true/false
let _bridgeStatus = null;
let _bridgeProbedAt = 0;          // 上次探测时间戳(ms)，用于 TTL 重探
const BRIDGE_PROBE_TTL = 30000;   // 探测结果缓存 30s，过期后 checkBridge 自动重探（兼顾自愈与标注密集场景下的探测频率）

function currentDatasetId() {
  return _bridgeStatus?.data_source?.id || '';
}

function isDataSourceReadOnly() {
  return _bridgeStatus?.data_source?.read_only === true;
}

function renderDataSourceBadge(status = _bridgeStatus) {
  const badge = document.getElementById('data-source-badge');
  if (!badge) return;
  const source = status?.data_source;
  badge.classList.remove('production', 'isolated');
  if (!source) {
    badge.textContent = status?.ok === false ? '数据源未连接' : '数据源检测中';
    badge.title = '未能读取本地数据源身份';
    document.body.classList.remove('data-source-readonly');
    return;
  }
  badge.classList.add(source.read_only ? 'production' : 'isolated');
  const bookCount = Number.isFinite(Number(source.book_count)) ? `${Number(source.book_count)}册 · ` : '';
  badge.textContent = `${source.label || source.id || '本地数据'} · ${bookCount}${source.read_only ? '只读' : '可写'}`;
  badge.title = [
    `datasetId=${source.id || '未设置'}`,
    source.path ? `数据目录=${source.path}` : '',
    source.read_only ? '禁止修改正式数据' : '允许保存新标注',
  ].filter(Boolean).join('；');
  document.body.classList.toggle('data-source-readonly', source.read_only === true);
}

function applyBridgeStatusToConfig(status) {
  if (!status || !status.ok) return;
  // 用户已手动保存过配置时，不用 bridge 状态覆盖
  if (config._userConfigured) return;
  const provider = status.provider;
  const model = status.model;
  if (provider && provider !== '未配置') {
    config.provider = provider;
  }
  const MODEL_FIELD_MAP = {
    qwen: 'qwenModel',
    openai: 'openaiModel',
    deepseek: 'deepseekModel',
    kimi: 'kimiModel',
    doubao: 'doubaoModel',
    zhipu: 'zhipuModel',
    gemini: 'geminiModel',
    baidu: 'baiduModel',
  };
  const modelField = MODEL_FIELD_MAP[provider];
  if (modelField && model && model !== '未配置') {
    config[modelField] = model;
  }
}

async function checkBridge() {
  // 缓存仍新鲜（< TTL）才直接返回；_bridgeAvailable === null（未探测/被重连重置）总是重探
  if (_bridgeAvailable !== null && (Date.now() - _bridgeProbedAt) < BRIDGE_PROBE_TTL) {
    return _bridgeAvailable;
  }
  const wasAvailable = _bridgeAvailable;
  try {
    const r = await fetch(BRIDGE_STATUS_URL, { signal: AbortSignal.timeout(3000) });
    _bridgeProbedAt = Date.now();
    if (!r.ok) {
      _bridgeAvailable = false;
      return _bridgeAvailable;
    }
    const j = await r.json();
    _bridgeStatus = j;
    renderDataSourceBadge(j);
    _bridgeAvailable = !!j.ok;
    // 仅在“首次可用 / 从不可用恢复”时同步配置，避免 TTL 重探时每 4s 反复回写 config
    if (_bridgeAvailable && wasAvailable !== true) {
      applyBridgeStatusToConfig(j);
      persistConfig();
    }
  } catch {
    _bridgeProbedAt = Date.now();
    _bridgeAvailable = false;
    renderDataSourceBadge({ ok: false });
  }
  return _bridgeAvailable;
}

async function imgToBase64(img) {
  let lastError = null;
  if (img?.pdfSource) {
    const book = getBook(img.pdfSource.bookId);
    const page = getPageRecord(img);
    const quad = normalizeQuad(img.pdfSource.cropQuad) || normalizeQuad(img.pdfSource.annotateQuad);
    const rect = normalizeRect(img.pdfSource.annotateRect)
      || normalizeRect(img.pdfSource.cropRect)
      || getPageAnnotateRect(page, img.pdfSource.selectionMode || '');
    const rotationDeg = clampCropRotationDeg(img.pdfSource.rotationDeg || 0);
    if (book && page && rect) {
      // 优先服务端高清裁剪（清晰+快）；失败回退 pdf.js
      const hi = await cropFromHiRes(book, page, rect, 1100, rotationDeg, quad);
      if (hi) return hi.split(',')[1] || '';
      const doc = pdfDocs[book.id] || await ensurePdfDoc(book).catch(() => null);
      if (doc) {
        try {
          const dataUrl = await renderPageRectDataUrl(doc, pdfPageOf(page), rect, 960, 0.9);
          if (dataUrl.startsWith('data:')) return dataUrl.split(',')[1] || '';
        } catch (e) {
          lastError = e;
          console.warn('imgToBase64 crop render failed', page.pageNum, e);
        }
      }
    }
  }
  // 从 URL 或 dataUrl 获取 base64
  const src = img.dataUrl || img.url || '';
  if (!src) {
    throw new Error(`图像加载失败：${img?.id || 'unknown'} 没有可用图片地址或裁剪结果`);
  }
  if (src.startsWith('data:')) return src.split(',')[1] || '';
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  } catch (e) {
    throw new Error(`图像加载失败：${img?.id || 'unknown'} (${e?.message || lastError?.message || 'fetch failed'})`);
  }
}

const _mergeCompositeCache = new Map();

function _mergeCompositeCacheKey(items, maxLong) {
  return `${items.map(item => [
    item?.id || '',
    item?.pdfSource?.pageNum || '',
    JSON.stringify(item?.pdfSource?.annotateRect || item?.pdfSource?.cropRect || []),
    JSON.stringify(item?.pdfSource?.annotateQuad || item?.pdfSource?.cropQuad || []),
    item?.pdfSource?.rotationDeg || 0,
  ].join(':')).join('|')}@${maxLong}`;
}

function _loadCompositeSource(base64) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('合并图来源裁图无法加载'));
    image.src = `data:image/jpeg;base64,${base64}`;
  });
}

async function buildMergedIllustrationDataUrlFromItems(items, maxLong = 1800) {
  const records = (items || []).map(item => item?.img || item).filter(Boolean);
  if (records.length < 2) {
    const only = records[0];
    return only ? `data:image/jpeg;base64,${await imgToBase64(only)}` : '';
  }
  const key = _mergeCompositeCacheKey(records, maxLong);
  if (_mergeCompositeCache.has(key)) return _mergeCompositeCache.get(key);
  const pending = (async () => {
    const sources = await Promise.all(records.map(imgToBase64));
    const images = await Promise.all(sources.map(_loadCompositeSource));
    const layout = calculateMergeCompositeLayout(
      images.map(image => ({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })),
      maxLong,
      2,
    );
    if (!layout.width || !layout.height) throw new Error('合并图尺寸无效');
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建合并图画布');
    ctx.fillStyle = '#f7f3e9';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((image, index) => {
      const box = layout.items[index];
      ctx.drawImage(image, box.x, box.y, box.width, box.height);
    });
    return canvas.toDataURL('image/jpeg', 0.92);
  })();
  _mergeCompositeCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    _mergeCompositeCache.delete(key);
    throw error;
  }
}

async function buildMergedIllustrationDataUrl(img, maxLong = 1800) {
  return buildMergedIllustrationDataUrlFromItems(getDisplayIllustrationItems(img), maxLong);
}

async function getAnnotationImageBase64(img) {
  const owner = getAnnotationOwnerRecord(img);
  const items = getDisplayIllustrationItems(owner);
  if (Array.isArray(owner?.imageMerge?.items) && items.length > 1) {
    const dataUrl = await buildMergedIllustrationDataUrlFromItems(items, 1800);
    return dataUrl.split(',')[1] || '';
  }
  return imgToBase64(owner || img);
}

function renderMergedIllustrationImage(img, {
  maxLong = 1800,
  alt = '合并插图',
  style = '',
  className = 'merged-composite-image',
} = {}) {
  const image = el('img', { class: className, alt, style });
  image.setAttribute('aria-busy', 'true');
  buildMergedIllustrationDataUrl(img, maxLong)
    .then(src => {
      image.src = src;
      image.dataset.compositeReady = 'true';
      image.setAttribute('aria-busy', 'false');
    })
    .catch(error => {
      const fallback = getIllustrationViewUrl(getDisplayIllustrationItems(img)[0] || img, maxLong);
      if (fallback) image.src = fallback;
      image.dataset.compositeError = error?.message || '合并图生成失败';
      image.setAttribute('aria-busy', 'false');
      console.warn('render merged illustration failed', img?.id, error);
    });
  return image;
}

async function openIllustrationLightbox(img, fallbackSrc = '', maxLong = 2400) {
  const owner = getAnnotationOwnerRecord(img);
  if (Array.isArray(owner?.imageMerge?.items) && owner.imageMerge.items.length > 1) {
    try {
      const src = await buildMergedIllustrationDataUrl(owner, maxLong);
      if (src) return openLightbox(src);
    } catch (error) {
      console.warn('open merged illustration failed', owner?.id, error);
    }
  }
  if (fallbackSrc) openLightbox(fallbackSrc);
}

function parseAnnotationText(text) {
  // 从模型回复中提取 JSON（支持 markdown 代码块）
  const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (m) text = m[1];
  else { const s = text.indexOf('{'), e = text.lastIndexOf('}'); if (s !== -1 && e !== -1) text = text.slice(s, e+1); }
  try { return JSON.parse(text); }
  catch { return { parse_failed: true, raw_text: text.slice(0, 500) }; }
}

function normalizeEvidenceText(value) {
  return String(value || '').replace(/[\s，。、“”‘’：；·（）()\[\]【】]/g, '').trim();
}

function normalizeNullableAIText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return /^(?:null|none|undefined)$/i.test(text) ? '' : text;
}

function normalizeDirectionValue(value) {
  return normalizeNullableAIText(value)
    .replace(/^橫排/, '横排')
    .replace(/^豎排/, '竖排');
}

function expectedReadingOrderForDirection(direction) {
  if (/(?:右起|从右到左)/.test(direction || '')) return '右→左、自上而下';
  if (/(?:左起|从左到右)/.test(direction || '')) return '左→右、自上而下';
  return '';
}

function mapAIResponse(ai, rawText, {
  evidenceMode = '', finishReason = '', bookCtx = null, textSourceStatus = '',
} = {}) {
  // 把 AI 返回的嵌套 JSON 映射为前端表单使用的扁平格式
  // 优先级：新字段 academic_class/academic_subclass > 旧字段 image_type（兼容旧 prompt）
  const VALID_12 = new Set(['疾病图','诊法图','医疗图','药物图','器具图','养生图','脏腑图','经穴图','部位图','理论图','符咒图','人物图']);
  const qualityFlags = [];
  const resolvedFinishReason = finishReason || ai?._response_meta?.finish_reason || '';
  if (resolvedFinishReason === 'length') qualityFlags.push('output_truncated');
  if (ai?.parse_failed || isAIParseFailureText(ai?.content?.main_subject)) {
    const recovered = recoverAnnotationFromRawText(ai?.raw_text || rawText);
    if (recovered) {
      recovered.confidence = 'low';
      recovered.procedureStep = '';
      recovered._outputQualityFlags = [...new Set([...qualityFlags, 'parse_failed', 'recovered_partial_output'])];
      return recovered;
    }
  }
  const c = ai.content || {};
  const q = ai.image_quality || {};
  const parts = c.plant_parts_shown;
  const points = c.points_shown;
  const isMinimalV3 = Object.prototype.hasOwnProperty.call(ai, 'primary_subject') ||
    Object.prototype.hasOwnProperty.call(ai, 'illustration_name') ||
    Object.prototype.hasOwnProperty.call(ai, 'source_label');
  const mainSubject = normalizeNullableAIText(ai.primary_subject || c.main_subject);
  const explicitIllustrationName = cleanIllustrationName(normalizeNullableAIText(ai.illustration_name));
  let sourceLabel = normalizeNullableAIText(ai.source_label || c.source_label || c.herb_name_ancient);
  const textInImage = normalizeNullableAIText(ai.text_in_image);
  const expectedTextDirection = normalizeDirectionValue(bookCtx?.textDirection);
  const expectedTitleDirection = normalizeDirectionValue(bookCtx?.titleLabelDirection);
  let textDirection = normalizeDirectionValue(ai.text_direction);
  let readingOrderAssumed = normalizeNullableAIText(ai.reading_order_assumed);
  let titleLabelDirection = normalizeDirectionValue(ai.title_label_direction);
  const explicitTitleDirection = titleLabelDirection;
  // 插图裁图常只有横排题签，而书级 textDirection 描述的是正文竖排方向。
  // 当模型同时明确声明题签方向，且 text_direction 与该题签方向一致时，
  // 该值描述的是题签，不得误判为正文方向冲突。
  const textDirectionExplicitlyScopesToTitle = !!(
    expectedTitleDirection && (sourceLabel || textInImage) &&
    textDirection === expectedTitleDirection &&
    explicitTitleDirection === expectedTitleDirection
  );

  if (expectedTextDirection) {
    if (!textDirection || textDirection === '不明') {
      textDirection = expectedTextDirection;
      qualityFlags.push('text_direction_defaulted_from_book');
    } else if (textDirection !== expectedTextDirection) {
      if (textDirectionExplicitlyScopesToTitle) {
        qualityFlags.push('text_direction_scoped_to_title');
      } else {
        qualityFlags.push('text_direction_conflict');
      }
    }
  }
  const expectedReadingOrder = expectedReadingOrderForDirection(expectedTextDirection);
  if (expectedReadingOrder) {
    if (!readingOrderAssumed || readingOrderAssumed === '不明') {
      readingOrderAssumed = expectedReadingOrder;
      qualityFlags.push('reading_order_defaulted_from_book');
    } else if (readingOrderAssumed !== expectedReadingOrder) {
      qualityFlags.push('reading_order_conflict');
    }
  }
  if (expectedTitleDirection && (sourceLabel || textInImage)) {
    if (!titleLabelDirection || titleLabelDirection === '不明') {
      titleLabelDirection = expectedTitleDirection;
      qualityFlags.push('title_direction_defaulted_from_book');
    } else if (titleLabelDirection !== expectedTitleDirection) {
      qualityFlags.push('title_direction_conflict');
    }
  }
  if (evidenceMode === 'image_only' && sourceLabel) {
    const labelKey = normalizeEvidenceText(sourceLabel);
    const visibleTextKey = normalizeEvidenceText(textInImage);
    if (!labelKey || !visibleTextKey.includes(labelKey)) {
      sourceLabel = '';
      qualityFlags.push('unsupported_source_label_cleared');
    }
  }
  const unverifiedOcrTitle = sourceLabel && expectedTitleDirection && textSourceStatus &&
    textSourceStatus !== 'verified' && !textInImage && explicitTitleDirection !== expectedTitleDirection;
  if (unverifiedOcrTitle) qualityFlags.push('unverified_title_reading');
  const hasDirectionConflict = qualityFlags.some(flag => [
    'text_direction_conflict', 'reading_order_conflict', 'title_direction_conflict',
  ].includes(flag));
  const nameResolution = resolveIllustrationDisplayName({
    sourceLabel,
    textInImage,
    explicitIllustrationName,
    mainSubject,
    hasDirectionConflict,
    unverifiedOcrTitle,
  });
  const illustrationName = nameResolution.illustrationName;
  qualityFlags.push(...nameResolution.qualityFlags);
  if (isMinimalV3 && !explicitIllustrationName) qualityFlags.push('missing_illustration_name');
  if (!illustrationName) qualityFlags.push('empty_illustration_name');
  // 历史 Prompt 曾输出 evidence_sufficiency；仅原样兼容旧响应，不再要求、推导或审核。
  const legacySufficiency = ['充分', '部分', '不足'].includes(ai.evidence_sufficiency)
    ? ai.evidence_sufficiency : '';
  if (isMinimalV3 && typeof ai.has_multiple_illustrations !== 'boolean') {
    qualityFlags.push('missing_has_multiple_illustrations');
  }
  const confidenceFromLegacyEvidence = { '充分': 'high', '部分': 'mid', '不足': 'low' }[legacySufficiency] || '';
  const evidenceRelation = { '支持': '一致', '一致': '一致', '存疑': '存疑', '矛盾': '矛盾' }[
    ai.evidence_relation || ai.text_image_relation || ''
  ] || '';

  // ── 路径一：新 prompt 已直接输出 academic_class ──────────────────────────
  const directClass = typeof ai.academic_class === 'string' ? ai.academic_class.trim() : '';
  if (isMinimalV3 || VALID_12.has(directClass)) {
    const resolvedDirectClass = VALID_12.has(directClass) ? directClass : '';
    if (!resolvedDirectClass) qualityFlags.push('invalid_academic_class');
    const directSub = typeof ai.academic_subclass === 'string' && ai.academic_subclass !== 'null'
      ? ai.academic_subclass.trim() : null;
    const normalizedDirectSub = normalizeAcademicSubclass(resolvedDirectClass, directSub);
    if (directSub && normalizedDirectSub !== directSub) qualityFlags.push('academic_subclass_normalized');
    // 新规范允许细分类在证据不足时留空；不为填满细类而增加无依据判断。
    // legacy_type_guess 仅作兼容记录，不影响主分类
    const legacyGuess = ai.legacy_type_guess ? (AI_RESPONSE_TYPE_MAP[ai.legacy_type_guess] || '') : '';
    return {
      type:            resolvedDirectClass,
      academicClass:   resolvedDirectClass || null,
      academicSubclass: normalizedDirectSub,
      legacyType:      legacyGuess,
      illustrationName,
      subject:         mainSubject,
      style:           c.drawing_style || '',
      preservation:    q.preservation || '',
      confidence:      confidenceFromLegacyEvidence || AI_RESPONSE_CONF_MAP[ai.confidence] || '',
      // 旧响应兼容字段；v6 Prompt 不再生成，空值时连键也不写入。
      ...(legacySufficiency ? { evidenceSufficiency: legacySufficiency } : {}),
      // 历史存储键兼容：新规范中的 source_label 暂落在 herbClassical；它不是现代标准药名。
      herbClassical:   sourceLabel,
      herbModern:      isMinimalV3 ? '' : (c.herb_name_modern || ''),
      species:         c.species || '',
      parts:           Array.isArray(parts) ? parts.filter(Boolean) : (parts ? [parts] : []),
      meridian:        c.meridian_name || '',
      points:          Array.isArray(points) ? points.filter(Boolean) : (points ? [points] : []),
      note:            ai.annotation_note || '',
      // 重标规范 v1 不再生成结构化炮制工序；相关内容只保留在 correspondingText。
      procedureStep:   '',
      blockType:       ai.block_type || '',
      textImageRelation: ai.layout_text_relation || '',
      textDirection,
      readingOrderAssumed,
      titleLabelDirection,
      aiVerdict:       evidenceRelation,
      aiVerdictNote:   ai.evidence_note || ai.text_image_note || '',
      correspondingText: ai.evidence_excerpt || ai.corresponding_text || '',
      textEvidenceExcerpt: ai.evidence_excerpt || ai.text_evidence_excerpt || '',
      aiInterpretation:    ai.ai_interpretation || '',
      visualDescription:   ai.description || '',
      uncertaintyNote: ai.uncertainty_note || ai.annotation_note || '',
      _description:    ai.description || '',
      _textInImage:    textInImage,
      _layout:         c.layout || '',
      _sourceLabel:    sourceLabel,
      _outputQualityFlags: [...new Set(qualityFlags)],
      _rawText:        rawText || JSON.stringify(ai, null, 2),
    };
  }

  // ── 路径二：旧 prompt 输出 image_type → 走旧映射兜底 ─────────────────────
  const legacyType = AI_RESPONSE_TYPE_MAP[ai.image_type] || '';
  const migrated = inferAcademicClassificationFromAnnotation({
    legacyType,
    subject: mainSubject,
    herbClassical: sourceLabel,
    herbModern: c.herb_name_modern || '',
    species: c.species || '',
    parts: Array.isArray(parts) ? parts.filter(Boolean) : (parts ? [parts] : []),
    meridian: c.meridian_name || '',
    points: Array.isArray(points) ? points.filter(Boolean) : (points ? [points] : []),
    note: ai.annotation_note || '',
    procedureStep: c.procedure_step || '',
  });
  return {
    // 表单字段（扁平）
    type:         migrated.type,
    academicClass: migrated.academicClass,
    academicSubclass: migrated.academicSubclass,
    legacyType:   migrated.legacyType,
    illustrationName,
    subject:      mainSubject,
    style:        c.drawing_style || '',
    preservation: q.preservation || '',
    confidence:   AI_RESPONSE_CONF_MAP[ai.confidence] || 'mid',
    herbClassical: sourceLabel,
    herbModern:   c.herb_name_modern || '',
    species:      c.species || '',
    parts:        Array.isArray(parts) ? parts.filter(Boolean) : (parts ? [parts] : []),
    meridian:     c.meridian_name || '',
    points:       Array.isArray(points) ? points.filter(Boolean) : (points ? [points] : []),
    note:          ai.annotation_note || '',
    procedureStep: c.procedure_step || '',          // 炮制工序（从原文提取）
    // 版刻与图文特征（版式布局，供人工填写）
    blockType:         ai.block_type || '',
    textImageRelation: ai.layout_text_relation || '',// 图在文前/图在文后 等版式描述
    textDirection:     ai.text_direction || '',
    readingOrderAssumed: ai.reading_order_assumed || '',
    titleLabelDirection: ai.title_label_direction || '',   // 题签实际读向（可与正文方向不同）
    // AI 原文匹配评估（折叠参考字段，不作为日常审核主字段）。
    // 底层仍保留 一致/存疑/矛盾 与 confidence 原值，用于论文指标、导出与回溯统计。
    aiVerdict:     ai.text_image_relation || '',   // 一致/存疑/矛盾
    aiVerdictNote: ai.text_image_note || '',       // 具体说明
    correspondingText: ai.corresponding_text || '',
    textEvidenceExcerpt: ai.text_evidence_excerpt || '',
    aiInterpretation:    ai.ai_interpretation || '',
    visualDescription:   ai.description || '',
    // 额外保存原始 AI 输出（用于调试面板）
    _description: ai.description || '',
    _textInImage: ai.text_in_image || '',
    _layout:      c.layout || '',
    _rawText:     rawText || JSON.stringify(ai, null, 2),
  };
}

// ── 页面记录 helper（textAsset 统一入口）─────────────────────
function getPageRecord(img) {
  if (!img.pdfSource) return null;
  const book = state.books.find(b => b.id === img.pdfSource.bookId);
  if (!book) return null;
  return getBookPageRecord(book, img.pdfSource.pageNum);
}

function getPageTextAsset(img) {
  const page = getPageRecord(img);
  if (!page) return null;
  if (page.contentRect === undefined) page.contentRect = null;
  if (page.forceContentRect === undefined) page.forceContentRect = false;
  if (page.contentThumb === undefined) page.contentThumb = '';
  if (page.contentThumbHi === undefined) page.contentThumbHi = '';
  if (page.cropRect === undefined) page.cropRect = null;
  if (page.cropQuad === undefined) page.cropQuad = null;
  if (page.forceCropRect === undefined) page.forceCropRect = false;   // 手动框选插图（展示用，独立于版心）
  if (page.cropRotationDeg === undefined) page.cropRotationDeg = 0;
  if (page.cropThumb === undefined) page.cropThumb = '';
  if (page.cropThumbHi === undefined) page.cropThumbHi = '';
  // 向后兼容：老数据 page.textAsset 可能不存在
  if (!page.textAsset) {
    const t = (page.text || '').trim();
    page.textAsset = {
      fullText: t,
      associatedText: '',
      associatedPageNums: [],
      textSource: t ? 'pdf_text_layer' : 'none',
      textStatus: t ? 'extracted' : 'missing',
      verified: false,
      ocrModel: '',
      extractedAt: '',
      updatedAt: '',
      correctedText: '',
      correctedAt: '',
      reviewedAt: '',
      reviewNote: '',
    };
  }
  if (!Array.isArray(page.textAsset.associatedPageNums)) {
    page.textAsset.associatedPageNums = [];
  }
  if (page.textAsset.correctedText === undefined) page.textAsset.correctedText = '';
  if (page.textAsset.correctedAt === undefined) page.textAsset.correctedAt = '';
  if (page.textAsset.reviewedAt === undefined) page.textAsset.reviewedAt = '';
  if (page.textAsset.reviewNote === undefined) page.textAsset.reviewNote = '';
  if (!Array.isArray(page.textAsset.ocrRuns)) page.textAsset.ocrRuns = [];
  if (!Array.isArray(page.textAsset.charEdits)) page.textAsset.charEdits = [];
  if (!Array.isArray(page.textAsset.suspectChars)) page.textAsset.suspectChars = [];
  // 图文切割写在 illustrationPages，而 getPageRecord 返回 book.pages 里的条目。
  // 两者序列化后为独立对象；始终用 illustrationPages 的最新值覆盖，确保重新切割后生效。
  {
    const book = img?.pdfSource?.bookId
      ? state.books.find(b => b.id === img.pdfSource.bookId)
      : null;
    const ip = (book?.illustrationPages || []).find(p => Number(p.pageNum) === Number(page.pageNum));
    if (ip?.textAsset?.associatedText) {
      page.textAsset.associatedText     = ip.textAsset.associatedText;
      page.textAsset.associatedPageNums = Array.isArray(ip.textAsset.associatedPageNums)
        ? ip.textAsset.associatedPageNums : [];
      page.textAsset.associatedSource   = ip.textAsset.associatedSource || 'auto_text_cut';
    }
  }
  if (page.forceContentRect == null) page.forceContentRect = false;
  return page.textAsset;
}

function getEffectivePageText(pageOrTextAsset) {
  const ta = pageOrTextAsset?.textAsset || pageOrTextAsset || {};
  return String(ta.correctedText || ta.fullText || '').trim();
}

function hasManualCorrectedText(textAsset = {}) {
  return String(textAsset.correctedText || '').trim().length > 0;
}

function getTextSourceForExport(textAsset = {}) {
  if (hasManualCorrectedText(textAsset)) return 'manual_corrected';
  return textAsset.textSource || 'none';
}

function resetTextAssetManualProofAfterOcr(textAsset) {
  if (!textAsset) return;
  textAsset.correctedText = '';
  textAsset.correctedAt = '';
  textAsset.verified = false;
  textAsset.reviewedAt = '';
  textAsset.reviewNote = textAsset.reviewNote || '';
  textAsset.textStatus = String(textAsset.fullText || '').trim() ? 'extracted' : 'missing';
}

function appendTextAssetOcrRun(textAsset, run = {}) {
  if (!textAsset) return null;
  if (!Array.isArray(textAsset.ocrRuns)) textAsset.ocrRuns = [];
  const rec = {
    text: run.text || '',
    source: run.source || run.textSource || 'ai_ocr',
    model: run.model || '',
    provider: run.provider || '',
    at: run.at || new Date().toISOString(),
    charCount: Number.isFinite(run.charCount) ? run.charCount : String(run.text || '').length,
    pageNum: run.pageNum || null,
    mode: run.mode || run.source || 'ai_ocr',
    scanInputVersion: run.scanInputVersion || '',
    scanInput: run.scanInput ? deepClone(run.scanInput) : null,
    detectedTextDirection: run.detectedTextDirection || '',
    detectedTitleLabelDirection: run.detectedTitleLabelDirection || '',
    scanWarnings: Array.isArray(run.scanWarnings) ? [...run.scanWarnings] : [],
  };
  textAsset.ocrRuns = [rec, ...textAsset.ocrRuns].slice(0, 20);
  return rec;
}

function archiveCurrentOcrRun(textAsset) {
  if (!textAsset) return null;
  const text = String(textAsset.fullText || '');
  if (!text.trim()) return null;
  const latest = Array.isArray(textAsset.ocrRuns) ? textAsset.ocrRuns[0] : null;
  if (latest && String(latest.text || '') === text
    && String(latest.model || '') === String(textAsset.ocrModel || '')
    && String(latest.source || '') === String(textAsset.textSource || '')) return null;
  return appendTextAssetOcrRun(textAsset, {
    text,
    source: textAsset.textSource || 'ai_ocr',
    model: textAsset.ocrModel || '',
    at: textAsset.extractedAt || textAsset.updatedAt || new Date().toISOString(),
    mode: 'before_rerun',
    scanInputVersion: textAsset.scanInputVersion || '',
    scanInput: textAsset.scanInput || null,
    detectedTextDirection: textAsset.detectedTextDirection || '',
    detectedTitleLabelDirection: textAsset.detectedTitleLabelDirection || '',
    scanWarnings: textAsset.scanWarnings || [],
  });
}

function applyOcrRunToTextAsset(textAsset, run = {}, {
  resetManualProof = false,
  archiveExisting = true,
} = {}) {
  if (!textAsset) return null;
  const text = run.text || '';
  const previousText = String(textAsset.fullText || '');
  if (archiveExisting && previousText.trim() && previousText !== text) archiveCurrentOcrRun(textAsset);
  textAsset.fullText = text;
  textAsset.textSource = run.source || run.textSource || 'ai_ocr';
  textAsset.ocrModel = run.model || '';
  textAsset.extractedAt = run.extractedAt || run.at || new Date().toISOString();
  textAsset.updatedAt = new Date().toISOString();
  if (run.scanInputVersion) textAsset.scanInputVersion = run.scanInputVersion;
  if (run.scanInput) textAsset.scanInput = deepClone(run.scanInput);
  if (run.detectedTextDirection) textAsset.detectedTextDirection = run.detectedTextDirection;
  if (run.detectedTitleLabelDirection) textAsset.detectedTitleLabelDirection = run.detectedTitleLabelDirection;
  if (run.scanInput) {
    textAsset.scanWarnings = computeScanDirectionWarnings(
      run.scanInput, run.detectedTextDirection, run.detectedTitleLabelDirection);
  }
  if (resetManualProof) resetTextAssetManualProofAfterOcr(textAsset);
  textAsset.textStatus = text.trim() ? (textAsset.verified ? 'reviewed' : 'extracted') : 'missing';
  return appendTextAssetOcrRun(textAsset, {
    ...run,
    text,
    source: textAsset.textSource,
    model: textAsset.ocrModel,
    at: textAsset.updatedAt,
    scanWarnings: textAsset.scanWarnings || [],
  });
}

function getTextAssetProofStateLabel(textAsset = {}) {
  if (textAsset.verified || textAsset.textStatus === 'reviewed') return '人工已校';
  if (String(textAsset.correctedText || '').trim()) return '人工修订未确认';
  if (String(textAsset.fullText || '').trim()) return 'OCR候选';
  return '无文字';
}

function getAdjacentPageRecords(book, pageNum) {
  if (!book || !Number.isFinite(Number(pageNum))) return [];
  return [
    { offset: -1, label: '上一页', page: getBookPageRecord(book, Number(pageNum) - 1) },
    { offset: 1, label: '下一页', page: getBookPageRecord(book, Number(pageNum) + 1) },
  ].filter(item => item.page);
}

function formatEvidencePageNums(pageNums) {
  const nums = Array.isArray(pageNums)
    ? [...new Set(pageNums.map(n => Number(n)).filter(Number.isFinite))]
    : [];
  return nums.length ? nums.map(n => `第 ${n} 页`).join('、') : '未标注页码';
}

function getAssociatedPageNums(page) {
  const nums = Array.isArray(page?.textAsset?.associatedPageNums)
    ? [...new Set(page.textAsset.associatedPageNums.map(n => Number(n)).filter(Number.isFinite))]
    : [];
  return nums;
}

function getAssociatedEvidenceLabel(page) {
  const text = (page?.textAsset?.associatedText || '').trim();
  if (!text) return '未设置专用关联段落';
  const nums = getAssociatedPageNums(page);
  if (!nums.length || (nums.length === 1 && nums[0] === page.pageNum)) return '证据来源：本页';
  return `证据来源：${formatEvidencePageNums(nums)}`;
}

function normalizeRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4) return null;
  const nums = rect.map(v => Math.max(0, Math.min(1, Number(v) || 0)));
  const [x0, y0, x1, y1] = nums;
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
  return [x0, y0, x1, y1];
}

function normalizeQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return null;
  const pts = quad.map(pt => {
    if (!Array.isArray(pt) || pt.length !== 2) return null;
    return [
      Math.max(0, Math.min(1, Number(pt[0]) || 0)),
      Math.max(0, Math.min(1, Number(pt[1]) || 0)),
    ];
  });
  if (pts.some(pt => !pt)) return null;
  const xs = pts.map(pt => pt[0]);
  const ys = pts.map(pt => pt[1]);
  if (Math.max(...xs) - Math.min(...xs) < 0.01 || Math.max(...ys) - Math.min(...ys) < 0.01) return null;
  return pts;
}

function rectToQuad(rect) {
  const r = normalizeRect(rect);
  if (!r) return null;
  return [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[2], r[3]],
    [r[0], r[3]],
  ];
}

function quadToRect(quad) {
  const q = normalizeQuad(quad);
  if (!q) return null;
  const xs = q.map(pt => pt[0]);
  const ys = q.map(pt => pt[1]);
  return normalizeRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
}

function quadArea(quad) {
  const q = normalizeQuad(quad);
  if (!q) return 0;
  let area = 0;
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % q.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function rectArea(rect) {
  const r = normalizeRect(rect);
  if (!r) return 0;
  return Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
}

function clampCropRotationDeg(value) {
  const n = Number(value) || 0;
  const clamped = Math.max(-5, Math.min(5, n));
  return Math.round(clamped * 10) / 10;
}

function rectToRelativeWithinBase(rect, baseRect) {
  const r = normalizeRect(rect);
  const b = normalizeRect(baseRect);
  if (!r || !b) return r;
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  if (bw < 0.01 || bh < 0.01) return r;
  return normalizeRect([
    (r[0] - b[0]) / bw,
    (r[1] - b[1]) / bh,
    (r[2] - b[0]) / bw,
    (r[3] - b[1]) / bh,
  ]);
}

function quadToRelativeWithinBase(quad, baseRect) {
  const q = normalizeQuad(quad);
  const b = normalizeRect(baseRect);
  if (!q || !b) return q;
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  if (bw < 0.01 || bh < 0.01) return q;
  return normalizeQuad(q.map(([x, y]) => [
    (x - b[0]) / bw,
    (y - b[1]) / bh,
  ]));
}

function rectFromRelativeWithinBase(rect, baseRect) {
  const r = normalizeRect(rect);
  const b = normalizeRect(baseRect);
  if (!r || !b) return r;
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  if (bw < 0.01 || bh < 0.01) return r;
  return normalizeRect([
    b[0] + bw * r[0],
    b[1] + bh * r[1],
    b[0] + bw * r[2],
    b[1] + bh * r[3],
  ]);
}

function getIllustPageCropBaseRect(page) {
  return normalizeRect(page?.contentRect) || [0, 0, 1, 1];
}

function getIllustFigureBaseRect(page) {
  return normalizeRect(page?.cropRect) || normalizeRect(page?.contentRect) || [0, 0, 1, 1];
}

function getPageAnnotateRect(page, selectionMode = '') {
  if (!page) return null;
  if (selectionMode === 'crop' && normalizeRect(page.cropRect)) return normalizeRect(page.cropRect);
  if (page.forceContentRect && normalizeRect(page.contentRect)) return normalizeRect(page.contentRect);
  return normalizeRect(page.contentRect) || normalizeRect(page.cropRect) || null;
}

function quadFromRelativeWithinBase(quad, baseRect) {
  const q = normalizeQuad(quad);
  const b = normalizeRect(baseRect);
  if (!q || !b) return q;
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  if (bw < 0.01 || bh < 0.01) return q;
  return normalizeQuad(q.map(([x, y]) => [
    b[0] + bw * x,
    b[1] + bh * y,
  ]));
}

function quadToQueryValue(quad) {
  const q = normalizeQuad(quad);
  if (!q) return '';
  return q.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(',');
}

function getGeometryStyle(rectOrQuad, extra = '') {
  const q = normalizeQuad(rectOrQuad);
  if (q) {
    const rect = quadToRect(q);
    if (!rect) return extra || '';
    const pts = q.map(([x, y]) => `${((x - rect[0]) / Math.max(0.0001, rect[2] - rect[0]) * 100).toFixed(2)}% ${((y - rect[1]) / Math.max(0.0001, rect[3] - rect[1]) * 100).toFixed(2)}%`).join(', ');
    return `left:${(rect[0] * 100).toFixed(3)}%; top:${(rect[1] * 100).toFixed(3)}%; width:${((rect[2] - rect[0]) * 100).toFixed(3)}%; height:${((rect[3] - rect[1]) * 100).toFixed(3)}%; clip-path:polygon(${pts}); ${extra}`;
  }
  return getRectStyle(rectOrQuad, extra);
}

function getPagePreviewUrl(page, selectionMode = '') {
  if (!page) return '';
  if (selectionMode === 'full_page') {
    return page.thumbHi || page.thumb || page.contentThumbHi || page.contentThumb || page.cropThumbHi || page.cropThumb || '';
  }
  // 手动框选的插图框最优先用于展示（成果/审核台只显示插图本体），与版心(forceContentRect)并存、互不覆盖
  if (page.forceCropRect && (page.cropThumbHi || page.cropThumb)) {
    return page.cropThumbHi || page.cropThumb || '';
  }
  if (page.forceContentRect && (page.contentThumbHi || page.contentThumb)) {
    return page.contentThumbHi || page.contentThumb || page.thumbHi || page.thumb || '';
  }
  if (selectionMode === 'crop') {
    return page.cropThumbHi || page.cropThumb || page.contentThumbHi || page.contentThumb || page.thumbHi || page.thumb || '';
  }
  return page.contentThumbHi || page.contentThumb || page.thumbHi || page.thumb || '';
}

function getIllustrationViewUrl(img, maxLong = 1200) {
  if (!img) return '';
  const book = img.pdfSource?.bookId ? getBook(img.pdfSource.bookId) : null;
  const pageNum = Number(img.pdfSource?.pageNum) || null;
  const page = book && pageNum ? getBookPageRecord(book, pageNum) : null;
  const isFigureRecord = isFigureIllustrationRecord(img);
  const quad = isFigureRecord
    ? (normalizeQuad(img.pdfSource?.cropQuad) || normalizeQuad(img.pdfSource?.annotateQuad) || normalizeQuad(page?.cropQuad))
    : (normalizeQuad(img.pdfSource?.cropQuad) || normalizeQuad(page?.cropQuad) || normalizeQuad(img.pdfSource?.annotateQuad));
  const rect = isFigureRecord
    ? (normalizeRect(img.pdfSource?.annotateRect) || normalizeRect(img.pdfSource?.cropRect) || normalizeRect(page?.cropRect))
    : (normalizeRect(img.pdfSource?.cropRect) || normalizeRect(page?.cropRect) || normalizeRect(img.pdfSource?.annotateRect));
  const rotationDeg = clampCropRotationDeg(
    img.pdfSource?.rotationDeg ?? page?.cropRotationDeg ?? page?.rotationDeg ?? 0
  );
  if (book && pageNum && quad) return pageHiResUrl(book.id, pageNum, quadToRect(quad), maxLong, 0, quad);
  if (book && pageNum && rect) return pageHiResUrl(book.id, pageNum, rect, maxLong, rotationDeg);
  return img.url || img.dataUrl || '';
}

function getRectStyle(rect, extra = '') {
  const r = normalizeRect(rect);
  if (!r) return extra || '';
  return `left:${(r[0] * 100).toFixed(3)}%; top:${(r[1] * 100).toFixed(3)}%; width:${((r[2] - r[0]) * 100).toFixed(3)}%; height:${((r[3] - r[1]) * 100).toFixed(3)}%; ${extra}`;
}

function getEvidencePageOptions(book, page) {
  if (!book || !page) return [];
  const prev = getBookPageRecord(book, page.pageNum - 1);
  const next = getBookPageRecord(book, page.pageNum + 1);
  return [
    prev ? { role: 'prev', label: `上一页 · 第 ${prev.pageNum} 页`, page: prev } : null,
    { role: 'current', label: `本页 · 第 ${page.pageNum} 页`, page },
    next ? { role: 'next', label: `下一页 · 第 ${next.pageNum} 页`, page: next } : null,
  ].filter(Boolean);
}

async function applyEvidencePagesToAnnotation(book, page, sourcePageNums) {
  const normalized = [...new Set((Array.isArray(sourcePageNums) ? sourcePageNums : [page.pageNum])
    .map(n => Number(n))
    .filter(Number.isFinite))]
    .sort((a, b) => a - b);
  if (!normalized.length) throw new Error('未选择证据页');

  const parts = [];
  for (const pn of normalized) {
    const target = getBookPageRecord(book, pn);
    if (!target) continue;
    if (!getEffectivePageText(target.textAsset || target)) {
      await extractTextForPage(book, target, { force: false, refreshCrop: false }).catch(() => {});
    }
    const text = getEffectivePageText(target.textAsset || target);
    if (!text) continue;
    parts.push(normalized.length === 1 ? text : `【第 ${pn} 页】\n${text}`);
  }
  if (!parts.length) {
    throw new Error('所选证据页没有可用文字');
  }

  const mergedText = parts.join('\n\n');
  applyPageTextToAnnotation(book, page, mergedText, normalized);
  return mergedText;
}

function buildAssociatedPagePicker(book, page, assocTa, metaEl) {
  const currentNums = getAssociatedPageNums(page);
  const currentPageNum = currentNums.length ? currentNums[0] : page.pageNum;
  const pageNums = getBookPages(book).map(p => p.pageNum);
  const wrap = el('div', { style: 'margin-top:10px; padding:10px 12px; border:1px dashed #d9cfb0; border-radius:8px; background:#fcfbf7;' });
  wrap.appendChild(el('div', { style: 'font-size:12.5px; color:#6b5c34; font-weight:600; margin-bottom:8px;' }, '选择关联段落'));
  const row = el('div', { class: 'ta-actions', style: 'margin-top:0;' });
  const selectEl = el('select', {
    style: 'height:32px; min-width:140px; border:1px solid var(--c-border-strong); border-radius:6px; background:#fff; padding:0 8px;'
  });
  for (const pn of pageNums) {
    selectEl.appendChild(el('option', {
      value: String(pn),
      ...(pn === currentPageNum ? { selected: '' } : {})
    }, `第 ${pn} 页`));
  }
  row.appendChild(selectEl);
  row.appendChild(el('button', { class: 'btn', onclick: async () => {
    const selectedPageNum = Number(selectEl.value);
    const selectedPage = getBookPageRecord(book, selectedPageNum);
    if (!selectedPage) {
      toast('未找到所选 PDF 页', 'warn');
      return;
    }
    if (!getEffectivePageText(selectedPage.textAsset || selectedPage)) {
      await extractTextForPage(book, selectedPage, { force: false, refreshCrop: false }).catch(() => {});
    }
    const text = getEffectivePageText(selectedPage.textAsset || selectedPage);
    if (!text) {
      toast(`第 ${selectedPageNum} 页没有可用文字`, 'warn');
      return;
    }
    applyPageTextToAnnotation(book, page, text, [selectedPageNum]);
    assocTa.value = text;
    if (metaEl) metaEl.textContent = getAssociatedEvidenceLabel(page);
    toast(`已载入第 ${selectedPageNum} 页原文作为关联段落`, 'success');
  } }, '载入所选页原文'));
  wrap.appendChild(row);
  wrap.appendChild(el('div', { style: 'margin-top:8px; font-size:12px; color:#8a7a4a; line-height:1.6;' },
    '按 PDF 页码选择证据来源。载入后仍可在上方“关联段落”中继续手动修改。'));
  return wrap;
}

function buildEvidenceComposer(book, page, assocTa, metaEl) {
  const wrap = el('div', { style: 'margin-top:10px; padding:10px 12px; border:1px dashed #d9cfb0; border-radius:8px; background:#fcfbf7;' });
  wrap.appendChild(el('div', { style: 'font-size:12.5px; color:#6b5c34; font-weight:600; margin-bottom:8px;' }, '证据页组合'));
  const options = getEvidencePageOptions(book, page);
  const selected = new Set(getAssociatedPageNums(page).length ? getAssociatedPageNums(page) : [page.pageNum]);
  const checks = el('div', { style: 'display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;' });

  for (const opt of options) {
    const checked = selected.has(opt.page.pageNum);
    const label = el('label', {
      style: 'display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border:1px solid #e5dcc2; border-radius:999px; background:#fff; font-size:12px; color:#5a4a2a; cursor:pointer;'
    },
      el('input', {
        type: 'checkbox',
        ...(checked ? { checked: '' } : {}),
        onchange: (e) => {
          if (e.target.checked) selected.add(opt.page.pageNum);
          else selected.delete(opt.page.pageNum);
        }
      }),
      opt.label
    );
    checks.appendChild(label);
  }
  wrap.appendChild(checks);

  const btnRow = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap;' });
  btnRow.appendChild(el('button', { class: 'btn', onclick: async () => {
    const pageNums = [...selected].sort((a, b) => a - b);
    if (!pageNums.length) { toast('请至少选择一个证据页', 'warn'); return; }
    try {
      const text = await applyEvidencePagesToAnnotation(book, page, pageNums);
      assocTa.value = text;
      if (metaEl) metaEl.textContent = getAssociatedEvidenceLabel(page);
    } catch (e) {
      toast(e.message || '证据页组合失败', 'error');
    }
  } }, '合并所选页为关联段落'));
  btnRow.appendChild(el('button', { class: 'btn', onclick: () => {
    selected.clear();
    selected.add(page.pageNum);
    for (const input of checks.querySelectorAll('input[type="checkbox"]')) {
      const pn = Number(input.closest('label')?.dataset?.pageNum);
      if (Number.isFinite(pn)) input.checked = pn === page.pageNum;
    }
    toast('已重置为仅使用本页', 'success');
  } }, '重置为仅本页'));
  wrap.appendChild(btnRow);
  wrap.appendChild(el('div', { style: 'margin-top:8px; font-size:12px; color:#8a7a4a; line-height:1.6;' },
    '用于“本页是图，说明分布在相邻页”的情况。合并后会保留证据页码。'));

  for (const [idx, label] of [...checks.children].entries()) {
    const opt = options[idx];
    if (opt) label.dataset.pageNum = String(opt.page.pageNum);
  }
  return wrap;
}

// 上下文窗口半径：本页 + 前后各 N 页作为 AI 标注的文字证据（N 由设置 config.contextRadius 决定，默认 5）。
// 固定自动读取，不再依赖手选图文关系/关联段落/切割配对——复杂书（组图中夹文字）也能覆盖。
function getContextRadius() {
  const r = Number(config && config.contextRadius);
  return Number.isFinite(r) ? Math.max(0, Math.min(20, r)) : 5;
}

function getImageEvidenceBlocks(img) {
  if (!img?.pdfSource) return [];
  const book = getBook(img.pdfSource.bookId);
  const page = getPageRecord(img);
  if (!book || !page) return [];

  const blocks = [];
  // 人工指定的关联段落仍作为「重点」叠加（若有），不独占
  const ta = getPageTextAsset(img);
  const associated = (ta?.associatedText || '').trim();
  // 只把「人工指定」的关联段落当重点；自动切割(auto_text_cut)易切错，不再注入，避免误导模型。
  if (associated && ta?.associatedSource !== 'auto_text_cut') {
    const aNums = getAssociatedPageNums(page);
    blocks.push({
      kind: 'associated',
      pageNums: aNums.length ? aNums : [page.pageNum],
      text: associated,
      label: '重点关联段落（人工指定）',
    });
  }

  // 自动读取本页 + 上下各 N 页原文（N = 设置里的 contextRadius）
  const center = Number(page.pageNum);
  const radius = getContextRadius();
  for (let off = -radius; off <= radius; off++) {
    const pn = center + off;
    const rec = getBookPageRecord(book, pn);
    if (!rec) continue;
    const nta = rec.textAsset || getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: pn } });
    const text = getEffectivePageText(nta || rec);
    if (!text) continue;
    blocks.push({
      kind: off === 0 ? 'fullText' : 'context',
      pageNums: [pn],
      text,
      label: off === 0
        ? `本页原文（第 ${pn} 页）`
        : `第 ${pn} 页原文（${off < 0 ? '前文' : '后文'}）`,
    });
  }
  return blocks;
}

function stringifyEvidenceBlocks(blocks) {
  return blocks
    .filter(block => (block?.text || '').trim())
    .map(block => `【${block.label}】\n${block.text.trim()}`)
    .join('\n\n');
}

// 构建「AI 上下文引用原文片段」展示块（用于标注台和综述视图）
function buildAiCtxRefBlock(img) {
  const blocks = getImageEvidenceBlocks(img);
  if (!blocks.length) return null;
  const wrap = el('details', { class: 'ai-ctx-block' });
  wrap.appendChild(el('summary', { class: 'ai-ctx-header' }, `📄 AI 上下文引用原文片段（${blocks.length}）`));
  const body = el('div', { class: 'ai-ctx-body' });
  for (const b of blocks) {
    const row = el('div', { class: 'ai-ctx-row' });
    row.appendChild(el('div', { class: 'ai-ctx-label' }, b.label));
    // 截取前180字，避免撑开界面
    const snippet = (b.text || '').trim().slice(0, 180) + ((b.text || '').trim().length > 180 ? '…' : '');
    row.appendChild(el('div', { class: 'ai-ctx-text' }, snippet));
    body.appendChild(row);
  }
  wrap.appendChild(body);
  return wrap;
}

function buildBookReadingContext(bookCtx) {
  if (!bookCtx) return '';
  const rules = [];
  if (bookCtx.title) rules.push(`书名：${bookCtx.title}`);
  if (bookCtx.dynasty) rules.push(`朝代：${bookCtx.dynasty}`);
  if (bookCtx.layoutRelation) rules.push(`常见图文排布：${bookCtx.layoutRelation}`);
  if (bookCtx.textDirection) rules.push(`文字方向：${bookCtx.textDirection}`);
  if (bookCtx.pageOrderLabel) rules.push(`书页顺序：${bookCtx.pageOrderLabel}`);
  if (bookCtx.titleLabelDirection) rules.push(`题签/图题默认读法：${bookCtx.titleLabelDirection}`);
  if (bookCtx.topicNote) rules.push(`专题说明：${bookCtx.topicNote}`);
  if (bookCtx.readingNote) rules.push(`阅读规则备注：${bookCtx.readingNote}`);
  if (!rules.length) return '';
  return `【书级阅读规则】\n${rules.map(line => `- ${line}`).join('\n')}\n\n【阅读顺序硬规则】\n- 先遵守本书的书级阅读规则，再识别单张插图中的文字，不得每张图自行切换现代横排习惯。\n- 若本书文字方向为“竖排右起”，默认按“自右向左列、自上而下行”读取正文、题签、栏头、页码，除非图中有充分反证。\n- 若本书题签/图题默认读法已给出，优先按该规则读取题签、图题短签，不得先按现代横排解释；题签读向可与正文不同，须单独记入 title_label_direction。\n- 只有当图中文字明显为横排、反向竖排，或页面结构提供了清晰反证时，才允许改变读法，并必须在 text_direction 与 reading_order_assumed 中明确说明。\n- 若方向仍不确定，不要强行猜字，应保留不确定性并降低 confidence。`;
}

function extractOperationalReadingNote(readingNote) {
  const parts = String(readingNote || '').match(/[^。；]+[。；]?/g) || [];
  const directionTerms = /(?:阅读|读向|竖排|横排|右起|左起|自右向左|自左向右|题签方向|图题方向|栏头|页码|书页顺序|text_direction|title_label_direction|reading_order_assumed)/;
  const researchTerms = /(?:药名|工序|器具|炮制图|药材形态|人物操作|研究结论|专题研究)/;
  return parts
    .map(part => part.trim())
    .filter(part => directionTerms.test(part) && !researchTerms.test(part))
    .join('');
}

// ── 页面上下文：文字只作为证据；图像标注始终另用已确认插图裁图 ───────────
async function getPageContext(img) {
  if (!img.pdfSource) return { pageText: '', evidenceBlocks: [] };
  const blocks = getImageEvidenceBlocks(img);
  if (blocks.length) {
    const pageText = stringifyEvidenceBlocks(blocks);
    if (pageText) return { pageText, evidenceBlocks: blocks };
  }
  // 没有文字资产时进入 image_only。禁止用版心/整页图替代插图裁图，否则正文、边栏或
  // 同页其他图像会污染当前插图的分类。OCR 必须在书籍预处理链路独立完成。
  return { pageText: '', evidenceBlocks: [] };
}

function determineAnnotationEvidenceMode(evidenceBlocks) {
  return Array.isArray(evidenceBlocks) && evidenceBlocks.length ? 'text' : 'image_only';
}

// ── Prompt 构建 ───────────────────────────────────────────────
// 标注 prompt 版本号：随 prompt 实质修订递增；写入每条记录的 annotationEvidence.promptVersion，
// 用于追溯某条标注由哪一版 prompt 生成（当前为"轻标注·强证据·可检索"口径）。
const PROMPT_VERSION = 'quick_search_v7_core_entity_name';
// 由 scripts/export_reannotation_prompt_snapshot.js 生成的三模式 Prompt 合并内容 hash。
const PROMPT_CONTENT_SHA256 = 'caf1952121025c9246f8d199a45a91a486e790c846b29a9eab468b2af0fcf3a3';
// specs/classification_scheme.md v3.1（2026-07-18 冻结内容）的文件 hash。
const CLASSIFICATION_SCHEME_SHA256 = '041763b2f942a12f851d69870c02a0417f556d80c5964bb34decac02a8887d2e';

// 从已有信号派生 OCR 风险标注（不改 AI 契约，可对存量记录回填）：
// 依据 evidenceMode（文字证据档位）+ 图文关系 verdict + 置信度 + 是否有原文证据片段。
function deriveOcrRiskNote(img) {
  if (!img) return '';
  const ann = img.annotation || img.aiDraft || {};
  const mode = img.annotationEvidence?.mode || '';
  const parts = [];
  const qualityFlags = img.annotationEvidence?.outputQualityFlags || ann._outputQualityFlags || [];
  if (qualityFlags.includes('output_truncated')) parts.push('模型输出被截断，必须重跑');
  if (qualityFlags.includes('recovered_partial_output')) parts.push('JSON解析失败后仅恢复了部分字段，必须重跑');
  if (qualityFlags.includes('unsupported_source_label_cleared')) parts.push('无文字支持的原文标签已自动清空');
  if (qualityFlags.includes('missing_has_multiple_illustrations')) parts.push('模型未明确返回多图标记');
  if (qualityFlags.includes('text_direction_conflict')) parts.push('正文读向与书级规则冲突，必须人工核对');
  if (qualityFlags.includes('reading_order_conflict')) parts.push('阅读顺序与书级规则冲突，必须人工核对');
  if (qualityFlags.includes('title_direction_conflict')) parts.push('题签读向与书级规则冲突，题名不得直接采用');
  if (qualityFlags.includes('title_direction_defaulted_from_book')) parts.push('模型未明确题签读向，已采用书级默认规则');
  if (qualityFlags.includes('unverified_title_reading')) parts.push('未校OCR且题签读向未获模型确认，原书标签未自动用作展示名');
  if (mode === 'image_only') parts.push('无文字证据，仅凭图像降级判断');
  else if (mode === 'full_page_scan') parts.push('全页OCR候选证据，需人工核对');
  const verdict = ann.aiVerdict || ann.textImageRelation || '';
  if (verdict === '存疑') parts.push('图文关系存疑');
  else if (verdict === '矛盾') parts.push('图文关系矛盾，疑似误识');
  const conf = String(ann.confidence || '').toLowerCase();
  if (conf === 'low' || conf === '低') parts.push('低置信度');
  if (!String(ann.correspondingText || '').trim() && !String(ann.textEvidenceExcerpt || '').trim()) parts.push('无原文证据片段');
  return parts.join('；');
}

function buildPrompt(pageText, hasFullPage, bookCtx, evidenceMeta = {}) {
  const academicSubclassSchema = ACADEMIC_CLASSES.map(cls => {
    const values = Array.isArray(cls.subclasses) && cls.subclasses.length ? cls.subclasses.join('/') : 'null';
    return `${cls.value}=>${values}`;
  }).join('；');
  const evidenceMode = pageText ? 'text' : (hasFullPage ? 'full_page_scan' : 'image_only');
  const textSourceStatus = evidenceMeta.textSourceStatus || 'missing';
  const ocrStatus = evidenceMeta.ocrStatus || 'unavailable';
  const JSON_SCHEMA = `{
 "description": "只描述图中可直接观察到的主体、动作、器具和版式，1至2句",
 "academic_class": "疾病图/诊法图/医疗图/药物图/器具图/养生图/脏腑图/经穴图/部位图/理论图/符咒图/人物图/unknown",
 "academic_subclass": "可选细分类；仅在证据清楚时从下表选择，否则填null：${academicSubclassSchema}",
 "illustration_name": "用于目录与展示的稳定短名称；有可靠题签时按规范读序填写题签，无可靠题签时只写主要对象的核心实体名",
 "primary_subject": "主要对象或主要场景的短语，不写解释、异名、现代名、拉丁名或推测依据",
 "source_label": "图题、题签或对应原文中直接出现的原书称谓；没有可核对文字证据则填null",
 "text_direction": "竖排右起/竖排左起/横排左起/横排右起/双栏混排/不明",
 "reading_order_assumed": "右→左、自上而下/左→右、自上而下/不明",
 "title_label_direction": "竖签右起/竖签左起/横排左起/横排右起/随正文/不明/null",
 "text_in_image": "仅抄录插图裁图中实际可辨文字；无则填null",
 "evidence_relation": "支持/存疑/矛盾",
 "evidence_note": "说明最小证据如何支持或为何存疑，最多80字",
 "evidence_excerpt": "与本图对象或场景直接相关的最小原文片段，最多120字；无可靠证据填null",
 "uncertainty_note": "仅记录需人工核对之处；无则填null",
 "has_multiple_illustrations": false
}`;
  const CLASS_RULES = `【分类边界】
- 主分类只按图像直接呈现的知识功能判断，使用现行12类；不要因邻近正文谈到某主题就改变图像分类。
- 药物图可在证据清楚时细分为药物形态图、药物炮制图或药物关联图；看不清时细分类填null，不为填满字段而推断。
- “药物炮制图”是图像分类，不要求另行抽取统一的炮制工序。操作、步骤和差异只保留在 evidence_excerpt 对应原文中。
- 其他细分类同样只在图像或文字证据足够时填写；扩展研究结论不进入本次生产标注。`;
  // 专题研究结论不进入生产 Prompt；readingNote 只保留可执行的读向句，
  // 防止清理研究备注时误删书级题签/正文阅读规则。
  const factualBookCtx = bookCtx ? {
    ...bookCtx,
    topicNote: '',
    readingNote: extractOperationalReadingNote(bookCtx.readingNote),
  } : null;
  const readingCtx = buildBookReadingContext(factualBookCtx);
  const EVIDENCE_CTX = `【输入证据登记】
- evidenceMode: ${evidenceMode}
- textSourceStatus: ${textSourceStatus}
- ocrStatus: ${ocrStatus}
OCR/PDF文字均是候选证据；只有人工核对状态为 verified 才能视为已校文字。`;
  let MODE_TASK = '';
  if (pageText) {
    MODE_TASK = `【可用文字证据】（含页码与来源标签）
${pageText}

从中只摘录能直接支持本图对象或场景的最小片段。邻页只有在明确连续时才能引用；不要收整页文字、性味主治、附方或泛论。`;
  } else if (hasFullPage) {
    MODE_TASK = `当前仅有全页扫描图作为兜底。只读取与插图直接相邻且清晰的题签或短句，不承担整页OCR任务；文字模糊时 source_label 和 evidence_excerpt 均填null。`;
  } else {
    MODE_TASK = `当前只有插图裁图。只能填写图像直接支持的内容；source_label 仅当裁图中确有可辨文字且已逐字写入 text_in_image 时才能填写，其余文字依赖字段留空。`;
  }
  return `你是中医古籍插图整理专家。目标是“轻标注、强证据、可检索”，不是完成论文式阐释。

${CLASS_RULES}

${readingCtx}

${EVIDENCE_CTX}

${MODE_TASK}

【必须遵守】
1. 插图名称必须直接填写 illustration_name。它是用于目录与展示的稳定短名称，不是 primary_subject 的原样复制：有可靠题签或图题时按书级规范读序命名；无可靠题签时只写可确认的核心实体名，删除“植株、全株、形态、药材、矿石、炮制场景、采掘场景、产地景观、图”等描绘词。例如 primary_subject 为“黄芩植株”“黄芩炮制场景”或“黄芩产地景观”时，illustration_name 均写“黄芩”。若只能确认人物操作而不能确认对象，可写“采掘场景/炮制场景”等最小场景名，不得虚构药名。不得加入异名串、书名、页码、炮制步骤或推测说明。
2. 主要对象与原文标签分开：primary_subject 回答“画了什么”，source_label 只抄原书称谓；不得用旧标注、旧人工修改或历史名称补全本次结果。
3. 题签必须按书级读向转写，而不是照抄画面从左到右的字形排列。例如横排右起题签从左到右看见“乳鍾石製炮”时，应读作“炮製石鍾乳”；illustration_name、source_label 与 text_in_image 均写规范读序，title_label_direction 必须写“横排右起”。
4. 不输出炮制工序、现代规范名、拉丁学名、绘制风格、保存状态、经脉穴位或长篇解释；这些不是本轮默认生产字段。
5. academic_subclass 允许在证据不足时填null；不得为了完整而猜测。
6. has_multiple_illustrations 必须显式输出 true 或 false。
7. 无法确认的字段填null；仅输出一个符合下列形状的JSON对象，不得增加字段或附加说明：
${JSON_SCHEMA}`;
}

function getAnnotationModelSelection() {
  const MODEL_MAP = { qwen: config.qwenModel, openai: config.openaiModel, deepseek: config.deepseekModel,
    kimi: config.kimiModel, doubao: config.doubaoModel, zhipu: config.zhipuModel,
    gemini: config.geminiModel, baidu: config.baiduModel };
  const provider = config.provider;
  const model = MODEL_MAP[provider] || provider;
  return { provider, model };
}

async function captureAnnotationEvidenceSnapshot(img, { mock = false } = {}) {
  const { provider, model } = mock
    ? { provider: 'mock', model: 'Mock (Demo)' }
    : getAnnotationModelSelection();
  if (provider === 'deepseek') {
    throw new Error('DeepSeek 官方当前公开的是文本模型接口，本项目所需的图像 OCR / 图像标注流程暂不支持。请改用 Qwen、OpenAI、Gemini 等视觉模型。');
  }

  const { pageText, evidenceBlocks } = await getPageContext(img);
  const bookCtx = (() => {
    const bookId = img.pdfSource && img.pdfSource.bookId;
    const book = bookId && state.books && state.books.find(b => b.id === bookId);
    const traits = getBookTraits(book);
    const pageOrder = traits?.pageOrder === 'ltr' ? '从左到右' : '从右到左';
    return book ? {
      title: book.title,
      dynasty: book.dynasty || '',
      topicNote: book.topicNote || '',
      layoutRelation: traits?.layoutRelation || '',
      textDirection: traits?.textDirection || '',
      pageOrderLabel: pageOrder,
      titleLabelDirection: traits?.titleLabelDirection || '',
      readingNote: traits?.readingNote || '',
    } : null;
  })();
  const evidenceMode = determineAnnotationEvidenceMode(evidenceBlocks);
  const sourceTextAsset = getPageTextAsset(img);
  const textSourceStatus = deriveTextSourceStatus(sourceTextAsset);
  const ocrStatus = deriveOcrStatus(sourceTextAsset);
  const prompt = buildPrompt(pageText, false, bookCtx, { textSourceStatus, ocrStatus });
  const contextMeta = {
    contextRadius: getContextRadius(),
    contextPages: [...new Set((evidenceBlocks || []).flatMap(block => block.pageNums || []))],
    pinnedEvidenceRefs: (evidenceBlocks || [])
      .filter(block => block.kind === 'associated')
      .map(block => ({
        pageNums: block.pageNums || [],
        label: block.label || '',
        contentHash: fieldHash(block.text || ''),
      })),
  };

  const annotationOwner = getAnnotationOwnerRecord(img);
  contextMeta.annotationImageMode = Array.isArray(annotationOwner?.imageMerge?.items)
    && annotationOwner.imageMerge.items.length > 1
    ? 'merged_crop'
    : 'illustration_crop';
  const imageB64 = mock ? '' : await getAnnotationImageBase64(annotationOwner);
  const imageUrl = imageB64 ? '' : (annotationOwner?.url || img.url || '');
  return {
    provider,
    model,
    prompt,
    imageB64,
    imageUrl,
    evidenceBlocks,
    evidenceMode,
    textSourceStatus,
    ocrStatus,
    contextMeta,
    bookCtx,
    receipt: {
      provider,
      model,
      promptVersion: PROMPT_VERSION,
      promptContentSha256: PROMPT_CONTENT_SHA256,
      classificationVersion: CLASSIFICATION_VERSION,
      classificationSchemeSha256: CLASSIFICATION_SCHEME_SHA256,
      evidenceMode,
      textSourceStatus,
      ocrStatus,
      contextRadius: contextMeta.contextRadius,
      contextPages: contextMeta.contextPages,
      pinnedEvidenceRefs: contextMeta.pinnedEvidenceRefs,
      annotationImageMode: contextMeta.annotationImageMode,
      imageHash: fieldHash(imageB64 || imageUrl),
      textHash: fieldHash(pageText || ''),
    },
  };
}

async function invokeAnnotationModel(snapshot, img, { mock = false } = {}) {
  if (mock) {
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 600));
    return {
      annotation: mockAnnotate(img),
      model: 'Mock (Demo)',
      pageFullText: '',
      hasMultiple: false,
    };
  }
  const bridgeOk = await checkBridge();
  if (!bridgeOk || !_bridgeStatus?.has_key || snapshot.provider !== _bridgeStatus?.provider) {
    const error = new Error('本地桥接未就绪，或桥接中的模型配置与当前选择不一致。请先在设置中保存模型配置。');
    error.code = 'BRIDGE_NOT_READY';
    throw error;
  }
  const response = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: snapshot.provider,
      model: snapshot.model,
      image_b64: snapshot.imageB64,
      image_url: snapshot.imageUrl,
      page_b64: '',
      prompt: snapshot.prompt,
    }),
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    const invalid = new Error(`桥接返回了无法解析的响应（HTTP ${response.status}）`);
    invalid.code = 'BRIDGE_RESPONSE_INVALID';
    throw invalid;
  }
  if (!response.ok || data?.error) {
    const requestError = new Error(data?.error || `桥接请求失败（HTTP ${response.status}）`);
    requestError.code = 'MODEL_CALL_FAILED';
    throw requestError;
  }
  const rawAnnotation = data?.annotation;
  const rawText = JSON.stringify(rawAnnotation || {}, null, 2);
  return {
    annotation: mapAIResponse(rawAnnotation, rawText, {
      evidenceMode: snapshot.evidenceMode,
      finishReason: rawAnnotation?._response_meta?.finish_reason || '',
      bookCtx: snapshot.bookCtx,
      textSourceStatus: snapshot.textSourceStatus,
    }),
    model: snapshot.model,
    pageFullText: String(rawAnnotation?.page_full_text || '').trim(),
    hasMultiple: rawAnnotation?.has_multiple_illustrations,
  };
}

// ── 原文缺失警告弹窗 ──────────────────────────────────────────
// 一级门禁：页面完全没有文字
function openTextMissingGate(img) {
  return new Promise(resolve => {
    const pageInfo = img.pdfSource
      ? `第 ${img.pdfSource.pageNum} 页（${img.pdfSource.bookTitle || '—'}）`
      : '';
    const dlg = el('div', { class: 'confirm', style: 'max-width:440px' },
      el('h3', null, '📄 本页尚无文字资产'),
      el('p', { style: 'color:#555; line-height:1.6' },
        `${pageInfo} 未提取到任何文字。图文互证需要原文支撑，建议先提取文字。`),
      el('p', { style: 'color:#b07a3a; font-size:12.5px; margin-top:8px' },
        '仅凭图像时，原文标签和对应原文将留空；系统只保留图像能够直接支持的字段。'),
      el('div', { class: 'row', style: 'gap:10px; justify-content:flex-end; margin-top:14px' },
        el('button', { class: 'btn primary', style: 'min-width:140px',
            onclick: () => {
              scrim.remove();
              // 跳转到页面详情的文字准备区
              if (img.pdfSource) {
                navigateTo('page-detail', {
                  currentBookId:   img.pdfSource.bookId,
                  currentBookPage: img.pdfSource.pageNum,
                });
              }
              resolve('goto-page');
            } }, '📄 先提取本页文字'),
        el('button', { class: 'btn', style: 'min-width:120px; color:#c00',
            onclick: () => { scrim.remove(); resolve('proceed'); } },
          '仅凭图像继续（不推荐）'),
      ),
    );
    const scrim = el('div', { class: 'scrim' }, dlg);
    $('#overlay-root').appendChild(scrim);
  });
}

// 二级门禁：有全页文字但没有关联段落
function openContextWarning(img) {
  return new Promise(resolve => {
    const pageInfo = img.pdfSource
      ? `（第 ${img.pdfSource.pageNum} 页，书籍：${img.pdfSource.bookTitle || '—'}）`
      : '';
    const dlg = el('div', { class: 'confirm', style: 'max-width:420px' },
      el('h3', null, '⚠ 原文关联段落为空'),
      el('p', { style: 'color:#555; line-height:1.6' },
        `该图像来自 PDF${pageInfo}，但尚未关联原文段落。`),
      el('p', { style: 'color:#555; line-height:1.6; margin-top:6px' },
        '建议先在右侧「来源」面板中确认或填写“关联段落”，以便 AI 对照原文完成对象识别和证据摘录。'),
      el('p', { style: 'color:#b07a3a; font-size:12.5px; margin-top:8px' },
        '直接运行时，AI 将仅凭裁图降级标注，原文标签和对应原文会留空。'),
      el('div', { class: 'row', style: 'gap:10px; justify-content:flex-end; margin-top:14px' },
        el('button', { class: 'btn', style: 'min-width:120px',
            onclick: () => { scrim.remove(); resolve('cancel'); } },
          '← 去填写原文'),
        el('button', { class: 'btn', style: 'min-width:140px; color:#888',
            onclick: () => { scrim.remove(); resolve('proceed'); } },
          '仅凭图像运行'),
      ),
    );
    const scrim = el('div', { class: 'scrim' }, dlg);
    $('#overlay-root').appendChild(scrim);
  });
}

async function ensureImagePageText(img, { silent = false } = {}) {
  if (!img?.pdfSource) return { ok: true, source: 'non_pdf' };
  const book = getBook(img.pdfSource.bookId);
  const page = getPageRecord(img);
  if (!book || !page) {
    return { ok: false, source: 'missing_page_record', error: '页面记录不存在' };
  }

  const prepared = [];
  const targets = [page, ...getAdjacentPageRecords(book, page.pageNum).map(item => item.page)];
  for (const targetPage of targets) {
    const ta = targetPage.textAsset || getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: targetPage.pageNum } });
    if ((ta?.fullText || '').trim()) continue;
    try {
      const res = await extractTextForPage(book, targetPage, { force: false, refreshCrop: false });
      const nextTa = targetPage.textAsset || getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: targetPage.pageNum } });
      if ((nextTa?.fullText || '').trim()) {
        prepared.push({
          pageNum: targetPage.pageNum,
          mode: res.mode || 'prepared',
        });
      }
    } catch (e) {
      console.warn('ensureImagePageText failed', targetPage.pageNum, e);
    }
  }

  const blocks = getImageEvidenceBlocks(img);
  const hasText = blocks.length > 0;
  if (hasText && prepared.length && !silent) {
    const summary = prepared.map(item => `第 ${item.pageNum} 页`).join('、');
    toast(`✓ 已自动补齐证据文字：${summary}`, 'success');
  }
  return {
    ok: hasText,
    source: prepared[0]?.mode || (blocks[0]?.kind || 'existing_text'),
    error: hasText ? '' : '本页及相邻页均无可用文字证据'
  };
}

// 拼音种子（P1）：在名称产生/变化点（AI 回写 / 手动改名 / ↻自动）调后端 /api/pinyin
// 同步内存，使同会话的名称旁拼音与各导出口立即带值，不依赖刷新或后端写盘兜底。
// 自动拼音同时写 annotation 与 aiDraft（属 AI 基线，避免污染审核 diff）；
// pinyinSource==='human'（人工纠正过）不覆盖，除非 force（↻ 自动重生成）。
async function seedNamePinyin(img, { force = false, persistAfter = true } = {}) {
  const ann = img && (img.annotation || img.aiDraft);
  if (!ann) return;
  if (!force && ann.pinyinSource === 'human') return;
  const name = (ann.illustrationName || ann.subject || '').trim();
  let py = '';
  if (name) {
    try {
      const r = await fetch(`${BRIDGE_BASE}/api/pinyin?text=` + encodeURIComponent(name));
      if (!r.ok) return; // 后端异常：内存留旧值，落盘时由 write_images_guarded 兜底
      py = (await r.json()).pinyin || '';
    } catch (e) { return; }
  }
  for (const a of [img.annotation, img.aiDraft]) {
    if (!a) continue;
    if (!force && a.pinyinSource === 'human') continue;
    a.illustrationNamePinyin = py;
    a.pinyinSource = 'auto';
  }
  if (persistAfter) persistImage(img);
}

async function promoteAnnotationCandidate(img, result, runContext) {
  const snapshot = runContext.snapshot;
  const previousStatus = runContext.options?.previousStatus || img.status || 'todo';
  const { annotation, model, pageFullText, hasMultiple } = result;

  archiveConfirmedVersionBeforeRerun(img, previousStatus);
  img.aiDraft = deepClone(annotation);
  img.annotation = deepClone(annotation);
  resetCurrentReviewStateForFreshDraft(img, model);
  img.modelUsed = model;
  img.status = 'review';
  img.annotatedAt = Date.now();
  img.annotationEvidence = {
    mode: snapshot.evidenceMode,
    imageMode: snapshot.contextMeta?.annotationImageMode || 'illustration_crop',
    promptVersion: PROMPT_VERSION,
    blocks: (snapshot.evidenceBlocks || []).map(block => ({
      kind: block.kind,
      pageNums: block.pageNums,
      label: block.label,
      contentHash: fieldHash(block.text || ''),
    })),
    textExcerpt: img.annotation?.textEvidenceExcerpt || '',
    outputQualityFlags: annotation._outputQualityFlags || [],
    textSourceStatus: snapshot.textSourceStatus,
    ocrStatus: snapshot.ocrStatus,
    recordedAt: new Date().toISOString(),
  };
  img.annotationEvidence.ocrRiskNote = deriveOcrRiskNote(img);
  startNewDraftRun(img);
  img.versionContext = buildVersionContext({
    provider: snapshot.provider,
    model,
    evidenceMode: snapshot.evidenceMode,
    textSourceStatus: snapshot.textSourceStatus,
    ocrStatus: snapshot.ocrStatus,
    ...(snapshot.contextMeta || {}),
    outputQualityFlags: annotation._outputQualityFlags || [],
  });
  img.hasMultipleIllustrations = hasMultiple;

  // OCR 副产物不属于本次冻结输入；只在候选和 versionContext 都已基于快照
  // 生成后补写，避免把调用结束后的新文字伪装成本次模型已读取的证据。
  if (pageFullText && img.pdfSource) {
    const page = getPageRecord(img);
    const textAsset = page ? getPageTextAsset(img) : null;
    if (textAsset && !textAsset.fullText) {
      textAsset.fullText = pageFullText;
      textAsset.textSource = 'ai_annotation_byproduct';
      textAsset.textStatus = 'ocr';
      textAsset.extractedAt = new Date().toISOString();
    }
  }

  try {
    const archived = await storeModelRunSnapshot(img, deepClone(annotation), {
      provider: snapshot.provider,
      model,
      hasMultiple,
    });
    if (archived?.relative_path) {
      img.reviewMeta = img.reviewMeta || {};
      img.reviewMeta.modelArchivePath = archived.relative_path;
      const archiveList = Array.isArray(img.reviewMeta.modelArchives)
        ? img.reviewMeta.modelArchives.slice()
        : [];
      img.reviewMeta.modelArchives = [{
        provider: snapshot.provider,
        model,
        relative_path: archived.relative_path,
        stored_at: new Date().toISOString(),
      }, ...archiveList].slice(0, 12);
    }
  } catch (archiveError) {
    console.warn('model run archive failed', archiveError);
  }

  // 事务内只更新内存；由下方唯一一次阻塞保存统一提交，避免提前写入半成品。
  await seedNamePinyin(img, { persistAfter: false });
  if (runContext.options?.mock && !_bridgeAvailable) {
    persistImage(img);
    return { persisted: 'local_mock' };
  }
  const saved = await persistImageBlocking(img);
  if (!saved) {
    const error = new Error('新候选未能写入桥接存储，已保留原有标注数据');
    error.code = 'PROMOTION_PERSIST_FAILED';
    throw error;
  }
  return { persisted: 'bridge' };
}

function recordAnnotationRunReceipt(img, receipt) {
  img.reviewMeta = img.reviewMeta || {};
  const prior = Array.isArray(img.reviewMeta.annotationRuns)
    ? img.reviewMeta.annotationRuns
    : [];
  img.reviewMeta.annotationRuns = [deepClone(receipt), ...prior].slice(0, 30);
}

let _annotationRunModule = null;
function getAnnotationRunModule() {
  if (!_annotationRunModule) {
    _annotationRunModule = createAnnotationRunModule({
      captureEvidence: captureAnnotationEvidenceSnapshot,
      invokeModel: invokeAnnotationModel,
      promoteCandidate: promoteAnnotationCandidate,
      recordReceipt: recordAnnotationRunReceipt,
    });
  }
  return _annotationRunModule;
}

async function runAI(id) {
  const img = state.illustrations.find(i => i.id === id);
  if (!img) return false;
  if (getPendingReviewChanges(img).length) {
    toast('请先为当前修改选择原因并保存，再重新运行 AI', 'warn');
    renderForm();
    return false;
  }
  const annotationRunner = getAnnotationRunModule();
  if (img.status === 'running' || annotationRunner.isActive(id)) {
    toast('该插图正在标注中，请等待当前请求完成。', 'warn');
    return false;
  }
  const previousStatus = img.status || 'todo';
  const hadRecoverableResult = hasRecoverableCurrentResult(img);
  // running 只是界面态，不提前写入正式数据；刷新或进程中断时仍以旧记录为准。
  img.status = 'running';
  renderAll();
  try {
    const isMock = config.provider === 'mock';
    if (!isMock) {
      const bridgeReady = await checkBridge();
      if (!bridgeReady || !_bridgeStatus?.has_key || config.provider !== _bridgeStatus?.provider) {
        toast('本地桥接未就绪，或模型配置尚未保存。请先打开设置并保存模型配置。', 'error');
        return false;
      }
      if (!(await guardVisionTask('图像标注', {
        image_id: img.id,
        page_num: img.pdfSource?.pageNum || null,
        book_id: img.pdfSource?.bookId || '',
        book_title: img.pdfSource?.bookTitle || '',
      }))) return false;
      if (img.pdfSource) {
        const prep = await ensureImagePageText(img);
        const textStatus = getPageTextAsset(img)?.textStatus || 'missing';
        if (!prep.ok || textStatus === 'missing') {
          const choice = await openTextMissingGate(img);
          if (choice !== 'proceed') return false;
        }
      }
    }

    const outcome = await annotationRunner.run(img, { mock: isMock, previousStatus });
    if (!outcome.ok) {
      const outputRejected = outcome.code === 'OUTPUT_INCOMPLETE' || outcome.code === 'OUTPUT_INVALID';
      img.status = hadRecoverableResult && previousStatus !== 'running' ? previousStatus : 'todo';
      persistImage(img); renderAll();
      const error = new Error(outcome.message || '标注运行失败');
      error.code = outcome.code;
      await logClientRuntimeFailure('annotate_client', error, {
        image_id: img.id,
        page_num: img.pdfSource?.pageNum || null,
        book_id: img.pdfSource?.bookId || '',
        book_title: img.pdfSource?.bookTitle || '',
        has_pdf_source: !!img.pdfSource,
        annotation_run_id: outcome.runId || '',
        annotation_run_code: outcome.code || '',
      });
      toast(outputRejected
        ? `✗ 模型结果未进入待审核：${outcome.message}。可重新运行。`
        : `✗ 标注失败：${outcome.message}`, 'error');
      return false;
    }
    persistImage(img); renderAll();
    const multiNote = outcome.result?.hasMultiple ? '（检测到多图，建议人工核查）' : '';
    toast(`✓ ${img.id} AI 标注完成${multiNote}`, outcome.result?.hasMultiple ? 'warn' : 'success');
    return true;
  } catch (e) {
    img.status = hadRecoverableResult && previousStatus !== 'running' ? previousStatus : 'todo';
    persistImage(img); renderAll();
    await logClientRuntimeFailure('annotate_client', e, {
      image_id: img.id,
      page_num: img.pdfSource?.pageNum || null,
      book_id: img.pdfSource?.bookId || '',
      book_title: img.pdfSource?.bookTitle || '',
      has_pdf_source: !!img.pdfSource,
    });
    toast(`✗ 标注失败：${e.message}`, 'error');
    console.error('runAI error:', e);
    return false;
  } finally {
    if (img.status === 'running') {
      img.status = previousStatus === 'running' ? 'todo' : previousStatus;
      persistImage(img); renderAll();
    }
  }
}

// ── 全局批次控制器 ─────────────────────────────────────────────────────────
let _batchJob = null;
// 结构：{ id, targets, cursor, completed, failed, active, paused, cancelled,
//         skipIds: Set, startedAt, concurrency, bookId }
// 进度展示统一在「标注队列」监控页；底部悬浮进度条已移除（2026-06-12）

function getBatchJob() { return _batchJob; }

function batchPause()  { if (_batchJob) { _batchJob.paused = true;  refreshBatchMonitor(); } }
function batchResume() { if (_batchJob) { _batchJob.paused = false; refreshBatchMonitor(); } }
function batchCancel() {
  if (!_batchJob) return;
  _batchJob.cancelled = true;
  _batchJob.paused = false;
  // 将所有还在 running 状态的目标重置
  _batchJob.targets.forEach(img => { if (img.status === 'running') img.status = 'todo'; });
  persistImages(_batchJob.targets);
  refreshBatchMonitor();
}
function batchSkipItem(imgId) {
  if (!_batchJob) return;
  _batchJob.skipIds.add(imgId);
  const img = state.illustrations.find(i => i.id === imgId);
  if (img && img.status === 'running') img.status = 'todo';
  if (img) persistImage(img);
  refreshBatchMonitor();
}

let _bmonRefreshTimer = null;
function refreshBatchMonitor() {
  if (state.mainView === 'batch-monitor') renderMain();
  // 批次进行中时，若监控页打开则启动定时刷新
  if (_batchJob && !_batchJob.cancelled && state.mainView === 'batch-monitor') {
    clearTimeout(_bmonRefreshTimer);
    _bmonRefreshTimer = setTimeout(() => refreshBatchMonitor(), 2000);
  }
  // 底部悬浮进度条已移除（计数不准确，2026-06-12 用户决定）；进度统一看「标注队列」监控页
}

// 任务书 §5.2：批量操作前触发数据中心自动备份（best-effort，失败不阻塞批量流程）
async function dataCenterAutoBackup(reasonKey) {
  try {
    await fetch(`${BRIDGE_BASE}/api/data-center/auto-backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason_key: reasonKey }),
    });
  } catch (e) {
    console.warn('[data-center] auto-backup failed:', e);
  }
}

async function runBatch(targetIds = null, { skipConfirm = false, includeExisting = false } = {}) {
  if (!(await guardVisionTask('批量图像标注', {
    target_count: Array.isArray(targetIds) ? targetIds.length : null,
    entry: 'runBatch',
  }))) return;
  // 任务书 §5.2：批量重新标注前自动备份（best-effort）
  await dataCenterAutoBackup('before_bulk_annotate');
  const requestedIds = targetIds ? new Set(targetIds) : null;
  const requested = requestedIds
    ? state.illustrations.filter(img => requestedIds.has(img.id))
    : state.illustrations.filter(img => img.status === 'todo');
  const targets = includeExisting && requestedIds
    ? requested.slice()
    : getTodoImages(targetIds);
  const concurrency = Math.max(1, Math.min(10, Number(config.batchConcurrency) || 1));
  const scopedBookId = targets.length > 0 ? (targets[0].pdfSource?.bookId || null) : null;
  const skippedExisting = requested.filter(img => img.status === 'todo' && !targets.some(t => t.id === img.id)).length;
  if (targets.length === 0) {
    toast(skippedExisting > 0 ? `已跳过 ${skippedExisting} 张已有标注结果的记录，无需重复标注。` : '当前没有可批量标注的图片。', 'warn');
    return;
  }
  const bridgeReady = await checkBridge();
  if (!skipConfirm) {
    const ok = await openConfirm(
      (() => {
        const p = config.provider;
        const KM = { qwen: 'qwenKey', openai: 'openaiKey', deepseek: 'deepseekKey', kimi: 'kimiKey', doubao: 'doubaoKey', zhipu: 'zhipuKey', gemini: 'geminiKey', baidu: 'baiduKey' };
        const MM = { qwen: config.qwenModel, openai: config.openaiModel, deepseek: config.deepseekModel, kimi: config.kimiModel, doubao: config.doubaoModel, zhipu: config.zhipuModel, gemini: config.geminiModel, baidu: config.baiduModel };
        const bridgeCanAnnotate = bridgeReady && _bridgeStatus?.has_key && p === _bridgeStatus?.provider;
        const hasLocalKey = KM[p] ? !!config[KM[p]] : false;
        const mock = p === 'mock' || (!hasLocalKey && !bridgeCanAnnotate);
        return `将对 ${targets.length} 张图片运行 AI 标注，使用模型：${mock ? 'Mock (Demo)' : (MM[p] || p)}，并发：${concurrency} 张。${skippedExisting > 0 ? `已自动跳过 ${skippedExisting} 张已有标注结果的记录。` : ''}确认？`;
      })(),
    );
    if (!ok) return;
  }

  // 重标前必须生成磁盘备份：仅当批量重标"已有结果"的记录时（includeExisting），覆盖前留一份可恢复快照
  if (includeExisting && bridgeReady) {
    try {
      const r = await fetch(`${BRIDGE_BASE}/api/backup-now`, { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast('已生成重标前备份', 'success');
    } catch (err) {
      const cont = await openConfirm(`重标前自动备份失败（${err?.message || err}）。\n继续可能在覆盖后无法从磁盘备份恢复。仍要继续重标吗？`);
      if (!cont) return;
    }
  }

  // 创建全局批次控制对象
  _batchJob = {
    id: Date.now().toString(36),
    targets,
    cursor: 0,
    completed: 0,
    failed: 0,
    active: 0,
    paused: false,
    cancelled: false,
    skipIds: new Set(),
    startedAt: new Date(),
    concurrency,
    bookId: scopedBookId || null,
    textPrepared: 0,
    textFailed: 0,
    errors: [],
  };
  const job = _batchJob;
  refreshBatchMonitor();

  const worker = async () => {
    while (true) {
      // 暂停等待
      while (job.paused && !job.cancelled) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (job.cancelled) return;

      const idx = job.cursor++;
      if (idx >= job.targets.length) return;
      const target = job.targets[idx];
      if (job.skipIds.has(target.id)) continue;

      job.active++;
      refreshBatchMonitor();
      try {
        if (!job.cancelled && !job.skipIds.has(target.id)) {
          // 单张与批量共用同一运行入口：文字准备、证据冻结、模型调用和
          // 候选提升的顺序只由 runAI/AnnotationRun 负责。
          const ok = await runAI(target.id);
          if (!job.cancelled && ok) job.completed++;
          else if (!job.cancelled) {
            job.failed++;
            job.errors.push({
              id: target.id,
              page: target.pdfSource?.pageNum || null,
              stage: 'annotate',
              error: 'runAI returned false',
            });
          }
        }
      } catch (e) {
        job.failed++;
        job.errors.push({
          id: target.id,
          page: target.pdfSource?.pageNum || null,
          stage: 'annotate',
          error: e?.message || String(e),
        });
        console.error('batch worker failed', target.id, e);
      }
      finally {
        job.active--;
        refreshBatchMonitor();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));

  const wasCancelled = job.cancelled;
  _batchJob = null;
  refreshBatchMonitor();

  if (targetIds) {
    const doneIds = new Set(targets.map(img => img.id));
    state.annotateSelection = state.annotateSelection.filter(id => {
      if (!doneIds.has(id)) return true;
      const img = state.illustrations.find(item => item.id === id);
      return img?.status === 'todo';
    });
    persist();
  }
  if (job.textFailed > 0) {
    toast(`批量文字准备完成：成功 ${job.textPrepared}，失败 ${job.textFailed}。`, 'warn');
  }
  if (wasCancelled) {
    toast(`批量标注已取消，已完成 ${job.completed} / ${targets.length} 张`, 'warn');
  } else {
    toast(`批量标注完成：${targets.length} 张`, 'success');
  }
}

/* ============================================================
   ADD IMAGE MODAL
   ============================================================ */
function openAdd() {
  let activeTab = 'url';
  const state2 = { fileInfo: null, dataUrl: null, pdfPages: [], selectedPages: new Set() };

  const renderBody = () => {
    body.innerHTML = '';
    if (activeTab === 'url') {
      const urlInp = el('input', { type: 'text', placeholder: 'https://example.com/img.jpg', id: 'add-url' });
      const idInp = el('input', { type: 'text', placeholder: '自动生成', id: 'add-id' });
      const srcInp = el('input', { type: 'text', placeholder: '如：补遗雷公炮制便览·卷1', id: 'add-src' });
      const pageInp = el('input', { type: 'text', placeholder: '如：卷十二·页 045', id: 'add-page' });
      const preview = el('div', { class: 'preview-box', id: 'preview-box' });

      body.appendChild(field('图片 URL', urlInp));
      body.appendChild(field('图片 ID（可选）', idInp));
      body.appendChild(field('来源文献', srcInp));
      body.appendChild(field('卷次 / 页码', pageInp));
      body.appendChild(el('button', { class: 'btn', onclick: () => {
        const u = urlInp.value.trim();
        preview.innerHTML = '';
        if (!u) return;
        const im = new Image();
        im.onload = () => preview.appendChild(im);
        im.onerror = () => preview.appendChild(el('div', { style: 'color:#c1352b; font-size:12.5px' }, '⚠ 图片加载失败（可能受 CORS 限制；提交后仍会以 URL 形式保存）'));
        im.src = u;
      } }, '预览图片'));
      body.appendChild(preview);

      const batchTa = el('textarea', { placeholder: '每行一个 URL，可批量添加…', style: 'width:100%; min-height:100px; border:1px solid var(--c-border-strong); border-radius:6px; padding:8px; font-family: var(--f-mono); font-size:12px;' });
      body.appendChild(el('details', { class: 'advanced' },
        el('summary', null, '批量输入（多个 URL，每行一个）'),
        batchTa,
      ));
      body._submit = () => {
        const batch = batchTa.value.trim();
        if (batch) {
          const lines = batch.split('\n').map(s => s.trim()).filter(Boolean);
          for (const u of lines) {
            addImage({ url: u, source: srcInp.value.trim(), page: pageInp.value.trim() });
          }
          toast(`已批量添加 ${lines.length} 张`, 'success');
          return true;
        }
        const u = urlInp.value.trim();
        if (!u) { toast('请输入图片 URL', 'error'); return false; }
        addImage({
          id: idInp.value.trim() || undefined,
          url: u,
          source: srcInp.value.trim(),
          page: pageInp.value.trim(),
        });
        toast('已添加图片', 'success');
        return true;
      };

    } else if (activeTab === 'upload') {
      const dz = el('div', { class: 'drop-zone' },
        '📁 拖放图片到此处，或点击选择文件', el('br'),
        el('span', { style: 'font-size:12px; color:#aaa' }, '支持：PNG / JPG / TIFF'),
      );
      const fi = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      dz.appendChild(fi);
      dz.onclick = () => fi.click();
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
      dz.ondragleave = () => dz.classList.remove('over');
      dz.ondrop = (e) => {
        e.preventDefault(); dz.classList.remove('over');
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
      };
      fi.onchange = () => { if (fi.files[0]) handleFile(fi.files[0]); };
      function handleFile(f) {
        const reader = new FileReader();
        reader.onload = () => {
          state2.fileInfo = { name: f.name, size: f.size };
          state2.dataUrl = reader.result;
          renderBody();
        };
        reader.readAsDataURL(f);
      }
      body.appendChild(dz);
      if (state2.fileInfo) {
        body.appendChild(el('div', { class: 'file-info' },
          `已选：${state2.fileInfo.name}  ${(state2.fileInfo.size/1024/1024).toFixed(2)} MB`));
        body.appendChild(el('div', { class: 'preview-box' }, el('img', { src: state2.dataUrl })));
      }
      const srcInp = el('input', { type: 'text', placeholder: '如：补遗雷公炮制便览·卷1' });
      const pageInp = el('input', { type: 'text', placeholder: '如：卷十二·页 045' });
      body.appendChild(field('来源文献', srcInp));
      body.appendChild(field('卷次 / 页码', pageInp));
      body._submit = () => {
        if (!state2.dataUrl) { toast('请先选择图片文件', 'error'); return false; }
        addImage({
          name: state2.fileInfo.name.replace(/\.[^.]+$/, ''),
          url: state2.dataUrl,
          source: srcInp.value.trim(),
          page: pageInp.value.trim(),
        });
        toast('已上传并添加', 'success');
        return true;
      };

    } else if (activeTab === 'pdf') {
      body.appendChild(el('div', { class: 'drop-zone', onclick: () => {
        // mock: simulate pdf with 12 stand-in pages
        state2.pdfFile = { name: 'bencao_gangmu.pdf', size: 156 * 1024 * 1024, pages: 320 };
        state2.pdfPages = Array.from({ length: 12 }, (_, i) => ({
          page: 45 + i,
          thumb: placeholderImg(100 + i, '页 ' + (45 + i)),
        }));
        renderBody();
      } }, '📄 点击选择 PDF 文件（Mock）'));

      if (state2.pdfFile) {
        body.appendChild(el('div', { class: 'file-info' },
          `已选：${state2.pdfFile.name}（${(state2.pdfFile.size/1024/1024).toFixed(0)} MB，共 ${state2.pdfFile.pages} 页）`));
        body.appendChild(el('div', { style: 'font-size:13px; margin-top:10px; color:var(--c-text-soft)' }, '提取页面（已模拟提取 45–56 页）：'));
        const grid = el('div', { class: 'pdf-pages' });
        for (const p of state2.pdfPages) {
          const on = state2.selectedPages.has(p.page);
          grid.appendChild(el('div', {
            class: 'pdf-page' + (on ? ' on' : ''),
            onclick: () => {
              if (state2.selectedPages.has(p.page)) state2.selectedPages.delete(p.page);
              else state2.selectedPages.add(p.page);
              renderBody();
            },
          },
            el('img', { src: p.thumb }),
            el('div', { class: 'pn' }, '页 ' + p.page),
          ));
        }
        body.appendChild(grid);
      }
      const srcInp = el('input', { type: 'text', placeholder: '如：补遗雷公炮制便览·卷1' });
      body.appendChild(field('来源文献', srcInp));
      body._submit = () => {
        if (!state2.pdfFile) { toast('请先选择 PDF', 'error'); return false; }
        if (state2.selectedPages.size === 0) { toast('请选择至少一页', 'error'); return false; }
        let n = 0;
        for (const pn of state2.selectedPages) {
          const pg = state2.pdfPages.find(p => p.page === pn);
          addImage({
            name: `${state2.pdfFile.name.replace('.pdf','')} 页 ${pn}`,
            url: pg.thumb,
            source: srcInp.value.trim() || state2.pdfFile.name,
            page: '页 ' + pn,
          });
          n++;
        }
        toast(`已从 PDF 添加 ${n} 张`, 'success');
        return true;
      };
    }
  };

  const tabsRow = el('div', { class: 'modal-tabs' });
  for (const [k, label] of [['url','输入 URL'], ['upload','上传本地'], ['pdf','从 PDF 提取']]) {
    const b = el('button', {
      class: activeTab === k ? 'active' : '',
      onclick: () => { activeTab = k; document.querySelectorAll('.modal-tabs button').forEach(x => x.classList.toggle('active', x.dataset.k === k)); renderBody(); },
    }, label);
    b.dataset.k = k;
    tabsRow.appendChild(b);
  }

  const body = el('div', { class: 'modal-body' });
  renderBody();

  const modal = el('div', { class: 'modal' },
    el('div', { class: 'modal-head' },
      el('h3', null, '添加图片'),
      el('button', { class: 'modal-close', onclick: close }, '×'),
    ),
    tabsRow,
    body,
    el('div', { class: 'modal-foot' },
      el('button', { class: 'btn', onclick: close }, '取消'),
      el('button', { class: 'btn primary', onclick: () => { if (body._submit && body._submit()) close(); } }, '添加'),
    ),
  );
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } }, modal);
  $('#overlay-root').appendChild(scrim);
  function close() { scrim.remove(); }
}

function addImage({ id, name, url, source, page }) {
  const newId = id || autoId();
  const imgObj = {
    id: newId,
    name: name || newId,
    url,
    source: source || '未注明',
    page: page || '',
    status: 'todo',
    aiDraft: null,
    annotation: null,
    reviewDiff: {},
    reviewMeta: {},
    crossref: { classical: '', verdict: '', note: '' },
    createdAt: Date.now(),
    annotatedAt: null,
    modelUsed: null,
  };
  state.illustrations.push(imgObj);
  state.selectedId = newId;
  persist();
  renderAll();
  // 若是 dataURL，异步上传到 bridge 并替换为持久 URL
  if (url && url.startsWith('data:')) {
    maybePersistImage(newId, url).then(bridgeUrl => {
      if (bridgeUrl !== url) {
        imgObj.url = bridgeUrl;
        persist();
        // 若当前正显示此图，刷新图像预览
        if (state.selectedId === newId) renderMain();
      }
    });
  }
}
function autoId() {
  let n = 1;
  while (state.illustrations.some(i => i.id === `img_${String(n).padStart(3,'0')}`)) n++;
  return `img_${String(n).padStart(3,'0')}`;
}

/* ============================================================
   CONFIRM DIALOG
   ============================================================ */
function openConfirm(message) {
  return new Promise(resolve => {
    const dlg = el('div', { class: 'confirm' },
      el('h3', null, '确认操作'),
      el('p', null, message),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => { scrim.remove(); resolve(false); } }, '取消'),
        el('button', { class: 'btn primary', onclick: () => { scrim.remove(); resolve(true); } }, '确认'),
      ),
    );
    const scrim = el('div', { class: 'scrim' }, dlg);
    $('#overlay-root').appendChild(scrim);
  });
}

// 带图片预览的确认弹窗（用于新增选框等需要先看清再确认的操作）
function openImagePreviewConfirm(imgUrl, { title = '确认', okLabel = '✓ 确认', cancelLabel = '✕ 取消', note = '' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; scrim.remove(); resolve(v); };
    const dlg = el('div', { class: 'confirm', style: 'max-width:440px;' },
      el('h3', null, title),
      el('div', { style: 'text-align:center; margin:6px 0 10px;' },
        imgUrl
          ? el('img', { src: imgUrl, style: 'max-width:100%; max-height:340px; border:1px solid var(--c-border); border-radius:8px; background:#faf8f0;' })
          : el('div', { style: 'color:var(--c-text-mute); font-size:13px; padding:30px 0;' }, '（无预览图）')),
      note ? el('p', { style: 'font-size:12px; color:var(--c-text-soft); line-height:1.7;' }, note) : null,
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => finish(false) }, cancelLabel),
        el('button', { class: 'btn primary', onclick: () => finish(true) }, okLabel),
      ),
    );
    const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) finish(false); } }, dlg);
    $('#overlay-root').appendChild(scrim);
  });
}

function openQueueImageDetail(img) {
  if (!img) return;
  const book = img.pdfSource?.bookId ? getBook(img.pdfSource.bookId) : null;
  const pageNum = Number(img.pdfSource?.pageNum) || null;
  const previewSrc = getIllustrationViewUrl(img, 1200);
  const statusLabel = {
    running: '标注中',
    todo: '待标注',
    review: '待确认',
    ok: '已确认',
    bad: '已跳过',
  }[img.status] || img.status || '未知';
  const metaRows = [
    ['名称', img.bookRef || img.name || img.id],
    ['书籍', book?.title || img.source || '—'],
    ['页码', pageNum ? `第 ${pageNum} 页` : (img.page || '—')],
    ['图项', img.figureIndex || img.subIndex ? `图 ${img.figureIndex || img.subIndex}` : (isSplitIllustrationRecord(img) ? '图项' : '整页/单图')],
    ['状态', statusLabel],
    ['模型', img.modelUsed || '—'],
  ];
  const close = () => scrim.remove();
  const dlg = el('div', { class: 'confirm', style: 'width:min(760px, calc(100vw - 64px)); max-width:760px;' },
    el('h3', null, '插图详情'),
    el('div', { style: 'display:grid; grid-template-columns:minmax(240px, 1fr) 260px; gap:14px; align-items:start;' },
      el('div', { style: 'min-height:260px; display:flex; align-items:center; justify-content:center; background:#faf8f0; border:1px solid var(--c-border); border-radius:8px; padding:10px; overflow:auto;' },
        previewSrc
          ? el('img', { src: previewSrc, style: 'max-width:100%; max-height:62vh; object-fit:contain; display:block;' })
          : el('div', { style: 'color:var(--c-text-mute); font-size:13px;' }, '无可用预览图')
      ),
      el('div', { style: 'display:grid; gap:8px; font-size:12.5px;' },
        ...metaRows.map(([k, v]) => el('div', { style: 'display:grid; grid-template-columns:52px 1fr; gap:8px;' },
          el('span', { style: 'color:var(--c-text-mute);' }, k),
          el('span', { style: 'color:var(--c-text); line-height:1.6; word-break:break-word;' }, v)
        )),
        rect ? el('div', { style: 'margin-top:4px; color:var(--c-text-mute); line-height:1.6;' }, `裁剪框：${formatRectSpec(rect)}`) : null
      )
    ),
    el('div', { class: 'row', style: 'margin-top:14px;' },
      book && pageNum ? el('button', {
        class: 'btn',
        onclick: () => {
          close();
          openPageDetail(book.id, pageNum, 'illustrations', img.id);
        },
      }, '打开所在页') : null,
      el('button', { class: 'btn primary', onclick: close }, '关闭')
    )
  );
  const scrim = el('div', {
    class: 'scrim',
    onclick: e => { if (e.target === scrim) close(); },
  }, dlg);
  $('#overlay-root').appendChild(scrim);
}

function openHomeBookCardMenu(book) {
  if (!book) return;
  const dlg = el('div', { class: 'confirm', style: 'max-width:360px' },
    el('h3', null, book.title || '书籍操作'),
    el('p', null, '可打开该书继续整理，或编辑书籍信息、删除该书及其关联资源。'),
    el('div', { style: 'display:grid; gap:8px;' },
      el('button', {
        class: 'btn',
        onclick: () => { scrim.remove(); openBookLandingPage(book.id); }
      }, '打开书籍'),
      el('button', {
        class: 'btn',
        onclick: () => { scrim.remove(); openBookInfoEditor(book); }
      }, '编辑书籍信息'),
      el('button', {
        class: 'btn danger-ghost',
        onclick: async () => { scrim.remove(); await deleteBookFromState(book.id); }
      }, '删除书籍')
    ),
    el('div', { class: 'row', style: 'margin-top:14px;' },
      el('button', { class: 'btn', onclick: () => scrim.remove() }, '取消')
    )
  );
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) scrim.remove(); } }, dlg);
  $('#overlay-root').appendChild(scrim);
}

function openBookInfoEditor(book) {
  if (!book) return;
  const inp = (label, val, placeholder) => {
    const wrap = el('div', { style: 'display:flex; flex-direction:column; gap:4px;' });
    wrap.appendChild(el('label', { style: 'font-size:12px; color:var(--c-text-soft);' }, label));
    const input = el('input', {
      type: 'text', value: val || '', placeholder: placeholder || '',
      style: 'padding:7px 10px; border:1px solid var(--c-border); border-radius:6px; font-size:13px; color:var(--c-text); outline:none; width:100%; box-sizing:border-box;',
    });
    wrap.appendChild(input);
    return { wrap, input };
  };
  const titleField      = inp('书名',        book.title,             '书名');
  const dynastyField    = inp('朝代',        book.dynasty,           '如：明、清…');
  const versionField    = inp('版本 / 卷次', book.version,           '如：清刻本 卷一');
  const editionField    = inp('刻本',        book.edition    || '',  '如：明嘉靖刻本');
  const repositoryField = inp('收藏机构',    book.repository || '',  '如：国家图书馆');
  const printYearField  = inp('刻印年代',    book.printYear  || '',  '如：1596');
  const layoutSel = el('select', { style: 'width:100%; padding:6px 8px; border:1px solid var(--c-border); border-radius:var(--r-ctrl); font-size:13px;' },
    el('option', { value: 'auto'        }, '自动（两侧均取文字）'),
    el('option', { value: 'text_after'  }, '图在文前（描述在图后）'),
    el('option', { value: 'text_before' }, '图在文后（描述在图前）'),
  );
  layoutSel.value = book.textLayout || 'auto';
  const layoutWrap = el('div', { class: 'field-wrap' },
    el('label', { style: 'font-size:12px; color:var(--c-text-soft); display:block; margin-bottom:4px;' }, '图文排版'),
    layoutSel,
  );

  const errMsg = el('div', { style: 'font-size:12px; color:#d32f2f; min-height:16px;' });

  const save = async () => {
    const newTitle = titleField.input.value.trim();
    if (!newTitle) { errMsg.textContent = '书名不能为空'; return; }
    book.title      = newTitle;
    book.dynasty    = dynastyField.input.value.trim();
    book.version    = versionField.input.value.trim();
    book.edition    = editionField.input.value.trim();
    book.repository = repositoryField.input.value.trim();
    book.printYear  = printYearField.input.value.trim();
    book.textLayout = layoutSel.value;
    persist(book.id);
    scrim.remove();
    renderHome();
  };

  const dlg = el('div', { class: 'modal', style: 'max-width:400px;' },
    el('div', { class: 'modal-head' },
      el('h3', null, '编辑书籍信息'),
      el('button', { class: 'modal-close', onclick: () => scrim.remove() }, '×'),
    ),
    el('div', { class: 'modal-body', style: 'display:flex; flex-direction:column; gap:14px;' },
      titleField.wrap,
      dynastyField.wrap,
      versionField.wrap,
      editionField.wrap,
      repositoryField.wrap,
      printYearField.wrap,
      layoutWrap,
      errMsg,
    ),
    el('div', { class: 'modal-foot' },
      el('button', { class: 'btn', onclick: () => scrim.remove() }, '取消'),
      el('button', { class: 'btn primary', onclick: save }, '保存'),
    ),
  );
  // 回车保存
  dlg.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) scrim.remove(); } }, dlg);
  $('#overlay-root').appendChild(scrim);
  titleField.input.focus();
  titleField.input.select();
}

/* ============================================================
   BOOK IMPORT MODAL
   ============================================================ */
function releaseImageImportPreviewUrls(ctx) {
  for (const url of (ctx.imagePreviewUrls || [])) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
  ctx.imagePreviewUrls = [];
}

function prepareImageImportPlan(ctx, files) {
  const api = globalThis.ImageBookImport;
  if (!api) throw new Error('图片书籍导入模块未加载');
  releaseImageImportPreviewUrls(ctx);
  const plan = api.analyzeImageFiles(files);
  ctx.imagePreviewUrls = [];
  plan.volumes.forEach(volume => volume.scans.forEach(scan => {
    scan.previewUrl = URL.createObjectURL(scan.file);
    ctx.imagePreviewUrls.push(scan.previewUrl);
  }));
  ctx.imagePlan = plan;
  ctx.imageMeta = {
    title: plan.title,
    dynasty: '',
    edition: '',
    repository: '',
    printYear: '',
    textLayout: 'auto',
  };
  ctx.imagePlanConfirmed = false;
  return plan;
}

function uploadImageBookPlan(ctx, onProgress) {
  const api = globalThis.ImageBookImport;
  const manifest = api.buildManifest(ctx.imagePlan, ctx.imageMeta);
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  ctx.imagePlan.files.forEach(file => form.append('files', file, file.name));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BRIDGE_IMPORT_IMAGE_BOOK_URL);
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      onProgress?.({ phase: 'upload', current: event.loaded, total: event.total });
    };
    xhr.upload.onload = () => onProgress?.({ phase: 'process', current: 1, total: 1 });
    xhr.onerror = () => reject(new Error('无法连接本地导入服务'));
    xhr.onload = () => {
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status < 200 || xhr.status >= 300 || payload.error) {
        const error = new Error(payload.error || `图片书籍导入失败（HTTP ${xhr.status}）`);
        error.code = payload.code || '';
        reject(error);
        return;
      }
      resolve(payload);
    };
    xhr.send(form);
  });
}

function renderImageBookImport(ctx, body, foot, render, close) {
  const api = globalThis.ImageBookImport;
  if (!api) {
    body.appendChild(el('div', { style: 'color:var(--c-error)' }, '图片书籍导入模块未加载，请刷新页面。'));
    foot.appendChild(el('button', { class: 'btn', onclick: close }, '关闭'));
    return;
  }

  if (ctx.stage === 'image-importing') {
    const progress = ctx.imageProgress || { phase: 'upload', current: 0, total: 1 };
    const pct = progress.phase === 'upload' && progress.total
      ? Math.round(progress.current / progress.total * 100)
      : 100;
    body.appendChild(el('div', { class: 'image-import-progress' },
      el('div', { style: 'font:600 19px var(--f-serif); color:var(--c-nav);' },
        progress.phase === 'upload' ? '正在传送原始扫描图' : '正在校验、拆页并建立书籍'),
      el('div', { class: 'progress-bar', style: 'max-width:520px; width:100%; margin:0 auto;' },
        el('div', { style: `width:${pct}%` })),
      el('div', { style: 'font-size:12px; color:var(--c-text-soft); line-height:1.8;' },
        progress.phase === 'upload'
          ? `${pct}% · 原图只传入本地 bridge，不经过远端模型`
          : '正在计算 SHA-256、保存原图并按“右页→左页”生成逻辑页。请勿关闭窗口。'),
    ));
    foot.appendChild(el('button', { class: 'btn', disabled: '' }, '处理中…'));
    return;
  }

  if (ctx.stage === 'image-done') {
    const result = ctx.imageImportResult || {};
    body.appendChild(el('div', { class: 'image-import-progress' },
      el('div', { style: 'font-size:34px; color:var(--c-success);' }, '✓'),
      el('div', { style: 'font:600 19px var(--f-serif); color:var(--c-nav);' }, '图片书籍已安全导入'),
      el('div', { style: 'font-size:13px; color:var(--c-text-soft); line-height:1.9;' },
        `卷册 ${result.books?.length || 0} · 原始扫描 ${result.source_scan_count || 0} 张 · 逻辑页 ${result.logical_page_count || 0} 页`,
        el('br'),
        result.backup?.backup_id ? `导入前备份：${result.backup.backup_id}` : '原数据集为空，未生成空备份'),
    ));
    foot.appendChild(el('button', { class: 'btn', onclick: close }, '关闭'));
    foot.appendChild(el('button', {
      class: 'btn primary',
      onclick: () => {
        const book = result.books?.[0];
        if (book) openBookLandingPage(book.id);
        close();
      },
    }, '打开新书'));
    return;
  }

  if (ctx.stage === 'image-error') {
    body.appendChild(el('div', { class: 'image-import-progress' },
      el('div', { style: 'font:600 18px var(--f-serif); color:var(--c-error);' }, '导入未写入'),
      el('div', { style: 'font-size:13px; color:var(--c-text-soft); line-height:1.8;' },
        ctx.errorMsg || '图片书籍导入失败。'),
    ));
    foot.appendChild(el('button', { class: 'btn', onclick: close }, '关闭'));
    foot.appendChild(el('button', {
      class: 'btn primary',
      onclick: () => { ctx.stage = 'form'; render(); },
    }, '返回预检'));
    return;
  }

  const folderInput = el('input', {
    type: 'file',
    accept: '.jpg,.jpeg,.png,.webp,.tif,.tiff,image/*',
    multiple: '',
    webkitdirectory: '',
    directory: '',
    style: 'display:none',
  });
  const filesInput = el('input', {
    type: 'file',
    accept: '.jpg,.jpeg,.png,.webp,.tif,.tiff,image/*',
    multiple: '',
    style: 'display:none',
  });
  const chooseFiles = fileList => {
    if (!fileList?.length) return;
    try {
      const plan = prepareImageImportPlan(ctx, fileList);
      if (!plan.sourceScanCount) {
        toast('没有找到支持的 JPG/PNG/WebP/TIFF 图片', 'warn');
        return;
      }
      render();
    } catch (error) {
      toast(error.message || String(error), 'error');
    }
  };
  folderInput.onchange = () => chooseFiles(folderInput.files);
  filesInput.onchange = () => chooseFiles(filesInput.files);

  const sourcePanel = el('div', { class: 'image-import-source' },
    el('div', { style: 'display:flex; justify-content:space-between; gap:14px; align-items:center;' },
      el('div', null,
        el('div', { style: 'font:600 16px var(--f-serif); color:var(--c-nav);' }, '图片书籍 · 来源预检'),
        el('div', { style: 'font-size:12px; color:var(--c-text-soft); margin-top:4px;' },
          '选择含卷册子目录的文件夹；系统默认按单页预览，确认前不会写入数据。')),
      el('div', { style: 'display:flex; gap:7px; flex:0 0 auto;' },
        el('button', { class: 'btn primary', onclick: () => folderInput.click() }, '选择文件夹'),
        el('button', { class: 'btn', onclick: () => filesInput.click() }, '多选图片'),
      ),
    ),
    folderInput,
    filesInput,
  );

  const plan = ctx.imagePlan;
  const wrap = el('div', { class: 'image-book-import' }, sourcePanel);
  if (!plan) {
    wrap.appendChild(el('div', { class: 'drop-zone', onclick: () => folderInput.click() },
      el('div', { style: 'font:600 18px var(--f-serif); color:var(--c-nav); margin-bottom:6px;' }, '把一套扫描图作为书籍导入'),
      el('div', null, '推荐选择最外层书籍文件夹，系统会按子目录识别卷册、按文件名数字排序。'),
      el('div', { style: 'font-size:11.5px; margin-top:8px;' }, '支持 JPG / JPEG / PNG / WebP / TIFF；不会把图片先转成 PDF。'),
    ));
    body.appendChild(wrap);
    foot.appendChild(el('button', { class: 'btn', onclick: close }, '取消'));
    return;
  }

  plan.logicalPageCount = api.countLogicalPages(plan.volumes);
  const summary = el('div', { class: 'image-import-summary' },
    el('div', { class: 'image-import-metric' }, el('b', null, String(plan.volumes.length)), el('span', null, '识别卷册')),
    el('div', { class: 'image-import-metric' }, el('b', null, String(plan.sourceScanCount)), el('span', null, '原始扫描图')),
    el('div', { class: 'image-import-metric' }, el('b', null, String(plan.logicalPageCount)), el('span', null, '预计逻辑页')),
  );
  wrap.appendChild(summary);

  const titleInp = el('input', { type: 'text', value: ctx.imageMeta.title, placeholder: '书名' });
  titleInp.oninput = event => { ctx.imageMeta.title = event.target.value; ctx.imagePlanConfirmed = false; };
  const dynastyInp = el('input', { type: 'text', value: ctx.imageMeta.dynasty, placeholder: '如：清' });
  dynastyInp.oninput = event => { ctx.imageMeta.dynasty = event.target.value; };
  const editionInp = el('input', { type: 'text', value: ctx.imageMeta.edition, placeholder: '如：同治刻本' });
  editionInp.oninput = event => { ctx.imageMeta.edition = event.target.value; };
  const repositoryInp = el('input', { type: 'text', value: ctx.imageMeta.repository, placeholder: '来源网站或收藏机构' });
  repositoryInp.oninput = event => { ctx.imageMeta.repository = event.target.value; };
  wrap.appendChild(el('div', { style: 'display:grid; grid-template-columns:2fr 1fr 1fr 1.5fr; gap:9px;' },
    field('整本书名', titleInp),
    field('朝代', dynastyInp),
    field('版本', editionInp),
    field('来源/收藏', repositoryInp),
  ));

  const preset = value => {
    api.applyModePreset(plan, value);
    ctx.imagePlanConfirmed = false;
    render();
  };
  wrap.appendChild(el('div', { class: 'image-import-presets' },
    el('span', { style: 'font-size:12px; color:var(--c-text-soft); margin-right:3px;' }, '快速设置：'),
    el('button', { class: 'btn tiny', onclick: () => preset('volume-first-single') }, '各卷首张单页，其余跨页'),
    el('button', { class: 'btn tiny', onclick: () => preset('all-single') }, '全部单页'),
    el('button', { class: 'btn tiny', onclick: () => preset('all-spread') }, '全部跨页'),
    el('span', { style: 'font-size:11px; color:var(--c-text-mute);' }, '默认不拆分；跨页按古籍顺序生成：右页在先，左页在后'),
  ));

  plan.volumes.forEach((volume, volumeIndex) => {
    const versionInp = el('input', {
      type: 'text',
      value: volume.version,
      style: 'width:90px; padding:4px 7px; margin-left:8px;',
      onclick: event => event.stopPropagation(),
    });
    versionInp.oninput = event => { volume.version = event.target.value; ctx.imagePlanConfirmed = false; };
    const grid = el('div', { class: 'image-import-grid' });
    volume.scans.forEach(scan => {
      const modeSelect = el('select', null,
        el('option', { value: 'spread' }, '跨页：右→左'),
        el('option', { value: 'single' }, '单页：不拆分'),
        el('option', { value: 'skip' }, '跳过此图'),
      );
      modeSelect.value = scan.mode;
      const card = el('div', { class: 'image-import-card', 'data-mode': scan.mode },
        el('img', { src: scan.previewUrl, alt: scan.filename, loading: 'lazy' }),
        el('div', { class: 'image-import-card-body' },
          el('div', { class: 'image-import-filename', title: scan.relativePath }, scan.filename),
          modeSelect,
        ),
      );
      modeSelect.onchange = event => {
        scan.mode = event.target.value;
        ctx.imagePlanConfirmed = false;
        render();
      };
      grid.appendChild(card);
    });
    const details = el('details', { class: 'image-import-volume', ...(volumeIndex < 2 ? { open: '' } : {}) },
      el('summary', null,
        `${volume.sourceName} · ${volume.scans.length} 张`,
        versionInp),
      grid,
    );
    wrap.appendChild(details);
  });

  const confirmInput = el('input', { type: 'checkbox', ...(ctx.imagePlanConfirmed ? { checked: '' } : {}) });
  confirmInput.onchange = event => { ctx.imagePlanConfirmed = event.target.checked; };
  wrap.appendChild(el('label', { class: 'image-import-confirm' },
    confirmInput,
    el('span', null,
      '我已核对卷册顺序与“单页 / 跨页 / 跳过”设置。原始 JPG 将原样保存；跨页只生成派生逻辑页，不修改源文件。'),
  ));
  const readOnlySource = isDataSourceReadOnly();
  if (readOnlySource) {
    wrap.appendChild(el('div', { style: 'padding:9px 11px; border-radius:8px; background:#fff1e8; color:#9a4c24; font-size:12px;' },
      '当前连接“历史生产库 · 只读”：可以核对预览，但不能执行导入。请用可写工作库启动标注系统后再确认导入。'));
  }
  if (plan.unsupportedCount) {
    wrap.appendChild(el('div', { style: 'font-size:11.5px; color:var(--c-warning);' },
      `已忽略 ${plan.unsupportedCount} 个非图片文件。`));
  }

  body.appendChild(wrap);
  foot.appendChild(el('button', { class: 'btn', onclick: close }, '取消'));
  foot.appendChild(el('button', {
    class: 'btn primary',
    ...(readOnlySource ? { disabled: '', title: '当前数据源只读' } : {}),
    onclick: async () => {
      if (isDataSourceReadOnly()) { toast('当前历史生产库只读，请切换到可写工作库后导入', 'warn'); return; }
      const errors = api.validatePlan(plan, ctx.imageMeta);
      if (errors.length) { toast(errors[0], 'warn'); return; }
      if (!ctx.imagePlanConfirmed) { toast('请先核对并确认卷册与拆页规则', 'warn'); return; }
      ctx.stage = 'image-importing';
      ctx.imageProgress = { phase: 'upload', current: 0, total: 1 };
      render();
      try {
        ctx.imageImportResult = await uploadImageBookPlan(ctx, progress => {
          ctx.imageProgress = progress;
          render();
        });
        await initFromBridge();
        migrateIllustrationPages();
        refreshBookCount();
        renderAll();
        if (typeof renderBooksList === 'function') renderBooksList();
        ctx.stage = 'image-done';
      } catch (error) {
        ctx.errorMsg = error.message || String(error);
        ctx.stage = 'image-error';
      }
      render();
    },
  }, readOnlySource ? '当前数据源只读' : `确认导入 · ${plan.logicalPageCount} 页`));
}

function openBookImport() {
  const ctx = {
    importType: 'pdf',
    title: '',
    dynasty: '',
    version: '',
    edition: '',
    repository: '',
    printYear: '',
    textLayout: 'auto',
    sensitivity: 'mid',
    file: null,
    stage: 'form',   // form | scan | text | thumb | done | error
    progress: null,
    errorMsg: '',
    book: null,
  };

  const body = el('div', { class: 'modal-body' });
  const foot = el('div', { class: 'modal-foot' });

  const modal = el('div', { class: 'modal' },
    el('div', { class: 'modal-head' },
      el('h3', null, '导入书籍'),
      el('button', { class: 'modal-close', onclick: close }, '×'),
    ),
    body,
    foot,
  );
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim && ctx.stage !== 'scan' && ctx.stage !== 'text' && ctx.stage !== 'thumb') close(); } }, modal);
  $('#overlay-root').appendChild(scrim);

  function close() {
    if (ctx.stage === 'image-importing') return;
    releaseImageImportPreviewUrls(ctx);
    scrim.remove();
  }

  function renderProgressBlock() {
    const p = ctx.progress || { current: 0, total: 0, found: 0, step: 'scan' };
    const pct = p.total ? Math.round((p.current / p.total) * 100) : 0;
    body.appendChild(el('div', { style: 'display:flex; flex-direction:column; gap:12px' },
      el('div', { style: 'font-size:13px; color:var(--c-text-soft)' },
        (ctx.fileCount > 1 ? `（第 ${ctx.fileIndex || 1}/${ctx.fileCount} 个文件）` : '')
        + (ctx.stage === 'text' ? '正在提取插图文字…' : '正在导入全书页面…')
      ),
      el('div', { class: 'batch-progress', style: 'position:static; transform:none; left:auto; bottom:auto; min-width:auto; box-shadow:none; padding:0; background:transparent;' },
        el('div', { class: 'pct' },
          el('span', null, `${p.step || ctx.stage}`),
          el('span', null, `${p.current || 0}/${p.total || 0} · ${pct}%`),
        ),
        el('div', { class: 'progress-bar' }, el('div', { style: `width:${pct}%` })),
        el('div', { style: 'margin-top:6px; font-size:12px; color:var(--c-text-soft)' },
          p.step === 'scan-pages'
            ? '正在建立页面索引与缩略图，插图识别将在导入后执行'
            : `已发现 ${p.found || 0} 处插图`),
      ),
    ));
  }

  function render() {
    body.innerHTML = '';
    foot.innerHTML = '';
    modal.style.width = ctx.importType === 'images'
      ? 'min(1040px, calc(100vw - 72px))'
      : '560px';

    if (ctx.stage === 'form') {
      const sourceTabs = el('div', { class: 'modal-tabs', style: 'margin:-18px -20px 16px;' });
      [['pdf', 'PDF 书籍'], ['images', '图片文件夹']].forEach(([value, label]) => {
        sourceTabs.appendChild(el('button', {
          class: ctx.importType === value ? 'active' : '',
          onclick: () => {
            ctx.importType = value;
            ctx.stage = 'form';
            render();
          },
        }, label));
      });
      body.appendChild(sourceTabs);
      if (ctx.importType === 'images') {
        renderImageBookImport(ctx, body, foot, render, close);
        return;
      }
      const fileInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: '' });
      fileInput.onchange = () => {
        const fs = [...(fileInput.files || [])];
        if (!fs.length) return;
        ctx.files = (ctx.files || []).concat(fs);   // 可多次追加
        ctx.fileMeta = (ctx.fileMeta || []).concat(fs.map(f => ({ title: f.name.replace(/\.pdf$/i, ''), version: '' })));
        if (!ctx.mode) ctx.mode = ctx.files.length > 1 ? 'group' : 'separate';
        render();
      };
      const files = ctx.files || [];

      const dynastyInp = el('input', { type: 'text', value: ctx.dynasty, placeholder: '如：明' });
      dynastyInp.oninput = e => { ctx.dynasty = e.target.value; };
      const editionInp = el('input', { type: 'text', value: ctx.edition, placeholder: '如：明嘉靖刻本' });
      editionInp.oninput = e => { ctx.edition = e.target.value; };
      const repositoryInp = el('input', { type: 'text', value: ctx.repository, placeholder: '如：国家图书馆' });
      repositoryInp.oninput = e => { ctx.repository = e.target.value; };
      const printYearInp = el('input', { type: 'text', value: ctx.printYear, placeholder: '如：1596' });
      printYearInp.oninput = e => { ctx.printYear = e.target.value; };
      const layoutSelImp = el('select', null,
        el('option', { value: 'auto'        }, '自动（两侧均取文字）'),
        el('option', { value: 'text_after'  }, '图在文前（描述在图后）'),
        el('option', { value: 'text_before' }, '图在文后（描述在图前）'),
      );
      layoutSelImp.value = ctx.textLayout || 'auto';
      layoutSelImp.onchange = e => { ctx.textLayout = e.target.value; };
      const sensSel = el('select', null,
        el('option', { value: 'low' }, '高灵敏（更多插图）'),
        el('option', { value: 'mid' }, '标准'),
        el('option', { value: 'high' }, '低灵敏（更少误检）'),
      );
      sensSel.value = ctx.sensitivity;
      sensSel.onchange = e => { ctx.sensitivity = e.target.value; };

      const rows = [];
      rows.push(field('PDF 文件（可多选，可分次添加）', el('div', null, fileInput,
        el('div', { style: 'margin-top:4px; font-size:11px; color:var(--c-text-mute);' }, '选多个文件：可各自成书，或合并为一本书的多卷/章节'))));

      if (files.length > 1) {
        rows.push(el('button', { class: 'btn', style: 'align-self:flex-start;', title: '按文件名里的卷一/卷2/上中下/结尾数字自动排序并识别为同一本书',
          onclick: () => autoDetectChapters(ctx, render) }, '🔎 按文件名识别章节顺序'));
      }

      if (files.length > 1) {
        const mk = (val, label) => el('label', { style: 'display:inline-flex; align-items:center; gap:5px; font-size:13px; cursor:pointer;' },
          el('input', { type: 'radio', name: 'imp-mode', ...(ctx.mode === val ? { checked: '' } : {}), onchange: () => { ctx.mode = val; render(); } }),
          el('span', null, label));
        rows.push(field('导入方式', el('div', { style: 'display:flex; gap:16px;' },
          mk('group', '合并为一本书（多卷/章节）'), mk('separate', '各自独立成书'))));
        if (ctx.mode === 'group') {
          const gtInp = el('input', { type: 'text', value: ctx.groupTitle || '', placeholder: '如：补遗雷公炮制便览' });
          gtInp.oninput = e => { ctx.groupTitle = e.target.value; };
          rows.push(field('整本书名', gtInp));
        }
      }

      if (files.length) {
        const list = el('div', { style: 'display:flex; flex-direction:column; gap:6px;' });
        files.forEach((f, i) => {
          const tInp = el('input', { type: 'text', value: ctx.fileMeta[i].title, style: 'flex:1; min-width:0;' });
          tInp.oninput = e => { ctx.fileMeta[i].title = e.target.value; };
          const vInp = el('input', { type: 'text', value: ctx.fileMeta[i].version, placeholder: ctx.mode === 'group' ? `卷${i + 1}` : '版本/卷次', style: 'width:120px; flex:0 0 120px;' });
          vInp.oninput = e => { ctx.fileMeta[i].version = e.target.value; };
          const canSort = files.length > 1;
          const handle = el('span', {
            style: `flex:0 0 auto; color:var(--c-text-mute); font-size:15px; user-select:none; ${canSort ? 'cursor:grab;' : 'opacity:.3;'}`,
            title: canSort ? '按住拖动调整顺序' : '',
            ...(canSort ? { draggable: 'true', ondragstart: (e) => { ctx._dragIndex = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (_) {} } } : {}),
          }, '⠿');
          const row = el('div', {
            style: 'display:flex; gap:6px; align-items:center; padding:2px 2px; border-radius:6px;',
            ...(canSort ? {
              ondragover: (e) => { e.preventDefault(); e.currentTarget.style.boxShadow = 'inset 0 2px 0 var(--c-primary, #2b6cb0)'; },
              ondragleave: (e) => { e.currentTarget.style.boxShadow = ''; },
              ondrop: (e) => {
                e.preventDefault(); e.currentTarget.style.boxShadow = '';
                const from = ctx._dragIndex;
                if (from == null || from === i) { ctx._dragIndex = null; return; }
                const [f] = ctx.files.splice(from, 1); ctx.files.splice(i, 0, f);
                const [m] = ctx.fileMeta.splice(from, 1); ctx.fileMeta.splice(i, 0, m);
                ctx._dragIndex = null; render();
              },
            } : {}),
          },
            handle,
            el('span', { style: 'font-size:11px; color:var(--c-text-mute); width:16px; text-align:right; flex:0 0 auto;' }, String(i + 1)),
            tInp,
            (files.length > 1 || ctx.mode === 'group') ? vInp : null,
            el('button', { class: 'btn', style: 'padding:2px 8px; flex:0 0 auto;', title: '移除', onclick: () => { ctx.files.splice(i, 1); ctx.fileMeta.splice(i, 1); render(); } }, '✕'));
          list.appendChild(row);
        });
        rows.push(field(files.length > 1 ? (ctx.mode === 'group' ? '各卷/章（上下顺序 = 书内顺序）' : '各文件（各自成书）') : '书名', list));
      }

      rows.push(field('朝代（可选）', dynastyInp));
      rows.push(field('刻本（可选）', editionInp));
      rows.push(field('收藏机构（可选）', repositoryInp));
      rows.push(field('刻印年代（可选）', printYearInp));
      rows.push(field('图文排版', layoutSelImp));
      rows.push(field('扫描灵敏度', sensSel));

      body.appendChild(el('div', { style: 'display:flex; flex-direction:column; gap:12px' }, ...rows));

      foot.appendChild(el('button', { class: 'btn', onclick: close }, '取消'));
      foot.appendChild(el('button', { class: 'btn primary', onclick: async () => {
        if (!files.length) { toast('请先选择 PDF 文件', 'warn'); return; }
        ctx.stage = 'multi';
        render();
        await importBooks(ctx, render);
      } }, files.length > 1 ? `开始导入（${files.length} 个文件）` : '开始导入'));
      return;
    }

    if (ctx.importType === 'images') {
      renderImageBookImport(ctx, body, foot, render, close);
      return;
    }

    if (ctx.stage === 'scan' || ctx.stage === 'scanning' || ctx.stage === 'text' || ctx.stage === 'thumb' || ctx.stage === 'multi') {
      renderProgressBlock();
      foot.appendChild(el('button', { class: 'btn', disabled: '' }, '处理中…'));
      return;
    }

    if (ctx.stage === 'done') {
      const imported = ctx.importedBooks || (ctx.book ? [ctx.book] : []);
      const book = imported[imported.length - 1] || ctx.book;
      const totalPages = imported.reduce((s, b) => s + (b.totalPages || 0), 0);
      body.appendChild(el('div', { style: 'display:flex; flex-direction:column; gap:10px' },
        el('div', { style: 'font-size:14px; color:var(--c-success); font-weight:600' }, '✓ 导入完成'),
        el('div', { style: 'font-size:13px; color:var(--c-text-soft); line-height:1.9' },
          ctx.grouped
            ? [`整本：《${ctx.grouped.title}》`, el('br'), `共 ${ctx.grouped.count} 卷/章 · 合计 ${totalPages} 页`]
            : (imported.length > 1
                ? [`已导入 ${imported.length} 本书 · 合计 ${totalPages} 页`, el('br'), imported.map(b => b.title).join('、')]
                : (book ? [`书名：${book.title}`, el('br'), `总页数：${book.totalPages} · 插图：${book.illustrationPages.length}（导入后点"识别插图"）`] : '')),
        ),
      ));
      foot.appendChild(el('button', { class: 'btn', onclick: close }, '关闭'));
      foot.appendChild(el('button', { class: 'btn primary', onclick: () => {
        if (book) { state.leftTab = 'books'; openBookLandingPage(book.id); }
        close();
      } }, imported.length > 1 ? '查看书籍' : '打开书籍'));
      return;
    }

    if (ctx.stage === 'error') {
      body.appendChild(el('div', { style: 'color:var(--c-error); line-height:1.8; font-size:13px;' },
        ctx.errorMsg || '导入失败'));
      foot.appendChild(el('button', { class: 'btn', onclick: close }, '关闭'));
      foot.appendChild(el('button', { class: 'btn primary', onclick: () => { ctx.stage = 'form'; render(); } }, '返回重试'));
    }
  }

  render();
}

/* ============================================================
   LIGHTBOX
   ============================================================ */
/* ============================================================
   IMAGE ENHANCEMENT  — Canvas-based, no external API
   ============================================================ */
function _clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

/**
 * 通用图像增强组件。
 * getSourceFn: () => HTMLImageElement | HTMLCanvasElement  — 返回当前图像元素
 * 返回 { toggleBtn, enhBar }，调用方自行插入布局。
 */
function buildImgEnhanceSection(getSourceFn) {
  let _active = false;
  let _overlayCanvas = null;
  let _cachedDisplayHint = null;  // 首次可见时缓存，src 隐藏后复用
  let _resizeObserver = null;

  const sharpenSl  = el('input', { type: 'range', min: '0', max: '3',  step: '0.1',  value: '1.2' });
  const contrastSl = el('input', { type: 'range', min: '1', max: '2',  step: '0.05', value: '1.25' });
  const deYellowCk = el('input', { type: 'checkbox' });
  let _enhDebTimer = null;

  function _refreshDisplayHint() {
    const src = getSourceFn();
    const probe = [src, _overlayCanvas, _overlayCanvas?.parentElement, src?.parentElement];
    for (const node of probe) {
      const w = node?.offsetWidth || node?.clientWidth || 0;
      const h = node?.offsetHeight || node?.clientHeight || 0;
      if (w > 0 && h > 0) {
        _cachedDisplayHint = { w, h };
        return _cachedDisplayHint;
      }
    }
    return _cachedDisplayHint;
  }

  const _applyDebounced = () => {
    clearTimeout(_enhDebTimer);
    _enhDebTimer = setTimeout(() => { if (_active) _apply(); }, 180);
  };

  function _ensureResizeObserver(src) {
    if (_resizeObserver || typeof ResizeObserver === 'undefined') return;
    const host = _overlayCanvas?.parentElement || src?.parentElement;
    if (!host) return;
    _resizeObserver = new ResizeObserver(() => {
      if (!_active) return;
      _refreshDisplayHint();
      _applyDebounced();
    });
    _resizeObserver.observe(host);
  }

  function _teardownResizeObserver() {
    if (_resizeObserver) {
      _resizeObserver.disconnect();
      _resizeObserver = null;
    }
  }

  function _apply() {
    const src = getSourceFn();
    if (!src) return;
    if (!_active) {
      src.style.display = '';
      if (_overlayCanvas) { _overlayCanvas.style.display = 'none'; }
      _teardownResizeObserver();
      return;
    }
    const run = () => {
      try {
        const displayHint = _refreshDisplayHint();
        const c = buildEnhancedCanvas(src, {
          sharpen:  parseFloat(sharpenSl.value),
          contrast: parseFloat(contrastSl.value),
          deYellow: deYellowCk.checked,
          displayHint,
        });
        if (!_overlayCanvas) {
          _overlayCanvas = el('canvas');
          _overlayCanvas.style.cssText = 'max-height:400px; max-width:100%; object-fit:contain; display:block;';
          src.parentNode.insertBefore(_overlayCanvas, src.nextSibling);
        }
        _overlayCanvas.width  = c.width;
        _overlayCanvas.height = c.height;
        _overlayCanvas.getContext('2d').drawImage(c, 0, 0);
        _overlayCanvas.style.display = 'block';
        src.style.display = 'none';
        _ensureResizeObserver(src);
      } catch(e) {
        toast('图像增强失败（跨域图片限制）', 'warn');
        _active = false;
        _toggleBtn.textContent = '🔬 增强查看';
        _toggleBtn.classList.remove('active');
        _bar.style.display = 'none';
        _teardownResizeObserver();
      }
    };
    const src2 = getSourceFn();
    if (!src2) return;
    const ready = src2.tagName === 'IMG'
      ? (src2.complete && src2.naturalWidth > 0)
      : (src2.width > 0 && src2.height > 0);
    if (ready) run();
    else if (src2.tagName === 'IMG') src2.addEventListener('load', run, { once: true });
    else setTimeout(run, 300);   // canvas 异步渲染兜底
  }

  const _toggleBtn = el('button', { class: 'icon-btn', onclick: () => {
    _active = !_active;
    _toggleBtn.textContent = _active ? '↩ 原始图像' : '🔬 增强查看';
    _toggleBtn.classList.toggle('active', _active);
    _bar.style.display = _active ? 'flex' : 'none';
    if (_active) _refreshDisplayHint();
    _apply();
  }}, '🔬 增强查看');

  // 防抖：滑块连续拖动时只在停下后 180ms 触发一次，避免大图卡主线程
  sharpenSl.oninput = contrastSl.oninput = _applyDebounced;
  deYellowCk.onchange = () => { if (_active) _apply(); };  // checkbox 无需防抖

  const _bar = el('div', { class: 'img-enhance-bar', style: 'display:none' },
    el('span', { class: 'lbl' }, '锐化'), sharpenSl,
    el('div',  { class: 'esep' }),
    el('span', { class: 'lbl' }, '对比度'), contrastSl,
    el('div',  { class: 'esep' }),
    el('label', null, deYellowCk, ' 去黄底'),
    el('button', { class: 'btn', style: 'font-size:11px; padding:2px 8px; margin-left:auto;', onclick: () => {
      sharpenSl.value = '1.2'; contrastSl.value = '1.25'; deYellowCk.checked = false;
      if (_active) _apply();
    }}, '重置'),
  );

  return { toggleBtn: _toggleBtn, enhBar: _bar };
}

/**
 * 对 <img> 元素做图像增强，返回一个处理后的 <canvas>。
 * opts: { sharpen:0-3, contrast:1-2, deYellow:bool }
 */
/**
 * opts.displayHint: { w, h } — 调用方传入元素的实际显示尺寸（offsetWidth/Height × dpr）
 * 处理分辨率 = min(原始尺寸, max(显示尺寸 × 2, 800px))
 * 既避免大图同步卡顿，又不过度降采样细节场景。
 * 若 displayHint 未传，则沿用固定 1200px 上限作为兜底。
 */
function buildEnhancedCanvas(imgEl, opts) {
  const { sharpen = 1.2, contrast = 1.25, deYellow = false, displayHint } = opts || {};
  const srcW = imgEl.naturalWidth  || imgEl.width;
  const srcH = imgEl.naturalHeight || imgEl.height;
  if (!srcW || !srcH) throw new Error('image not loaded');

  // 动态分辨率上限：以显示尺寸的 2 倍为准，最低 800px，最高不超过原始尺寸
  const dpr    = window.devicePixelRatio || 1;
  const dispW  = displayHint ? displayHint.w * dpr : 0;
  const dispH  = displayHint ? displayHint.h * dpr : 0;
  const capW   = dispW > 50 ? Math.max(dispW * 2, 800) : 1200;   // 有显示信息用2×显示，否则 1200 兜底
  const capH   = dispH > 50 ? Math.max(dispH * 2, 800) : 1200;
  const scale  = Math.min(capW / srcW, capH / srcH, 1);           // 从不放大
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, w, h);

  // 1. 去黄底（古籍纸张泛黄校正）
  if (deYellow) {
    const id = ctx.getImageData(0, 0, w, h);
    const d  = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      // 检测暖黄区域：R 高 G 中 B 低
      const warm = Math.max(0, Math.min(1, (r - 160) / 60))
                 * Math.max(0, Math.min(1, (g - 130) / 60))
                 * Math.max(0, Math.min(1, (210 - b) / 60));
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      d[i]   = _clampByte(r + (gray - r) * warm * 0.75);
      d[i+1] = _clampByte(g + (gray - g) * warm * 0.75);
      d[i+2] = _clampByte(b + (gray - b) * warm * 0.75);
    }
    ctx.putImageData(id, 0, 0);
  }

  // 2. 对比度调整
  if (contrast !== 1.0) {
    const id = ctx.getImageData(0, 0, w, h);
    const d  = id.data;
    // Photoshop-style contrast formula
    const f  = (259 * (contrast * 128 - 128)) / (128 * (259 - (contrast * 128 - 128)));
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = _clampByte(f * (d[i]   - 128) + 128);
      d[i+1] = _clampByte(f * (d[i+1] - 128) + 128);
      d[i+2] = _clampByte(f * (d[i+2] - 128) + 128);
    }
    ctx.putImageData(id, 0, 0);
  }

  // 3. 锐化（unsharp mask 3×3 卷积核）
  if (sharpen > 0) {
    const id  = ctx.getImageData(0, 0, w, h);
    const src = new Uint8ClampedArray(id.data);
    const dst = id.data;
    const k   = sharpen * 0.12;        // 核权重
    const c   = 1 + 8 * k;            // 中心权重
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const s =
            -k * src[((y-1)*w+(x-1))*4+ch] + -k * src[((y-1)*w+x)*4+ch] + -k * src[((y-1)*w+(x+1))*4+ch] +
            -k * src[(y*w+(x-1))*4+ch]     +  c * src[i+ch]              + -k * src[(y*w+(x+1))*4+ch]     +
            -k * src[((y+1)*w+(x-1))*4+ch] + -k * src[((y+1)*w+x)*4+ch] + -k * src[((y+1)*w+(x+1))*4+ch];
          dst[i+ch] = _clampByte(s);
        }
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  return canvas;
}

function openLightbox(url) {
  const lb = el('div', { class: 'lightbox', onclick: () => lb.remove() },
    el('img', { src: url }),
  );
  $('#overlay-root').appendChild(lb);
}


// 原书翻页查看器：从该图所在页开始，可 ‹ › / ←→ 翻阅原书整页，用于核对 AI 据上下文摘的原文对照
async function viewOriginalPage(img) {
  if (!img?.pdfSource?.bookId) { toast('无原始页面信息', 'warn'); return; }
  const book = getBook(img.pdfSource.bookId);
  const startPage = Math.max(1, Number(img.pdfSource.pageNum) || 1);
  const doc = pdfDocs[book?.id] || (book && await ensurePdfDoc(book).catch(() => null));
  const maxPage = doc ? doc.numPages : startPage;
  const cache = {};
  let cur = startPage;

  const imgEl = el('img', { style: 'max-width:84vw; max-height:78vh; object-fit:contain; background:#fff; border-radius:4px; box-shadow:0 6px 30px rgba(0,0,0,.45);' });
  const label = el('div', { style: 'color:#fff; font-size:13px; text-align:center; margin-top:10px; letter-spacing:.5px;' });
  const navBtnStyle = 'flex:0 0 auto; width:44px; height:64px; border:none; border-radius:8px; background:rgba(255,255,255,.16); color:#fff; font-size:28px; cursor:pointer;';
  const prevBtn = el('button', { style: navBtnStyle }, '‹');
  const nextBtn = el('button', { style: navBtnStyle }, '›');

  async function show(pn) {
    cur = Math.max(1, Math.min(maxPage, pn));
    const target = cur;
    label.textContent = `${book?.title || ''} · 第 ${target} 页${maxPage ? ` / 共 ${maxPage} 页` : ''}${target === startPage ? '（本图所在页）' : ''}`;
    prevBtn.disabled = target <= 1; prevBtn.style.opacity = target <= 1 ? '.35' : '1';
    nextBtn.disabled = target >= maxPage; nextBtn.style.opacity = target >= maxPage ? '.35' : '1';
    if (cache[target]) { imgEl.src = cache[target]; return; }
    const pg = getBookPageRecord(book, target);
    imgEl.src = pg?.thumbHi || pg?.thumb || imgEl.src || '';   // 渲染完成前先用缩略图占位
    if (!doc) return;
    try {
      const url = await renderPageRectDataUrl(doc, pg ? pdfPageOf(pg) : target, [0, 0, 1, 1], 1500, 0.9);
      cache[target] = url;
      if (cur === target) imgEl.src = url;   // 仍停在该页才替换，避免快速翻页错位
    } catch {}
  }
  prevBtn.onclick = (e) => { e.stopPropagation(); show(cur - 1); };
  nextBtn.onclick = (e) => { e.stopPropagation(); show(cur + 1); };

  const overlay = el('div', { class: 'lightbox', style: 'flex-direction:column;', onclick: (e) => { if (e.target === overlay) close(); } },
    el('div', { style: 'display:flex; align-items:center; gap:14px;', onclick: e => e.stopPropagation() }, prevBtn, imgEl, nextBtn),
    label,
    el('button', { style: 'margin-top:10px; background:rgba(255,255,255,.16); color:#fff; border:none; padding:6px 16px; border-radius:999px; font-size:13px; cursor:pointer;', onclick: () => close() }, '✕ 关闭（Esc）'));
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') show(cur - 1);
    else if (e.key === 'ArrowRight') show(cur + 1);
    else if (e.key === 'Escape') close();
  };
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  document.addEventListener('keydown', onKey);
  $('#overlay-root').appendChild(overlay);
  show(startPage);
}

/* ============================================================
   SETTINGS DRAWER
   ============================================================ */
function openSettings() {
  let local = JSON.parse(JSON.stringify(config));
  const renderDrawer = () => {
    body.innerHTML = '';

    body.appendChild(el('h4', { style: 'margin:0 0 8px; font-size:12px; letter-spacing:1px; color:var(--c-text-mute); text-transform:uppercase' }, 'API 提供商'));

    const PROVIDERS = [
      { k: 'mock',   label: '仅演示(Mock)',        note: '无需 API Key，随时可用' },
      { k: 'qwen',   label: 'Qwen / Kimi（阿里百炼）', note: '推荐 · 支持 Qwen 系列与 kimi-k2.6 · 国内可用 · dashscope.console.aliyun.com' },
      { k: 'deepseek', label: 'DeepSeek',          note: '官方 OpenAI 兼容接口 · 当前仅公开文本模型，图像 OCR / 标注暂不可用 · platform.deepseek.com' },
      { k: 'kimi',   label: 'Kimi（月之暗面）',     note: '均衡 · 中文理解好 · 国内可用 · platform.moonshot.cn' },
      { k: 'doubao', label: '豆包（字节）',          note: '速度快 · 价格低 · 国内可用 · console.volcengine.com/ark' },
      { k: 'zhipu',  label: '智谱 GLM',             note: '兼容旧 ZHIPU_API_KEY · 国内可用 · open.bigmodel.cn' },
      { k: 'openai', label: 'OpenAI (GPT-4o)',      note: '图像理解最强 · 需科学上网 · platform.openai.com' },
      { k: 'gemini', label: 'Gemini（Google）',     note: '免费额度大 · 需科学上网 · aistudio.google.com' },
      { k: 'baidu',  label: '文心 ERNIE（百度）',   note: '国内合规 · 需用 API Key+Secret 换 token · console.bce.baidu.com' },
    ];
    const curP = PROVIDERS.find(p => p.k === local.provider) || PROVIDERS[0];
    const provSel = el('select', { style: 'padding:7px 10px; border:1px solid var(--c-border-strong); border-radius:6px; font-size:13px; width:100%; margin-bottom:4px' });
    PROVIDERS.forEach(p => { const opt = el('option', { value: p.k }, p.label); if (p.k === local.provider) opt.selected = true; provSel.appendChild(opt); });
    provSel.onchange = () => { local.provider = provSel.value; renderDrawer(); };
    body.appendChild(provSel);
    body.appendChild(el('div', { style: 'font-size:11.5px; color:var(--c-text-mute); margin-bottom:8px' }, curP.note));

    const KEY_DEFS = [
      { k: 'qwen',   fld: 'qwenKey',   label: 'Qwen API Key' },
      { k: 'deepseek', fld: 'deepseekKey', label: 'DeepSeek API Key' },
      { k: 'kimi',   fld: 'kimiKey',   label: 'Kimi API Key' },
      { k: 'doubao', fld: 'doubaoKey', label: '豆包 API Key' },
      { k: 'zhipu',  fld: 'zhipuKey',  label: '智谱 API Key' },
      { k: 'openai', fld: 'openaiKey', label: 'OpenAI API Key' },
      { k: 'gemini', fld: 'geminiKey', label: 'Gemini API Key' },
      { k: 'baidu',  fld: 'baiduKey',  label: '百度 Access Token' },
    ];
    const curKD = KEY_DEFS.find(d => d.k === local.provider);
    if (curKD) {
      body.appendChild(el('h4', { style: 'margin:14px 0 8px; font-size:12px; letter-spacing:1px; color:var(--c-text-mute); text-transform:uppercase' }, 'API 密钥'));
      const curVal = local[curKD.fld] || '';
      body.appendChild(el('div', { class: 'api-row' },
        el('label', null, curKD.label),
        curVal ? el('div', { class: 'val' }, maskKey(curVal)) : el('div', { class: 'val' }, '未配置'),
        el('button', { class: 'btn', onclick: () => {
          const v = prompt('请输入 ' + curKD.label + '（仅保存在本地浏览器）:', curVal);
          if (v !== null) { local[curKD.fld] = v.trim(); renderDrawer(); }
        } }, curVal ? '修改' : '填写'),
      ));
    }

    // ── 图像标注（模型 + 并发，同一卡片）──────────────────────
    body.appendChild(el('h4', { style: 'margin:16px 0 6px; font-size:12px; letter-spacing:1px; color:var(--c-text-mute); text-transform:uppercase' }, '图像标注'));
    const annotateCard = el('div', { style: 'border:1px solid var(--c-border); border-radius:8px; overflow:hidden; margin-bottom:4px;' });

    const annotateModelRow = el('div', { style: 'padding:10px 12px; background:var(--c-bg);' });
    annotateModelRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:6px;' }, '视觉模型（用于单张图像标注）'));
    const MODEL_DEFS = {
      qwen:   { fld: 'qwenModel',   opts: ['qwen3.7-plus','qwen3.6-plus','qwen3.5-plus','qwen3.5-flash','kimi-k2.6'] },
      openai: { fld: 'openaiModel', opts: ['gpt-4o','gpt-4o-mini'] },
      deepseek: { fld: 'deepseekModel', opts: ['deepseek-v4-flash','deepseek-v4-pro'] },
      kimi:   { fld: 'kimiModel',   opts: ['moonshot-v1-8k','moonshot-v1-32k'] },
      doubao: { fld: 'doubaoModel', opts: ['doubao-vision-pro-32k','doubao-vision-lite-32k'] },
      zhipu:  { fld: 'zhipuModel',  opts: ['glm-4v-plus','glm-4v'] },
      gemini: { fld: 'geminiModel', opts: ['gemini-1.5-flash','gemini-1.5-pro'] },
      baidu:  { fld: 'baiduModel',  opts: ['ERNIE-Bot-Vision','ERNIE-4.0-Vision'] },
    };
    const curMD = MODEL_DEFS[local.provider];
    if (curMD) {
      annotateModelRow.appendChild(radioGroup(curMD.opts, local[curMD.fld], v => { local[curMD.fld] = v; renderDrawer(); }));
    } else {
      annotateModelRow.appendChild(el('div', { style: 'font-size:12.5px; color:var(--c-text-mute)' }, 'Mock 模式无需选择模型'));
    }
    annotateCard.appendChild(annotateModelRow);

    annotateCard.appendChild(el('div', { style: 'height:1px; background:var(--c-border);' }));

    const annotateConcurRow = el('div', { style: 'padding:10px 12px; background:#f8fafc;' });
    annotateConcurRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:6px;' }, '同时标注张数'));
    annotateConcurRow.appendChild(radioGroup(['1', '2', '3', '5', '8', '10'], String(local.batchConcurrency || 1), v => {
      local.batchConcurrency = Number(v) || 1;
      renderDrawer();
    }));
    annotateConcurRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-top:5px;' }, '百炼稳定版 RPM=3000，并发 5~10 均在限额内。带日期快照版（RPM=60）建议不超过 1。'));
    annotateCard.appendChild(annotateConcurRow);

    annotateCard.appendChild(el('div', { style: 'height:1px; background:var(--c-border);' }));
    const contextRow = el('div', { style: 'padding:10px 12px; background:#f8fafc;' });
    contextRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:6px;' }, 'AI 读取上下文（本页 + 前后各 N 页）'));
    contextRow.appendChild(radioGroup(['0', '2', '5', '8', '10', '15'], String(local.contextRadius ?? 5), v => {
      local.contextRadius = Number(v) || 0;
      renderDrawer();
    }));
    contextRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-top:5px;' }, '标注时自动读取本页及前后各 N 页原文作上下文。页数越多覆盖越广，但提示更长、更慢更费 token。0=仅本页。'));
    annotateCard.appendChild(contextRow);

    body.appendChild(annotateCard);

    // ── 全书扫描（模型 + 并发，同一卡片）──────────────────────
    body.appendChild(el('h4', { style: 'margin:16px 0 6px; font-size:12px; letter-spacing:1px; color:var(--c-text-mute); text-transform:uppercase' }, '全书扫描'));
    const scanCard = el('div', { style: 'border:1px solid var(--c-border); border-radius:8px; overflow:hidden; margin-bottom:4px;' });

    // 模型行
    const scanModelRow = el('div', { style: 'padding:10px 12px; background:var(--c-bg);' });
    scanModelRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:6px;' }, '视觉模型（可与标注模型不同）'));
    const SCAN_MODEL_OPTIONS = [
      // 下拉只展示模型名，价格/平台说明不进入选项文本，避免配置面板过重。
      { value: 'qwen|qwen3-vl-flash',          label: 'qwen3-vl-flash' },
      { value: 'qwen|qwen-vl-plus',            label: 'qwen-vl-plus' },
      { value: 'qwen|qwen-vl-plus-latest',     label: 'qwen-vl-plus-latest' },
      // qwen-vl-ocr 是 OCR 专用模型，不支持插图判断，不列入
      // ── 其他平台 ────────────────────────────────────────────────
      { value: 'gemini|gemini-1.5-flash',      label: 'gemini-1.5-flash' },
      { value: 'gemini|gemini-2.0-flash',      label: 'gemini-2.0-flash' },
      { value: 'openai|gpt-4o-mini',           label: 'gpt-4o-mini' },
      { value: 'doubao|doubao-vision-lite-32k',label: 'doubao-vision-lite-32k' },
      { value: 'zhipu|glm-4v',                 label: 'glm-4v' },
    ];
    const curScanVal = (local.scanProvider && local.scanModel)
      ? `${local.scanProvider}|${local.scanModel}` : '';
    const scanSel = el('select', { style: 'padding:7px 10px; border:1px solid var(--c-border-strong); border-radius:6px; font-size:13px; width:100%;' });
    const defOpt = el('option', { value: '' }, '沿用标注模型（默认）');
    if (!curScanVal) defOpt.selected = true;
    scanSel.appendChild(defOpt);
    SCAN_MODEL_OPTIONS.forEach(o => {
      const opt = el('option', { value: o.value }, o.label);
      if (o.value === curScanVal) opt.selected = true;
      scanSel.appendChild(opt);
    });
    scanSel.onchange = () => {
      const v = scanSel.value;
      if (!v) { local.scanProvider = ''; local.scanModel = ''; }
      else { const [p, m] = v.split('|'); local.scanProvider = p; local.scanModel = m; }
    };
    scanModelRow.appendChild(scanSel);
    if (curScanVal) {
      const [sp] = curScanVal.split('|');
      const KEY_DEFS_SCAN = { qwen:'qwenKey', openai:'openaiKey', kimi:'kimiKey',
        doubao:'doubaoKey', zhipu:'zhipuKey', gemini:'geminiKey', baidu:'baiduKey' };
      const skf = KEY_DEFS_SCAN[sp];
      const skv = skf ? (local[skf] || '') : '';
      if (skf && !skv) {
        scanModelRow.appendChild(el('div', { style: 'font-size:11.5px; color:#c0392b; margin-top:5px;' },
          `⚠ ${sp} 的 API Key 未配置，请在上方"API 密钥"中填写，或切换到已配置的提供商。`));
      }
    }
    scanCard.appendChild(scanModelRow);

    // 分隔线
    scanCard.appendChild(el('div', { style: 'height:1px; background:var(--c-border);' }));

    // 并发行
    const scanConcurRow = el('div', { style: 'padding:10px 12px; background:#f8fafc;' });
    scanConcurRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-bottom:6px;' }, '同时扫描页数'));
    scanConcurRow.appendChild(radioGroup(['1', '5', '10', '20'], String(local.scanConcurrency || 1), v => {
      local.scanConcurrency = Number(v) || 1;
      renderDrawer();
    }));
    scanConcurRow.appendChild(el('div', { style: 'font-size:11px; color:var(--c-text-mute); margin-top:5px;' }, '并发过高可能触发 API 限流，建议从 5 开始。'));
    scanCard.appendChild(scanConcurRow);

    body.appendChild(scanCard);

    body.appendChild(el('div', { style: 'display:flex; align-items:center; justify-content:space-between; margin-top:14px; padding:10px 12px; background:#f7f9fc; border-radius:8px;' },
      el('div', null,
        el('div', { style: 'font-size:13px' }, '双模型交叉验证'),
        el('div', { style: 'font-size:11.5px; color:var(--c-text-mute); margin-top:2px' }, '同时调用两个模型，对比结果'),
      ),
      el('label', { class: 'switch' },
        el('input', { type: 'checkbox', ...(local.crossCheck ? { checked: '' } : {}), onchange: e => { local.crossCheck = e.target.checked; } }),
        el('span', { class: 'slider' }),
      ),
    ));

    body.appendChild(el('div', { class: 'hint' }, '注：API Key 仅保存在本地浏览器 localStorage，不会上传到任何服务器。'));
  };

  const body = el('div', { class: 'drawer-body' });
  renderDrawer();

  const drawer = el('div', { class: 'drawer' },
    el('div', { class: 'drawer-head' },
      el('h3', null, '⚙ 配置面板'),
      el('button', { class: 'modal-close', onclick: close }, '×'),
    ),
    body,
    el('div', { class: 'drawer-foot' },
      el('button', { class: 'btn', onclick: close }, '取消'),
      el('button', { class: 'btn primary', onclick: () => {
        config = local;
        config._userConfigured = true;  // 标记用户已手动保存，阻止 bridge 状态覆盖
        persistConfig();
        toast('配置已保存', 'success');
        close();
      } }, '保存配置'),
    ),
  );
  const wrap = el('div', { class: 'drawer-wrap', onclick: e => { if (e.target === wrap) close(); } }, drawer);
  $('#overlay-root').appendChild(wrap);
  function close() { wrap.remove(); }
}

function providerLabel(k) {
  return { mock: '仅演示(Mock)', qwen: 'Qwen / Kimi（阿里百炼）', openai: 'OpenAI (GPT-4o)', deepseek: 'DeepSeek',
           kimi: 'Kimi（月之暗面）', doubao: '豆包（字节）', zhipu: '智谱 GLM',
           gemini: 'Gemini（Google）', baidu: '文心 ERNIE（百度）' }[k] || '仅演示(Mock)';
}
function providerKey(label) {
  return { '仅演示(Mock)': 'mock', 'Qwen / Kimi（阿里百炼）': 'qwen', 'OpenAI (GPT-4o)': 'openai', 'DeepSeek': 'deepseek',
           'Kimi（月之暗面）': 'kimi', '豆包（字节）': 'doubao', '智谱 GLM': 'zhipu',
           'Gemini（Google）': 'gemini', '文心 ERNIE（百度）': 'baidu' }[label] || 'mock';
}
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '*'.repeat(k.length);
  return k.slice(0, 4) + '*'.repeat(Math.max(0, k.length - 8)) + k.slice(-4);
}

/* ============================================================
   EXPORT
   ============================================================ */
function buildRecord(img) {
  const a = img.annotation || {};
  const diff = buildReviewDiff(img);
  const book = img.pdfSource?.bookId ? getBook(img.pdfSource.bookId) : null;
  const traits = getBookTraits(book) || { blockType: '', layoutRelation: '', textDirection: '' };
  const multiMeta = getMultiIllustrationMeta(img);
  const rec = {
    image_id: img.id,
    parent_image_id: img.parentId || null,
    illustration_group_id: multiMeta.groupId,
    page_figure_role: multiMeta.role,
    page_sub_index: img.subIndex || null,
    child_image_count: multiMeta.childRecords.length,
    multi_illustration_relation: multiMeta.relation || null,
    multi_illustration_note: multiMeta.note || null,
    export_decision: multiMeta.shouldExport ? 'export' : 'skip_container',
    illustration_code: _showcaseId(img, book),
    illustration_name: _showcaseName(img),
    illustration_name_pinyin: displayNamePinyin(img),
    image_url: getIllustrationViewUrl(img, 1200),
    source: img.source,
    page: img.page,
    name: img.name,
    status: img.status,
    human_verified: img.status === 'ok',
    annotated_at: img.annotatedAt ? new Date(img.annotatedAt).toISOString() : null,
    model: img.modelUsed || null,
    ai_generated_at: img.reviewMeta?.aiGeneratedAt ? new Date(img.reviewMeta.aiGeneratedAt).toISOString() : null,
    human_edited_at: img.reviewMeta?.humanEditedAt ? new Date(img.reviewMeta.humanEditedAt).toISOString() : null,
    illustration_type: a.type || null,
    illustration_subtype: a.academicSubclass || null,
    legacy_type: a.legacyType || null,
    academic_class: a.type || a.academicClass || null,
    academic_subclass: a.academicSubclass || null,
    subject: a.subject || null,
    style: a.style || null,
    preservation: a.preservation || null,
    confidence: a.confidence || null,
    herb_classical: a.herbClassical || null,
    herb_modern: a.herbModern || null,
    species: a.species || null,
    parts_visible: a.parts || [],
    meridian: a.meridian || null,
    points: a.points || [],
    note: a.note || null,
    crossref: {
      classical_text: img.crossref?.classical || '',
      verdict: img.crossref?.verdict || '',
      note: img.crossref?.note || '',
    },
    ai_draft: img.aiDraft || null,
    final_annotation: img.annotation || null,
    corresponding_text: a.correspondingText || null,
    prompt_version: img.annotationEvidence?.promptVersion || '',
    evidence_mode: img.annotationEvidence?.mode || '',
    ocr_risk_note: img.annotationEvidence?.ocrRiskNote || '',
    review_diff_count: diff.changed,
    review_diff: diff.fields,
    ai_features: a.features || [],
    book_traits: {
      block_type: traits.blockType || null,
      layout_relation: traits.layoutRelation || null,
      text_direction: traits.textDirection || null,
      topic_note: book?.topicNote || null,
    },
  };
  if (img.pdfSource) {
    rec.source_type = 'pdf_page';
    rec.dynasty = img.pdfSource.dynasty || null;
    rec.book_edition = book?.edition || null;
    rec.book_repository = book?.repository || null;
    rec.book_print_year = book?.printYear || null;
    rec.pdf_source = {
      book_id: img.pdfSource.bookId,
      book_title: img.pdfSource.bookTitle,
      page_num: img.pdfSource.pageNum,
      crop_rect: img.pdfSource.cropRect || null,
      crop_quad: normalizeQuad(img.pdfSource.cropQuad) || normalizeQuad(img.pdfSource.annotateQuad) || null,
      rotation_deg: clampCropRotationDeg(img.pdfSource.rotationDeg || 0),
      selection_mode: img.pdfSource.selectionMode || (img.pdfSource.cropRect ? 'crop' : 'full_page'),
      full_page_text: (() => { const ta = getPageTextAsset(img); return getEffectivePageText(ta) || ''; })(),
      associated_text: (() => { const ta = getPageTextAsset(img); return ta?.associatedText || ''; })(),
      text_source: (() => { const ta = getPageTextAsset(img); return getTextSourceForExport(ta || {}); })(),
      text_verified: (() => { const ta = getPageTextAsset(img); return ta?.verified || false; })(),
      text_corrected: (() => { const ta = getPageTextAsset(img); return hasManualCorrectedText(ta || {}); })(),
      text_corrected_at: (() => { const ta = getPageTextAsset(img); return ta?.correctedAt || null; })(),
      text_status: (() => { const ta = getPageTextAsset(img); return ta?.textStatus || ''; })(),
    };
  }
  return rec;
}
function download(filename, content, type) {
  const blob = new Blob([content], { type: type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}

function sanitizeExportFilenamePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'book';
}

function buildBookOcrExport(books, { textMode = 'effective', includeEmpty = true } = {}) {
  const orderedBooks = (Array.isArray(books) ? books : [books])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (a.groupOrder ?? 1e9) - (b.groupOrder ?? 1e9));
  const volumes = orderedBooks.map((book, volumeIndex) => {
    const pages = getBookPages(book)
      .slice()
      .sort((a, b) => Number(a.pageNum || 0) - Number(b.pageNum || 0))
      .map(page => {
        const textAsset = page.textAsset || {};
        const fullText = String(textAsset.fullText || '').trim();
        const correctedText = String(textAsset.correctedText || '').trim();
        const effectiveText = correctedText || fullText;
        return {
          page_num: Number(page.pageNum || 0),
          source_page_num: Number(page.pdfPageNum || page.pageNum || 0),
          text: textMode === 'raw' ? fullText : effectiveText,
          full_text: fullText,
          corrected_text: correctedText,
          text_source: getTextSourceForExport(textAsset),
          text_status: textAsset.textStatus || (effectiveText ? 'extracted' : 'missing'),
          verified: !!textAsset.verified,
          full_scan_done: !!textAsset.fullScanDone,
          ocr_model: textAsset.ocrModel || '',
          extracted_at: textAsset.extractedAt || '',
          corrected_at: textAsset.correctedAt || '',
          updated_at: textAsset.updatedAt || '',
          scan_input_version: textAsset.scanInputVersion || '',
        };
      })
      .filter(page => includeEmpty || page.text);
    return {
      book_id: book.id,
      title: book.title || '',
      volume: getVolumeListLabel(book, volumeIndex),
      page_count: pages.length,
      pages,
    };
  });
  const allPages = volumes.flatMap(volume => volume.pages);
  const groupTitle = orderedBooks[0]?.groupTitle || orderedBooks[0]?.title || '';
  return {
    schema: 'book-ocr-export-v1',
    generated_at: new Date().toISOString(),
    title: groupTitle,
    text_mode: textMode,
    text_mode_note: textMode === 'raw'
      ? '仅导出 OCR 底稿 fullText；人工校文仍保留在 corrected_text 字段。'
      : '导出可读正文：人工校文 correctedText 优先，否则使用 OCR 底稿 fullText。',
    include_empty_pages: !!includeEmpty,
    summary: {
      volume_count: volumes.length,
      page_count: allPages.length,
      pages_with_text: allPages.filter(page => page.text).length,
      pages_with_raw_ocr: allPages.filter(page => page.full_text).length,
      pages_with_manual_correction: allPages.filter(page => page.corrected_text).length,
      empty_pages: allPages.filter(page => !page.text).length,
    },
    volumes,
  };
}

function renderBookOcrText(payload) {
  const lines = [
    `# ${payload.title || '古籍'} OCR 导出`,
    '',
    `导出时间：${payload.generated_at}`,
    `文本口径：${payload.text_mode === 'raw' ? '原始 OCR 底稿' : '可读正文（人工校文优先）'}`,
    `卷册：${payload.summary.volume_count}；页面：${payload.summary.page_count}；有文字：${payload.summary.pages_with_text}；空白：${payload.summary.empty_pages}`,
    '',
  ];
  payload.volumes.forEach(volume => {
    lines.push(`# ${volume.volume}${volume.title && volume.title !== payload.title ? ` · ${volume.title}` : ''}`, '');
    volume.pages.forEach(page => {
      lines.push(`## 第 ${page.page_num} 页`, '', page.text || '[无文字]', '');
    });
  });
  return lines.join('\n').trimEnd() + '\n';
}

function openBookOcrExportModal(book, { defaultScope = 'book' } = {}) {
  if (!book) return;
  const groupBooks = book.groupId ? getSortedGroupBooks(book.groupId) : [book];
  let selectedScope = defaultScope === 'group' && groupBooks.length > 1 ? 'group' : 'book';
  let selectedTextMode = 'effective';
  let includeEmpty = true;

  const currentBooks = () => selectedScope === 'group' ? groupBooks : [book];
  const title = book.groupTitle || book.title || '古籍';
  const volumeIndex = Math.max(0, groupBooks.findIndex(item => item.id === book.id));
  const currentVolumeLabel = getVolumeListLabel(book, volumeIndex);
  const dlg = el('div', { class: 'modal', style: 'width:620px; max-width:95vw;' });
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) scrim.remove(); } }, dlg);
  dlg.appendChild(el('div', { class: 'modal-head' },
    el('h3', { style: 'margin:0; font-size:15px;' }, '导出 OCR 文字'),
    el('button', { class: 'modal-close', onclick: () => scrim.remove() }, '×'),
  ));
  const body = el('div', { style: 'padding:16px 20px; display:flex; flex-direction:column; gap:14px;' });
  const preview = el('div', {
    style: 'padding:12px 14px; border:1px solid var(--c-border); border-radius:8px; background:var(--c-bg-soft,#f7f7f5); font-size:12px; line-height:1.8; color:var(--c-text-soft);'
  });
  const scopeRow = el('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' },
    el('span', { style: 'min-width:68px; font-size:12px; color:var(--c-text-soft);' }, '导出范围'),
  );
  const textModeRow = el('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' },
    el('span', { style: 'min-width:68px; font-size:12px; color:var(--c-text-soft);' }, '文本口径'),
  );

  const refresh = () => {
    scopeRow.querySelectorAll('button').forEach(button => button.classList.toggle('primary', button.dataset.value === selectedScope));
    textModeRow.querySelectorAll('button').forEach(button => button.classList.toggle('primary', button.dataset.value === selectedTextMode));
    const payload = buildBookOcrExport(currentBooks(), { textMode: selectedTextMode, includeEmpty });
    preview.innerHTML = '';
    preview.append(
      el('div', null,
        el('strong', { style: 'font-size:15px; color:var(--c-text);' }, `${payload.summary.volume_count}`),
        ` 卷 · ${payload.summary.page_count} 页 · 有文字 ${payload.summary.pages_with_text} 页 · 空白 ${payload.summary.empty_pages} 页`
      ),
      el('div', null, `原始 OCR ${payload.summary.pages_with_raw_ocr} 页 · 人工校文 ${payload.summary.pages_with_manual_correction} 页`),
      el('div', { style: 'margin-top:5px; color:var(--c-text-mute);' }, payload.text_mode_note),
      el('div', { style: 'color:var(--c-text-mute);' }, 'JSON 同时保留 full_text 与 corrected_text，便于追溯；本操作只读，不会修改书籍数据。')
    );
  };
  const makeChoiceButton = (row, value, label, onSelect) => {
    const button = el('button', {
      class: 'btn',
      'data-value': value,
      onclick: () => { onSelect(); refresh(); },
    }, label);
    button.dataset.value = value;
    row.appendChild(button);
  };
  makeChoiceButton(scopeRow, 'book', `当前卷：${currentVolumeLabel}`, () => { selectedScope = 'book'; });
  if (groupBooks.length > 1) {
    makeChoiceButton(scopeRow, 'group', `全书（${groupBooks.length} 卷）`, () => { selectedScope = 'group'; });
  }
  makeChoiceButton(textModeRow, 'effective', '可读正文（校文优先）', () => { selectedTextMode = 'effective'; });
  makeChoiceButton(textModeRow, 'raw', '仅原始 OCR', () => { selectedTextMode = 'raw'; });
  const emptyCheckbox = el('input', {
    type: 'checkbox',
    checked: '',
    onchange: event => { includeEmpty = !!event.target.checked; refresh(); },
  });
  body.append(
    el('div', { style: 'font-size:12.5px; line-height:1.7; color:var(--c-text-soft);' },
      '导出整本书的页面文字，不包含插图标注。默认优先采用人工校文；也可选择只导出模型 OCR 底稿。'),
    scopeRow,
    textModeRow,
    el('label', { style: 'display:flex; align-items:center; gap:8px; font-size:12px; color:var(--c-text-soft);' },
      emptyCheckbox,
      '保留无文字页面及页码（推荐，避免页序错位）'
    ),
    preview,
  );
  dlg.appendChild(body);
  const exportFile = format => {
    const books = currentBooks();
    const payload = buildBookOcrExport(books, { textMode: selectedTextMode, includeEmpty });
    const scopeLabel = selectedScope === 'group' ? '全书' : currentVolumeLabel;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseName = `${sanitizeExportFilenamePart(title)}_${sanitizeExportFilenamePart(scopeLabel)}_OCR_${date}`;
    if (format === 'json') {
      download(`${baseName}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    } else {
      download(`${baseName}.txt`, renderBookOcrText(payload), 'text/plain;charset=utf-8');
    }
    toast(`已导出 ${payload.summary.volume_count} 卷、${payload.summary.page_count} 页 OCR`, 'success');
  };
  dlg.appendChild(el('div', { class: 'modal-foot' },
    el('button', { class: 'btn', onclick: () => scrim.remove() }, '取消'),
    el('button', { class: 'btn', onclick: () => exportFile('json') }, '下载 JSON'),
    el('button', { class: 'btn primary', onclick: () => exportFile('txt') }, '下载 TXT'),
  ));
  $('#overlay-root').appendChild(scrim);
  refresh();
}

/** 异步将导出内容保存到 bridge，不阻塞本地下载，失败静默。 */
async function maybeSaveExportToBridge(filename, contentText, bookId) {
  if (!bookId) return;
  const ok = await checkBridge();
  if (!ok) return;
  try {
    await fetch(BRIDGE_SAVE_EXPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookId, filename, content_text: contentText }),
    });
  } catch { /* 静默失败 */ }
}

function openExportModal() {
  const scopedBookId = ['gallery', 'page-detail'].includes(state.mainView) ? (state.currentBookId || null) : null;
  const scopedBook = scopedBookId ? getBook(scopedBookId) : null;

  // 状态：scope / status / model
  let selScope  = scopedBookId ? 'book' : 'all';
  let selStatus = 'all';    // all / annotated / verified
  let selModel  = 'all';

  // 收集全量模型列表
  const allModels = [...new Set(state.illustrations.map(i => i.modelUsed).filter(Boolean))].sort();

  function getImgs() {
    let imgs = selScope === 'book' && scopedBookId
      ? state.illustrations.filter(i => i?.pdfSource?.bookId === scopedBookId)
      : state.illustrations.slice();
    imgs = imgs.filter(shouldUseIllustrationRecord);
    if (selStatus === 'annotated') imgs = imgs.filter(i => ['review', 'ok'].includes(i.status));
    if (selStatus === 'verified')  imgs = imgs.filter(i => i.status === 'ok');
    if (selModel !== 'all')        imgs = imgs.filter(i => i.modelUsed === selModel);
    return imgs;
  }

  function buildStats(imgs) {
    const total    = imgs.length;
    const verified = imgs.filter(i => i.status === 'ok').length;
    const review   = imgs.filter(i => i.status === 'review').length;
    const todo     = imgs.filter(i => i.status === 'todo').length;
    const modelCounts = {};
    imgs.forEach(i => { if (i.modelUsed) modelCounts[i.modelUsed] = (modelCounts[i.modelUsed] || 0) + 1; });
    return { total, verified, review, todo, modelCounts };
  }

  // ── DOM 构建 ─────────────────────────────────────────────
  const dlg = el('div', { class: 'modal', style: 'width:580px; max-width:95vw;' });
  dlg.appendChild(el('div', { class: 'modal-head' },
    el('h3', { style: 'margin:0; font-size:15px;' }, '📤 导出数据'),
    el('button', { class: 'modal-close', onclick: () => scrim.remove() }, '×'),
  ));

  const body = el('div', { style: 'padding:16px 20px; display:flex; flex-direction:column; gap:14px;' });
  dlg.appendChild(body);

  // 预览区（每次刷新）
  const previewEl = el('div');
  function refreshPreview() {
    const imgs = getImgs();
    const exportImgs = imgs.filter(shouldExportIllustrationRecord);
    const st = buildStats(imgs);
    const skippedContainers = Math.max(0, imgs.length - exportImgs.length);
    previewEl.innerHTML = '';

    // 统计行
    const statRow = el('div', { style: 'font-size:13px; color:var(--c-text-soft); line-height:1.8;' });
    statRow.appendChild(el('div', null,
      el('strong', { style: 'color:var(--c-text); font-size:15px;' }, `${st.total}`),
      ` 条工作区记录 · 实际导出 `,
      el('strong', null, `${exportImgs.length}`),
      ` 条 · 已确认 `,
      el('strong', null, `${st.verified}`),
      ` · 待确认 ${st.review} · 未标注 ${st.todo}`
    ));
    if (skippedContainers > 0) {
      statRow.appendChild(el('div', { style: 'margin-top:2px; font-size:12px; color:var(--c-text-mute);' },
        `其中 ${skippedContainers} 条页面候选记录会在导出时自动跳过。`));
    }
    const modelLine = Object.entries(st.modelCounts)
      .map(([m, n]) => `${m} (${n})`).join(' · ');
    if (modelLine) statRow.appendChild(el('div', { style: 'margin-top:2px; font-size:12px; color:var(--c-text-mute);' }, `使用模型：${modelLine}`));
    previewEl.appendChild(statRow);

    // JSON 片段预览（前 2 条关键字段）
    if (exportImgs.length > 0) {
      const snippet = exportImgs.slice(0, 2).map(i => {
        const a = i.annotation || {};
        return JSON.stringify({
          id: i.id, name: i.name, status: i.status,
          page_figure_role: getMultiIllustrationMeta(i).role,
          model: i.modelUsed || null,
          academic_class: a.type || null,
          subject: a.subject || null,
          confidence: a.confidence || null,
          text_image_relation: a.aiVerdict || null,
        }, null, 2);
      }).join(',\n');
      const pre = el('pre', {
        style: 'margin:8px 0 0; padding:10px 12px; background:var(--c-bg-soft,#f5f6f8); border-radius:6px; font-size:11px; line-height:1.5; max-height:140px; overflow-y:auto; color:var(--c-text-mute);'
      }, `// 前 ${Math.min(2, exportImgs.length)} 条导出预览（部分字段）\n[\n${snippet}\n${exportImgs.length > 2 ? `,  // … 还有 ${exportImgs.length - 2} 条` : ''}\n]`);
      previewEl.appendChild(pre);
    } else {
      previewEl.appendChild(el('div', { style: 'font-size:13px; color:var(--c-text-mute); padding:8px 0;' }, '（无符合条件的记录）'));
    }
  }

  // 范围选择
  const scopeRow = el('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' });
  scopeRow.appendChild(el('span', { style: 'font-size:12px; color:var(--c-text-soft); min-width:32px;' }, '范围'));
  const mkScopeBtn = (val, label) => {
    const btn = el('button', {
      class: 'btn' + (selScope === val ? ' primary' : ''),
      disabled: val === 'book' && !scopedBookId,
      onclick: () => { selScope = val; scopeRow.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b.dataset.v === val)); refreshPreview(); },
    }, label);
    btn.dataset.v = val;
    return btn;
  };
  scopeRow.appendChild(mkScopeBtn('all', '全部书籍'));
  scopeRow.appendChild(mkScopeBtn('book', scopedBook ? `当前书籍：${scopedBook.title.slice(0, 10)}…` : '当前书籍（未进入书籍）'));
  body.appendChild(scopeRow);

  // 状态筛选
  const statusRow = el('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' });
  statusRow.appendChild(el('span', { style: 'font-size:12px; color:var(--c-text-soft); min-width:32px;' }, '状态'));
  [['all', '全部'], ['annotated', '已标注'], ['verified', '已确认']].forEach(([val, label]) => {
    const btn = el('button', {
      class: 'btn' + (selStatus === val ? ' primary' : ''),
      onclick: () => { selStatus = val; statusRow.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b.dataset.v === val)); refreshPreview(); },
    }, label);
    btn.dataset.v = val;
    statusRow.appendChild(btn);
  });
  body.appendChild(statusRow);

  // 模型筛选
  const modelRow = el('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' });
  modelRow.appendChild(el('span', { style: 'font-size:12px; color:var(--c-text-soft); min-width:32px;' }, '模型'));
  if (allModels.length === 0) {
    modelRow.appendChild(el('span', { style: 'font-size:12px; color:var(--c-text-mute);' }, '（尚无标注记录）'));
  } else {
    const mkModelBtn = (val, label) => {
      const btn = el('button', {
        class: 'btn' + (selModel === val ? ' primary' : ''),
        style: 'font-size:12px;',
        onclick: () => { selModel = val; modelRow.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b.dataset.v === val)); refreshPreview(); },
      }, label);
      btn.dataset.v = val;
      return btn;
    };
    modelRow.appendChild(mkModelBtn('all', '全部模型'));
    allModels.forEach(m => modelRow.appendChild(mkModelBtn(m, m)));
  }
  body.appendChild(modelRow);

  // 分隔线 + 预览
  body.appendChild(el('div', { style: 'border-top:1px solid var(--c-border); padding-top:12px;' }));
  body.appendChild(previewEl);

  // 格式按钮行
  body.appendChild(el('div', { style: 'border-top:1px solid var(--c-border); padding-top:14px; display:flex; gap:8px; flex-wrap:wrap;' },
    ...[
      ['jsonl-all',      'JSONL 全量',    '包含所有状态的记录'],
      ['jsonl-verified', 'JSONL 已确认',  '仅 human_verified=true'],
      ['csv',            'CSV 表格',      '扁平格式，Excel 可打开'],
      ['html',           'HTML 报告',     '单文件图文并排'],
      ['crossref',       '图文互证',      '仅含原文对照条目'],
    ].map(([kind, label, tip]) =>
      el('button', {
        class: 'btn',
        title: tip,
        onclick: () => {
          scrim.remove();
          exportData(kind, { scopeBookId: selScope === 'book' ? scopedBookId : null, filterModel: selModel === 'all' ? null : selModel, filterStatus: selStatus });
        },
      }, label)
    )
  ));

  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) scrim.remove(); } }, dlg);
  $('#overlay-root').appendChild(scrim);
  refreshPreview();
}

function exportData(kind, opts = {}) {
  const { scopeBookId, filterModel, filterStatus } = opts;
  const scopedBookId = scopeBookId !== undefined ? scopeBookId
    : (['gallery', 'page-detail'].includes(state.mainView) ? (state.currentBookId || null) : null);
  let imgs = scopedBookId
    ? state.illustrations.filter(i => i?.pdfSource?.bookId === scopedBookId)
    : state.illustrations.slice();
  // 来自导出模态框的额外筛选
  if (filterModel)                   imgs = imgs.filter(i => i.modelUsed === filterModel);
  if (filterStatus === 'annotated')  imgs = imgs.filter(i => ['review', 'ok'].includes(i.status));
  if (filterStatus === 'verified')   imgs = imgs.filter(i => i.status === 'ok');
  // 格式专属筛选
  if (kind === 'jsonl-verified') imgs = imgs.filter(i => i.status === 'ok');
  if (kind === 'crossref') imgs = imgs.filter(i => (i.crossref?.classical || '').trim());
  imgs = imgs.filter(shouldExportIllustrationRecord);

  const bookId = scopedBookId;

  if (kind === 'jsonl-all' || kind === 'jsonl-verified' || kind === 'crossref') {
    const lines = imgs.map(i => JSON.stringify(buildRecord(i))).join('\n');
    const fname = kind === 'jsonl-verified' ? 'annotations_verified.jsonl'
      : kind === 'crossref' ? 'crossref_records.jsonl'
      : 'annotations.jsonl';
    download(fname, lines, 'application/x-ndjson');
    maybeSaveExportToBridge(fname, lines, bookId);
    toast(`已导出 ${imgs.length} 条记录 → ${fname}`, 'success');
    return;
  }
  if (kind === 'csv') {
    const cols = ['illustration_code','illustration_name','illustration_name_pinyin','image_id','parent_image_id','illustration_group_id','page_figure_role','page_sub_index','child_image_count','multi_illustration_relation','multi_illustration_note','export_decision','name','source','page','status','human_verified','illustration_type','illustration_subtype','legacy_type','subject','style','preservation','confidence','herb_classical','herb_modern','species','parts_visible','meridian','points','note','annotated_at','ai_generated_at','human_edited_at','model','review_diff_count','crossref_verdict','crossref_classical','crossref_note','book_edition','book_repository','book_print_year','corresponding_text','prompt_version','evidence_mode','ocr_risk_note'];
    const rows = [cols.join(',')];
    for (const img of imgs) {
      const r = buildRecord(img);
      rows.push(cols.map(c => {
        let v;
        if (c === 'parts_visible') v = (r.parts_visible || []).join('|');
        else if (c === 'points') v = (r.points || []).join('|');
        else if (c === 'crossref_verdict') v = r.crossref.verdict;
        else if (c === 'crossref_classical') v = r.crossref.classical_text;
        else if (c === 'crossref_note') v = r.crossref.note;
        else v = r[c];
        if (v == null) v = '';
        v = String(v).replace(/"/g,'""');
        if (/[,"\n]/.test(v)) v = '"' + v + '"';
        return v;
      }).join(','));
    }
    const csvText = '﻿' + rows.join('\n');
    download('annotations.csv', csvText, 'text/csv;charset=utf-8');
    maybeSaveExportToBridge('annotations.csv', csvText, bookId);
    toast(`已导出 ${imgs.length} 行 → annotations.csv`, 'success');
    return;
  }
  if (kind === 'html') {
    const html = buildHtmlReport(imgs);
    download('annotation_report.html', html, 'text/html;charset=utf-8');
    maybeSaveExportToBridge('annotation_report.html', html, bookId);
    toast(`已生成 HTML 报告（${imgs.length} 张）`, 'success');
    return;
  }
}
function buildHtmlReport(imgs) {
  const c = imgs.reduce((acc, img) => {
    acc[img.status] = (acc[img.status] || 0) + 1;
    return acc;
  }, { todo: 0, running: 0, review: 0, ok: 0, bad: 0 });
  const rows = imgs.map(img => {
    const a = img.annotation || {};
    const st = STATUSES[img.status];
    const multiMeta = getMultiIllustrationMeta(img);
    const _book = getBook(img?.pdfSource?.bookId);
    const _code = _showcaseId(img, _book);
    const _name = _showcaseName(img);
    const _pinyin = displayNamePinyin(img);
    const aiModel = img.modelUsed || img.reviewMeta?.aiModel || '';
    const aiTime = img.reviewMeta?.aiGeneratedAt || img.annotatedAt || null;
    const editedTime = img.reviewMeta?.humanEditedAt || null;
    const features = Array.isArray(a.features) ? a.features.filter(Boolean) : [];
    const diff = buildReviewDiff(img);
    const illustrationSrc = getIllustrationViewUrl(img, 1200);
    return `
    <article class="entry">
      <div class="entry-img"><img src="${escapeHtml(illustrationSrc)}" alt="${escapeHtml(img.name)}"/></div>
      <div class="entry-meta">
        <header>
          <h2>${escapeHtml(_name)}${_pinyin ? ` <span style="font-size:0.6em; color:#9aa7b5; font-weight:400; letter-spacing:.3px;">${escapeHtml(_pinyin)}</span>` : ''}</h2>
          <div class="mono"><b>${escapeHtml(_code)}</b> · ${escapeHtml(img.source)} · ${escapeHtml(img.page||'')}</div>
          <div class="status pill-${st.pill}">${st.label}</div>
        </header>
        <dl>
          ${aiModel ? `<dt>标注模型</dt><dd>${escapeHtml(aiModel)}</dd>` : ''}
          ${aiTime ? `<dt>AI生成时间</dt><dd>${escapeHtml(fmtDate(aiTime))}</dd>` : ''}
          ${a.type ? `<dt>插图类型</dt><dd>${escapeHtml(a.type)}${a.academicSubclass ? ' · ' + escapeHtml(a.academicSubclass) : ''}</dd>` : ''}
          ${multiMeta.isGroup ? `<dt>多图角色</dt><dd>${escapeHtml({ single: '单图', container: '页面候选', child: `图项 ${img.figureIndex || img.subIndex || ''}` }[multiMeta.role] || '')}</dd>` : ''}
          ${multiMeta.isGroup ? `<dt>多图归属</dt><dd>${escapeHtml(getMultiIllustrationRelationLabel(multiMeta.relation))}</dd>` : ''}
          ${multiMeta.note ? `<dt>组图说明</dt><dd>${escapeHtml(multiMeta.note)}</dd>` : ''}
          ${a.legacyType ? `<dt>历史工程分类</dt><dd>${escapeHtml(ENGINEERING_TYPE_LABEL[a.legacyType] || a.legacyType)}</dd>` : ''}
          ${a.subject ? `<dt>主要对象</dt><dd>${escapeHtml(a.subject)}</dd>` : ''}
          ${a.style ? `<dt>绘制风格</dt><dd>${escapeHtml(a.style)}</dd>` : ''}
          ${a.preservation ? `<dt>保存状态</dt><dd>${escapeHtml(a.preservation)}</dd>` : ''}
          ${a.confidence ? `<dt>置信度</dt><dd>${escapeHtml({high:'高',mid:'中',low:'低'}[a.confidence]||'')}</dd>` : ''}
          ${a.procedureStep ? `<dt>历史字段：炮制工序</dt><dd>${escapeHtml(a.procedureStep)}</dd>` : ''}
          ${a.aiVerdict ? `<dt>图文互证</dt><dd>${escapeHtml(a.aiVerdict)}</dd>` : ''}
          ${a.aiVerdictNote ? `<dt>互证说明</dt><dd>${escapeHtml(a.aiVerdictNote)}</dd>` : ''}
          ${a.herbClassical ? `<dt>原文标签 / 原书称谓</dt><dd>${escapeHtml(a.herbClassical)}</dd>` : ''}
          ${a.herbModern ? `<dt>药材名（现代）</dt><dd>${escapeHtml(a.herbModern)}</dd>` : ''}
          ${a.species ? `<dt>拉丁学名</dt><dd><i>${escapeHtml(a.species)}</i></dd>` : ''}
          ${(a.parts||[]).length ? `<dt>可见部位</dt><dd>${a.parts.map(escapeHtml).join('、')}</dd>` : ''}
          ${a.meridian ? `<dt>经脉</dt><dd>${escapeHtml(a.meridian)}</dd>` : ''}
          ${(a.points||[]).length ? `<dt>穴位</dt><dd>${a.points.map(escapeHtml).join('、')}</dd>` : ''}
          ${features.length ? `<dt>AI识别特征</dt><dd>${features.map(escapeHtml).join('；')}</dd>` : ''}
          ${img.hasMultipleIllustrations ? `<dt>多图提示</dt><dd>检测到同页可能存在多处独立插图，建议人工核查</dd>` : ''}
          ${editedTime ? `<dt>人工修改时间</dt><dd>${escapeHtml(fmtDate(editedTime))}</dd>` : ''}
          ${diff.changed ? `<dt>人工修改字段数</dt><dd>${diff.changed}</dd>` : ''}
          ${a.note ? `<dt>备注</dt><dd>${escapeHtml(a.note)}</dd>` : ''}
        </dl>
      </div>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(state.project)} · 标注报告</title>
<style>
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background:#f5f6f8; color:#222; margin:0; padding:40px 20px; }
.container { max-width: 1000px; margin: 0 auto; }
h1 { font-family: "Songti SC","SimSun",serif; font-size:28px; border-bottom:2px solid #1a3a5c; padding-bottom:10px; }
.summary { background:#fff; padding:14px 18px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.08); margin:14px 0 30px; font-size:13px; color:#5b6470; }
.entry { background:#fff; padding:22px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.08); margin-bottom:18px; display:grid; grid-template-columns: 280px 1fr; gap:24px; }
.entry-img img { width:100%; border-radius:6px; border:1px solid #e8e8e8; }
.entry-meta header h2 { margin:0 0 4px; font-family: "Songti SC",serif; font-size:22px; }
.entry-meta .mono { font-family: "Consolas", monospace; font-size:11.5px; color:#8a93a0; }
.entry-meta .status { display:inline-block; margin-top:6px; padding:2px 10px; border-radius:12px; font-size:11.5px; }
.pill-ok { background:#e6f5e7; color:#2f8a36; }
.pill-review { background:#fff4e3; color:#c2680a; }
.pill-bad { background:#fdecea; color:#c1352b; }
.pill-todo { background:#eef0f3; color:#6b7280; }
.pill-running { background:#e3f2fd; color:#2196f3; }
dl { display:grid; grid-template-columns: 120px 1fr; gap:6px 14px; margin:14px 0; font-size:13.5px; }
dt { color:#5b6470; font-weight:500; }
dd { margin:0; }
</style></head>
<body><div class="container">
<h1>${escapeHtml(state.project)} · 标注报告</h1>
<div class="summary">共 ${imgs.length} 条记录 · 已确认 ${c.ok} · 待审核 ${c.review} · 有问题 ${c.bad} · 未标注 ${c.todo + c.running}<br/>生成于 ${fmtDate(Date.now())} · 报告内逐条显示标注模型与AI生成时间</div>
${rows}
</div></body></html>`;
}

/* ============================================================
   WIRE TOP-BAR
   ============================================================ */
$('#btn-add')?.addEventListener('click', openAdd);
$('#btn-settings')?.addEventListener('click', () => {
  $('#nav-more')?.classList.remove('open');
  openSettings();
});
$('#btn-review-queue')?.addEventListener('click', () => { captureReturnContext(); enterReviewMode(); });
$('#btn-batch-monitor')?.addEventListener('click', () => { captureReturnContext(); navigateTo('batch-monitor'); });
$('#btn-archive-manager')?.addEventListener('click', () => { captureReturnContext(); navigateTo('archive-manager'); });
$('#btn-asset-desk')?.addEventListener('click', () => { openAssetDeskFor(getCurrent()); });
$('#btn-run-history')?.addEventListener('click', () => { captureReturnContext(); navigateTo('run-history'); });
$('#btn-more')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('#nav-more')?.classList.toggle('open');
});
$('#btn-stats')?.addEventListener('click', () => {
  $('#nav-more')?.classList.remove('open');
  state.rightTab = 'stats';
  persist();
  renderRightTab();
});
document.addEventListener('click', (e) => {
  const more = $('#nav-more');
  if (more && !more.contains(e.target)) more.classList.remove('open');
});
$('#btn-import-book-2')?.addEventListener('click', openBookImport);
$('#btn-merge-toggle')?.addEventListener('click', toggleMergeMode);
$('#btn-merge-confirm')?.addEventListener('click', executeMerge);
$('#btn-merge-cancel')?.addEventListener('click', toggleMergeMode);

$('#btn-export')?.addEventListener('click', (e) => {
  e.stopPropagation();
  openExportModal();
});

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => { state.rightTab = t.dataset.tab; persist(); renderRightTab(); });
});
// 左侧 Tab 激活的唯一入口：设状态 + 同步 DOM（active 类 / 面板显隐 / 书列表）。
// 消除此前散落在 3 处的重复同步，以及 listBtn 里的 setTimeout(100) hack。
function activateLeftTab(tab) {
  state.leftTab = tab;
  document.querySelectorAll('.left-tab').forEach(x => x.classList.toggle('active', x.dataset.ltab === tab));
  const imgPanel  = $('#left-tab-images');
  const bookPanel = $('#left-tab-books');
  if (imgPanel)  imgPanel.style.display  = tab === 'images' ? 'flex' : 'none';
  if (bookPanel) bookPanel.style.display = tab === 'books'  ? 'flex' : 'none';
  if (tab === 'books') renderBooksList();
  if (tab === 'images') renderLeftList();
}

document.querySelectorAll('.left-tab').forEach(t => {
  t.addEventListener('click', () => {
    activateLeftTab(t.dataset.ltab);
    persist();
  });
});
$('#filter').addEventListener('change', e => { state.filter = e.target.value; persist(); renderLeftList(); });
$('#image-book-filter').addEventListener('change', e => { state.imageBookFilter = e.target.value; persist(); renderLeftList(); });
$('#search').addEventListener('input', e => { state.search = e.target.value; renderLeftList(); });

// keyboard nav
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  // 普通浏览/标注视图：方向键切换插图
  if (state.mainView === 'annotate') {
    if (e.key === 'ArrowLeft') goRel(-1);
    if (e.key === 'ArrowRight') goRel(1);
    return;
  }
  // 快速审核视图：Enter 确认 / N 下一条 / ←→ 上下一待审
  if (state.mainView === 'review-queue') {
    const img = getCurrent();
    if (!img) return;
    const reviewItems = getReviewQueueItems();
    const idx = reviewItems.findIndex(i => i.id === img.id);
    const goReview = (target) => { if (target) { e.preventDefault(); selectAndReview(target.id); } };
    if (e.key === 'Enter') {
      if (img.status === 'review') { e.preventDefault(); commitReviewQueueDecision(img.id, 'confirm'); }
    } else if (e.key === 'n' || e.key === 'N') {
      goReview(reviewItems[idx + 1]);
    } else if (e.key === 'ArrowLeft') {
      goReview(reviewItems[idx - 1]);
    } else if (e.key === 'ArrowRight') {
      goReview(reviewItems[idx + 1]);
    }
  }
});

/* ============================================================
   v1.1: BOOKS — STATE HELPERS
   ============================================================ */
function getBook(id) { return state.books.find(b => b.id === id) || null; }
function getCurrentBook() { return getBook(state.currentBookId); }
function getBookPages(book) {
  if (Array.isArray(book?.pages) && book.pages.length) return book.pages;
  return Array.isArray(book?.illustrationPages) ? book.illustrationPages : [];
}
function getBookPageRecord(book, pageNum) {
  return getBookPages(book).find(p => p.pageNum === pageNum) || null;
}
function getShowcaseCoverPageNum(book) {
  const pages = getBookPages(book);
  const first = Number(pages[0]?.pageNum) || 1;
  const pn = Number(book?.showcaseCoverPageNum);
  return Number.isFinite(pn) && pn > 0 ? pn : first;
}
function setShowcaseCoverPage(book, pageNum) {
  const pn = Number(pageNum);
  if (!book || !Number.isFinite(pn) || !getBookPageRecord(book, pn)) {
    toast('请选择有效页面作为展示封面', 'warn');
    return;
  }
  book.showcaseCoverPageNum = pn;
  markBookDirty(book.id);
  toast(`已设为展示封面：第 ${pn} 页`, 'success');
  returnToGalleryBrowse(book);
}
// PDF 物理页码：删除页面后 pageNum(显示) 与 pdfPageNum(物理) 分离，渲染一律用物理页
function pdfPageOf(rec) { return rec?.pdfPageNum ?? rec?.pageNum; }
function getBookTraits(book) {
  if (!book) return null;
  if (!book.bookTraits) {
    const legacy = { blockType: '', layoutRelation: '', textDirection: '', pageOrder: 'rtl', titleLabelDirection: '', readingNote: '' };
    for (const img of state.illustrations) {
      if (img.pdfSource?.bookId !== book.id) continue;
      const a = img.annotation || {};
      if (!legacy.blockType && a.blockType) legacy.blockType = a.blockType;
      if (!legacy.layoutRelation && a.textImageRelation) legacy.layoutRelation = a.textImageRelation;
      if (!legacy.textDirection && a.textDirection) legacy.textDirection = a.textDirection;
      if (legacy.blockType && legacy.layoutRelation && legacy.textDirection) break;
    }
    book.bookTraits = legacy;
  }
  if (!book.bookTraits.pageOrder) book.bookTraits.pageOrder = 'rtl';
  if (book.bookTraits.titleLabelDirection === undefined) book.bookTraits.titleLabelDirection = '';
  if (book.bookTraits.readingNote === undefined) book.bookTraits.readingNote = '';
  return book.bookTraits;
}

function ensureBookCropTemplate(book) {
  if (!book) return null;
  if (book.contentRectTemplate === undefined) book.contentRectTemplate = null;
  if (book.contentRectTemplateSourcePageNum === undefined) book.contentRectTemplateSourcePageNum = null;
  return normalizeRect(book.contentRectTemplate);
}

function formatRectSpec(rect) {
  const r = normalizeRect(rect);
  if (!r) return '未设置';
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  return `左 ${pct(r[0])} · 上 ${pct(r[1])} · 宽 ${pct(r[2] - r[0])} · 高 ${pct(r[3] - r[1])}`;
}

function sortQueuedImages() {
  const bookOrder = new Map((state.books || []).map((b, i) => [b.id, i]));
  state.illustrations.sort((a, b) => {
    const ap = a?.pdfSource;
    const bp = b?.pdfSource;
    if (ap?.bookId && bp?.bookId) {
      const bo = (bookOrder.get(ap.bookId) ?? 999999) - (bookOrder.get(bp.bookId) ?? 999999);
      if (bo !== 0) return bo;
      const po = (Number(ap.pageNum) || 0) - (Number(bp.pageNum) || 0);
      if (po !== 0) return po;
      const fo = getFigureOrder(a) - getFigureOrder(b);
      if (fo !== 0) return fo;
      const so = (ap.selectionMode === 'crop' ? 0 : 1) - (bp.selectionMode === 'crop' ? 0 : 1);
      if (so !== 0) return so;
    }
    if (ap?.bookId && !bp?.bookId) return -1;
    if (!ap?.bookId && bp?.bookId) return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

function refreshBookCount() {
  const el = $('#book-count');
  if (el) el.textContent = state.books.length;
}

function applyAnalyzeResultToPage(page, result, { allowClearCrop = false } = {}) {
  if (!page || !result) return;
  page.thumb = result.thumb || page.thumb;
  page.thumbHi = result.thumbHi || page.thumbHi;
  page.imgDensity = result.imgDensity ?? page.imgDensity ?? 0;
  if (!page.forceContentRect) {
    if (normalizeRect(result.contentRect)) page.contentRect = normalizeRect(result.contentRect);
    if (result.contentThumb) page.contentThumb = result.contentThumb;
    if (result.contentThumbHi) page.contentThumbHi = result.contentThumbHi;
  }
  if (normalizeRect(result.cropRect)) page.cropRect = normalizeRect(result.cropRect);
  else if (allowClearCrop) page.cropRect = null;
  if (allowClearCrop && !normalizeRect(result.cropRect)) page.cropQuad = null;
  if (result.cropThumb) page.cropThumb = result.cropThumb;
  if (result.cropThumbHi) page.cropThumbHi = result.cropThumbHi;
}

async function refreshPageContentPreview(book, page) {
  const rect = normalizeRect(page?.contentRect);
  if (!book || !page || !rect) return false;
  // 优先服务端高清裁剪（清晰+快）；失败回退 pdf.js
  const hi = await cropFromHiRes(book, page, rect, 1000);
  if (hi) {
    page.contentThumbHi = hi;
    page.contentThumb = (await cropFromHiRes(book, page, rect, 320)) || hi;
    syncPageAssetIntoQueuedImages(book, page);
    return true;
  }
  const doc = pdfDocs[book.id] || await ensurePdfDoc(book).catch(() => null);
  if (!doc) return false;
  try {
    page.contentThumb = await renderPageRectDataUrl(doc, pdfPageOf(page), rect, 240, 0.82);
    page.contentThumbHi = await renderPageRectDataUrl(doc, pdfPageOf(page), rect, 520, 0.9);
    syncPageAssetIntoQueuedImages(book, page);
    return true;
  } catch (e) {
    console.warn('refreshPageContentPreview failed', page.pageNum, e);
    return false;
  }
}

async function setPageContentRect(book, page, rect) {
  const normalized = normalizeRect(rect);
  if (!book || !page || !normalized) return false;
  page.contentRect = normalized;
  page.forceContentRect = true;
  await refreshPageContentPreview(book, page);
  persist();
  return true;
}

// 手动框选插图：渲出"只有插图"的缩略图（展示用），与版心独立
async function refreshPageCropPreview(book, page) {
  const rect = normalizeRect(page?.cropRect);
  const quad = normalizeQuad(page?.cropQuad);
  if (!book || !page || !rect) return false;
  const rotationDeg = clampCropRotationDeg(page.cropRotationDeg || page.rotationDeg || 0);
  // 优先服务端高清裁剪（出数据的插图本体，清晰+快）；失败回退 pdf.js
  const hi = await cropFromHiRes(book, page, rect, 1100, rotationDeg, quad);
  if (hi) {
    page.cropThumbHi = hi;
    page.cropThumb = (await cropFromHiRes(book, page, rect, 320, rotationDeg, quad)) || hi;
    syncPageAssetIntoQueuedImages(book, page);
    return true;
  }
  const doc = pdfDocs[book.id] || await ensurePdfDoc(book).catch(() => null);
  if (!doc) return false;
  try {
    page.cropThumb = await renderPageRectDataUrl(doc, pdfPageOf(page), rect, 260, 0.82);
    page.cropThumbHi = await renderPageRectDataUrl(doc, pdfPageOf(page), rect, 560, 0.9);
    syncPageAssetIntoQueuedImages(book, page);
    return true;
  } catch (e) {
    console.warn('refreshPageCropPreview failed', page.pageNum, e);
    return false;
  }
}

async function setPageCropRect(book, page, rect, rotationDeg = page?.cropRotationDeg || 0, quad = null) {
  const normalized = normalizeRect(rect);
  if (!book || !page || !normalized) return false;
  page.cropRect = normalized;
  page.cropQuad = normalizeQuad(quad) || null;
  page.cropRotationDeg = clampCropRotationDeg(rotationDeg);
  page.forceCropRect = true;          // 标记为手动插图框 → 展示优先用它
  await refreshPageCropPreview(book, page);
  persist();
  return true;
}

async function renderFigurePreviewUrl(book, page, rect, { maxLong = 1100, targetWidth = 560, quality = 0.9, rotationDeg = 0, quad = null } = {}) {
  const normalized = normalizeRect(rect);
  if (!book || !page || !normalized) return '';
  const rot = clampCropRotationDeg(rotationDeg);
  const normalizedQuad = normalizeQuad(quad);
  try {
    const hi = await cropFromHiRes(book, page, normalized, maxLong, rot, normalizedQuad);
    if (hi) return hi;
  } catch (e) {
    console.warn('figure hi-res preview failed', e);
  }
  try {
    const doc = pdfDocs[book.id] || await ensurePdfDoc(book).catch(() => null);
    if (doc) return await renderPageRectDataUrl(doc, pdfPageOf(page), normalized, targetWidth, quality);
  } catch (e) {
    console.warn('figure pdf.js preview failed', e);
  }
  return '';
}

async function setFigureCropRect(book, page, img, rect, rotationDeg = img?.pdfSource?.rotationDeg || 0, quad = null) {
  const normalized = normalizeRect(rect);
  if (!book || !page || !img || !normalized) return false;
  const rot = clampCropRotationDeg(rotationDeg);
  const normalizedQuad = normalizeQuad(quad);
  const previewUrl = await renderFigurePreviewUrl(book, page, normalized, {
    maxLong: 1100,
    targetWidth: 560,
    quality: 0.9,
    rotationDeg: rot,
    quad: normalizedQuad,
  });
  if (!previewUrl) {
    toast('无法生成新的插图预览，已取消保存，避免保留旧裁剪图', 'warn');
    return false;
  }
  img.pdfSource = img.pdfSource || {};
  img.pdfSource.cropRect = normalized;
  img.pdfSource.annotateRect = normalized;
  img.pdfSource.cropQuad = normalizedQuad;
  img.pdfSource.annotateQuad = normalizedQuad;
  img.pdfSource.rotationDeg = rot;
  img.pdfSource.contentRect = page.contentRect || img.pdfSource.contentRect || null;
  img.pdfSource.selectionMode = 'crop';
  img.url = previewUrl;
  markBookDirty(book.id);
  persist();
  return true;
}

async function applyContentRectBatch(book, sourcePage, scope = 'queued') {
  const rect = normalizeRect(sourcePage?.contentRect);
  if (!book || !sourcePage || !rect) {
    toast('请先框选正文区域', 'warn');
    return;
  }
  const pages = scope === 'book'
    ? getBookPages(book)
    : getQueuedBookPages(book);
  if (!pages.length) {
    toast(scope === 'book' ? '当前书籍没有可套用的页面' : '当前没有待标注页可套用', 'warn');
    return;
  }

  let refreshed = 0;
  for (let i = 0; i < pages.length; i++) {
    const target = pages[i];
    target.contentRect = rect.slice();
    target.forceContentRect = true;
    if (getQueuedImageForPage(book, target.pageNum) || target.pageNum === state.currentBookPage) {
      if (await refreshPageContentPreview(book, target)) refreshed++;
    } else {
      syncPageAssetIntoQueuedImages(book, target);
    }
    if ((i + 1) % 8 === 0 || i === pages.length - 1) {
      persist();
      if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
      refreshPageDetailWorkspace(book.id, state.currentBookPage);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  toast(scope === 'book'
    ? `已将正文框套用到全书 ${pages.length} 页${refreshed ? `，刷新 ${refreshed} 个预览` : ''}`
    : `已将正文框套用到待标注页 ${pages.length} 页${refreshed ? `，刷新 ${refreshed} 个预览` : ''}`, 'success');
}

function setBookContentRectTemplate(book, rect, sourcePageNum = null, sourceBookId = null) {
  const normalized = normalizeRect(rect);
  if (!book || !normalized) return false;
  book.contentRectTemplate = normalized.slice();
  book.contentRectTemplateSourceBookId = sourceBookId || book.id || null;
  book.contentRectTemplateSourcePageNum = Number.isFinite(Number(sourcePageNum)) ? Number(sourcePageNum) : null;
  state.bookTemplateBookId = book.contentRectTemplateSourceBookId || state.bookTemplateBookId;
  state.bookTemplatePageNum = book.contentRectTemplateSourcePageNum || state.bookTemplatePageNum;
  persist();
  if (state.mainView === 'group-overview') renderGroupOverviewView();
  if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
  if (state.mainView === 'page-detail' && state.currentBookId === book.id) refreshPageDetailWorkspace(book.id, state.currentBookPage);
  return true;
}

async function applyBookContentRectTemplate(book, scope = 'book', opts = {}) {
  const rect = ensureBookCropTemplate(book);
  if (!book || !rect) {
    toast('当前书籍尚未设置统一正文框规格', 'warn');
    return;
  }
  if (book?.isGroupProxy) {
    const groupBooks = getSortedGroupBooks(book.groupId);
    let total = 0;
    let refreshed = 0;
    for (const targetBook of groupBooks) {
      targetBook.contentRectTemplate = rect.slice();
      targetBook.contentRectTemplateSourceBookId = book.contentRectTemplateSourceBookId || null;
      targetBook.contentRectTemplateSourcePageNum = book.contentRectTemplateSourcePageNum || null;
      const pages = scope === 'queued' ? getQueuedBookPages(targetBook) : getBookPages(targetBook);
      total += pages.length;
      for (let i = 0; i < pages.length; i++) {
        const target = pages[i];
        target.contentRect = rect.slice();
        target.forceContentRect = true;
        if (getQueuedImageForPage(targetBook, target.pageNum) || targetBook.id === state.currentBookId) {
          if (await refreshPageContentPreview(targetBook, target)) refreshed++;
        } else {
          syncPageAssetIntoQueuedImages(targetBook, target);
        }
        if ((i + 1) % 8 === 0 || i === pages.length - 1) {
          persist(targetBook.id);
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }
    if (!opts.silent) {
      toast(scope === 'queued'
        ? `已将统一规格套用到书组待标注页 ${total} 页${refreshed ? `，刷新 ${refreshed} 个预览` : ''}`
        : `已将统一规格套用到书组 ${total} 页${refreshed ? `，刷新 ${refreshed} 个预览` : ''}`, 'success');
    }
    if (state.mainView === 'group-overview') renderGroupOverviewView();
    return;
  }
  await applyContentRectBatch(book, { contentRect: rect.slice() }, scope);
}

function rerenderBookTemplateContext(book) {
  if (state.mainView === 'group-overview') {
    renderGroupOverviewView();
    return;
  }
  if (state.mainView === 'gallery') {
    renderGalleryView();
    return;
  }
  if (state.mainView === 'page-detail' && book?.id === state.currentBookId) {
    refreshPageDetailWorkspace(book.id, state.currentBookPage);
    return;
  }
  renderAll();
}

function getBookTemplateReferenceEntries(book) {
  if (!book) return [];
  if (book.isGroupProxy) {
    const groupBooks = getSortedGroupBooks(book.groupId);
    return groupBooks.flatMap((volumeBook, index) => getBookPages(volumeBook).map(page => ({
      book: volumeBook,
      page,
      label: `${getVolumeListLabel(volumeBook, index)} · 第 ${page.pageNum} 页`,
      value: `${volumeBook.id}::${page.pageNum}`,
    })));
  }
  return getBookPages(book).map(page => ({
    book,
    page,
    label: `第 ${page.pageNum} 页`,
    value: `${book.id}::${page.pageNum}`,
  }));
}

function renderBookTemplateEditor(book) {
  const templateRect = ensureBookCropTemplate(book);
  const entries = getBookTemplateReferenceEntries(book);
  if (!entries.length) return null;
  const sourceBookId = book.contentRectTemplateSourceBookId || book.id || null;
  const selectedBookId = state.bookTemplateBookId || sourceBookId || entries[0].book.id;
  const selectedPageNum = Number(state.bookTemplatePageNum || book.contentRectTemplateSourcePageNum || entries[0].page.pageNum || 1);
  let selectedEntry = entries.find(item => item.book.id === selectedBookId && Number(item.page.pageNum) === selectedPageNum)
    || entries.find(item => item.book.id === sourceBookId && Number(item.page.pageNum) === Number(book.contentRectTemplateSourcePageNum))
    || entries[0];
  const selectedBook = selectedEntry.book;
  const selectedPage = selectedEntry.page;
  state.bookTemplateBookId = selectedBook.id;
  state.bookTemplatePageNum = selectedPage.pageNum;

  const wrap = el('div', { class: 'template-preview' + (state.bookTemplateEditing ? ' editing' : '') });
  const controls = el('div', { class: 'ta-actions', style: 'margin-top:0; margin-bottom:10px;' });
  const pageSelect = el('select', {
    style: 'height:32px; min-width:140px; border:1px solid var(--c-border-strong); border-radius:6px; background:#fff; padding:0 8px;',
    onchange: (e) => {
      const [bookId, pageNum] = String(e.target.value || '').split('::');
      state.bookTemplateBookId = bookId || null;
      state.bookTemplatePageNum = Number(pageNum) || null;
      persist();
      rerenderBookTemplateContext(book);
    }
  });
  for (const item of entries) {
    pageSelect.appendChild(el('option', {
      value: item.value,
      ...(item.value === selectedEntry.value ? { selected: '' } : {})
    }, `参考页：${item.label}`));
  }
  controls.appendChild(pageSelect);
  controls.appendChild(el('button', {
    class: state.bookTemplateEditing ? 'btn primary' : 'btn',
    onclick: async () => {
      state.bookTemplateEditing = !state.bookTemplateEditing;
      persist();
      rerenderBookTemplateContext(book);
      if (!state.bookTemplateEditing) {
        // 完成编辑时自动应用到全书页
        await applyBookContentRectTemplate(book, 'book');
      }
    }
  }, state.bookTemplateEditing ? '完成' : '调整统一规格'));
  wrap.appendChild(controls);

  const stage = el('div', { class: 'template-preview-stage' });
  const img = el('img', { src: selectedPage.thumbHi || selectedPage.thumb, class: 'template-preview-image' });
  stage.appendChild(img);
  const overlay = el('div', {
    class: 'template-overlay text',
    style: templateRect ? getRectStyle(templateRect, '') : 'display:none;'
  });
  stage.appendChild(overlay);
  const handles = ['nw', 'ne', 'sw', 'se'].map(pos => {
    const h = el('div', { class: 'template-handle', style: 'display:none;' });
    h.dataset.pos = pos;
    stage.appendChild(h);
    return h;
  });

  const placeHandles = (rect) => {
    const r = normalizeRect(rect);
    if (!r) {
      overlay.style.display = 'none';
      handles.forEach(h => { h.style.display = 'none'; });
      return;
    }
    overlay.style.display = '';
    overlay.style.cssText = getRectStyle(r, 'display:block;');
    const positions = {
      nw: [r[0], r[1]],
      ne: [r[2], r[1]],
      sw: [r[0], r[3]],
      se: [r[2], r[3]],
    };
    for (const h of handles) {
      const pos = positions[h.dataset.pos];
      h.style.display = state.bookTemplateEditing ? '' : 'none';
      h.style.left = `calc(${(pos[0] * 100).toFixed(3)}% - 7px)`;
      h.style.top = `calc(${(pos[1] * 100).toFixed(3)}% - 7px)`;
    }
  };
  placeHandles(templateRect);

  if (state.bookTemplateEditing) {
    const editor = el('div', {
      class: 'template-overlay',
      style: 'left:0; top:0; width:100%; height:100%; cursor:crosshair; background:rgba(255,255,255,0.01);'
    });
    stage.appendChild(editor);
    let draft = normalizeRect(templateRect) || normalizeRect(selectedPage.contentRect) || [0.12, 0.08, 0.88, 0.92];
    let startX = 0;
    let startY = 0;
    let startRect = null;
    let dragMode = 'draw';

    const detectDragMode = (px, py, rect, box) => {
      const r = normalizeRect(rect);
      if (!r) return 'draw';
      const tolX = Math.max(0.012, 10 / box.width);
      const tolY = Math.max(0.012, 10 / box.height);
      const nearL = Math.abs(px - r[0]) <= tolX;
      const nearR = Math.abs(px - r[2]) <= tolX;
      const nearT = Math.abs(py - r[1]) <= tolY;
      const nearB = Math.abs(py - r[3]) <= tolY;
      const insideX = px >= r[0] && px <= r[2];
      const insideY = py >= r[1] && py <= r[3];
      if (nearL && nearT) return 'resize-nw';
      if (nearR && nearT) return 'resize-ne';
      if (nearL && nearB) return 'resize-sw';
      if (nearR && nearB) return 'resize-se';
      if (nearL && insideY) return 'resize-w';
      if (nearR && insideY) return 'resize-e';
      if (nearT && insideX) return 'resize-n';
      if (nearB && insideX) return 'resize-s';
      if (insideX && insideY) return 'move';
      return 'draw';
    };
    const resizeRect = (mode, rect, dx, dy) => {
      const r = rect.slice();
      if (mode.includes('w')) r[0] += dx;
      if (mode.includes('e')) r[2] += dx;
      if (mode.includes('n')) r[1] += dy;
      if (mode.includes('s')) r[3] += dy;
      const minSize = 0.02;
      if (r[2] - r[0] < minSize) {
        if (mode.includes('w')) r[0] = r[2] - minSize;
        else r[2] = r[0] + minSize;
      }
      if (r[3] - r[1] < minSize) {
        if (mode.includes('n')) r[1] = r[3] - minSize;
        else r[3] = r[1] + minSize;
      }
      return normalizeRect(r);
    };

    placeHandles(draft);
    editor.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const box = stage.getBoundingClientRect();
      startX = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      startY = Math.max(0, Math.min(1, (e.clientY - box.top) / box.height));
      startRect = draft ? draft.slice() : null;
      dragMode = detectDragMode(startX, startY, draft, box);
      if (dragMode === 'draw') draft = [startX, startY, startX, startY];

      const onMove = (ev) => {
        const mx = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
        const my = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
        if (dragMode === 'draw') {
          draft = normalizeRect([Math.min(startX, mx), Math.min(startY, my), Math.max(startX, mx), Math.max(startY, my)]);
        } else if (dragMode === 'move' && startRect) {
          const dx = mx - startX;
          const dy = my - startY;
          const width = startRect[2] - startRect[0];
          const height = startRect[3] - startRect[1];
          const nextLeft = Math.max(0, Math.min(1 - width, startRect[0] + dx));
          const nextTop = Math.max(0, Math.min(1 - height, startRect[1] + dy));
          draft = [nextLeft, nextTop, nextLeft + width, nextTop + height];
        } else if (startRect) {
          draft = resizeRect(dragMode.replace('resize-', ''), startRect, mx - startX, my - startY);
        }
        placeHandles(draft);
      };
      const onUp = async () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (!draft || rectArea(draft) < 0.02) {
          toast('统一规格过小，已取消本次修改', 'warn');
          rerenderBookTemplateContext(book);
          return;
        }
        await setPageContentRect(selectedBook, selectedPage, draft);
        setBookContentRectTemplate(book, draft, selectedPage.pageNum, selectedBook.id);
        if (book.isGroupProxy) {
          await applyBookContentRectTemplate(book, 'book', { silent: true });
          toast(`已更新书组统一规格（参考：${selectedEntry.label}），并已套用到后续分卷`, 'success');
        } else {
          toast(`已更新全书统一规格（参考第 ${selectedPage.pageNum} 页）`, 'success');
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  wrap.appendChild(stage);
  wrap.appendChild(el('div', { style: 'margin-top:8px; font-size:12px; color:#8a7a4a; line-height:1.6;' },
    state.bookTemplateEditing
      ? '拖动框体或拉动四角调整全书统一规格。修改会同步到模板，并记录当前参考页。'
      : '这里显示全书统一规格的实际框选范围。可切换参考页查看覆盖效果，或进入编辑态继续调整。'));
  return wrap;
}

/* ============================================================
   v1.1: LEFT — BOOKS LIST
   ============================================================ */
function partitionBooksForList(books) {
  const groups = {};
  const ungrouped = [];
  for (const book of books || []) {
    if (!book.groupId) {
      ungrouped.push(book);
      continue;
    }
    if (!groups[book.groupId]) {
      groups[book.groupId] = {
        title: book.groupTitle || book.groupId,
        books: [],
      };
    }
    groups[book.groupId].books.push(book);
  }
  for (const [groupId, group] of Object.entries(groups)) {
    if (group.books.length > 1) continue;
    ungrouped.push(...group.books);
    delete groups[groupId];
  }
  return { groups, ungrouped };
}

function renderBooksList() {
  const list = $('#books-list');
  list.innerHTML = '';
  if (state.books.length === 0) {
    list.appendChild(el('div', { class: 'empty-list' },
      '尚未导入任何书籍。', el('br'),
      '点击下方「+ 导入新书籍」', el('br'),
      '先建立全书页面索引，再按需识别插图。'));
    return;
  }

  // 历史图片导入可能为单卷误写 groupId；单成员组按普通书籍显示，
  // 这样仍可进入合并模式，而真正的多卷书组保持原有展示。
  const { groups, ungrouped } = partitionBooksForList(state.books);

  function makeBookCard(book) {
    const isActive = state.currentBookId === book.id && (state.mainView === 'gallery' || state.mainView === 'page-detail');
    const isPreviewing = state.previewBookId === book.id && state.rightTab === 'form';
    const isSelected = state.mergeSelected.includes(book.id);
    const cls = 'book-card'
      + (isActive ? ' active' : '')
      + (isPreviewing && !isActive ? ' preview-active' : '')
      + (isSelected ? ' merge-selected' : '');
    // 计算该书标注进度
    const bookIllusts = state.illustrations.filter(img => img.pdfSource?.bookId === book.id);
    const okCount    = bookIllusts.filter(img => img.status === 'ok').length;
    const totalCount = bookIllusts.length;

    const card = el('div', {
      class: cls,
      onclick: () => {
        if (state.mergeMode) { toggleMergeSelection(book.id); return; }
        openGallery(book.id, 'pages');
        scrollToBrowse();
      },
      title: state.mergeMode ? (isSelected ? '取消选择' : '点击选中此书') : '打开书籍主页',
    });
    card.appendChild(el('div', { class: 'merge-check' }, isSelected ? '✓' : ''));
    card.appendChild(el('div', { class: 'title' }, '📗 ' + bookDisplayTitle(book)));

    // 标注进度（有图片时才显示）
    if (totalCount > 0) {
      const pct = Math.round(okCount / totalCount * 100);
      const prog = el('div', { class: 'book-card-progress' });
      prog.appendChild(el('div', { class: 'book-card-progress-bar' },
        el('div', { class: 'book-card-progress-fill', style: `width:${pct}%` })
      ));
      prog.appendChild(el('span', { class: 'book-card-progress-label' }, `${okCount}/${totalCount} 已确认`));
      card.appendChild(prog);
    }
    return card;
  }

  function makeVolumeListItem(book, index = 0) {
    const isActive = state.currentBookId === book.id && (state.mainView === 'gallery' || state.mainView === 'page-detail');
    const item = el('button', {
      class: 'group-volume-item' + (isActive ? ' active' : ''),
      title: `进入${getVolumeListLabel(book, index)}内容`,
      onclick: () => {
        openGallery(book.id, 'pages');
        scrollToBrowse();
      },
    });
    item.appendChild(el('span', { class: 'group-volume-item-bullet' }, isActive ? '▸' : '•'));
    item.appendChild(el('span', { class: 'group-volume-item-text' }, getVolumeListLabel(book, index)));
    const pageCount = Number(book.totalPages) || getBookPages(book).length || 0;
    if (pageCount > 0) {
      item.appendChild(el('span', { class: 'group-volume-item-meta' }, `${pageCount}页`));
    }
    return item;
  }

  function makeGroupCard(groupId, group) {
    const isPreviewing = state.previewGroupId === groupId && state.rightTab === 'form';
    const groupIllusts = state.illustrations.filter(img => img.pdfSource?.bookId && group.books.some(book => book.id === img.pdfSource.bookId));
    const okCount = groupIllusts.filter(img => img.status === 'ok').length;
    const totalCount = groupIllusts.length;
    const cls = 'book-card group-book-card' + (isPreviewing ? ' preview-active' : '');
    const card = el('div', {
      class: cls,
      title: '打开书组信息',
      onclick: () => {
        openGroupOverview(groupId);
      },
    });
    card.appendChild(el('div', { class: 'title', style: 'display:flex; align-items:center; gap:6px; margin-bottom:0;' },
      el('span', null, '📚 ' + group.title),
      el('span', { style: 'font-weight:400; opacity:.7; margin-left:3px;' }, `（${group.books.length}卷）`)
    ));
    if (totalCount > 0) {
      const pct = Math.round(okCount / totalCount * 100);
      const prog = el('div', { class: 'book-card-progress' });
      prog.appendChild(el('div', { class: 'book-card-progress-bar' },
        el('div', { class: 'book-card-progress-fill', style: `width:${pct}%` })
      ));
      prog.appendChild(el('span', { class: 'book-card-progress-label' }, `${okCount}/${totalCount} 已确认`));
      card.appendChild(prog);
    }
    return card;
  }

  // Render grouped books first
  for (const [groupId, group] of Object.entries(groups)) {
    const isCollapsed = state.groupCollapsed?.[groupId] !== false;
    list.appendChild(makeGroupCard(groupId, group));
    if (!isCollapsed) {
      const childWrap = el('div', { style: 'display:flex; flex-direction:column; gap:8px; margin:8px 0 12px 14px; padding-left:10px; border-left:2px solid rgba(43,108,176,0.12);' });
      group.books
        .slice()
        .sort((a, b) => (a.groupOrder ?? 1e9) - (b.groupOrder ?? 1e9))
        .forEach((book, index) => childWrap.appendChild(makeVolumeListItem(book, index)));
      list.appendChild(childWrap);
    }
  }

  // Render ungrouped books（与书组平等并列，不再单列「其他书籍」分类标题）
  for (const book of ungrouped) list.appendChild(makeBookCard(book));
}

function toggleMergeMode() {
  state.mergeMode = !state.mergeMode;
  state.mergeSelected = [];
  document.body.classList.toggle('merge-mode', state.mergeMode);
  const toggleBtn = $('#btn-merge-toggle');
  const confirmRow = $('#merge-confirm-row');
  if (toggleBtn) toggleBtn.textContent = state.mergeMode ? '× 退出' : '🔗 合并';
  if (confirmRow) confirmRow.style.display = state.mergeMode ? 'flex' : 'none';
  updateMergeCount();
  renderBooksList();
}

function toggleMergeSelection(bookId) {
  const idx = state.mergeSelected.indexOf(bookId);
  if (idx === -1) state.mergeSelected.push(bookId);
  else state.mergeSelected.splice(idx, 1);
  updateMergeCount();
  renderBooksList();
}

function updateMergeCount() {
  const countEl = $('#merge-count');
  if (countEl) countEl.textContent = state.mergeSelected.length;
}

function applyMergeResultToBooks(books, result, title) {
  const merged = new Map((result?.books || []).map(item => [item.bookId, item]));
  for (const book of books || []) {
    const finalMeta = merged.get(book.id);
    if (!finalMeta) continue;
    book.groupId = result.groupId;
    book.groupTitle = title;
    book.groupMeta = book.groupMeta || {};
    book.groupOrder = finalMeta.groupOrder;
    if (finalMeta.version) book.version = finalMeta.version;
  }
  return [...merged.keys()];
}

async function executeMerge() {
  if (state.mergeSelected.length < 2) {
    alert('请至少选择 2 本书籍进行合并。');
    return;
  }
  const title = prompt('请为这组书籍命名（将作为合并书籍组的标题）：',
    state.books.find(b => b.id === state.mergeSelected[0])?.title || '合并书籍');
  if (!title) return;
  const confirmBtn = $('#btn-merge-confirm');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '合并中…'; }
  try {
    const resp = await fetch(`${BRIDGE_BASE}/api/merge-books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: state.mergeSelected, title }),
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(result.error || '合并失败');

    // 只更新受影响书籍，不调用 initFromBridge()
    // （initFromBridge 会 Object.assign 覆盖全量 state，可能丢失未保存的确认状态）
    // 卷次和 groupOrder 必须采用后端最终值，否则随后的 persist 会把旧值覆盖回去。
    const mergedBookIds = applyMergeResultToBooks(state.books, result, title);
    // 把改动过的书标脏，让 flushBridgeState 同步到 bridge
    mergedBookIds.forEach(bid => markBookDirty(bid));

    // Exit merge mode
    state.mergeMode = false;
    state.mergeSelected = [];
    document.body.classList.remove('merge-mode');
    const toggleBtn = $('#btn-merge-toggle');
    const confirmRow = $('#merge-confirm-row');
    if (toggleBtn) toggleBtn.textContent = '🔗 合并';
    if (confirmRow) confirmRow.style.display = 'none';
    persist();
    renderAll();
    alert(`✅ 合并成功！${result.volumes} 本书籍已归入「${title}」书籍组。`);
  } catch (e) {
    alert('❌ 合并失败：' + e.message);
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; updateMergeCount(); confirmBtn.textContent = `合并选中(${state.mergeSelected.length}本)`; }
  }
}

function openBookLandingPage(bookId) {
  const book = getBook(bookId);
  const firstPage = getBookPages(book)[0];
  if (!book || !firstPage) {
    openGallery(bookId, 'pages');
    return;
  }
  openPageDetail(bookId, firstPage.pageNum, 'pages');
}

function openGallery(bookId, scope = 'illustrations', focusPageNum = null) {
  const book = getBook(bookId);
  const hasQueuedPages = scope === 'illustrations' && getQueuedBookPages(book).length > 0;
  const focused = Number(focusPageNum) || null;
  _galleryFocusRequestPageNum = focused;
  navigateTo('gallery', {
    currentBookId:   bookId,
    currentBookPage: focused || state.currentBookPage,
    galleryScope:    scope,
    pageBrowseScope: scope,
    galleryFilter:   scope === 'illustrations' && hasQueuedPages ? 'added' : 'all',
    gallerySelection: scope === 'pages' && focused ? [focused] : [],
  });
}

function bulkAddBookToQueue(bookId) {
  const book = getBook(bookId); if (!book) return;
  let added = 0, skippedMulti = 0;
  for (const p of book.illustrationPages) {
    if (pageHasMultipleIllustrations(book, p.pageNum)) {
      skippedMulti++;
      continue;
    }
    if (getQueuedImageForPage(book, p.pageNum)) continue; // already in illustrations
    addImageFromBookPage(book, p.pageNum);
    added++;
  }
  const suffix = skippedMulti ? `；${skippedMulti} 页多图候选需先人工拆成图1/图2` : '';
  toast(`已从《${book.title}》加入 ${added} 张到标注队列${suffix}`, skippedMulti ? 'warn' : 'success');
  persist();
  renderAll();
}

/* ── 图文切割：以插图位置为分隔符，自动关联前后文字段落 ─────────────────── */
// 每侧最多取几页文字（防止相邻插图间有大量空白页时文字过长）
const TEXT_CUT_MAX_PER_SIDE = 8;

function runTextImageCut(book) {
  if (!book) return 0;
  const allPages = getBookPages(book).sort((a, b) => Number(a.pageNum) - Number(b.pageNum));
  const illustNums = new Set((book.illustrationPages || []).map(p => Number(p.pageNum)));
  if (!illustNums.size) return 0;

  const sortedIllustNums = [...illustNums].sort((a, b) => a - b);
  let cutCount = 0;

  for (const ip of (book.illustrationPages || [])) {
    const pageNum = Number(ip.pageNum);

    // 若已有手动设置的关联文字，不覆盖（手动优先）
    const existingSrc = ip.textAsset?.associatedSource;
    if (existingSrc && existingSrc !== 'auto_text_cut' && (ip.textAsset?.associatedText || '').trim()) continue;

    // 前后相邻插图页码（作为文字段的左右边界）
    const prevIllust = [...sortedIllustNums].reverse().find(n => n < pageNum) ?? null;
    const nextIllust = sortedIllustNums.find(n => n > pageNum) ?? null;

    const layout = book.textLayout || 'auto'; // 'auto' | 'text_before' | 'text_after'

    // 文字提取辅助：人工修订文本优先，其次 OCR/PDF 文字层，最后兼容老的 page.text。
    const pageHasText = p => !!(getEffectivePageText(p.textAsset || p) || p.text || '').trim();
    const pageText    = p => (getEffectivePageText(p.textAsset || p) || p.text || '').trim();

    // 插图前侧文字页（取最靠近插图的 N 页）
    const textBefore = layout === 'text_after' ? [] : allPages
      .filter(p => {
        const n = Number(p.pageNum);
        return n < pageNum
          && (prevIllust === null || n > prevIllust)
          && !illustNums.has(n)
          && pageHasText(p);
      })
      .slice(-TEXT_CUT_MAX_PER_SIDE);

    // 插图后侧文字页（取最靠近插图的 N 页）
    let textAfter = layout === 'text_before' ? [] : allPages
      .filter(p => {
        const n = Number(p.pageNum);
        return n > pageNum
          && (nextIllust === null || n < nextIllust)
          && !illustNums.has(n)
          && pageHasText(p);
      })
      .slice(0, TEXT_CUT_MAX_PER_SIDE);

    // 图组场景：后侧紧跟插图导致文字区间为空 → 跨过插图继续搜索，但限制最大距离
    if (!textAfter.length && layout !== 'text_before') {
      const searchCeiling = (nextIllust !== null ? nextIllust : pageNum) + TEXT_CUT_MAX_PER_SIDE;
      textAfter = allPages
        .filter(p => {
          const n = Number(p.pageNum);
          return n > pageNum
            && n <= searchCeiling
            && !illustNums.has(n)
            && pageHasText(p);
        })
        .slice(0, TEXT_CUT_MAX_PER_SIDE);
    }

    // 插图页自身文字（混排页：图文同页）
    const selfText = pageText(ip);

    const allTextPages = [...textBefore, ...textAfter];
    if (!selfText && !allTextPages.length) continue;

    // 组装文字块（按页码顺序，带页码标注方便 AI 区分来源）
    const blocks = [];
    if (selfText) blocks.push({ pageNum, text: selfText });
    for (const p of allTextPages) {
      const t = (getEffectivePageText(p.textAsset || p) || p.text || '').trim();
      if (t) blocks.push({ pageNum: Number(p.pageNum), text: t });
    }
    blocks.sort((a, b) => a.pageNum - b.pageNum);

    const associated = blocks.map(b => `【第${b.pageNum}页】\n${b.text}`).join('\n\n');
    const associatedPageNums = blocks.map(b => b.pageNum);

    // 写入 illustrationPages 条目
    if (!ip.textAsset) ip.textAsset = {};
    ip.textAsset.associatedText      = associated;
    ip.textAsset.associatedPageNums  = associatedPageNums;
    ip.textAsset.associatedSource    = 'auto_text_cut';
    ip.textAsset.associatedUpdatedAt = new Date().toISOString();
    // 同步写入 book.pages 对应条目（两数组序列化后为独立对象，必须同时写）
    const bookPage = (book.pages || []).find(p => Number(p.pageNum) === pageNum);
    if (bookPage) {
      if (!bookPage.textAsset) bookPage.textAsset = {};
      bookPage.textAsset.associatedText      = associated;
      bookPage.textAsset.associatedPageNums  = associatedPageNums;
      bookPage.textAsset.associatedSource    = 'auto_text_cut';
      bookPage.textAsset.associatedUpdatedAt = ip.textAsset.associatedUpdatedAt;
    }
    cutCount++;
  }

  markBookDirty(book.id);
  return cutCount;
}

function uniqueSortedBookPages(book, pages) {
  const pageMap = new Map(getBookPages(book).map(p => [Number(p.pageNum), p]));
  const nums = Array.from(new Set((pages || [])
    .map(p => Number(p?.pageNum ?? p))
    .filter(n => Number.isFinite(n) && pageMap.has(n))))
    .sort((a, b) => a - b);
  return nums.map(n => pageMap.get(n));
}

function computeSelectedScanPages(book) {
  return uniqueSortedBookPages(book, state.gallerySelection || []);
}

function computeContextScanPages(book, { radius = config.scanContextRadius, selectedPages = state.gallerySelection || [] } = {}) {
  const allPages = getBookPages(book);
  const existingNums = new Set(allPages.map(p => Number(p.pageNum)));
  const centers = new Set((selectedPages || []).map(n => Number(n)).filter(n => Number.isFinite(n)));

  const r = Math.max(0, Math.min(10, Number(radius) || 0));
  const targetNums = new Set();
  centers.forEach(center => {
    if (!Number.isFinite(center)) return;
    for (let n = center - r; n <= center + r; n++) {
      if (existingNums.has(n)) targetNums.add(n);
    }
  });
  return uniqueSortedBookPages(book, Array.from(targetNums));
}

function getScanJobLabel(job) {
  if (!job) return 'AI 全书扫描';
  return job.scopeLabel || (job.mode === 'selected'
    ? '选中页扫描'
    : job.mode === 'context'
      ? '插图上下文补扫'
      : 'AI 全书扫描');
}

/* ── AI 扫描：OCR + 插图判断（合并一次调用）────────────────────────── */
const SCAN_INPUT_VERSION = 'page-region-v1';
const SCAN_CONTENT_LONG_SIDE = 1700;

function getScanContentRect(book, page) {
  return normalizeRect(page?.contentRect) || normalizeRect(book?.contentRectTemplate);
}

function resolveScanInputRegion(book, page, { allowFullPage = false } = {}) {
  const contentRect = getScanContentRect(book, page);
  if (contentRect) return { region: 'content_rect', rect: contentRect };
  if (allowFullPage) return { region: 'full_page', rect: [0, 0, 1, 1] };
  return null;
}

function pagesMissingScanContentRect(book, pages) {
  return uniqueSortedBookPages(book, pages).filter(page => !getScanContentRect(book, page));
}

function openMissingContentRectGate(book, pages, scopeLabel = '页面扫描') {
  const missing = pagesMissingScanContentRect(book, pages);
  if (!missing.length) return Promise.resolve('content_rect');
  return new Promise(resolve => {
    let done = false;
    const finish = (choice) => {
      if (done) return;
      done = true;
      scrim.remove();
      resolve(choice);
    };
    const pagePreview = missing.slice(0, 8).map(page => page.pageNum).join('、');
    const more = missing.length > 8 ? ` 等 ${missing.length} 页` : '';
    const body = el('div', { class: 'modal-body', style: 'display:grid; gap:12px; line-height:1.75;' },
      el('div', {
        style: 'padding:12px 14px; border:1px solid #e4c77a; border-radius:8px; background:#fff9e8; color:#6c5421;'
      },
        el('div', { style: 'font-weight:700; margin-bottom:4px;' }, `缺少正文框：第 ${pagePreview} 页${more}`),
        el('div', { style: 'font-size:12.5px;' },
          `${scopeLabel}尚未开始。正文框可以排除页边、藏印、版框和无关区域，通常更适合 OCR 与插图候选检测。`)
      ),
      el('div', { style: 'font-size:13px; color:var(--c-text-soft);' },
        '建议先设置全书统一正文框。若当前书页无法统一框选，也可以仅在本次任务中使用原始整页；系统仍从原 PDF 渲染长边 1700px，不使用缩略图，并会把该页记录为 full_page 降级输入。')
    );
    const modal = el('div', { class: 'modal', style: 'max-width:610px;' },
      el('div', { class: 'modal-head' },
        el('h3', null, '扫描前需要确认图像范围'),
        el('button', { class: 'modal-close', onclick: () => finish('cancel') }, '×')
      ),
      body,
      el('div', { class: 'modal-foot', style: 'flex-wrap:wrap;' },
        el('button', { class: 'btn', onclick: () => finish('cancel') }, '取消'),
        el('button', { class: 'btn', onclick: () => finish('full_page') }, '仅本次使用原始整页'),
        el('button', { class: 'btn primary', onclick: () => finish('setup') }, '去设置统一正文框')
      )
    );
    const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) finish('cancel'); } }, modal);
    $('#overlay-root').appendChild(scrim);
  });
}

async function chooseScanInputPolicy(book, pages, scopeLabel) {
  const missing = pagesMissingScanContentRect(book, pages);
  if (!missing.length) return { allowFullPage: false, missingPages: [] };
  const choice = await openMissingContentRectGate(book, missing, scopeLabel);
  if (choice === 'setup') {
    const page = missing[0];
    state.bookTemplateBookId = book.id;
    state.bookTemplatePageNum = page.pageNum;
    state.bookTemplateEditing = true;
    state.bookPanelCollapsed = state.bookPanelCollapsed || {};
    state.bookPanelCollapsed[`${book.id}_prep`] = false;
    openGallery(book.id, 'pages', page.pageNum);
    toast('已打开书籍预处理并展开“统一剪裁规格”。请拖动或拉角设置正文框，完成后再开始扫描。', 'info');
    return null;
  }
  if (choice !== 'full_page') return null;
  return { allowFullPage: true, missingPages: missing.map(page => Number(page.pageNum)) };
}

function buildScanReadingContext(book) {
  const traits = getBookTraits(book) || {};
  return {
    text_direction: traits.textDirection || '不明',
    title_label_direction: traits.titleLabelDirection || '不明',
    page_order: traits.pageOrder === 'ltr' ? '从左到右' : '从右到左',
    reading_note: extractOperationalReadingNote(traits.readingNote || ''),
  };
}

function computeScanDirectionWarnings(readingContext, detectedTextDirection, detectedTitleDirection) {
  const warnings = [];
  const expectedText = normalizeDirectionValue(readingContext?.text_direction);
  const expectedTitle = normalizeDirectionValue(readingContext?.title_label_direction);
  const detectedText = normalizeDirectionValue(detectedTextDirection) || '不明';
  const detectedTitle = normalizeDirectionValue(detectedTitleDirection) || '不明';
  if (expectedText && expectedText !== '不明' && detectedText !== '不明' && detectedText !== expectedText) {
    warnings.push(`正文方向冲突：书级=${expectedText}，页面识别=${detectedText}`);
  }
  if (expectedTitle && expectedTitle !== '不明' && detectedTitle !== '不明' && detectedTitle !== expectedTitle) {
    warnings.push(`题签方向冲突：书级=${expectedTitle}，页面识别=${detectedTitle}`);
  }
  return warnings;
}

async function renderScanPageInput(doc, book, page, {
  maxLong = SCAN_CONTENT_LONG_SIDE,
  allowFullPage = false,
} = {}) {
  const resolved = resolveScanInputRegion(book, page, { allowFullPage });
  if (!resolved) {
    throw new Error('缺少统一正文框；请先在书籍预处理设置正文/版心范围');
  }
  const { rect, region } = resolved;
  // 首选服务端从原始页图（PDF 渲染缓存或图片书逻辑页）裁取正文框；
  // PDF 缓存失败时才以同一正文框走 pdf.js，不允许静默退回整页缩略图。
  const hi = await cropFromHiRes(book, page, rect, maxLong);
  if (hi) {
    return {
      dataUrl: hi,
      rect,
      region,
      renderer: doc ? 'server_original_pdf' : 'server_imported_image',
    };
  }

  if (!doc) {
    throw new Error('该页原始页图不可读取；请检查图片书源文件是否完整');
  }
  const pdfPage = await doc.getPage(pdfPageOf(page));
  const viewport = pdfPage.getViewport({ scale: 1 });
  const cropWidth = (rect[2] - rect[0]) * viewport.width;
  const cropHeight = (rect[3] - rect[1]) * viewport.height;
  const targetWidth = Math.max(1, maxLong * cropWidth / Math.max(cropWidth, cropHeight));
  const dataUrl = await renderPageRectDataUrl(doc, pdfPageOf(page), rect, targetWidth, 0.9);
  return { dataUrl, rect, region, renderer: 'pdfjs_original_pdf' };
}

async function scanBookPages(book, targetPages, {
  force = false,
  mode = 'full',
  scopeLabel = 'AI 全书扫描',
  emptyMessage = '',
} = {}) {
  if (!book) return;
  if (bookDetectJobs[book.id]?.running || selectedPageOcrJobs[book.id]?.running) {
    toast('该书已有页面扫描任务正在运行，请等待完成或请求停止。', 'warn');
    return;
  }

  const allPages = uniqueSortedBookPages(book, targetPages && targetPages.length ? targetPages : getBookPages(book));
  const pages = force
    ? allPages
    : allPages.filter(p => !p.textAsset?.fullScanDone || p.textAsset?.scanInputVersion !== SCAN_INPUT_VERSION);

  if (!pages.length) {
    toast(emptyMessage || '目标页面已完成扫描，如需重跑请使用"重新扫描"', 'info'); return;
  }

  const inputPolicy = await chooseScanInputPolicy(book, pages, scopeLabel);
  if (!inputPolicy) return;

  if (!(await guardVisionTask(scopeLabel, { book_id: book?.id || '', book_title: book?.title || '' }))) return;

  const doc = await ensurePdfDoc(book);
  if (!doc && !hasStoredPageScanSource(book)) {
    toast('该书既没有可读取的 PDF，也没有可读取的图片书原始页图', 'warn');
    return;
  }

  // 确定使用的 provider / model / key
  const KEY_MAP = { qwen:'qwenKey', openai:'openaiKey', kimi:'kimiKey',
    doubao:'doubaoKey', zhipu:'zhipuKey', gemini:'geminiKey', baidu:'baiduKey' };
  const MODEL_MAP = { qwen:config.qwenModel, openai:config.openaiModel, kimi:config.kimiModel,
    doubao:config.doubaoModel, zhipu:config.zhipuModel, gemini:config.geminiModel, baidu:config.baiduModel };
  const scanProvider = config.scanProvider || config.provider;
  const scanModel    = config.scanModel    || MODEL_MAP[scanProvider] || scanProvider;
  const apiKey       = config[KEY_MAP[scanProvider]] || '';

  if (scanProvider !== 'mock' && !apiKey) {
    toast(`${scopeLabel}：${scanProvider} 的 API Key 未配置，请前往设置填写`, 'error'); return;
  }
  if (scanProvider === 'deepseek') {
    toast('DeepSeek 不支持图像输入，请在设置中为扫描选择视觉模型', 'error'); return;
  }

  const _refreshScanView = () => {
    if (state.mainView === 'gallery' && state.currentBookId === book.id) {
      renderGalleryView();
      renderBookWorkspacePanel();
    }
  };

  const concurrency = Math.max(1, Math.min(20, Number(config.scanConcurrency) || 1));
  const job = {
    kind: 'book_page_scan',
    running: true,
    paused: false,
    cancelRequested: false,
    mode,
    scopeLabel,
    force,
    current: 0,
    total: pages.length,
    targetTotal: allPages.length,
    newIllust: 0,
    errors: 0,
    concurrency,
    startedAt: Date.now(),
  };
  bookDetectJobs[book.id] = job;
  toast(`开始${scopeLabel}，共 ${pages.length} 页，模型 ${scanModel}${concurrency > 1 ? `，并发 ${concurrency}` : ''}…`, 'info');
  _refreshScanView();

  try {
    let cursor = 0;
    const worker = async () => {
      while (true) {
        while (job.paused && job.running && !job.cancelRequested) {
          await new Promise(r => setTimeout(r, 400));
        }
        if (!job.running || job.cancelRequested) return;
        const i = cursor++;
        if (i >= pages.length) return;
        const page = pages[i];
        try {
          const scanInput = await renderScanPageInput(doc, book, page, inputPolicy);
          const dataUrl = scanInput.dataUrl;
          const pageb64 = dataUrl.split(',')[1] || '';
          const readingContext = buildScanReadingContext(book);
          const resp = await fetch(BRIDGE_SCAN_PAGE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              page_b64: pageb64,
              book_id: book.id,
              page_num: page.pageNum,
              provider: scanProvider,
              api_key: apiKey,
              model: scanModel,
              scan_input_version: SCAN_INPUT_VERSION,
              input_region: scanInput.region,
              input_long_side: SCAN_CONTENT_LONG_SIDE,
              content_rect: scanInput.rect,
              ...readingContext,
            }),
          });
          const data = await resp.json();
          if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
          if (!page.textAsset) page.textAsset = {};
          const ta = page.textAsset;
          ta.fullText    = data.full_text || '';
          ta.textSource  = 'ai_ocr';
          ta.textStatus  = ta.fullText.trim() ? (ta.verified ? 'reviewed' : 'extracted') : 'missing';
          ta.ocrModel    = data.model || scanModel;
          ta.extractedAt = ta.extractedAt || data.scanned_at || new Date().toISOString();
          ta.updatedAt   = new Date().toISOString();
          ta.fullScanDone = true;
          ta.scanInputVersion = SCAN_INPUT_VERSION;
          ta.scanInput = {
            region: scanInput.region,
            longSide: SCAN_CONTENT_LONG_SIDE,
            rect: [...scanInput.rect],
            renderer: scanInput.renderer,
            ...readingContext,
          };
          ta.detectedTextDirection = normalizeDirectionValue(data.detected_text_direction) || '不明';
          ta.detectedTitleLabelDirection = normalizeDirectionValue(data.detected_title_label_direction) || '不明';
          ta.scanWarnings = computeScanDirectionWarnings(
            readingContext, ta.detectedTextDirection, ta.detectedTitleLabelDirection);
          syncPageAssetIntoQueuedImages(book, page);
          if (data.has_illustration) {
            const illustNums = new Set(
              (Array.isArray(book.illustrationPages) ? book.illustrationPages : [])
                .map(p => Number(p.pageNum))
            );
            if (!illustNums.has(Number(page.pageNum))) {
              if (!Array.isArray(book.illustrationPages)) book.illustrationPages = [];
              page.confirmed = false;
              book.illustrationPages.push(page);
              book.illustrationPages.sort((a, b) => a.pageNum - b.pageNum);
              job.newIllust++;
            }
            page.hasMultipleIllustrations = !!data.has_multiple_illustrations;
            if (data.note) page.illustScanNote = data.note;
            page.illustConfidence = data.confidence || 'low';
          }
        } catch (e) {
          console.warn(`${scopeLabel}第 ${page.pageNum} 页失败:`, e);
          job.errors++;
        }
        job.current++;
        if (job.current % 3 === 0) _refreshScanView();
        if (job.current % 10 === 0) { markBookDirty(book.id); persist(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, () => worker()));
  } finally {
    job.running = false;
    job.cancelled = !!job.cancelRequested;
    job.finishedAt = new Date().toISOString();
    markBookDirty(book.id);
    persist();
    // 不再自动图文切割：AI 标注改为读「本页±N页窗口」并自挑 corresponding_text；
    // 自动切割是启发式（按相邻插图边界切），图组/混排/跨页易切错，且会作为"重点"误导模型，故取消。
    // 需要时仍可在审核台手动「合并所选页为关联段落」。
    persist();
    renderAll();
    const errMsg  = job.errors > 0 ? `，${job.errors} 页失败` : '';
    toast(`${scopeLabel}${job.cancelled ? '已停止' : '完成'}：OCR ${job.current} 页，新增插图 ${job.newIllust} 页${errMsg}`,
      job.errors > 0 ? 'warn' : 'success');
  }
}

async function runFullBookScan(book, { force = false } = {}) {
  return scanBookPages(book, getBookPages(book), {
    force,
    mode: 'full',
    scopeLabel: 'AI 全书扫描',
    emptyMessage: '所有页面已完成扫描，如需重跑请使用"重新扫描"',
  });
}

async function runSelectedBookScan(book, { force = false } = {}) {
  const pages = computeSelectedScanPages(book);
  if (!pages.length) {
    toast('请先在全页视图勾选要扫描的页面', 'warn');
    return;
  }
  return scanBookPages(book, pages, {
    force,
    mode: 'selected',
    scopeLabel: '选中页扫描',
    emptyMessage: '选中页面已完成扫描，如需重跑请使用"重新扫描选中"',
  });
}

async function runContextBookScan(book, { force = false } = {}) {
  const radius = Math.max(0, Math.min(10, Number(config.scanContextRadius) || 0));
  const pages = computeContextScanPages(book, { radius });
  if (!pages.length) {
    toast('请先选中作为中心的插图页或页面，再执行上下文扫描', 'warn');
    return;
  }
  return scanBookPages(book, pages, {
    force,
    mode: 'context',
    scopeLabel: `插图上下文补扫（±${radius}页）`,
    emptyMessage: '插图上下文范围内页面已完成扫描，如需重跑请使用"重新扫描上下文"',
  });
}

async function scanBookIllustrations(book, { force = false } = {}) {
  if (!book) return;
  if (bookDetectJobs[book.id]?.running || selectedPageOcrJobs[book.id]?.running) {
    toast('该书已有页面扫描任务正在运行，请等待完成或请求停止。', 'warn');
    return;
  }
  const doc = await ensurePdfDoc(book);
  if (!doc) { toast('该书 PDF 当前未加载，且没有可恢复的 PDF 文件', 'warn'); return; }
  const pages = getBookPages(book);
  if (!pages.length) { toast('当前书籍没有可扫描的页面', 'warn'); return; }

  const job = bookDetectJobs[book.id] = {
    running: true,
    current: 0,
    total: pages.length,
  };
  renderBooksList();
  if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();

  const detected = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      job.current = i + 1;
      try {
        const result = await analyzePage(doc, page.pageNum, getSensitivityThreshold(book));
        applyAnalyzeResultToPage(page, result, { allowClearCrop: force });
        page.imageScanSource = 'manual_scan';
        if (result.isIllust) {
          detected.push(page);
        }
      } catch (e) {
        console.warn('scan illustration failed', book.title, page.pageNum, e);
      }
      if ((i + 1) % 4 === 0 || i === pages.length - 1) {
        renderBooksList();
        if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } finally {
    job.running = false;
    job.finished = true;
    job.finishedAt = new Date().toISOString();
  }

  book.illustrationPages = detected;
  persist();
  await maybeSyncBookMeta(book);
  renderBooksList();
  if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
  toast(`识别完成：发现 ${detected.length} 处插图`, detected.length ? 'success' : 'warn');
}

const _extractTextInFlight = {};  // `${bookId}:${pageNum}` -> Promise
const _pageOcrCandidates = {};    // `${bookId}:${pageNum}` -> latest unaccepted OCR run

function getPageOcrTaskConfig(sourceConfig = config) {
  const provider = sourceConfig.scanProvider || sourceConfig.provider;
  const modelByProvider = {
    qwen: sourceConfig.qwenModel,
    openai: sourceConfig.openaiModel,
    deepseek: sourceConfig.deepseekModel,
    kimi: sourceConfig.kimiModel,
    doubao: sourceConfig.doubaoModel,
    zhipu: sourceConfig.zhipuModel,
    gemini: sourceConfig.geminiModel,
    baidu: sourceConfig.baiduModel,
  };
  return {
    provider,
    model: sourceConfig.scanModel || modelByProvider[provider] || provider,
    concurrency: Math.max(1, Math.min(20, Number(sourceConfig.scanConcurrency) || 1)),
  };
}

function normalizeOcrFailureMessage(error) {
  const raw = String(error?.message || error || '未知错误').replace(/\s+/g, ' ').trim();
  if (/127\.0\.0\.1[^\d]*7892|Unable to connect to proxy|ProxyError/i.test(raw)) {
    return '本机代理 127.0.0.1:7892 无法连接；请启动代理，或清除启动环境中的 HTTP_PROXY/HTTPS_PROXY 后重启标注系统';
  }
  if (/Read timed out|timeout=90|timed out/i.test(raw)) {
    return '模型接口 90 秒内未返回（网络或服务端超时）';
  }
  if (/UNEXPECTED_EOF|SSL|ConnectionReset|10054|强迫关闭/i.test(raw)) {
    return '模型接口连接被中途断开（SSL/网络连接异常）';
  }
  if (/API error 429|HTTP 429|rate.?limit/i.test(raw)) {
    return '模型接口限流（HTTP 429）；请降低扫描并发后重试';
  }
  return raw.slice(0, 240);
}

function summarizeOcrFailures(failures = []) {
  const groups = new Map();
  for (const failure of Array.isArray(failures) ? failures : []) {
    const pageNum = Number(failure?.pageNum);
    const reason = normalizeOcrFailureMessage(failure?.error || failure?.message || '未知错误');
    if (!groups.has(reason)) groups.set(reason, []);
    if (Number.isFinite(pageNum)) groups.get(reason).push(pageNum);
  }
  return [...groups.entries()].map(([reason, pages]) => ({
    reason,
    pages: [...new Set(pages)].sort((a, b) => a - b),
  }));
}

async function requestPageImageOcr(book, page, doc, inputPolicy = null) {
  const taskConfig = getPageOcrTaskConfig();
  const provider = taskConfig.provider;
  const KEY_MAP = { qwen:'qwenKey', openai:'openaiKey', deepseek:'deepseekKey', kimi:'kimiKey',
    doubao:'doubaoKey', zhipu:'zhipuKey', gemini:'geminiKey', baidu:'baiduKey' };
  if (provider === 'deepseek') {
    throw new Error('DeepSeek 官方当前未提供本项目所需的图像 OCR 接口。请切换到支持视觉输入的模型后再执行页面 OCR。');
  }

  const bridgeOk = await checkBridge();
  if (!bridgeOk) throw new Error('bridge.py 未启动，无法执行 AI OCR');

  const policy = inputPolicy || await chooseScanInputPolicy(book, [page], '页面 OCR');
  if (!policy) return null;
  const scanInput = await renderScanPageInput(doc, book, page, policy);
  const dataUrl = scanInput.dataUrl;
  const pageb64 = dataUrl.split(',')[1] || '';
  if (!pageb64) throw new Error('页面截图为空，无法执行 AI OCR');
  const readingContext = buildScanReadingContext(book);

  // 单页重OCR与全书扫描共用同一正文框和读向契约，避免两条链路产生不同顺序。
  const resp = await fetch(BRIDGE_SCAN_PAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page_b64: pageb64, book_id: book.id, page_num: page.pageNum,
      provider, api_key: config[KEY_MAP[provider]] || '', model: taskConfig.model,
      scan_input_version: SCAN_INPUT_VERSION,
      input_region: scanInput.region,
      input_long_side: SCAN_CONTENT_LONG_SIDE,
      content_rect: scanInput.rect,
      ...readingContext,
    })
  });
  let data = {};
  try { data = await resp.json(); } catch (e) {}
  if (!resp.ok || data.error) throw new Error(data.error || `OCR 失败（HTTP ${resp.status}）`);
  return {
    mode: 'ai_ocr',
    text: data.full_text || '',
    source: data.text_source || 'ai_ocr',
    model: data.model || '',
    provider,
    extractedAt: data.extracted_at || new Date().toISOString(),
    at: new Date().toISOString(),
    pageNum: page.pageNum,
    textLength: String(data.full_text || '').length,
    scanInputVersion: SCAN_INPUT_VERSION,
    scanInput: {
      region: scanInput.region, longSide: SCAN_CONTENT_LONG_SIDE,
      rect: [...scanInput.rect], renderer: scanInput.renderer, ...readingContext,
    },
    detectedTextDirection: normalizeDirectionValue(data.detected_text_direction) || '不明',
    detectedTitleLabelDirection: normalizeDirectionValue(data.detected_title_label_direction) || '不明',
  };
}

function pageOcrCandidateKey(book, page) {
  return `${book?.id || ''}:${Number(page?.pageNum) || ''}`;
}

function renderPageOcrCandidatePanel(book, page, run) {
  if (!book || !page || !run) return null;
  const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } }) || {};
  const oldText = String(ta.fullText || '');
  const newText = String(run.text || '');
  const delta = newText.length - oldText.length;
  const newEmpty = !newText.trim();
  const hasManual = hasManualCorrectedText(ta) || ta.verified || ta.textStatus === 'reviewed';
  const key = pageOcrCandidateKey(book, page);
  const deltaClass = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
  const deltaLabel = delta === 0 ? '字数无变化' : `${delta > 0 ? '+' : ''}${delta} 字`;
  const runWarnings = computeScanDirectionWarnings(
    run.scanInput || buildScanReadingContext(book),
    run.detectedTextDirection,
    run.detectedTitleLabelDirection,
  );
  const notice = newEmpty
    ? '新 OCR 返回为空，不能采用。请检查 bridge.py、模型配置或正文框。'
    : hasManual
      ? '新 OCR 已生成。采用后只更新 OCR 底稿 fullText，不覆盖人工 correctedText；人工校文仍优先显示。'
      : '新 OCR 已生成。请对照左侧原书页面确认后采用，或放弃本次结果。';

  const acceptBtn = el('button', {
    class: 'btn primary',
    ...(newEmpty ? { disabled: '' } : {}),
    onclick: () => {
      const targetTa = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } });
      applyOcrRunToTextAsset(targetTa, run, { resetManualProof: false });
      delete _pageOcrCandidates[key];
      syncPageAssetIntoQueuedImages(book, page);
      markBookDirty(book.id);
      persist(book.id);
      const keepNote = hasManualCorrectedText(targetTa) ? '；人工校文仍优先显示' : '';
      toast(`第 ${page.pageNum} 页已采用新 OCR 底稿（${run.textLength || 0} 字）${keepNote}`, 'success');
      refreshPageDetailWorkspace(book.id, page.pageNum);
    },
  }, '采用新 OCR 底稿');

  return el('div', { class: 'ocr-rerun-inline' },
    el('div', { class: 'ocr-rerun-inline-head' },
      el('strong', null, `第 ${page.pageNum} 页新 OCR 候选`),
      el('button', {
        class: 'btn',
        onclick: () => {
          delete _pageOcrCandidates[key];
          toast('已放弃本次 OCR 结果，原底稿未改变', 'info');
          refreshPageDetailWorkspace(book.id, page.pageNum);
        },
      }, '放弃')
    ),
    el('div', { class: 'ocr-rerun-notice' + (newEmpty ? ' error' : '') }, notice),
    el('div', {
      class: 'ocr-rerun-notice' + (runWarnings.length ? ' error' : ''),
    }, `阅读顺序：正文 ${run.detectedTextDirection || '不明'} · 题签 ${run.detectedTitleLabelDirection || '不明'}${runWarnings.length ? `；⚠ ${runWarnings.join('；')}` : ''}`),
    el('div', { class: 'ocr-rerun-stats' },
      el('span', null, `旧底稿 ${oldText.length} 字`),
      el('span', null, `新 OCR ${newText.length} 字`),
      el('span', { class: deltaClass }, deltaLabel),
      el('span', null, `模型 ${run.model || '—'}`),
      el('span', null, run.provider ? `提供商 ${run.provider}` : '图像 OCR'),
      hasManual ? el('span', { class: 'warn' }, '已有人工校文') : null
    ),
    el('label', { class: 'ocr-rerun-inline-text' },
      el('span', null, '新图像 OCR'),
      el('textarea', { readonly: '' }, newText)
    ),
    el('div', { class: 'ocr-rerun-inline-actions' },
      acceptBtn
    )
  );
}

async function extractTextForPage(book, page, {
  force = false,
  refreshCrop = false,
  pdfOnly = false,
  forceOcr = false,
  resetManualProof = force,
  scanInputPolicy = null,
} = {}) {
  const doc = await ensurePdfDoc(book);
  if (!doc && !hasStoredPageScanSource(book)) {
    throw new Error('该书既没有可读取的 PDF，也没有可读取的图片书原始页图');
  }
  const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } });
  if (!ta) throw new Error('页面文字资产初始化失败');

  if (refreshCrop) {
    try {
      const region = await analyzePage(doc, pdfPageOf(page), getSensitivityThreshold(book));
      applyAnalyzeResultToPage(page, region);
      page.imageScanSource = 'ocr_refresh';
    } catch (e) {
      console.warn('refresh crop failed', page.pageNum, e);
    }
  }

  if (!force && (ta.fullText || '').trim()) {
    syncPageAssetIntoQueuedImages(book, page);
    return { mode: 'skipped' };
  }

  // 并发去重：同一页若已有进行中的请求，复用同一个 Promise
  const cacheKey = `${book.id}:${page.pageNum}`;
  if (!force && _extractTextInFlight[cacheKey]) {
    return _extractTextInFlight[cacheKey];
  }

  const doExtract = async () => {
    if (!forceOcr && doc) {
      const pdfPage = await doc.getPage(pdfPageOf(page));
      const tc = await pdfPage.getTextContent();
      const rawText = tc.items.map(it => it.str).join('').replace(/\s+/g, ' ').trim();
      if (rawText) {
        ta.fullText = rawText;
        ta.textSource = 'pdf_text_layer';
        ta.ocrModel = '';
        ta.extractedAt = ta.extractedAt || new Date().toISOString();
        ta.updatedAt = new Date().toISOString();
        if (resetManualProof) resetTextAssetManualProofAfterOcr(ta);
        ta.textStatus = ta.verified ? 'reviewed' : 'extracted';
        syncPageAssetIntoQueuedImages(book, page);
        return { mode: 'pdf_text_layer', textLength: rawText.length };
      }
    }

    if (pdfOnly) {
      ta.textStatus = ta.textStatus || 'missing';
      ta.updatedAt = new Date().toISOString();
      return { mode: 'no_text_layer' };
    }

    const run = await requestPageImageOcr(book, page, doc, scanInputPolicy);
    if (!run) return { mode: 'cancelled' };
    if (!String(run.text || '').trim()) {
      return { mode: 'ai_ocr_empty', textLength: 0, run };
    }
    applyOcrRunToTextAsset(ta, run, { resetManualProof });
    syncPageAssetIntoQueuedImages(book, page);
    return { mode: 'ai_ocr', textLength: ta.fullText.length, run };
  };

  const promise = doExtract();
  if (!force) _extractTextInFlight[cacheKey] = promise;
  try {
    return await promise;
  } finally {
    if (_extractTextInFlight[cacheKey] === promise) delete _extractTextInFlight[cacheKey];
  }
}

function getBookAllPagesTextStats(book) {
  const pages = Array.isArray(book?.pages) ? book.pages : [];
  let withText = 0, missing = 0, reviewed = 0;
  for (const p of pages) {
    const ta = p.textAsset || {};
    if (ta.textStatus === 'reviewed') { reviewed++; withText++; }
    else if (getEffectivePageText(ta)) withText++;
    else missing++;
  }
  return { total: pages.length, withText, missing, reviewed };
}

async function runBookFullTextScan(book) {
  if (!book || bookTextScanJobs[book.id]?.running) return;
  const pages = Array.isArray(book.pages) ? book.pages : [];
  if (!pages.length) { toast('该书暂无页面数据', 'warn'); return; }
  const doc = await ensurePdfDoc(book);
  if (!doc) { toast('该书 PDF 当前未加载', 'warn'); return; }

  const job = bookTextScanJobs[book.id] = {
    running: true, finished: false,
    current: 0, total: pages.length,
    updated: 0, skipped: 0,
  };
  if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();

  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      job.current = i + 1;
      try {
        const res = await extractTextForPage(book, page, { force: false, refreshCrop: false, pdfOnly: true });
        if (res.mode === 'skipped' || res.mode === 'pdf_text_layer') job.updated++;
        else job.skipped++;
      } catch (e) {
        console.warn('text scan failed', page.pageNum, e);
        job.skipped++;
      }
      if ((i + 1) % 5 === 0 || i === pages.length - 1) {
        persist();
        if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } finally {
    job.running = false;
    job.finished = true;
    persist();
    if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
  }
  const stats = getBookAllPagesTextStats(book);
  toast(`文字层扫描完成：${stats.withText} 页有文字，${stats.missing} 页仍无文字`, 'success');
}

async function runSelectedPagesOcr(book, pageNums, {
  force = true,
  forceOcr = true,
  refreshCrop = false,
  onProgress = null,
} = {}) {
  if (!book) return { updated: 0, skipped: 0, failed: 0, total: 0 };
  if (selectedPageOcrJobs[book.id]?.running || bookDetectJobs[book.id]?.running) {
    toast('该书已有页面扫描任务正在运行，请等待完成或请求停止。', 'warn');
    return { ...(selectedPageOcrJobs[book.id] || {}), alreadyRunning: true };
  }
  const normalized = [...new Set((Array.isArray(pageNums) ? pageNums : [])
    .map(n => Number(n))
    .filter(Number.isFinite))]
    .sort((a, b) => a - b);
  if (!normalized.length) return { updated: 0, skipped: 0, failed: 0, total: 0 };
  const selectedPages = normalized.map(n => getBookPageRecord(book, n)).filter(Boolean);
  const scanInputPolicy = await chooseScanInputPolicy(book, selectedPages, '页面 OCR');
  if (!scanInputPolicy) return { updated: 0, skipped: 0, failed: 0, total: normalized.length, cancelled: true };
  if (!(await guardVisionTask('页面 OCR', {
    book_id: book?.id || '',
    book_title: book?.title || '',
    page_nums: normalized,
  }))) return { updated: 0, skipped: 0, failed: 0, total: normalized.length, cancelled: true };
  // 任务书 §5.2：批量 OCR 前自动备份（best-effort）
  await dataCenterAutoBackup('before_bulk_ocr');
  const doc = await ensurePdfDoc(book);
  if (!doc && !hasStoredPageScanSource(book)) {
    throw new Error('该书既没有可读取的 PDF，也没有可读取的图片书原始页图');
  }
  const taskConfig = getPageOcrTaskConfig();

  const job = selectedPageOcrJobs[book.id] = {
    kind: 'selected_page_ocr',
    running: true,
    finished: false,
    cancelRequested: false,
    current: 0,
    total: normalized.length,
    currentPageNum: null,
    activePageNums: [],
    updated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    targetPageNums: [...normalized],
    provider: taskConfig.provider,
    model: taskConfig.model,
    concurrency: Math.min(taskConfig.concurrency, normalized.length),
    startedAt: Date.now(),
  };
  const reportProgress = () => {
    onProgress?.({ ...job });
    renderBooksList();
    if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
  };
  const result = {
    updated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    failedPageNums: [],
    total: normalized.length,
    cancelled: false,
  };
  reportProgress();

  try {
    let cursor = 0;
    const worker = async () => {
      while (true) {
        if (job.cancelRequested) {
          result.cancelled = true;
          return;
        }
        const index = cursor++;
        if (index >= normalized.length) return;
        const pageNum = normalized[index];
        const page = getBookPageRecord(book, pageNum);
        job.currentPageNum = pageNum;
        job.activePageNums = [...job.activePageNums, pageNum].sort((a, b) => a - b);
        reportProgress();
        try {
          if (!page) throw new Error('页面记录不存在');
          const res = await extractTextForPage(book, page, {
            force,
            forceOcr,
            refreshCrop,
            resetManualProof: false,
            scanInputPolicy,
          });
          if (res.mode === 'cancelled') {
            result.cancelled = true;
            job.cancelRequested = true;
          } else if (res.mode === 'skipped' || res.mode === 'ai_ocr_empty') {
            result.skipped++;
          } else {
            result.updated++;
          }
          if (page?.textAsset) delete page.textAsset.lastOcrFailure;
        } catch (error) {
          const message = normalizeOcrFailureMessage(error);
          console.warn('selected page OCR failed', book.title, pageNum, error);
          result.failed++;
          const failure = { pageNum, error: message, at: new Date().toISOString() };
          result.failures.push(failure);
          result.failedPageNums.push(pageNum);
          if (page) {
            page.textAsset = page.textAsset || {};
            page.textAsset.updatedAt = failure.at;
            page.textAsset.lastOcrFailure = failure;
          }
        } finally {
          job.activePageNums = job.activePageNums.filter(value => value !== pageNum);
          job.current++;
          job.updated = result.updated;
          job.skipped = result.skipped;
          job.failed = result.failed;
          job.failures = [...result.failures];
          persist(book.id);
          refreshPageDetailWorkspace(book.id, pageNum);
          reportProgress();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    };
    await Promise.all(Array.from({ length: job.concurrency }, () => worker()));
  } finally {
    job.running = false;
    job.finished = true;
    job.cancelled = result.cancelled;
    job.currentPageNum = null;
    job.activePageNums = [];
    job.completedAt = Date.now();
    job.updated = result.updated;
    job.skipped = result.skipped;
    job.failed = result.failed;
    job.failures = [...result.failures];
    // 只保存任务诊断元数据，不写入标注字段；刷新页面后仍可查看原因并重试失败页。
    book.lastSelectedPageOcrJob = {
      kind: job.kind,
      running: false,
      finished: true,
      cancelled: !!job.cancelled,
      current: job.current,
      total: job.total,
      updated: job.updated,
      skipped: job.skipped,
      failed: job.failed,
      failures: [...job.failures],
      targetPageNums: [...job.targetPageNums],
      provider: job.provider,
      model: job.model,
      concurrency: job.concurrency,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
    persist(book.id);
    reportProgress();
  }
  return result;
}

function openPageReocrReviewModal(book, page, run) {
  return new Promise(resolve => {
    const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } }) || {};
    const oldText = String(ta.fullText || '');
    const newText = String(run?.text || '');
    const hasManual = hasManualCorrectedText(ta) || ta.verified || ta.textStatus === 'reviewed';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      scrim.remove();
      resolve(value);
    };

    const newEmpty = !newText.trim();
    const diff = newText.length - oldText.length;
    const diffLabel = diff === 0 ? '±0' : (diff > 0 ? `+${diff}` : `${diff}`);
    const stat = el('div', { class: 'ocr-rerun-stats' },
      el('span', null, `旧底稿 ${oldText.length} 字`),
      el('span', null, `新 OCR ${newText.length} 字`),
      el('span', { class: diff === 0 ? '' : (diff > 0 ? 'up' : 'down') }, `差值 ${diffLabel}`),
      el('span', null, `模型 ${run?.model || '—'}`),
      el('span', null, run?.provider ? `提供商 ${run.provider}` : '图像 OCR'),
      el('span', null, `时间 ${fmtDate(run?.at || new Date().toISOString())}`),
      el('span', { class: hasManual ? 'warn' : '' }, hasManual ? '本页已有人工校文' : '本页无人工校文')
    );
    const notice = newEmpty
      ? '新 OCR 返回空文本，无法采用。请检查桥接服务是否运行、当前模型是否支持图像输入、以及正文框是否覆盖到文字区域。'
      : (hasManual
        ? '该页已有人工校文；采用新 OCR 只更新 OCR 底稿 fullText，不会覆盖 correctedText，校文仍优先显示。'
        : '采用后会把新 OCR 写入底稿 fullText；之后可继续人工校文。');
    const body = el('div', { class: 'modal-body ocr-rerun-modal-body' },
      el('div', { class: 'ocr-rerun-notice' + (newEmpty ? ' error' : '') }, notice),
      stat,
      el('div', { class: 'ocr-rerun-compare' },
        el('label', null,
          el('span', null, '旧 OCR 底稿'),
          el('textarea', { readonly: '' }, oldText || '（无）')
        ),
        el('label', null,
          el('span', null, '新图像 OCR'),
          el('textarea', { readonly: '' }, newText || '（空）')
        )
      )
    );
    const acceptBtn = el('button', {
      class: 'btn primary',
      ...(newEmpty ? { disabled: '', title: '新 OCR 为空，无法采用' } : {}),
      onclick: () => { if (newEmpty) return; finish(true); },
    }, '采用新 OCR 底稿');
    const modal = el('div', { class: 'modal', style: 'max-width:980px;' },
      el('div', { class: 'modal-head' },
        el('h3', null, `确认第 ${page.pageNum} 页重新 OCR`),
        el('button', { class: 'modal-close', onclick: () => finish(false) }, '×'),
      ),
      body,
      el('div', { class: 'modal-foot' },
        el('button', { class: 'btn', onclick: () => finish(false) }, '放弃'),
        acceptBtn,
      ),
    );
    const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) finish(false); } }, modal);
    $('#overlay-root').appendChild(scrim);
  });
}

// L1：OCR 历史查看 + 恢复为某次 OCR 底稿（仍不覆盖 correctedText）
function restoreOcrRun(book, page, run) {
  const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } });
  if (!ta || !run) return;
  const text = String(run.text || '');
  applyOcrRunToTextAsset(ta, {
    text,
    source: run.source || 'ocr_restore',
    model: run.model || '',
    provider: run.provider || '',
    extractedAt: run.at || new Date().toISOString(),
    at: new Date().toISOString(),
    pageNum: page.pageNum,
    mode: 'restore',
    textLength: text.length,
  }, { resetManualProof: false });
  syncPageAssetIntoQueuedImages(book, page);
  markBookDirty(book.id);
  persist(book.id);
  const keepNote = hasManualCorrectedText(ta) ? '；人工校文仍优先显示' : '';
  toast(`已恢复该页 OCR 底稿（${text.length} 字）${keepNote}`, 'success');
  refreshPageDetailWorkspace(book.id, page.pageNum);
}

function openOcrHistoryModal(book, page) {
  const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } }) || {};
  const runs = Array.isArray(ta.ocrRuns) ? ta.ocrRuns : [];
  const close = () => scrim.remove();
  const list = el('div', { class: 'ocr-history-list' });
  if (!runs.length) {
    list.appendChild(el('div', { class: 'ocr-history-empty' },
      '暂无 OCR 历史。点击“重新 OCR”并采用一次后，这里会记录每次底稿。'));
  } else {
    runs.slice(0, 10).forEach((r, i) => {
      const rText = String(r.text || '');
      const isCurrent = i === 0 && rText === String(ta.fullText || '');
      const row = el('div', { class: 'ocr-history-row' },
        el('div', { class: 'ocr-history-row-head' },
          el('span', { class: 'ocr-history-when' }, fmtDate(r.at)),
          el('span', null, `${Number.isFinite(r.charCount) ? r.charCount : rText.length} 字`),
          el('span', null, r.model || r.mode || r.source || 'ocr'),
          isCurrent ? el('span', { class: 'ocr-history-cur' }, '当前底稿') : null,
        ),
        el('pre', { class: 'ocr-history-text' }, rText ? rText.slice(0, 400) : '（空）'),
        el('div', { class: 'ocr-history-actions' },
          el('button', {
            class: 'btn',
            ...(isCurrent ? { disabled: '' } : {}),
            onclick: () => { restoreOcrRun(book, page, r); close(); },
          }, isCurrent ? '已是当前底稿' : '恢复为此 OCR 底稿'),
        ),
      );
      list.appendChild(row);
    });
  }
  const modal = el('div', { class: 'modal', style: 'max-width:760px;' },
    el('div', { class: 'modal-head' },
      el('h3', null, `第 ${page.pageNum} 页 OCR 历史（最多保留 20 条）`),
      el('button', { class: 'modal-close', onclick: close }, '×'),
    ),
    el('div', { class: 'modal-body' }, list),
    el('div', { class: 'modal-foot' }, el('button', { class: 'btn', onclick: close }, '关闭')),
  );
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } }, modal);
  $('#overlay-root').appendChild(scrim);
}

function openPageOcrModal(book, currentPageNum, {
  allowedPageNums = null,
  initialPageNums = null,
  title = '批量重新 OCR',
  selectionHint = '',
} = {}) {
  if (!providerSupportsVisionTasks()) {
    guardVisionTask('页面 OCR', {
      book_id: book?.id || '',
      book_title: book?.title || '',
      page_num: currentPageNum || null,
      entry: 'openPageOcrModal',
    });
    return;
  }
  const allPageNums = getBookPages(book).map(p => Number(p.pageNum));
  const allowed = Array.isArray(allowedPageNums)
    ? new Set(allowedPageNums.map(n => Number(n)).filter(Number.isFinite))
    : null;
  const pageNums = allowed ? allPageNums.filter(pn => allowed.has(pn)) : allPageNums;
  if (!pageNums.length) {
    toast('没有可重新 OCR 的页面', 'warn');
    return;
  }
  const initial = Array.isArray(initialPageNums) ? initialPageNums : [currentPageNum];
  const selected = new Set(initial
    .map(n => Number(n))
    .filter(pn => pageNums.includes(pn)));
  if (!selected.size) selected.add(pageNums[0]);
  let running = false;

  const body = el('div', { class: 'modal-body' });
  const countEl = el('div', { style: 'font-size:12px; color:var(--c-text-soft); margin-bottom:10px;' });
  const list = el('div', {
    style: 'max-height:360px; overflow:auto; border:1px solid var(--c-border); border-radius:8px; background:#fff; padding:8px;'
  });
  const rowCheckboxes = new Map();

  const refreshCount = () => {
    countEl.textContent = `已选 ${selected.size} 页`;
  };

  for (const pn of pageNums) {
    const page = getBookPageRecord(book, pn);
    const ta = page?.textAsset || {};
    const textLabel = ta.textStatus === 'reviewed' || ta.verified ? '已核对'
      : getEffectivePageText(ta) ? (ta.correctedText ? '已修订' : '已提取') : '缺失';
    const checkbox = el('input', {
      type: 'checkbox',
      ...(selected.has(pn) ? { checked: '' } : {}),
      onchange: (e) => {
        if (e.target.checked) selected.add(pn);
        else selected.delete(pn);
        refreshCount();
      }
    });
    rowCheckboxes.set(pn, checkbox);
    const row = el('label', {
      style: 'display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 10px; border-radius:6px; cursor:pointer;'
    },
      el('span', { style: 'display:inline-flex; align-items:center; gap:8px;' },
        checkbox,
        el('span', null, `第 ${pn} 页`)
      ),
      el('span', { style: 'font-size:12px; color:var(--c-text-mute);' }, textLabel)
    );
    list.appendChild(row);
  }
  const renderListSelection = () => {
    rowCheckboxes.forEach((checkbox, pn) => { checkbox.checked = selected.has(pn); });
  };
  refreshCount();

  body.appendChild(el('div', { style: 'padding:10px 12px; border:1px solid #d6e3ef; border-radius:8px; background:#f5f9fc; font-size:13px; color:#38556f; line-height:1.8; margin-bottom:8px;' },
    (selectionHint ? `${selectionHint} ` : '') + '所选页面将重新执行图像 OCR，并在结果非空时直接更新 OCR 底稿；旧 OCR 自动保留在“OCR 历史”。已有人工校正文不会被覆盖，也不需要逐页再确认。'));
  body.appendChild(countEl);
  const progressEl = el('div', {
    style: 'display:none; padding:8px 10px; margin:0 0 10px; border-radius:6px; background:#edf6fc; color:#245878; font-size:12.5px; font-weight:600;',
    role: 'status', 'aria-live': 'polite',
  });
  body.appendChild(progressEl);
  const quickSelect = el('div', { style: 'display:flex; gap:8px; margin:0 0 10px;' });
  quickSelect.appendChild(el('button', {
    class: 'btn', style: 'font-size:12px;',
    onclick: () => { pageNums.forEach(pn => selected.add(pn)); refreshCount(); renderListSelection(); },
  }, '全选'));
  quickSelect.appendChild(el('button', {
    class: 'btn', style: 'font-size:12px;',
    onclick: () => {
      selected.clear();
      pageNums.forEach(pn => {
        const ta = getBookPageRecord(book, pn)?.textAsset || {};
        if (!(ta.verified || ta.textStatus === 'reviewed' || String(ta.correctedText || '').trim())) selected.add(pn);
      });
      refreshCount(); renderListSelection();
    },
  }, '仅未人工校文'));
  body.appendChild(quickSelect);
  body.appendChild(list);

  const submitBtn = el('button', { class: 'btn primary' }, '重新 OCR 并直接采用');
  const cancelBtn = el('button', { class: 'btn', onclick: close }, '取消');
  const updateProgress = (job) => {
    const total = Math.max(1, Number(job?.total) || selected.size || 1);
    const current = Math.min(total, Math.max(0, Number(job?.current) || 0));
    const detail = `第 ${job?.currentPageNum || current || 1} 页（${current}/${total}）· 已采用 ${job?.updated || 0} · 空结果 ${job?.skipped || 0} · 失败 ${job?.failed || 0}`;
    progressEl.style.display = 'block';
    progressEl.textContent = `正在 OCR：${detail}`;
    submitBtn.textContent = `OCR中 ${current}/${total}`;
  };
  submitBtn.onclick = async () => {
    if (running) return;
    if (!selected.size) {
      toast('请至少选择一页', 'warn');
      return;
    }
    running = true;
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    updateProgress({ current: 0, total: selected.size });
    try {
      const res = await runSelectedPagesOcr(book, [...selected], {
        force: true,
        forceOcr: true,
        refreshCrop: false,
        onProgress: updateProgress,
      });
      toast(res.cancelled
        ? `批量 OCR 已停止：已采用 ${res.updated} 页，空结果跳过 ${res.skipped} 页，失败 ${res.failed} 页`
        : `批量 OCR 完成：已采用 ${res.updated} 页，空结果跳过 ${res.skipped} 页，失败 ${res.failed} 页`,
      res.failed ? 'warn' : 'success');
      close();
    } catch (e) {
      toast(`页面OCR失败：${e.message}`, 'error');
      running = false;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      submitBtn.textContent = '开始OCR';
    }
  };

  const modal = el('div', { class: 'modal' },
    el('div', { class: 'modal-head' },
      el('h3', null, title),
      el('button', { class: 'modal-close', onclick: () => { if (!running) close(); } }, '×'),
    ),
    body,
    el('div', { class: 'modal-foot' },
      cancelBtn,
      submitBtn,
    ),
  );
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim && !running) close(); } }, modal);
  $('#overlay-root').appendChild(scrim);
  function close() { scrim.remove(); }
}

function openRectActionsModal(book, page) {
  const body = el('div', { class: 'modal-body', style: 'display:grid; gap:14px;' });

  body.appendChild(el('div', { class: 'toolbar-more-row' },
    el('label', null, '版心(AI)'),
    el('button', {
      class: 'btn' + (state.pageRectEditing && state.pageRectTarget !== 'crop' ? ' primary' : ''),
      onclick: () => {
        state.pageDetailMode = 'page';
        if (state.pageRectEditing && state.pageRectTarget !== 'crop') { state.pageRectEditing = false; }
        else { state.pageRectEditing = true; state.pageRectTarget = 'content'; }
        persist();
        close();
        refreshPageDetailWorkspace(book.id, page.pageNum);
        if (state.pageRectEditing) toast('请在上方页面图像中拖拽框选正文区域（版心，供 AI 识别）', 'success');
      }
    }, (state.pageRectEditing && state.pageRectTarget !== 'crop') ? '完成 / 继续微调' : '开始框选正文区域')
  ));

  body.appendChild(el('div', { class: 'toolbar-more-row' },
    el('label', null, '插图(展示)'),
    el('button', {
      class: 'btn' + (state.pageRectEditing && state.pageRectTarget === 'crop' ? ' primary' : ''),
      onclick: () => {
        state.pageDetailMode = 'page';
        if (state.pageRectEditing && state.pageRectTarget === 'crop') { state.pageRectEditing = false; }
        else { state.pageRectEditing = true; state.pageRectTarget = 'crop'; }
        persist();
        close();
        refreshPageDetailWorkspace(book.id, page.pageNum);
        if (state.pageRectEditing) toast('请在上方页面图像中拖拽框选插图区域（只圈插图本体，供成果/审核展示）', 'success');
      }
    }, (state.pageRectEditing && state.pageRectTarget === 'crop') ? '完成 / 继续微调' : '开始框选插图区域')
  ));

  body.appendChild(el('div', { class: 'toolbar-more-row' },
    el('label', null, '统一规格'),
    el('button', {
      class: 'btn',
      disabled: page.contentRect ? null : '',
      onclick: () => {
        if (!page.contentRect) {
          toast('请先为当前页设置正文框', 'warn');
          return;
        }
        setBookContentRectTemplate(book, page.contentRect, page.pageNum);
        toast(`已将第 ${page.pageNum} 页正文框设为全书统一规格`, 'success');
        close();
        refreshPageDetailWorkspace(book.id, page.pageNum);
      }
    }, '设为全书统一规格')
  ));

  body.appendChild(el('div', { class: 'toolbar-more-row' },
    el('label', null, '批量应用'),
    el('div', { class: 'ta-actions', style: 'margin-top:0;' },
      el('button', {
        class: 'btn',
        disabled: page.contentRect ? null : '',
        onclick: async () => {
          await applyContentRectBatch(book, page, 'queued');
          close();
          refreshPageDetailWorkspace(book.id, page.pageNum);
        }
      }, '套用到待标注页'),
      el('button', {
        class: 'btn',
        disabled: page.contentRect ? null : '',
        onclick: async () => {
          await applyContentRectBatch(book, page, 'book');
          close();
          refreshPageDetailWorkspace(book.id, page.pageNum);
        }
      }, '套用到全书页')
    )
  ));

  body.appendChild(el('div', { class: 'toolbar-more-row' },
    el('label', null, '清理'),
    el('button', {
      class: 'btn',
      disabled: page.contentRect ? null : '',
      onclick: () => {
        page.contentRect = null;
        page.forceContentRect = false;
        page.contentThumb = '';
        page.contentThumbHi = '';
        syncPageAssetIntoQueuedImages(book, page);
        persist();
        close();
        refreshPageDetailWorkspace(book.id, page.pageNum);
        toast(`已清除第 ${page.pageNum} 页正文框`, 'success');
      }
    }, '清除正文框')
  ));

  body.appendChild(el('div', { class: 'toolbar-more-row' },
    el('label', null, '清理'),
    el('button', {
      class: 'btn',
      disabled: page.cropRect ? null : '',
      onclick: () => {
        page.cropRect = null;
        page.cropQuad = null;
        page.forceCropRect = false;
        page.cropRotationDeg = 0;
        page.cropThumb = '';
        page.cropThumbHi = '';
        syncPageAssetIntoQueuedImages(book, page);
        persist();
        close();
        refreshPageDetailWorkspace(book.id, page.pageNum);
        toast(`已清除第 ${page.pageNum} 页插图框`, 'success');
      }
    }, '清除插图框')
  ));

  const modal = el('div', { class: 'modal', style: 'max-width:420px;' },
    el('div', { class: 'modal-head' },
      el('h3', null, '框选区域'),
      el('button', { class: 'modal-close', onclick: close }, '×'),
    ),
    body,
    el('div', { class: 'modal-foot' },
      el('button', { class: 'btn', onclick: close }, '关闭'),
    ),
  );
  const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } }, modal);
  $('#overlay-root').appendChild(scrim);
  function close() { scrim.remove(); }
}

/* ============================================================
   插图页确认 / 删除 / 手动添加（统一数据源）
   ============================================================ */

// 确认一页为插图：confirmed=true + 同步到 state.illustrations
function confirmIllustPage(book, pageNum) {
  if (!book || pageNum == null) return;
  if (!Array.isArray(book.illustrationPages)) book.illustrationPages = [];
  let entry = book.illustrationPages.find(p => Number(p.pageNum) === Number(pageNum));
  if (!entry) {
    const page = getBookPageRecord(book, pageNum);
    if (!page) return;
    entry = page;
    book.illustrationPages.push(entry);
    book.illustrationPages.sort((a, b) => a.pageNum - b.pageNum);
  }
  entry.confirmed = true;
  // 单图页直接入队；多图页只保留页级确认，等待人工拆成图1/图2后再入队
  if (!pageHasMultipleIllustrations(book, pageNum)) {
    addImageFromBookPage(book, pageNum, { allowFullPage: true });
  }
  markBookDirty(book.id);
  persist();
}

// 全部确认
async function confirmAllIllustPages(book) {
  if (!Array.isArray(book?.illustrationPages)) return;
  // 任务书 §5.2：批量确认前自动备份（best-effort）
  await dataCenterAutoBackup('before_bulk_confirm');
  for (const p of book.illustrationPages) {
    if (!p.confirmed) {
      p.confirmed = true;
      if (!pageHasMultipleIllustrations(book, p.pageNum)) {
        addImageFromBookPage(book, p.pageNum, { allowFullPage: true });
      }
    }
  }
  markBookDirty(book.id);
  persist();
}

// 删除一页插图（从候选列表和标注队列同时移除）
function removeIllustPage(book, pageNum) {
  if (!book) return;
  book.illustrationPages = (book.illustrationPages || []).filter(p => Number(p.pageNum) !== Number(pageNum));
  // 按 bookId + pageNum 精确删除整页相关图项，避免同 idShort 多卷本误删其他书的记录
  state.illustrations = state.illustrations.filter(img =>
    !(img.pdfSource?.bookId === book.id && Number(img.pdfSource?.pageNum) === Number(pageNum))
  );
  markBookDirty(book.id); markGlobalDirty();
  persist();
}

// 从标注队列删除一张插图（含误入的子记录/主记录）
function deleteIllustFromQueue(img) {
  if (!img) return;
  if (isSplitIllustrationRecord(img)) {
    // 页内图项：直接移除，不影响页面候选
    state.illustrations = state.illustrations.filter(i => i.id !== img.id);
    if (img.pdfSource?.bookId) markBookDirty(img.pdfSource.bookId);
    markGlobalDirty();
    persist();
  } else if (img.pdfSource?.bookId && img.pdfSource?.pageNum != null) {
    const book = getBook(img.pdfSource.bookId);
    if (book) removeIllustPage(book, img.pdfSource.pageNum);   // 主记录：连带从候选页移除
    else { state.illustrations = state.illustrations.filter(i => i.id !== img.id); persist(); }
  } else {
    state.illustrations = state.illustrations.filter(i => i.id !== img.id);
    persist();
  }
  if (state.selectedId === img.id) state.selectedId = null;
}

async function deletePageFigureRecord(book, page, img) {
  if (!book || !page || !img || !isSplitIllustrationRecord(img)) return false;
  const figureNo = img.figureIndex || img.subIndex || '';
  const ok = await openConfirm(`删除第 ${page.pageNum} 页的图${figureNo ? ` ${figureNo}` : '项'}？\n会从待标注队列移除该图项，并自动重排本页图号。`);
  if (!ok) return false;
  const siblings = getChildQueuedImagesForPage(book, page.pageNum);
  const idx = siblings.findIndex(item => item.id === img.id);
  const nextSelected = siblings[idx + 1] || siblings[idx - 1] || getPageQueuedImageForPage(book, page.pageNum) || null;
  deleteIllustFromQueue(img);
  normalizeFigureIndexesForPage(book, page.pageNum);
  state.selectedId = nextSelected?.id || null;
  sortQueuedImages();
  markBookDirty(book.id);
  persist();
  refreshPageDetailWorkspace(book.id, page.pageNum);
  toast('已删除图项并重排图号', 'success');
  return true;
}

// 手动加入一页为已确认插图
function addIllustPageManual(book, pageNum) {
  pageNum = Number(pageNum);
  if (!book || !pageNum) return false;
  const page = getBookPageRecord(book, pageNum);
  if (!page) return false;
  confirmIllustPage(book, pageNum);
  return true;
}

/* ============================================================
   v1.1: ADD IMAGE FROM BOOK PAGE
   ============================================================ */
function addImageFromBookPage(book, pageNum, { allowFullPage = false } = {}) {
  const page = getBookPageRecord(book, pageNum);
  if (!page) return null;
  if (pageHasMultipleIllustrations(book, pageNum)) {
    const existingFigure = getChildQueuedImagesForPage(book, pageNum)[0];
    return existingFigure ? existingFigure.id : null;
  }
  if (!page.cropRect && !allowFullPage) return null;
  const useWholePage = !page.cropRect;
  const ta = page.textAsset || null;
  const initialClassical = (ta?.associatedText || getEffectivePageText(ta || page) || page.text || '').trim();
  // 查重：按 bookId + pageNum（不用 id，避免同 idShort 多卷本碰撞）
  const existing = state.illustrations.find(i =>
    !i.parentId && i.pdfSource?.bookId === book.id && Number(i.pdfSource?.pageNum) === Number(pageNum)
  );
  if (existing) return existing.id;
  // 新 ID 用 book.id 前缀保证跨卷唯一；老数据已有 idShort 格式的 ID 不受影响
  const id = `${book.id}_p${String(pageNum).padStart(3,'0')}`;
  const img = {
    id,
    name: useWholePage ? `第${pageNum}页（整页待确认）` : `第${pageNum}页`,
    bookRef: useWholePage ? `${book.title} · 第${pageNum}页（整页待确认）` : `${book.title} · 第${pageNum}页`,
    url: getPagePreviewUrl(page, useWholePage ? 'full_page' : 'crop'),
    source: book.title,
    page: '第 ' + pageNum + ' 页',
    status: 'todo',
    aiDraft: null,
    annotation: null,
    reviewDiff: {},
    reviewMeta: {},
    crossref: { classical: initialClassical, verdict: '', note: '' },
    createdAt: Date.now(),
    annotatedAt: null,
    modelUsed: null,
    pdfSource: {
      bookId: book.id,
      bookTitle: book.title,
      dynasty: book.dynasty || '',
      pageNum,
      cropRect: page.cropRect || null,
      cropQuad: normalizeQuad(page.cropQuad) || null,
      contentRect: page.contentRect || null,
      annotateRect: getPageAnnotateRect(page, useWholePage ? 'full_page' : 'crop') || null,
      annotateQuad: normalizeQuad(page.cropQuad) || null,
      selectionMode: useWholePage ? 'full_page' : 'crop',
      rotationDeg: clampCropRotationDeg(page.cropRotationDeg || page.rotationDeg || 0),
      // 文字不再复制到 img，统一从 page.textAsset 读取
    },
  };
  state.illustrations.push(img);
  sortQueuedImages();
  return id;
}

function renderBookWorkspaceOverview(book, scope) {
  const queuedOnlyMetrics = scope === 'illustrations';
  const candidateCount = Array.isArray(book.illustrationPages) ? book.illustrationPages.length : 0;
  const queuedCount = state.illustrations.filter(i => i?.pdfSource?.bookId === book.id).length;
  const detectJob = bookDetectJobs[book.id];
  const templateRect = ensureBookCropTemplate(book);
  const visionSupported = providerSupportsVisionTasks();
  const visionOcrMsg = getVisionUnsupportedMessage('视觉 OCR');
  const visionAnnotateMsg = getVisionUnsupportedMessage('图像标注');
  const isGroupedVolume = !!book.groupId;

  const wrap = el('div');
  if (isGroupedVolume) {
    // 分卷提示框已由内容区顶部的步骤条替换（见 renderGalleryView），此处不再渲染
    return wrap;
  }

  if (!isGroupedVolume) {
    const metric = (label, value, note = '') => el('div', { class: 'book-metric-card' },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value),
      note ? el('div', { class: 'note' }, note) : null,
    );
    const infoSection = el('div', { class: 'workspace-section' });
    infoSection.appendChild(el('div', { class: 'workspace-section-head' },
      el('h3', null, '书籍信息'),
    ));
    const infoPanel = renderBookProfilePanel(book, { collapsible: false });
    const infoPanelHead = infoPanel.querySelector('.ta-panel-head');
    const infoPanelBody = infoPanel.querySelector('.ta-panel-body');
    if (infoPanelHead && infoPanelBody) {
      const infoKey = `${book.id}_info`;
      const infoInitCollapsed = !!(state.bookPanelCollapsed || {})[infoKey];
      infoPanelBody.style.display = infoInitCollapsed ? 'none' : '';
      const infoColBtn = el('button', {
        class: 'btn',
        style: 'margin-left:auto; padding:2px 8px; font-size:12px;',
        onclick: () => {
          const nowCollapsed = infoPanelBody.style.display !== 'none';
          infoPanelBody.style.display = nowCollapsed ? 'none' : '';
          infoColBtn.textContent = nowCollapsed ? '展开 ▼' : '收起 ▲';
          state.bookPanelCollapsed = state.bookPanelCollapsed || {};
          state.bookPanelCollapsed[infoKey] = nowCollapsed;
          persist();
        }
      }, infoInitCollapsed ? '展开 ▼' : '收起 ▲');
      infoPanelHead.appendChild(infoColBtn);
    }
    infoSection.appendChild(infoPanel);
    wrap.appendChild(infoSection);
  }

  const prepSection = el('div', { class: 'workspace-section' });
  prepSection.appendChild(el('div', { class: 'workspace-section-head' },
    el('h3', null, '预处理'),
  ));
  const prep = el('div', { class: 'ta-panel', style: 'margin:0' });
  const prepBody = el('div', { class: 'ta-panel-body' });
  const prepKey = `${book.id}_prep`;
  const prepInitCollapsed = !!(state.bookPanelCollapsed || {})[prepKey];
  prepBody.style.display = prepInitCollapsed ? 'none' : '';
  const prepColBtn = el('button', {
    class: 'btn',
    style: 'margin-left:auto; padding:2px 8px; font-size:12px;',
    onclick: () => {
      const nowCollapsed = prepBody.style.display !== 'none';
      prepBody.style.display = nowCollapsed ? 'none' : '';
      prepColBtn.textContent = nowCollapsed ? '展开 ▼' : '收起 ▲';
      state.bookPanelCollapsed = state.bookPanelCollapsed || {};
      state.bookPanelCollapsed[prepKey] = nowCollapsed;
      persist();
    }
  }, prepInitCollapsed ? '展开 ▼' : '收起 ▲');
  prep.appendChild(el('div', { class: 'ta-panel-head' },
    el('span', null, '书籍预处理'),
    el('span', { class: 'ta-badge st-reviewed' }, scope === 'pages' ? '当前：全书页视图' : '当前：插图视图'),
    prepColBtn,
  ));
  prepBody.appendChild(el('div', {
    style: 'margin-bottom:10px; font-size:12px; color:var(--c-text-mute); line-height:1.8;'
  }, `AI 插图：${candidateCount}。该数字仅供预处理参考，不代表最终有效插图数量。`));

  const cropSpec = el('div', {
    style: 'margin-bottom:12px; padding:10px 12px; border:1px dashed #d9cfb0; border-radius:8px; background:#fcfbf7;'
  });
  cropSpec.appendChild(el('div', { style: 'font-size:12.5px; color:#6b5c34; font-weight:600; margin-bottom:6px;' }, '统一剪裁规格（正文/版心 · 供 AI）'));
  cropSpec.appendChild(el('div', { style: 'font-size:12px; color:#8a7a4a; line-height:1.8;' },
    templateRect
      ? `当前规格：${formatRectSpec(templateRect)}${formatBookTemplateSource(book) ? ` · 来源：${formatBookTemplateSource(book)}` : ''}`
      : '尚未设置。建议先进入一页，在“页面”视图框选正文边框后，点击“设为全书统一规格”。'
  ));
  cropSpec.appendChild(el('div', { style: 'margin-top:6px; font-size:11.5px; color:#54708f; line-height:1.7;' },
    `扫描标准：优先从原始 PDF 裁取正文框，长边 ${SCAN_CONTENT_LONG_SIDE}px；正文框缺失时扫描前会提醒，可设置统一正文框或仅本次使用原始整页。最终插图标注只使用确认后的插图裁图。`));
  cropSpec.appendChild(renderBookTemplateEditor(book));
  // 插图裁切（逐页，展示用，独立于上方版心统一规格）
  const _bpages = getBookPages(book);
  const _cropCount = _bpages.filter(p => p && p.forceCropRect && p.cropRect).length;
  const illCrop = el('div', { style: 'margin-top:10px; padding-top:10px; border-top:1px dashed #e3d9b8;' });
  illCrop.appendChild(el('div', { style: 'font-size:12.5px; color:#2e6b45; font-weight:600; margin-bottom:6px;' }, '插图裁切（逐页 · 供成果展示）'));
  illCrop.appendChild(el('div', { style: 'font-size:12px; color:#5c7a64; line-height:1.8;' },
    _cropCount ? `已框插图：${_cropCount} / ${_bpages.length} 页。` : '尚未框插图本体（成果/审核暂显示整页或版心）。',
    el('br'),
    '进入某页「插图」视图：单图直接查看，若同页多图则用「+ 新增插图」依次框出图1、图2。版心（供 AI）用上方统一规格。'));
  cropSpec.appendChild(illCrop);
  prepBody.appendChild(cropSpec);


  // 扫描按钮已移至全书页工具栏左侧
  prep.appendChild(prepBody);
  prepSection.appendChild(prep);
  wrap.appendChild(prepSection);

  return wrap;
}


/* ============================================================
   BOOK-LEVEL BATCH ANNOTATE
   ============================================================ */

/**
 * 批量标注的权威来源：
 *   可见的已确认插图页  ∪  已经在 state.illustrations 里的历史页
 * 两者取并集，避免旧数据（state.illustrations 有记录但 confirmed 未设置）被漏掉。
 * 已并入合并主图的子图只保留作来源追溯，不能再次成为空白的批量标注页。
 */
function getBookIllustrations(book) {
  const confirmedNums = new Set(
    getVisibleConfirmedIllustrations(book).map(p => Number(p.pageNum))
  );
  const queuedNums = new Set(
    state.illustrations
      .filter(i => i?.pdfSource?.bookId === book?.id &&
                   Number.isFinite(Number(i.pdfSource?.pageNum)) &&
                   !i?.mergedInto)
      .map(i => Number(i.pdfSource.pageNum))
  );
  const allNums = new Set([...confirmedNums, ...queuedNums]);
  return Array.from(allNums)
    .map(pn => getBookPageRecord(book, pn))
    .filter(Boolean)
    .sort((a, b) => a.pageNum - b.pageNum);
}

function openBookAnnotateDialog(book, { pageNums = null } = {}) {
  if (!providerSupportsVisionTasks()) {
    guardVisionTask('批量图像标注', {
      book_id: book?.id || '',
      book_title: book?.title || '',
      entry: 'openBookAnnotateDialog',
    });
    return;
  }
  const selectedPages = Array.isArray(pageNums)
    ? new Set(pageNums.map(n => Number(n)).filter(Number.isFinite))
    : null;
  const queuedIllustrations = state.illustrations
    .filter(i => i.pdfSource?.bookId === book.id)
    .filter(i => !selectedPages || selectedPages.has(Number(i.pdfSource?.pageNum)))
    .filter(shouldExportIllustrationRecord);
  const total = queuedIllustrations.length;
  if (total === 0) {
    toast(selectedPages
      ? '所选插图页没有可标注的图项。多图页请先人工框出图1、图2。'
      : '当前书还没有可标注的图项。单图页可直接入队；多图页请先人工框出图1、图2。', 'warn');
    return;
  }
  const todoCount = queuedIllustrations.filter(img => img.status === 'todo').length;
  const reviewCount = queuedIllustrations.filter(img => img.status === 'review').length;
  const okCount = queuedIllustrations.filter(img => img.status === 'ok').length;
  const badCount = queuedIllustrations.filter(img => img.status === 'bad').length;
  const doneIllusts = queuedIllustrations.filter(img => ['ok', 'review', 'bad'].includes(img.status));
  const recoverableCount = doneIllusts.filter(img => hasRecoverableCurrentResult(img)).length;
  const metadataOnlyCount = doneIllusts.filter(img => !hasRecoverableCurrentResult(img) && !!(img.modelUsed || img.annotatedAt || img.reviewMeta?.aiGeneratedAt)).length;
  let scrim = null;
  const enterReview = () => {
    const firstReview = queuedIllustrations.find(img => img.status === 'review');
    if (!firstReview) return;
    scrim?.remove();
    captureReturnContext();
    state.currentBookId = book.id;
    state.imageBookFilter = book.id;
    state.selectedId = firstReview.id;
    state.mainView = 'review-queue';
    persist();
    renderAll();
  };
  const actionButtons = todoCount === total
    ? [
        el('button', {
          class: 'btn primary',
          style: 'min-width:150px',
          onclick: () => { scrim.remove(); runBookAnnotateBatch(book, 'todo', { pageNums }); },
        }, `开始标注（${total}）`),
      ]
    : [
        ...(reviewCount > 0 ? [el('button', {
          class: 'btn success',
          style: 'min-width:130px',
          onclick: enterReview,
        }, `进入审核（${reviewCount}）`)] : []),
        el('button', {
          class: 'btn danger-ghost',
          style: 'min-width:130px',
          onclick: () => { scrim.remove(); runBookAnnotateBatch(book, 'all', { pageNums }); },
        }, `重标全部（${total}）`),
        el('button', {
          class: 'btn primary',
          style: 'min-width:130px',
          disabled: todoCount === 0 ? '' : null,
          onclick: () => { scrim.remove(); runBookAnnotateBatch(book, 'todo', { pageNums }); },
        }, todoCount === 0 ? '没有待标注项' : `标注未完成（${todoCount}）`),
      ];

  const dlg = el('div', { class: 'confirm', style: 'max-width:460px; position:relative;' },
    el('button', {
      class: 'btn',
      style: 'position:absolute; right:12px; top:10px; width:24px; height:24px; min-width:0; padding:0; border:none; background:transparent; box-shadow:none; color:var(--c-text-mute); font-size:18px; line-height:1;',
      title: '关闭',
      onclick: () => scrim.remove(),
    }, '×'),
    el('h3', null, selectedPages ? '⚡ 批量标注所选插图页' : '⚡ 批量标注插图'),
    el('p', { style: 'color:#555; line-height:1.7' },
      selectedPages
        ? `已选 ${selectedPages.size} 个插图页，涉及 ${total} 张有效图项；待标注 ${todoCount}，待审核 ${reviewCount}，已确认 ${okCount}${badCount ? `，已跳过 ${badCount}` : ''}。`
        : `当前插图队列共 ${total} 张；待标注 ${todoCount}，待审核 ${reviewCount}，已确认 ${okCount}${badCount ? `，已跳过 ${badCount}` : ''}。`),
    el('p', { style: 'color:#8a7a4a; font-size:12.5px; margin-top:4px; line-height:1.6' },
      '每张图约消耗一次视觉模型调用。无文字的页面会同时进行 OCR，结果自动回填到页面文字资产。'),
    (doneIllusts.length > 0 ? el('p', { style: 'color:#7a5c10; font-size:12.5px; margin-top:4px; line-height:1.7' },
      `全部重新标注前会先尝试保护当前结果：${recoverableCount} 张可自动补归档，${metadataOnlyCount} 张仅剩模型元信息，无法从本地恢复旧正文。`) : null),
    el('div', { class: 'row', style: 'gap:8px; justify-content:flex-end; margin-top:14px; flex-wrap:wrap' },
      ...actionButtons,
    ),
  );
  scrim = el('div', { class: 'scrim' }, dlg);
  $('#overlay-root').appendChild(scrim);
}

async function runBookAnnotateBatch(book, mode, { pageNums = null } = {}) {
  // （图文切割预检已移除：AI 标注自动读「本页±N页窗口」，不再依赖切割）

  const selectedPages = Array.isArray(pageNums)
    ? new Set(pageNums.map(n => Number(n)).filter(Number.isFinite))
    : null;
  const queuedIllustrations = state.illustrations
    .filter(i => i.pdfSource?.bookId === book.id)
    .filter(i => !selectedPages || selectedPages.has(Number(i.pdfSource?.pageNum)))
    .filter(shouldExportIllustrationRecord);
  if (queuedIllustrations.length === 0) {
    toast(selectedPages
      ? '所选插图页没有可批量标注的图项。多图页请先人工拆图后再批量标注。'
      : '当前书没有可批量标注的图项。多图页请先人工拆图后再批量标注。', 'warn');
    return;
  }

  // 2. Collect target IDs based on mode. 旧结果不在调用前改写；只有新候选
  // 通过质量门并成功持久化时，统一标注事务才会归档并替换当前草稿。
  // todo 模式：只取 status==='todo'（天然排除 bad/ok/review）
  // all 模式：全量重跑，包含 bad，用户明确选择"全部重新标注"时不应屏蔽任何页
  const targetIds = (mode === 'all'
    ? queuedIllustrations
    : queuedIllustrations.filter(img => img.status === 'todo'))
    .map(img => img.id);

  if (targetIds.length === 0) { toast('没有需要标注的图片', 'warn'); return; }

  // 3. Switch to annotate view so progress bar is visible, then run batch
  state.mainView = 'annotate';
  state.leftTab = 'images';
  persist();
  renderAll();

  await runBatch(targetIds, { skipConfirm: true, includeExisting: true });

  const completedTargets = targetIds
    .map(id => state.illustrations.find(img => img.id === id))
    .filter(Boolean);
  const reviewCount = completedTargets.filter(img => img.status === 'review').length;
  const failedCount = completedTargets.filter(img => img.status === 'bad').length;
  returnToGalleryBrowse(book, { scope: 'illustrations', preserveScroll: false });
  toast(`标注完成：本批 ${targetIds.length} 张，${reviewCount} 张待审核${failedCount ? `，${failedCount} 张失败` : ''}。可从“审核”进入处理。`, failedCount ? 'warn' : 'success');
}

/* ============================================================
   v1.1: GALLERY VIEW — 批量删除页面
   ============================================================ */
async function deleteSelectedPagesWithConfirm(book) {
  const nums = [...state.gallerySelection].sort((a, b) => a - b);
  if (!nums.length) return;

  // 客户端预检：有 status==='ok' 的标注不得删除
  const protectedPages = [];
  for (const ill of state.illustrations) {
    const src = ill.pdfSource;
    if (src?.bookId === book.id && nums.includes(Number(src.pageNum)) && ill.status === 'ok') {
      if (!protectedPages.includes(Number(src.pageNum))) protectedPages.push(Number(src.pageNum));
    }
  }
  if (protectedPages.length) {
    toast(`第 ${protectedPages.sort((a,b)=>a-b).join(',')} 页有已确认标注，禁止删除`, 'warn');
    return;
  }

  // 统计将被连带删除的标注记录数
  const recCount = state.illustrations.filter(ill => {
    const src = ill.pdfSource;
    return src?.bookId === book.id && nums.includes(Number(src.pageNum));
  }).length;

  // 第一次确认
  const MAX_SHOW = 15;
  const numsDisplay = nums.length > MAX_SHOW
    ? nums.slice(0, MAX_SHOW).join('、') + ` 等 ${nums.length} 页`
    : nums.join('、');
  const ok1 = await openConfirm(
    `即将删除第 ${numsDisplay} 共 ${nums.length} 页。\n` +
    `连带删除 ${recCount} 条标注记录。\n` +
    `删除前将自动备份到 data/backups/pre_write/。\n` +
    `剩余页码将重新编号，操作不可在界面内撤销（可从备份恢复）。\n\n` +
    `确认继续？`
  );
  if (!ok1) return;

  // 第二次确认
  const ok2 = await openConfirm(`最终确认：真的删除这 ${nums.length} 页？界面内无法撤销（可从备份恢复）。`);
  if (!ok2) return;

  try {
    await enqueueBridgeFlush();
    const r = await fetch(`${BRIDGE_BASE}/api/book/${encodeURIComponent(book.id)}/delete-pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_nums: nums }),
    });
    const j = await r.json();
    if (!r.ok || j.error) { toast(j.error || ('删除失败 ' + r.status), 'error'); return; }
    state.gallerySelection = [];
    state.galleryActionMode = null;
    state.galleryScanRange = 'all';
    _galleryFocusRequestPageNum = null;
    await initFromBridge();
    refreshBookCount(); renderAll();
    toast(`已删除 ${j.deleted_pages.length} 页（连带 ${j.deleted_records} 条标注），剩余 ${j.remaining_pages} 页，已备份`, 'success');
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

function describeSelectedPageOcrProgress(job) {
  if (!job) return null;
  const total = Math.max(1, Number(job.total) || 1);
  const current = Math.min(total, Math.max(0, Number(job.current) || 0));
  const pct = job.finished ? 100 : Math.round(current / total * 100);
  const countText = `已采用 ${job.updated || 0} · 空结果 ${job.skipped || 0} · 失败 ${job.failed || 0}`;
  const activePages = [...new Set((job.activePageNums || [])
    .map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const activeText = activePages.length
    ? `第 ${activePages.join('、')} 页`
    : `第 ${job.currentPageNum || current || 1} 页`;
  const statusText = job.running
    ? (job.cancelRequested
      ? `正在停止：等待当前 ${activePages.length || 1} 个请求结束（${current}/${total}）`
      : `正在 OCR：${activeText}（已完成 ${current}/${total}）`)
    : (job.cancelled ? `已停止：处理至 ${current}/${total} 页` : `OCR 已完成：${total} 页`);
  const tone = job.running && !job.cancelRequested ? '#1f5f8e' : (job.failed ? '#9a5f11' : '#287a35');
  return { total, current, pct, countText, statusText, tone };
}

function compactPageNumberList(pageNums = []) {
  const nums = [...new Set((Array.isArray(pageNums) ? pageNums : [])
    .map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const parts = [];
  let start = null;
  let previous = null;
  const flush = () => {
    if (start === null) return;
    parts.push(start === previous ? String(start) : `${start}–${previous}`);
  };
  for (const num of nums) {
    if (start === null) {
      start = previous = num;
    } else if (num === previous + 1) {
      previous = num;
    } else {
      flush();
      start = previous = num;
    }
  }
  flush();
  return parts.join('、');
}

function parsePageNumberSelection(value = '') {
  const pages = new Set();
  const tokens = String(value).trim().split(/[、,，;；\s]+/).filter(Boolean);
  for (const token of tokens) {
    const range = token.match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);
    if (range) {
      const left = Number(range[1]);
      const right = Number(range[2]);
      const start = Math.min(left, right);
      const end = Math.max(left, right);
      if (end - start > 5000) continue;
      for (let page = start; page <= end; page++) pages.add(page);
      continue;
    }
    if (/^\d+$/.test(token)) pages.add(Number(token));
  }
  return [...pages].filter(Number.isFinite).sort((a, b) => a - b);
}

function describeBookPageScanProgress(job) {
  if (!job) return null;
  const total = Math.max(1, Number(job.total) || 1);
  const current = Math.min(total, Math.max(0, Number(job.current) || 0));
  const finished = !job.running && !!job.finishedAt;
  const pct = finished && !job.cancelled ? 100 : Math.round(current / total * 100);
  const countText = `新增插图 ${job.newIllust || 0} · 失败 ${job.errors || 0}`;
  const statusText = job.running
    ? (job.cancelRequested
      ? `正在停止：当前请求结束后停止后续页面（${current}/${total}）`
      : `${job.paused ? '已暂停' : '正在扫描'}：${current}/${total} 页`)
    : (job.cancelled ? `已停止：处理至 ${current}/${total} 页` : `扫描已完成：${current}/${total} 页`);
  const tone = job.running && !job.cancelRequested ? '#1f5f8e' : ((job.errors || 0) > 0 ? '#9a5f11' : '#287a35');
  return { total, current, pct, countText, statusText, tone };
}

function galleryScanJobTimestamp(job) {
  if (!job) return 0;
  if (Number.isFinite(Number(job.startedAt))) return Number(job.startedAt);
  const finished = Date.parse(job.finishedAt || '');
  return Number.isFinite(finished) ? finished : 0;
}

function getGalleryScanJob(book) {
  if (!book) return null;
  const jobs = [
    bookDetectJobs[book.id],
    selectedPageOcrJobs[book.id],
    book.lastSelectedPageOcrJob,
  ].filter(Boolean);
  return jobs.find(job => job.running)
    || jobs.sort((a, b) => galleryScanJobTimestamp(b) - galleryScanJobTimestamp(a))[0]
    || null;
}

function hasActiveGalleryScanJob(book) {
  return !!getGalleryScanJob(book)?.running;
}

function gallerySelectionModeFor(actionMode, scope, scanRange = 'all') {
  if (actionMode === 'scan') {
    return scope === 'illustrations' || scanRange === 'selected';
  }
  if (actionMode === 'confirm') return scope === 'pages';
  if (actionMode === 'annotate') return scope === 'illustrations';
  if (actionMode === 'asset-source') return scope === 'illustrations';
  if (actionMode === 'manage') return scope === 'pages';
  return false;
}

function isGallerySelectionMode(scope) {
  return gallerySelectionModeFor(state.galleryActionMode, scope, state.galleryScanRange);
}

function setGalleryActionMode(mode, scope) {
  const closing = state.galleryActionMode === mode;
  state.galleryActionMode = closing ? null : mode;
  state.gallerySelection = [];
  state.galleryScanRange = !closing && mode === 'scan' && scope === 'pages' ? 'all' : 'selected';
  renderGalleryView({ preserveScroll: true, suppressFocus: true });
}

function closeGalleryActionMode() {
  state.galleryActionMode = null;
  state.galleryScanRange = 'all';
  state.gallerySelection = [];
  renderGalleryView({ preserveScroll: true, suppressFocus: true });
}

function returnToGalleryBrowse(book, { scope = state.galleryScope || 'illustrations', preserveScroll = true } = {}) {
  if (!book) return;
  const stayingInGallery = state.mainView === 'gallery' && state.currentBookId === book.id;
  state.mainView = 'gallery';
  state.currentBookId = book.id;
  state.galleryScope = scope;
  state.galleryActionMode = null;
  state.gallerySelection = [];
  state.galleryScanRange = 'all';
  _galleryFocusRequestPageNum = null;
  persist(book.id);
  if (stayingInGallery) {
    renderGalleryView({ preserveScroll, suppressFocus: true });
  } else {
    renderAll();
  }
}

function toggleGalleryPageSelection(pageNum) {
  const normalized = Number(pageNum);
  if (!Number.isFinite(normalized)) return;
  const selected = state.gallerySelection.map(Number).includes(normalized);
  state.gallerySelection = selected
    ? state.gallerySelection.filter(value => Number(value) !== normalized)
    : [...state.gallerySelection, normalized];
  // 选择仅属于当前任务，不持久化，避免刷新后残留隐式批处理范围。
  renderGalleryView({ preserveScroll: true, suppressFocus: true });
}

function describeGalleryScanAction(book, selectedPageNums = []) {
  const selectedCount = uniqueSortedBookPages(book, selectedPageNums).length;
  if (selectedCount > 0) {
    return {
      mode: 'selected_ocr',
      label: `扫描所选（${selectedCount}页）`,
      title: `重新 OCR 所选 ${selectedCount} 页；非空结果直接采用，旧 OCR 保留在历史中，人工校文不覆盖`,
      selectedCount,
    };
  }
  const allPages = getBookPages(book);
  const currentCount = allPages.filter(page => page.textAsset?.fullScanDone).length;
  const remaining = Math.max(0, allPages.length - currentCount);
  return {
    mode: remaining > 0 ? 'full_scan' : 'full_rescan',
    label: remaining > 0
      ? (currentCount > 0 ? `继续扫描全书（剩${remaining}页）` : '扫描全书')
      : '重新扫描全书',
    title: remaining > 0
      ? '扫描全书未完成页：同时执行正文 OCR、阅读顺序识别与插图页检测'
      : '全书已完成；重新扫描会再次执行正文 OCR、阅读顺序识别与插图页检测',
    selectedCount: 0,
    remaining,
  };
}

async function runGalleryScanAction(book, selectedPageNums = []) {
  if (!book || hasActiveGalleryScanJob(book)) {
    toast('该书已有页面扫描任务正在运行，请等待完成或请求停止。', 'warn');
    return;
  }
  const action = describeGalleryScanAction(book, selectedPageNums);
  if (action.mode === 'selected_ocr') {
    try {
      const result = await runSelectedPagesOcr(book, selectedPageNums, {
        force: true,
        forceOcr: true,
        refreshCrop: false,
      });
      if (!result || result.alreadyRunning) return;
      toast(result.cancelled
        ? `扫描已停止：已采用 ${result.updated} 页，空结果 ${result.skipped} 页，失败 ${result.failed} 页`
        : `扫描完成：已采用 ${result.updated} 页，空结果 ${result.skipped} 页，失败 ${result.failed} 页`,
      result.failed ? 'warn' : 'success');
    } catch (error) {
      toast(`扫描失败：${error.message || error}`, 'error');
    }
    returnToGalleryBrowse(book);
    return;
  }
  try {
    await runFullBookScan(book, { force: action.mode === 'full_rescan' });
  } finally {
    returnToGalleryBrowse(book);
  }
}

function renderGalleryScanProgress(book) {
  const job = getGalleryScanJob(book);
  if (!job) return null;
  const isSelectedOcr = job.kind === 'selected_page_ocr';
  const summary = isSelectedOcr
    ? describeSelectedPageOcrProgress(job)
    : describeBookPageScanProgress(job);
  if (!summary) return null;
  const { total, current, pct, countText, statusText, tone } = summary;
  const label = isSelectedOcr ? '页面扫描' : getScanJobLabel(job);
  const stopRequested = !!job.cancelRequested;
  const failureGroups = isSelectedOcr ? summarizeOcrFailures(job.failures) : [];
  const failedPageNums = failureGroups.flatMap(group => group.pages);
  return el('div', {
    class: 'gallery-scan-progress',
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': job.running ? 'true' : 'false',
  },
    el('span', { class: 'gallery-scan-progress-title', style: `color:${tone}` }, job.running ? `⟳ ${label}` : `✓ ${label}`),
    el('span', { class: 'gallery-scan-progress-status' }, statusText),
    el('div', {
      class: 'gallery-scan-progress-track',
      role: 'progressbar',
      'aria-label': `${label}进度`,
      'aria-valuemin': '0',
      'aria-valuemax': String(total),
      'aria-valuenow': String(current),
    }, el('div', {
      class: 'gallery-scan-progress-fill',
      style: `width:${pct}%; background:${stopRequested || job.paused ? '#d4952a' : '#2e7eb6'};`,
    })),
    el('span', { class: 'gallery-scan-progress-counts' }, `${current}/${total} · ${countText}`),
    isSelectedOcr && job.model
      ? el('span', { class: 'gallery-scan-progress-counts' }, `${job.model} · 并发 ${job.concurrency || 1}`)
      : null,
    job.running && !isSelectedOcr
      ? el('button', {
          class: 'btn',
          disabled: stopRequested ? '' : null,
          onclick: () => { job.paused = !job.paused; renderGalleryView(); },
        }, job.paused ? '继续' : '暂停')
      : null,
    job.running
      ? el('button', {
          class: 'btn',
          disabled: stopRequested ? '' : null,
          title: '不会中断已经发出的模型请求；当前请求结束后停止派发后续页面',
          onclick: () => {
            job.cancelRequested = true;
            if (!isSelectedOcr) {
              job.paused = false;
            }
            renderGalleryView();
          },
        }, stopRequested ? '正在停止…' : '完成当前请求后停止')
      : el('div', { class: 'gallery-selectionbar-group' },
          isSelectedOcr && failedPageNums.length
            ? el('button', {
                class: 'btn primary',
                title: `只重新扫描失败的第 ${compactPageNumberList(failedPageNums)} 页`,
                onclick: () => runGalleryScanAction(book, failedPageNums),
              }, `重新扫描失败页（${failedPageNums.length}）`)
            : null,
          el('button', {
            class: 'btn',
            onclick: () => {
              if (isSelectedOcr) {
                delete selectedPageOcrJobs[book.id];
                delete book.lastSelectedPageOcrJob;
                persist(book.id);
              }
              else delete bookDetectJobs[book.id];
              renderGalleryView();
            },
          }, '关闭状态'),
        ),
    failureGroups.length
      ? el('details', { class: 'gallery-scan-failures' },
          el('summary', null, `查看失败明细（${failedPageNums.length}页）`),
          ...failureGroups.map(group => el('div', { class: 'gallery-scan-failure-row' },
            el('strong', null, `第 ${compactPageNumberList(group.pages)} 页`),
            el('span', null, group.reason),
          )),
        )
      : null,
  );
}

function addSelectedPagesToIllustrations(book, pageNums) {
  let added = 0;
  let skipped = 0;
  let failed = 0;
  const selected = uniqueSortedBookPages(book, pageNums);
  for (const page of selected) {
    const pageNum = Number(page.pageNum);
    if (!Number.isFinite(pageNum)) {
      failed++;
      continue;
    }
    const alreadyConfirmed = getConfirmedIllustrations(book)
      .some(item => Number(item.pageNum) === pageNum);
    if (alreadyConfirmed) {
      skipped++;
      continue;
    }
    confirmIllustPage(book, pageNum);
    added++;
  }
  state.gallerySelection = [];
  returnToGalleryBrowse(book);
  if (!added && !skipped && !failed) {
    toast('未选中任何页面', 'warn');
    return;
  }
  const parts = [];
  if (added) parts.push(`已加入插图列表 ${added} 页`);
  if (skipped) parts.push(`${skipped} 页已存在（跳过）`);
  if (failed) parts.push(`${failed} 页失败（页面数据不完整）`);
  toast(parts.join('；'), failed ? 'warn' : (added ? 'success' : 'info'));
}

function renderGalleryActionPanel(book, scope, visiblePages, {
  visionSupported = true,
  visionAnnotateMsg = '',
} = {}) {
  const actionMode = state.galleryActionMode;
  if (!actionMode) return null;
  const visibleNums = visiblePages.map(page => Number(page.pageNum)).filter(Number.isFinite);
  const visibleSet = new Set(visibleNums);
  const selectedPageNums = uniqueSortedBookPages(book, state.gallerySelection)
    .map(page => Number(page.pageNum))
    .filter(pageNum => visibleSet.has(pageNum));
  const selectedSet = new Set(selectedPageNums);
  const selectedTargets = scope === 'illustrations'
    ? getQueuedIllustrationsForPages(book, selectedPageNums)
    : [];
  const selectionMode = isGallerySelectionMode(scope);
  const scanPageNums = selectionMode ? selectedPageNums : [];
  const scanAction = selectionMode && !selectedPageNums.length
    ? {
        mode: 'selected_ocr',
        label: '扫描所选（0页）',
        title: '请先点击整张缩略图选择要重新 OCR 的页面',
        selectedCount: 0,
      }
    : describeGalleryScanAction(book, scanPageNums);
  const taskRunning = hasActiveGalleryScanJob(book);
  const summary = scope === 'illustrations'
    ? `已选 ${selectedPageNums.length} 页 · ${selectedTargets.length} 张有效插图`
    : `已选 ${selectedPageNums.length} 页`;

  const selectVisible = () => {
    state.gallerySelection = visibleNums;
    renderGalleryView({ preserveScroll: true, suppressFocus: true });
  };
  const invertVisible = () => {
    state.gallerySelection = visibleNums.filter(pageNum => !selectedSet.has(pageNum));
    renderGalleryView({ preserveScroll: true, suppressFocus: true });
  };
  const clearSelection = () => {
    state.gallerySelection = [];
    renderGalleryView({ preserveScroll: true, suppressFocus: true });
  };
  let pageRangeInput = null;
  const selectByPageText = () => {
    const requested = parsePageNumberSelection(pageRangeInput?.value || '');
    const available = requested.filter(pageNum => visibleSet.has(pageNum));
    if (!available.length) {
      toast('没有解析到当前列表中的有效页码', 'warn');
      return;
    }

    state.gallerySelection = available;
    renderGalleryView({ preserveScroll: true, suppressFocus: true });
  };

  const actionLabel = {
    scan: '扫描页面',
    confirm: '确认插图页',
    annotate: '标注插图',
    'asset-source': '导出素材源',
    manage: '页面操作',
  }[actionMode] || '批量任务';

  const rangeControls = actionMode === 'scan' && scope === 'pages'
    ? el('div', { class: 'gallery-action-range' },
        el('span', { class: 'gallery-action-hint' }, '扫描范围'),
        el('div', { class: 'seg' },
          el('button', {
            class: state.galleryScanRange === 'all' ? 'on' : '',
            onclick: () => {
              state.galleryScanRange = 'all';
              state.gallerySelection = [];
              renderGalleryView({ preserveScroll: true, suppressFocus: true });
            },
          }, '全书'),
          el('button', {
            class: state.galleryScanRange === 'selected' ? 'on' : '',
            onclick: () => {
              state.galleryScanRange = 'selected';
              state.gallerySelection = [];
              renderGalleryView({ preserveScroll: true, suppressFocus: true });
            },
          }, '选择页面'),
        ),
      )
    : null;

  if (selectionMode) {
    pageRangeInput = el('input', {
      class: 'gallery-page-range-input',
      placeholder: '页码，如 18、20、45-47',
      'aria-label': '按页码范围选择',
      onkeydown: event => {
        if (event.key === 'Enter') selectByPageText();
      },
    });
  }
  const selectionControls = selectionMode
    ? el('div', { class: 'gallery-selectionbar-group' },
        el('span', { class: 'gallery-action-hint' }, '点击整张缩略图选择'),
        el('button', { class: 'btn', onclick: selectVisible }, scope === 'illustrations' ? '全选当前插图页' : '全选当前页'),
        el('button', { class: 'btn', onclick: invertVisible }, '反选'),
        el('button', {
          class: 'btn',
          disabled: selectedPageNums.length ? null : '',
          onclick: clearSelection,
        }, '清空'),
        pageRangeInput,
        el('button', { class: 'btn', onclick: selectByPageText }, '按页码选择'),
        el('span', { class: 'gallery-selection-summary', 'aria-live': 'polite' }, summary),
      )
    : el('span', { class: 'gallery-action-hint' }, scanAction.title);

  let primaryActions = null;
  if (actionMode === 'scan') {
    const needsSelection = selectionMode;
    primaryActions = el('button', {
      class: 'btn primary',
      disabled: !visionSupported || taskRunning || (needsSelection && !selectedPageNums.length) ? '' : null,
      title: !visionSupported ? getVisionUnsupportedMessage('页面扫描')
        : (taskRunning ? '当前已有页面扫描任务正在运行'
          : (needsSelection && !selectedPageNums.length ? '请先点击缩略图选择页面' : scanAction.title)),
      onclick: () => runGalleryScanAction(book, scanPageNums),
    }, taskRunning ? '扫描进行中…' : scanAction.label);
  } else if (actionMode === 'confirm') {
    primaryActions = el('button', {
      class: 'btn primary',
      disabled: selectedPageNums.length ? null : '',
      onclick: () => addSelectedPagesToIllustrations(book, selectedPageNums),
    }, `确认所选为插图页（${selectedPageNums.length}）`);
  } else if (actionMode === 'annotate') {
    primaryActions = el('button', {
      class: 'btn primary',
      disabled: selectedTargets.length && visionSupported && !taskRunning ? null : '',
      title: !visionSupported ? visionAnnotateMsg
        : (taskRunning ? '请等待当前页面扫描任务结束'
          : (selectedTargets.length ? '只标注所选插图页中的有效图项' : '请先点击含有效图项的插图页')),
      onclick: () => openBookAnnotateDialog(book, { pageNums: selectedPageNums }),
    }, `标注所选（${selectedTargets.length}）`);
  } else if (actionMode === 'asset-source') {
    primaryActions = el('button', {
      class: 'btn primary',
      disabled: selectedTargets.length ? null : '',
      title: selectedTargets.length
        ? '从权威 PDF 按各插图当前审核裁框批量导出无损源素材包'
        : '请先点击含有效图项的插图页',
      onclick: async () => {
        const result = await exportAssetSourceRecords(selectedTargets);
        if (result) returnToGalleryBrowse(book);
      },
    }, `导出所选素材源（${selectedTargets.length}）`);
  } else if (actionMode === 'manage') {
    primaryActions = el('div', { class: 'gallery-selectionbar-group' },
      selectedPageNums.length === 1
        ? el('button', {
            class: 'btn',
            title: '将所选页面设为展示站首页或卷册封面',
            onclick: () => setShowcaseCoverPage(book, selectedPageNums[0]),
          }, `设为封面（第${selectedPageNums[0]}页）`)
        : null,
      el('button', {
        class: 'btn danger-ghost',
        disabled: selectedPageNums.length ? null : '',
        onclick: () => deleteSelectedPagesWithConfirm(book),
      }, `删除所选（${selectedPageNums.length}）`),
    );
  }

  return el('div', { class: 'gallery-selectionbar gallery-action-panel' },
    el('div', { class: 'gallery-action-panel-head' },
      el('strong', null, actionLabel),
      el('button', { class: 'btn', onclick: closeGalleryActionMode }, '退出任务'),
    ),
    rangeControls,
    selectionControls,
    el('span', { class: 'spacer' }),
    primaryActions,
  );
}

function renderGalleryView({ preserveScroll = false, suppressFocus = false } = {}) {
  const scroll = $('#main-scroll');
  const savedScrollTop = preserveScroll ? scroll.scrollTop : null;
  scroll.innerHTML = '';
  const book = getCurrentBook();
  if (!book) { state.mainView = 'annotate'; renderAll(); return; }
  const scope = state.galleryScope || 'illustrations';
  if (!['scan', 'confirm', 'annotate', 'asset-source', 'manage'].includes(state.galleryActionMode)) {
    state.galleryActionMode = null;
  }
  if ((scope === 'pages' && state.galleryActionMode === 'annotate')
    || (scope === 'illustrations' && ['confirm', 'manage'].includes(state.galleryActionMode))) {
    state.galleryActionMode = null;
    state.gallerySelection = [];
  }
  if (scope === 'pages' && state.galleryFilter !== 'all') {
    state.galleryFilter = 'all';
  }
  const queuedPages = getQueuedBookPages(book);
  const sourcePages = scope === 'pages' ? getBookPages(book) : getVisibleConfirmedIllustrations(book);
  const visionSupported = providerSupportsVisionTasks();
  const visionAnnotateMsg = getVisionUnsupportedMessage('批量图像标注');

  // breadcrumb + step bar → 固定 header 区域
  setMainHeader(
    buildBreadcrumbBar([
      { label: book.title, onClick: () => openBookLandingPage(book.id) },
      { label: scope === 'pages' ? '全书页' : '插图队列', onClick: () => openGallery(book.id, scope) },
    ]),
  );

  // 步骤条从面包屑带拆出，移到内容区顶部（替换原分卷提示框位置），水平居中
  scroll.appendChild(el('div', { class: 'step-bar-content' }, buildStepBar(scope === 'pages' ? 1 : 3, book)));
  scroll.appendChild(renderBookWorkspaceOverview(book, scope));
  const scanProgress = renderGalleryScanProgress(book);
  if (scanProgress) scroll.appendChild(scanProgress);
  scroll.appendChild(el('div', { class: 'workspace-section-head', id: 'gallery-browse-head', style: 'margin-bottom:10px;' },
    el('h3', null, '页面浏览'),
  ));

  // toolbar
  const filterSel = el('select', {
    onchange: e => {
      state.galleryFilter = e.target.value;
      // 筛选切换后不保留看不见的插图页，避免批量任务误带隐藏项。
      if (scope === 'illustrations') state.gallerySelection = [];
      persist(); renderGalleryView();
    },
  },
    el('option', { value: 'all', ...(state.galleryFilter === 'all' ? { selected: '' } : {}) }, '全部'),
    el('option', { value: 'full_page', ...(state.galleryFilter === 'full_page' ? { selected: '' } : {}) }, '整页待确认'),
    el('option', { value: 'crop', ...(state.galleryFilter === 'crop' ? { selected: '' } : {}) }, '裁图')
  );
  const sortSel = el('select', {
    onchange: e => { state.gallerySort = e.target.value; persist(); renderGalleryView(); },
  },
    el('option', { value: 'page', ...(state.gallerySort === 'page' ? { selected: '' } : {}) }, '页码升序'),
    el('option', { value: 'page-desc', ...(state.gallerySort === 'page-desc' ? { selected: '' } : {}) }, '页码降序'),
  );
  const viewSeg = el('div', { class: 'seg' },
    el('button', { class: state.galleryView === 'grid' ? 'on' : '', onclick: () => { state.galleryView = 'grid'; persist(); renderGalleryView(); } }, '▦ 网格'),
    el('button', { class: state.galleryView === 'list' ? 'on' : '', onclick: () => { state.galleryView = 'list'; persist(); renderGalleryView(); } }, '≡ 列表'),
  );
  const openGalleryTextProof = () => {
    const pages = getBookPages(book);
    const selectedPageNum = Number(state.gallerySelection?.[0]);
    const currentPageNum = Number(state.currentBookPage);
    const targetPage = pages.find(p => Number(p.pageNum) === selectedPageNum)
      || pages.find(p => Number(p.pageNum) === currentPageNum)
      || pages[0];
    if (!targetPage) {
      toast('当前书没有可校核的页面', 'warn');
      return;
    }
    openPageDetail(book.id, targetPage.pageNum, 'text');
  };
  // 先确定当前筛选后的可见页面；选择工具栏与缩略图共用同一范围。
  let pages = sourcePages.slice();
  if (scope === 'illustrations') {
    if (state.galleryFilter === 'full_page') pages = pages.filter(p => getGalleryPageAnnotationSummary(book, p.pageNum).mode === 'full_page');
    if (state.galleryFilter === 'crop') pages = pages.filter(p => getGalleryPageAnnotationSummary(book, p.pageNum).mode === 'crop');
  }
  pages.sort((a, b) => state.gallerySort === 'page-desc' ? b.pageNum - a.pageNum : a.pageNum - b.pageNum);

  scroll.appendChild(el('div', { class: 'gallery-toolbar' },
    el('button', {
      class: state.galleryActionMode === 'scan' ? 'btn primary' : 'btn',
      title: scope === 'pages' ? '扫描全书或选择页面重新 OCR' : '选择插图页重新 OCR',
      onclick: () => setGalleryActionMode('scan', scope),
    }, '扫描'),
    ...(scope === 'pages' ? [
      el('button', {
        class: state.galleryActionMode === 'confirm' ? 'btn primary' : 'btn',
        title: '选择页面并确认加入插图队列',
        onclick: () => setGalleryActionMode('confirm', scope),
      }, '确认插图'),
      el('button', {
        class: 'btn',
        style: 'font-size:11px; padding:2px 8px;',
        title: '打开当前页文字校核，查看原书页并修订 OCR 文本',
        onclick: openGalleryTextProof,
      }, '校文'),
      el('button', {
        class: 'btn',
        style: 'font-size:11px; padding:2px 8px;',
        title: '导出当前卷或整书 OCR；不会修改现有数据',
        onclick: () => openBookOcrExportModal(book, { defaultScope: 'book' }),
      }, '导出 OCR'),
      el('button', {
        class: state.galleryActionMode === 'manage' ? 'btn primary' : 'btn',
        title: '选择页面后设为封面或删除',
        onclick: () => setGalleryActionMode('manage', scope),
      }, '页面操作'),
    ] : []),
    ...(scope === 'illustrations' ? [
      el('button', {
        class: state.galleryActionMode === 'annotate' ? 'btn primary' : 'btn',
        title: '选择插图页后批量重新标注',
        onclick: () => setGalleryActionMode('annotate', scope),
      }, '标注'),
      el('button', {
        class: state.galleryActionMode === 'asset-source' ? 'btn primary' : 'btn',
        title: '选择已确认插图，并从权威 PDF 的当前裁框导出素材源包',
        onclick: () => setGalleryActionMode('asset-source', scope),
      }, '导出素材源'),
      el('span', null, '筛选'), filterSel,
    ] : []),
    el('span', { style: 'flex:1' }),
    el('div', { class: 'seg' },
      el('button', { class: scope === 'pages' ? 'on' : '', onclick: () => { state.galleryScope = 'pages'; state.galleryFilter = 'all'; state.gallerySelection = []; state.galleryActionMode = null; state.galleryScanRange = 'all'; persist(); renderGalleryView(); } }, `全页 ${getBookPages(book).length}`),
      el('button', { class: scope === 'illustrations' ? 'on' : '', onclick: () => { state.galleryScope = 'illustrations'; state.galleryFilter = 'all'; state.gallerySelection = []; state.galleryActionMode = null; state.galleryScanRange = 'all'; persist(); renderGalleryView(); } }, `插图 ${getConfirmedIllustrations(book).length}`),
    ),
    el('div', { class: 'toolbar-inline-group' },
      el('label', null, '排序'),
      sortSel,
    ),
    el('div', { class: 'toolbar-inline-group' },
      el('label', null, '视图'),
      viewSeg,
    ),
  ));
  const actionPanel = renderGalleryActionPanel(book, scope, pages, {
    visionSupported,
    visionAnnotateMsg,
  });
  if (actionPanel) scroll.appendChild(actionPanel);

  if (pages.length === 0) {
    scroll.appendChild(el('div', { class: 'placeholder-state', style: 'height:280px; background:#fff; border-radius:10px; box-shadow:var(--shadow-card)' },
      el('div', { class: 'sub' }, '没有匹配筛选的页面')));
    return;
  }

  // grid
  if (state.galleryView === 'grid') {
    const grid = el('div', { class: 'gallery-grid' });
    const selectionMode = isGallerySelectionMode(scope);
    for (const p of pages) {
      const illustPage = Array.isArray(book.illustrationPages) && book.illustrationPages.find(ip => Number(ip.pageNum) === Number(p.pageNum));
      const isPending   = !!(illustPage && !illustPage.confirmed);
      const isConfirmed = !!(illustPage && illustPage.confirmed);
      const selected = state.gallerySelection.includes(p.pageNum);
      const annSummary = scope === 'illustrations' ? getGalleryPageAnnotationSummary(book, p.pageNum) : null;
      const queueMode = annSummary?.mode || '';
      const ta = getGalleryPageTextAsset(book, p);
      const textLabel = ta.textStatus === 'reviewed' || ta.verified ? '已核对'
        : getEffectivePageText(ta) ? (ta.correctedText ? '已修订' : '已提取') : '缺失';
      // illustration scope: derive border class from annotation status
      let annStateClass = '';
      if (scope === 'illustrations') {
        const st = annSummary?.status || 'todo';
        annStateClass = st === 'ok' ? ' st-ann-ok'
          : st === 'review' ? ' st-ann-review'
            : st === 'bad' ? ' st-ann-bad'
              : ' st-ann-todo';
      }
      const pageStateClass = scope === 'pages'
        ? (isConfirmed ? ' st-confirmed' : isPending ? ' st-pending' : '')
        : '';
      const card = el('div', {
        class: 'gallery-card' + pageStateClass + annStateClass
          + (selectionMode ? ' selection-mode' : '') + (selected ? ' selected' : ''),
        'data-page-num': String(p.pageNum),
        role: selectionMode ? 'button' : null,
        tabindex: selectionMode ? '0' : null,
        'aria-pressed': selectionMode ? String(selected) : null,
        title: selectionMode ? (selected ? '点击取消选择' : '点击选择此页') : '打开页面',
        onclick: () => selectionMode
          ? toggleGalleryPageSelection(p.pageNum)
          : openPageDetail(book.id, p.pageNum, scope),
        onkeydown: selectionMode ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleGalleryPageSelection(p.pageNum);
          }
        } : null,
      });
      const thumb = el('div', { class: 'thumb', style: `background-image: url("${p.thumb}")` });
      if (scope === 'illustrations') {
        if (annSummary?.records?.length) {
          if (annSummary.isSplit || annSummary.records.some(img => img.hasMultipleIllustrations))
            thumb.appendChild(el('div', { class: 'multi-warn', title: '\u68c0\u6d4b\u5230\u591a\u56fe\uff0c\u5efa\u8bae\u4eba\u5de5\u6838\u67e5' }, '\u26a0\ufe0f'));
          const dotTitle = { ok: '\u5df2\u786e\u8ba4', review: '\u5f85\u6838\u67e5', running: '\u6807\u6ce8\u4e2d', todo: '\u5f85\u6807\u6ce8', bad: '\u5df2\u8df3\u8fc7' }[annSummary.status] || '';
          thumb.appendChild(el('div', { class: 'status-dot ' + (annSummary.status || 'todo'), title: dotTitle }));
        }
      }
      card.appendChild(thumb);
      const info = el('div', { class: 'info' },
        el('span', { class: 'pn' }, '第 ' + p.pageNum + ' 页'),
        scope === 'pages' && Number(p.pageNum) === getShowcaseCoverPageNum(book)
          ? el('span', { class: 'added-tag', style: 'background:#fff7ed; color:#9a3412; border-color:#fed7aa;' }, '展示封面')
          : null,
        scope === 'illustrations'
          ? (annSummary?.isSplit
              ? el('span', { class: 'added-tag', style: getGallerySummaryTagStyle(annSummary.status) }, annSummary.label)
              : queueMode === 'full_page'
              ? el('span', { class: 'added-tag', style: 'background:#fff8e1; color:#8a6d1f; border-color:#efd58b;' }, '整页待确认')
              : el('span', { class: 'added-tag' }, '裁图'))
          : null,   // 全书页网格不再显示「✓ 插图」绿字，插图页由绿色边框标识即可
        // 文字状态降噪：正常（已提取/已核对）不显示，仅缺失时橙色告警
        textLabel === '缺失' ? el('span', { style: 'font-size:11px; color:var(--c-warning); font-weight:600;' }, '⚠ 缺原文') : null,
      );
      card.appendChild(info);
      grid.appendChild(card);
    }
    scroll.appendChild(grid);
  } else {
    // list view
    const list = el('div', { style: 'background:#fff; border-radius:10px; box-shadow:var(--shadow-card); overflow:hidden;' });
    const selectionMode = isGallerySelectionMode(scope);
    for (const p of pages) {
      const added = Array.isArray(book.illustrationPages) && book.illustrationPages.some(ip => Number(ip.pageNum) === Number(p.pageNum));
      const selected = state.gallerySelection.includes(p.pageNum);
      const annSummary = scope === 'illustrations' ? getGalleryPageAnnotationSummary(book, p.pageNum) : null;
      const queueMode = annSummary?.mode || '';
      const ta = getGalleryPageTextAsset(book, p);
      const textLabel = ta.textStatus === 'reviewed' || ta.verified ? '已核对'
        : getEffectivePageText(ta) ? (ta.correctedText ? '已修订' : '已提取') : '缺失';
      list.appendChild(el('div', {
        'data-page-num': String(p.pageNum),
        class: selectionMode ? 'gallery-list-row selection-mode' + (selected ? ' selected' : '') : 'gallery-list-row',
        style: `display:grid; grid-template-columns: 60px 80px 1fr auto; align-items:center; gap:14px; padding:8px 14px; border-bottom:1px solid var(--c-border); cursor:pointer; ${selected ? 'background:#eaf4fb;' : ''}`,
        role: selectionMode ? 'button' : null,
        tabindex: selectionMode ? '0' : null,
        'aria-pressed': selectionMode ? String(selected) : null,
        onclick: () => selectionMode
          ? toggleGalleryPageSelection(p.pageNum)
          : openPageDetail(book.id, p.pageNum, scope),
        onkeydown: selectionMode ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleGalleryPageSelection(p.pageNum);
          }
        } : null,
      },
        el('img', { src: p.thumb, style: 'width:60px; border:1px solid var(--c-border); border-radius:4px' }),
        el('span', { style: 'font-family: var(--f-mono); font-size:13px' }, '第 ' + p.pageNum + ' 页'),
        el('span', { style: 'font-family: var(--f-serif); font-size:13px; color:var(--c-text-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;' }, ((ta.associatedText || getEffectivePageText(ta) || p.text || '').slice(0, 80) || '（无文字）')),
        el('span', null,
          scope === 'illustrations'
            ? (annSummary?.isSplit
                ? el('span', { class: annSummary.status === 'ok' ? 'pill ok' : annSummary.status === 'review' ? 'pill review' : 'pill todo' }, el('span', { class: 'dot' }), annSummary.label)
                : queueMode === 'full_page'
                ? el('span', { class: 'pill review' }, el('span', { class: 'dot' }), '整页待确认')
                : el('span', { class: 'pill ok' }, el('span', { class: 'dot' }), '裁图'))
            : (p.cropRect
                ? el('span', { class: 'pill ok' }, el('span', { class: 'dot' }), '插图')
                : el('span', { class: 'pill todo' }, el('span', { class: 'dot' }), '未识别')),
          ' ',
          scope === 'pages' && Number(p.pageNum) === getShowcaseCoverPageNum(book)
            ? el('span', { class: 'pill review' }, el('span', { class: 'dot' }), '展示封面')
            : null,
          ' ',
          ta.textStatus === 'reviewed'
            ? el('span', { class: 'pill ok' }, el('span', { class: 'dot' }), textLabel)
            : getEffectivePageText(ta)
              ? el('span', { class: 'pill review' }, el('span', { class: 'dot' }), textLabel)
              : el('span', { class: 'pill todo' }, el('span', { class: 'dot' }), textLabel),
        ),
      ));
    }
    scroll.appendChild(list);
  }

  if (savedScrollTop !== null) {
    scroll.scrollTop = savedScrollTop;
  }
  const focusPageNum = suppressFocus ? null : Number(_galleryFocusRequestPageNum);
  _galleryFocusRequestPageNum = null;
  if (focusPageNum) {
    setTimeout(() => {
      const target = $('#main-scroll')?.querySelector(`[data-page-num="${focusPageNum}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }
}

/* ============================================================
   v1.1: PAGE DETAIL (DUAL VIEW)
   ============================================================ */
function openPageDetail(bookId, pageNum, scope = state.galleryScope || 'illustrations', preferredImageId = null) {
  const book = getBook(bookId);
  const currentImg = book ? getActiveQueuedImageForPage(book, pageNum, preferredImageId || state.selectedId) : null;
  const sameWorkspace = state.mainView === 'page-detail' && state.currentBookId === bookId;
  const normalizedScope = scope === 'text' ? 'pages' : scope;
  const modeFromScope = scope === 'text' ? 'text' : (scope === 'pages' ? 'page' : 'illust');
  if (sameWorkspace) {
    const nextMode = scope === 'pages'
      ? (state.pageDetailMode === 'text' ? 'text' : 'page')
      : modeFromScope;
    // 同书内翻页：走轻量路径（局部重渲染，不全量 renderAll），避免大列表抖动
    state.currentBookId = bookId;
    state.currentBookPage = pageNum;
    state.pageBrowseScope = normalizedScope;
    state.pageDetailMode = nextMode;
    state.rightTab = 'form';
    state.selectedId = currentImg ? currentImg.id : null;
    deferPersist();
    renderPageDetailView();
    renderRightTab();
    return;
  }
  navigateTo('page-detail', {
    currentBookId:   bookId,
    currentBookPage: pageNum,
    pageBrowseScope: normalizedScope,
    pageDetailMode:  modeFromScope,
    rightTab:        'form',
    selectedId:      currentImg ? currentImg.id : null,
  });
}

function refreshPageDetailWorkspace(bookId = state.currentBookId, pageNum = state.currentBookPage) {
  if (!(state.mainView === 'page-detail' && state.currentBookId === bookId && state.currentBookPage === pageNum)) return;
  const book = getBook(bookId);
  const currentImg = book ? getActiveQueuedImageForPage(book, pageNum, state.selectedId) : null;
  state.selectedId = currentImg ? currentImg.id : null;
  renderPageDetailView();
  renderRightTab();
}

async function detectSinglePageIllustration(book, page) {
  const doc = await ensurePdfDoc(book);
  if (!doc) {
    toast('该书 PDF 当前未加载，无法识别本页插图', 'warn');
    return false;
  }
  const result = await analyzePage(doc, pdfPageOf(page), getSensitivityThreshold(book));
  applyAnalyzeResultToPage(page, result, { allowClearCrop: true });
  page.imageScanSource = 'manual_single';

  const list = Array.isArray(book.illustrationPages) ? book.illustrationPages.slice() : [];
  const existingIdx = list.findIndex(p => p.pageNum === page.pageNum);

  if (result.isIllust && result.cropRect) {
    if (existingIdx === -1) list.push(page);
    else list[existingIdx] = page;
    list.sort((a, b) => a.pageNum - b.pageNum);
    book.illustrationPages = list;
    persist();
    await maybeSyncBookMeta(book);
    renderBooksList();
    if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
    refreshPageDetailWorkspace(book.id, page.pageNum);
    toast(`第 ${page.pageNum} 页已识别为插图页`, 'success');
    return true;
  }
  if (existingIdx !== -1) {
    list.splice(existingIdx, 1);
    book.illustrationPages = list;
  }
  persist();
  await maybeSyncBookMeta(book);
  renderBooksList();
  if (state.mainView === 'gallery' && state.currentBookId === book.id) renderGalleryView();
  refreshPageDetailWorkspace(book.id, page.pageNum);
  toast(`第 ${page.pageNum} 页未识别到插图，可继续浏览或调整灵敏度`, 'warn');
  return false;
}

/* ============================================================
   TEXT ASSET PANEL
   ============================================================ */
const TA_SOURCE_LABEL = {
  'pdf_text_layer': 'PDF文字层', 'ai_ocr': 'AI OCR',
  'ai_annotation_byproduct': 'AI标注回填', 'manual': '人工录入', 'mock': 'Mock', 'none': '无',
};
const TA_SOURCE_CSS = {
  'pdf_text_layer': 'src-pdf', 'ai_ocr': 'src-ocr',
  'ai_annotation_byproduct': 'src-ocr', 'manual': 'src-manual', 'mock': 'src-mock', 'none': 'src-none',
};
const TA_STATUS_LABEL = { 'missing': '缺失', 'ocr': '已OCR', 'extracted': '已提取', 'reviewed': '已核对' };
const TA_STATUS_CSS   = { 'missing': 'st-missing', 'ocr': 'st-extracted', 'extracted': 'st-extracted', 'reviewed': 'st-reviewed' };

function renderTextAssetPanel(book, page) {
  // 确保 textAsset 存在
  if (!page.textAsset) {
    const t = (page.text || '').trim();
    page.textAsset = {
      fullText: t, associatedText: '', associatedPageNums: [],
      textSource: t ? 'pdf_text_layer' : 'none',
      textStatus: t ? 'extracted' : 'missing',
      verified: false, ocrModel: '', extractedAt: '', updatedAt: '',
      correctedText: '', correctedAt: '', reviewedAt: '', reviewNote: '',
    };
  }
  const ta = page.textAsset;
  if (ta.correctedText === undefined) ta.correctedText = '';
  if (ta.correctedAt === undefined) ta.correctedAt = '';
  if (ta.reviewedAt === undefined) ta.reviewedAt = '';
  if (ta.reviewNote === undefined) ta.reviewNote = '';

  const panel = el('div', { class: 'ta-panel' });


  const body = el('div', { class: 'ta-panel-body' });

  // 全页原文
  body.appendChild(el('div', { class: 'ta-label' }, `全页原文（${getTextAssetProofStateLabel(ta)}）`));
  const fullTa = el('textarea', { class: 'ta-textarea', placeholder: '该页尚无文字，可点击下方按钮提取或人工录入' });
  fullTa.value = ta.correctedText || ta.fullText || '';
  fullTa.oninput = () => {
    const nextText = String(fullTa.value || '');
    const original = String(ta.fullText || '');
    const now = new Date().toISOString();
    if (nextText !== original && nextText.trim()) {
      ta.correctedText = nextText;
      ta.correctedAt = now;
    } else {
      ta.correctedText = '';
      ta.correctedAt = '';
    }
    ta.updatedAt = now;
    ta.verified = false;
    ta.reviewedAt = '';
    ta.textStatus = nextText.trim() ? 'extracted' : 'missing';
    if (!ta.textSource || ta.textSource === 'none' || ta.textSource === 'manual_corrected') {
      ta.textSource = original.trim() ? (ta.ocrModel ? 'ai_ocr' : 'pdf_text_layer') : 'manual';
    }
    persist();
  };
  body.appendChild(fullTa);

  // ── AI 扫描结果 ──────────────────────────────────────────────
  const livePage  = getBookPageRecord(book, page.pageNum) || page;
  const scanNote  = livePage.illustScanNote || page.illustScanNote || '';
  const isIllust  = Array.isArray(book.illustrationPages) &&
                    book.illustrationPages.some(ip => Number(ip.pageNum) === Number(page.pageNum));

  if (isIllust || ta.fullScanDone) {
    body.appendChild(el('hr', { class: 'ta-divider' }));
    const scanRow = el('div', { style: 'display:flex; align-items:center; gap:6px; margin-bottom:6px;' });
    scanRow.appendChild(el('span', { class: 'ta-label', style: 'margin:0;' }, 'AI 扫描结果'));
    if (isIllust) scanRow.appendChild(el('span', { style: 'font-size:10px; background:var(--c-primary); color:#fff; border-radius:8px; padding:1px 7px;' }, '含插图'));
    if (ta.ocrModel) scanRow.appendChild(el('span', { style: 'font-size:10px; color:var(--c-text-mute); margin-left:auto;' }, ta.ocrModel));
    body.appendChild(scanRow);
    if (scanNote) {
      body.appendChild(el('div', { style: 'font-size:12px; color:var(--c-text-soft); line-height:1.7; margin-bottom:4px;' }, `插图：${scanNote}`));
    }
    if (!ta.fullText?.trim() && ta.fullScanDone) {
      body.appendChild(el('div', { style: 'font-size:12px; color:var(--c-text-mute);' }, '本页未提取到文字'));
    }
  }

  body.appendChild(el('div'));
  panel.appendChild(body);
  return panel;
}

function renderBookProfilePanel(book, opts = {}) {
  const { collapsible = false, open = true } = opts;
  const traits = getBookTraits(book);
  const panel = el('div', { class: 'ta-panel', style: 'margin:12px 0 4px' });
  if (!collapsible) {
    panel.appendChild(el('div', { class: 'ta-panel-head' },
      el('span', null, '📚 书籍介绍与整书特征')
    ));
  }
  const body = el('div', { class: 'ta-panel-body', style: 'display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 16px;' });
  const meta = el('div', { style: 'grid-column:1 / -1; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px 16px;' },
    el('div', null, el('div', { class: 'ta-label' }, '书名'), el('div', { style: 'font-size:13px; color:#555' }, book.title || '—')),
    el('div', null, el('div', { class: 'ta-label' }, '朝代'), el('div', { style: 'font-size:13px; color:#555' }, book.dynasty || '—')),
    el('div', null, el('div', { class: 'ta-label' }, '版本 / 卷次'), el('div', { style: 'font-size:13px; color:#555' }, book.version || '—')),
  );
  body.appendChild(meta);
  const blockTypes = ['写刻本','仿宋刻','嘉靖刻','万历刻','清刻','石印','铅印','活字本','其他'];
  const layoutOpts = ['图在文前','图在文后','图文夹排','整页图后附文','不明'];
  const directionOpts = ['竖排右起','竖排左起','横排左起','横排右起','双栏混排','不明'];
  const titleDirectionOpts = ['竖签右起','竖签左起','横排左起','横排右起','随正文','不明'];
  const pageOrderOpts = [
    { value: 'rtl', label: '从右到左' },
    { value: 'ltr', label: '从左到右' },
  ];
  // 图文排版（图文切割算法使用；与 traits.layoutRelation 描述不同，这里控制切割方向）
  const textLayoutOpts = ['auto', 'text_after', 'text_before'];
  const textLayoutLabels = { auto: '自动（两侧取文字）', text_after: '图在文前（描述在图后）', text_before: '图在文后（描述在图前）' };
  body.appendChild(field('图文切割排版', selectInput(
    textLayoutOpts.map(v => ({ value: v, label: textLayoutLabels[v] })),
    book.textLayout || 'auto',
    v => { book.textLayout = v; persist(book.id); toast('图文排版已保存', 'success'); }
  )));
  body.appendChild(field('版刻类型', selectInput(blockTypes, traits.blockType || '', v => {
    traits.blockType = v;
    persist(book.id);
  })));
  body.appendChild(field('图文排布', selectInput(layoutOpts, traits.layoutRelation || '', v => {
    traits.layoutRelation = v;
    persist(book.id);
  })));
  body.appendChild(field('文字方向', selectInput(directionOpts, traits.textDirection || '', v => {
    traits.textDirection = v;
    persist(book.id);
  })));
  body.appendChild(field('题签方向', selectInput(titleDirectionOpts, traits.titleLabelDirection || '', v => {
    traits.titleLabelDirection = v;
    persist(book.id);
  })));
  body.appendChild(field('书页顺序', selectInput(pageOrderOpts, traits.pageOrder || 'rtl', v => {
    traits.pageOrder = v || 'rtl';
    persist(book.id);
    if (state.mainView === 'page-detail' && state.pageDetailMode === 'page' && state.currentBookId === book.id) {
      refreshPageDetailWorkspace(book.id, state.currentBookPage || 1);
    }
  })));
  // ── 专题说明（学术参照用途）────────────────────────────────────────────────
  const topicTa = el('textarea', {
    rows: 3,
    placeholder: '可简述本书图像专题特征，如：本书样本以炮制操作图、药材形态图与相关器具场景图为主，学术参照分类主要集中于药物图、医疗图、器具图。',
    style: 'width:100%; font-size:12.5px; line-height:1.6; resize:vertical; padding:6px 8px; border:1px solid var(--c-border); border-radius:5px; color:var(--c-text); background:#fff; box-sizing:border-box;',
  });
  topicTa.value = book.topicNote || '';
  topicTa.oninput = e => { book.topicNote = e.target.value; persist(book.id); };
  const topicWrap = el('div', { style: 'grid-column: 1 / -1;' });
  topicWrap.appendChild(field('专题说明（学术参照）', topicTa));
  body.appendChild(topicWrap);
  const readingTa = el('textarea', {
    rows: 3,
    placeholder: '用于 AI 标注的阅读规则备注，如：本书正文默认竖排右起，蓝底题签优先按右起竖读；仅遇明确横排注释时例外。',
    style: 'width:100%; font-size:12.5px; line-height:1.6; resize:vertical; padding:6px 8px; border:1px solid var(--c-border); border-radius:5px; color:var(--c-text); background:#fff; box-sizing:border-box;',
  });
  readingTa.value = traits.readingNote || '';
  readingTa.oninput = e => { traits.readingNote = e.target.value; persist(book.id); };
  const readingWrap = el('div', { style: 'grid-column: 1 / -1;' });
  readingWrap.appendChild(field('阅读规则备注', readingTa));
  body.appendChild(readingWrap);
  // 编辑基本信息入口（书名/朝代/版本/刻本/收藏机构等）
  if (!book.isGroupProxy) {
    const editBasicBtn = el('button', {
      class: 'btn',
      style: 'grid-column: 1 / -1; font-size:12.5px;',
      onclick: () => openBookInfoEditor(book),
    }, '✎ 编辑书名 / 朝代 / 刻本等基本信息');
    body.appendChild(editBasicBtn);
  }
  if (!collapsible) {
    panel.appendChild(body);
    return panel;
  }

  const detailsEl = el('details', {
    style: 'margin:12px 0 4px; border:1px solid var(--c-border); border-radius:8px; overflow:hidden; background:#fff;',
    ...(open ? { open: '' } : {}),
  });
  const sumEl = el('summary', {
    style: 'cursor:pointer; list-style:none; padding:10px 12px; font-size:13px; font-weight:600; color:var(--c-text); background:#f7f8fa; border-bottom:1px solid var(--c-border);'
  }, '📚 书籍介绍与整书特征');
  detailsEl.appendChild(sumEl);
  detailsEl.appendChild(body);
  return detailsEl;
}

function renderPageDetailView() {
  const scroll = $('#main-scroll');
  scroll.innerHTML = '';
  const book = getCurrentBook();
  if (!book) { state.mainView = 'annotate'; renderAll(); return; }
  const page = getBookPageRecord(book, state.currentBookPage);
  if (!page) { state.mainView = 'gallery'; renderAll(); return; }
  updateShellLayout();
  const illustrationPageList = getVisibleConfirmedIllustrations(book);
  const illustTargetPageNum = illustrationPageList.some(p => p.pageNum === page.pageNum)
    ? page.pageNum
    : (illustrationPageList[0]?.pageNum || page.pageNum);
  const pageScope = state.pageDetailMode === 'illust' ? 'illustrations' : 'pages';
  state.pageBrowseScope = pageScope;
  const illustrationNavItems = pageScope === 'illustrations' ? getIllustrationNavItems(book) : [];
  const rawPageList = pageScope === 'pages'
    ? getBookPages(book)
    : illustrationNavItems.map(item => item.page);
  const pageList = rawPageList.some(p => p.pageNum === page.pageNum) ? rawPageList : [page];
  const added = !!getQueuedImageForPage(book, page.pageNum);
  const idx = pageList.findIndex(p => p.pageNum === page.pageNum);
  const traits = getBookTraits(book) || {};
  const pageOrder = traits.pageOrder === 'ltr' ? 'ltr' : 'rtl';

  setMainHeader(
    buildBreadcrumbBar([
      { label: book.title, onClick: () => openGallery(book.id, pageScope) },
      { label: pageScope === 'pages' ? '全书页' : '插图队列', onClick: () => openGallery(book.id, pageScope) },
      { label: `第 ${page.pageNum} 页`, onClick: () => openGallery(book.id, 'pages', page.pageNum) },
      { label: state.pageDetailMode === 'text' ? '文字校核' : (state.pageDetailMode === 'page' ? '页面视图' : '插图视图'), current: true },
    ], state._returnCtx ? renderReturnButton() : null),
  );
  if (state.pageDetailMode !== 'text') {
    scroll.appendChild(el('div', { class: 'step-bar-content' }, buildStepBar(pageScope === 'pages' ? 2 : 3, book)));
  }

  // header card
  const head = el('div', { class: 'pd-card' });
  const modeSwitch = el('div', { class: 'view-seg pd-mode-switch' },
    el('button', { class: state.pageDetailMode === 'illust' ? 'on' : '', onclick: () => openPageDetail(book.id, illustTargetPageNum, 'illustrations') }, '🖼 插图'),
    el('button', { class: state.pageDetailMode === 'page' ? 'on' : '', onclick: () => { state.pageDetailMode = 'page'; state.pageBrowseScope = 'pages'; persist(); refreshPageDetailWorkspace(book.id, page.pageNum); } }, '📄 页面'),
    el('button', { class: state.pageDetailMode === 'text' ? 'on' : '', onclick: () => { state.pageDetailMode = 'text'; state.pageBrowseScope = 'pages'; persist(); refreshPageDetailWorkspace(book.id, page.pageNum); } }, '校文'),
  );
  const pageTools = [
      state.pageDetailMode === 'page'
        ? el('button', {
            class: 'btn',
            title: pageOrder === 'rtl' ? '当前：从右往左（古籍习惯），点击改为从左往右' : '当前：从左往右，点击改为从右往左',
            onclick: () => { traits.pageOrder = pageOrder === 'rtl' ? 'ltr' : 'rtl'; persist(book.id); refreshPageDetailWorkspace(book.id, page.pageNum); },
          }, pageOrder === 'rtl' ? '右→左' : '左→右')
        : null,
      state.pageDetailMode === 'page'
        ? el('button', {
            class: 'btn' + (state.pageSoloMode ? ' primary' : ''),
            title: state.pageSoloMode ? '当前：单页，点击切换为双页展示' : '当前：双页，点击切换为单页展示',
            onclick: () => { state.pageSoloMode = !state.pageSoloMode; refreshPageDetailWorkspace(book.id, page.pageNum); },
          }, state.pageSoloMode ? '单页' : '双页')
        : null,
      state.pageDetailMode === 'page'
        ? el('div', { class: 'view-seg', title: '缩放页面（点击百分比重置）' },
            el('button', { onclick: () => { state.pageZoom = Math.max(0.25, Math.round(((state.pageZoom || 1) - 0.25) * 100) / 100); refreshPageDetailWorkspace(book.id, page.pageNum); } }, '−'),
            el('span', { class: 'zoom-label', title: '点击重置为 100%', onclick: () => { state.pageZoom = 1; refreshPageDetailWorkspace(book.id, page.pageNum); } },
              `${Math.round((state.pageZoom || 1) * 100)}%`),
            el('button', { onclick: () => { state.pageZoom = Math.min(4, Math.round(((state.pageZoom || 1) + 0.25) * 100) / 100); refreshPageDetailWorkspace(book.id, page.pageNum); } }, '+'),
          )
        : null,
      state.pageDetailMode === 'page' && page.pageNum === 1
        ? el('button', {
            class: 'btn' + (traits.coverPageNum === 1 ? ' primary' : ''),
            title: traits.coverPageNum === 1 ? '取消封面，恢复双页展示' : '设为封面，第 1 页单页展示，其余双页展示',
            onclick: () => {
              traits.coverPageNum = traits.coverPageNum === 1 ? null : 1;
              persist(book.id);
              refreshPageDetailWorkspace(book.id, page.pageNum);
            },
          }, traits.coverPageNum === 1 ? '取消封面' : '设为封面')
        : null,
  ].filter(Boolean);
  head.appendChild(el('div', { class: 'pd-head' },
    el('div', { class: 'pd-title' }, `📗 ${book.title} · 第 ${page.pageNum} 页`),
    el('div', { class: 'pd-mode-panel' },
      modeSwitch,
      pageTools.length ? el('div', { class: 'pd-page-tools' }, ...pageTools) : null,
    ),
  ));
  const body = el('div', { class: 'pd-body' });

  if (state.pageDetailMode === 'illust') {
    body.appendChild(renderIllustMode(book, page));
  } else if (state.pageDetailMode === 'text') {
    body.appendChild(renderTextProofMode(book, page));
  } else {
    body.appendChild(renderPageMode(book, page));
  }

  let prevPageTarget, nextPageTarget, pageCounterText;
  if (pageScope === 'pages') {
    if (state.pageDetailMode === 'text') {
      const navIdx = pageList.findIndex(p => Number(p.pageNum) === Number(page.pageNum));
      prevPageTarget = navIdx > 0 ? pageList[navIdx - 1] : null;
      nextPageTarget = navIdx >= 0 && navIdx < pageList.length - 1 ? pageList[navIdx + 1] : null;
      pageCounterText = `第${page.pageNum}页/${pageList.length}页`;
    } else {
      const pageSpreads = getSpreadSequence(pageList, traits.coverPageNum ?? null);
      const curSpreadIdx = pageSpreads.findIndex(s => s.some(p => p.pageNum === page.pageNum));
      const curSpread = curSpreadIdx >= 0 ? pageSpreads[curSpreadIdx] : [page];
      prevPageTarget = curSpreadIdx > 0 ? pageSpreads[curSpreadIdx - 1][0] : null;
      nextPageTarget = curSpreadIdx < pageSpreads.length - 1 ? pageSpreads[curSpreadIdx + 1][0] : null;
      pageCounterText = `第${curSpread.map(p => p.pageNum).join('、')}页/${pageList.length}页`;
    }
  } else {
    const activeImg = getActiveQueuedImageForPage(book, page.pageNum, state.selectedId);
    let navIdx = activeImg
      ? illustrationNavItems.findIndex(item => item.imageId === activeImg.id)
      : -1;
    if (navIdx < 0) navIdx = illustrationNavItems.findIndex(item => Number(item.pageNum) === Number(page.pageNum));
    prevPageTarget = navIdx > 0 ? illustrationNavItems[navIdx - 1] : null;
    nextPageTarget = navIdx >= 0 && navIdx < illustrationNavItems.length - 1 ? illustrationNavItems[navIdx + 1] : null;
    pageCounterText = navIdx >= 0
      ? `第 ${navIdx + 1} / ${illustrationNavItems.length} 张`
      : `第 ${Math.max(1, idx + 1)} / ${pageList.length} 处`;
  }

  // 页面模式翻页绑定页面主体区（不含顶部工具行，避免侧边热区遮挡按钮）；
  // 插图模式翻页绑定上方主图框，不受下方图项列表高度影响。
  // 校文模式也只在正文图片框上放置一组左右翻页键，避免校正文框出现重复控件。
  const proofImageFrame = body.querySelector('.ocr-proof-image-frame');
  const navHost = state.pageDetailMode === 'text' && proofImageFrame
    ? proofImageFrame
    : pageScope === 'illustrations'
      ? (body.querySelector('.pd-illust-frame') || body)
      : body;
  navHost.classList.add('pd-illust-stage');
  navHost.appendChild(el('button', {
    class: 'pd-side-nav prev',
    title: pageScope === 'illustrations' ? '上一插图' : '上一页',
    disabled: prevPageTarget ? null : '',
    onclick: () => prevPageTarget && openPageDetail(book.id, prevPageTarget.pageNum, pageScope, prevPageTarget.imageId || null),
  }, '‹'));
  navHost.appendChild(el('button', {
    class: 'pd-side-nav next',
    title: pageScope === 'illustrations' ? '下一插图' : '下一页',
    disabled: nextPageTarget ? null : '',
    onclick: () => nextPageTarget && openPageDetail(book.id, nextPageTarget.pageNum, pageScope, nextPageTarget.imageId || null),
  }, '›'));
  // illust nav + add-to-queue
  if (pageScope === 'illustrations') {
    body.appendChild(el('div', { class: 'pd-nav' },
      el('span'),
      el('span', { class: 'img-counter' }, pageCounterText),
      el('span'),
    ));
  } else {
    body.appendChild(el('div', { class: 'pd-nav' },
      el('span'),
      el('span', { class: 'img-counter' }, pageCounterText),
      el('span'),
    ));
  }
  // 页面下方的旧按钮排已移除：单图页可直接入队，多图页需先人工拆成图1/图2；
  // 具体操作统一放在右侧面板和中间图像区，避免页面底部出现重复入口。
  head.appendChild(body);
  scroll.appendChild(head);
}

function applyPageTextToAnnotation(book, page, text, sourcePageNums = [page.pageNum]) {
  // write to page-level textAsset (single source of truth)
  if (!page.textAsset) getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } });
  if (page.textAsset) {
    page.textAsset.associatedText = text;
    page.textAsset.associatedPageNums = Array.isArray(sourcePageNums)
      ? [...new Set(sourcePageNums.map(n => Number(n)).filter(Number.isFinite))]
      : [page.pageNum];
    page.textAsset.associatedSource = 'manual';   // 人工指定，区别于自动切割 auto_text_cut
    page.textAsset.updatedAt = new Date().toISOString();
  }
  // sync into any queued image for this page
  let img = state.illustrations.find(i => i.pdfSource?.bookId === book.id && i.pdfSource.pageNum === page.pageNum);
  if (!img) {
    const id = addImageFromBookPage(book, page.pageNum);
    img = id ? state.illustrations.find(i => i.id === id) : null;
  }
  if (img) {
    img.crossref = img.crossref || { classical: '', verdict: '', note: '' };
    img.crossref.classical = text;
    state.selectedId = img.id;
  }
  toast(`已设为关联段落（${formatEvidencePageNums(page.textAsset?.associatedPageNums || [page.pageNum])}）`, 'success');
  persist();
  renderAll();
}

/* ============================================================
   ILLUST / PAGE RENDER MODES
   ============================================================ */
// 插图模式内联裁剪编辑器：在 host(整页图容器)上叠加可拖拽绿框（画/移动/拉角），返回 { getRect }
function attachIllustCropEditor(host, page, opts = {}) {
  const initialRect = normalizeRect(opts.initialRect)
    || (opts.allowEmptyInitial ? null : (normalizeRect(page.cropRect) || [0.15, 0.12, 0.85, 0.9]));
  const initialQuad = normalizeQuad(opts.initialQuad);
  const hintText = opts.hintText || '拖框圈插图本体，可拉四角微调';
  let draft = initialRect ? initialRect.slice() : null;
  let draftQuad = initialQuad ? initialQuad.map(pt => pt.slice()) : null;
  let rotationDeg = clampCropRotationDeg(opts.rotationDeg || 0);
  let perspectiveMode = !!draftQuad;
  let syncRotationLabel = () => {};
  const imageNode = host.querySelector('img,canvas');
  const C = '#2e9e5b', F = 'rgba(46,158,91,0.18)';
  const editor = el('div', { style: 'position:absolute; inset:0; z-index:4; cursor:crosshair;' });
  const referenceRects = Array.isArray(opts.referenceRects) ? opts.referenceRects : [];
  const onReferenceClick = typeof opts.onReferenceClick === 'function' ? opts.onReferenceClick : null;
  referenceRects.forEach((item, idx) => {
    const r = normalizeRect(item?.rect || item);
    const q = normalizeQuad(item?.quad);
    if (!r) return;
    const label = item?.label || `图${idx + 1}`;
    const clickable = !!onReferenceClick;
    const actionLabel = item?.actionLabel || (clickable ? '编辑' : '');
    const ref = el('div', {
      title: clickable ? (item?.title || '点击编辑该图项范围') : '',
      style: getGeometryStyle(q || r, `position:absolute; pointer-events:${clickable ? 'auto' : 'none'}; cursor:${clickable ? 'pointer' : 'default'}; border:2px dashed #1e88e5; background:rgba(30,136,229,0.10); box-shadow:0 0 0 1px rgba(255,255,255,0.7) inset;`)
    });
    ref.appendChild(el('div', {
      style: 'position:absolute; left:4px; top:4px; padding:2px 6px; border-radius:999px; background:rgba(30,136,229,0.92); color:#fff; font-size:11px; line-height:1.4; white-space:nowrap;'
    }, clickable ? `${label} · ${actionLabel}` : label));
    if (clickable) {
      ref.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
      });
      ref.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (item?.copyOnClick) {
          draft = r.slice();
          draftQuad = q ? q.map(pt => pt.slice()) : null;
          perspectiveMode = !!draftQuad;
          rotationDeg = clampCropRotationDeg(item.rotationDeg || 0);
          place();
          syncRotationLabel();
        }
        onReferenceClick(item);
      });
    }
    editor.appendChild(ref);
  });
  const draftEl = el('div', { style: 'position:absolute; display:none; pointer-events:none;' });
  editor.appendChild(draftEl);
  const handles = ['nw', 'ne', 'sw', 'se'].map(pos => {
    const h = el('div', { style: 'position:absolute; display:none; width:13px; height:13px; border-radius:999px; background:' + C + '; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.25); pointer-events:none;' });
    h.dataset.pos = pos; editor.appendChild(h); return h;
  });
  editor.appendChild(el('div', { style: 'position:absolute; left:8px; top:8px; background:rgba(26,58,92,.86); color:#fff; padding:5px 9px; border-radius:999px; font-size:11px; pointer-events:none;' }, hintText));
  const rotLine = el('div', {
    title: '按住拖动微调旋转角度（-5° 到 5°）',
    style: 'position:absolute; display:none; width:2px; height:24px; background:#2e9e5b; box-shadow:0 0 0 1px #fff; transform-origin:50% 100%; pointer-events:auto; cursor:grab; z-index:7;'
  });
  const rotKnob = el('div', {
    title: '按住拖动微调旋转角度（-5° 到 5°）',
    style: 'position:absolute; display:none; width:16px; height:16px; border-radius:999px; background:#fff; border:2px solid #2e9e5b; box-shadow:0 1px 5px rgba(0,0,0,.28); pointer-events:auto; cursor:grab; z-index:8;'
  });
  const rotBubble = el('div', {
    style: 'position:absolute; display:none; padding:3px 7px; border-radius:999px; background:rgba(26,58,92,.88); color:#fff; font-size:11px; line-height:1.3; white-space:nowrap; pointer-events:none; z-index:9;'
  }, `${rotationDeg.toFixed(1)}°`);
  const rotReset = el('button', {
    type: 'button',
    title: '还原旋转角度为 0°',
    style: 'position:absolute; display:none; padding:3px 7px; border-radius:999px; border:1px solid rgba(46,158,91,.45); background:rgba(255,255,255,.95); color:#2e6b45; font-size:11px; line-height:1.2; cursor:pointer; z-index:9;'
  }, '还原');
  const modeBtn = el('button', {
    type: 'button',
    title: '切换透视校正模式',
    style: 'position:absolute; right:12px; top:12px; padding:4px 9px; border-radius:999px; border:1px solid rgba(46,158,91,.35); background:rgba(255,255,255,.94); color:#2e6b45; font-size:11px; line-height:1.2; cursor:pointer; z-index:9;'
  }, perspectiveMode ? '矩形框' : '透视校正');
  const syncRotationUi = (showAngle = false) => {
    rotBubble.textContent = `${rotationDeg.toFixed(1)}°`;
    rotBubble.style.display = showAngle || Math.abs(rotationDeg) >= 0.05 ? '' : 'none';
    rotReset.style.display = draft && Math.abs(rotationDeg) >= 0.05 ? '' : 'none';
  };
  syncRotationLabel = () => { syncRotationUi(false); };
  [rotLine, rotKnob].forEach(node => editor.appendChild(node));
  editor.appendChild(rotBubble);
  editor.appendChild(rotReset);
  editor.appendChild(modeBtn);
  const cloneQuad = (quad) => normalizeQuad(quad)?.map(pt => pt.slice()) || null;
  const syncModeBtn = () => { modeBtn.textContent = perspectiveMode ? '矩形框' : '透视校正'; };
  const place = () => {
    if (!draft && !draftQuad) {
      draftEl.style.display = 'none';
      handles.forEach(h => h.style.display = 'none');
      rotLine.style.display = 'none';
      rotKnob.style.display = 'none';
      rotBubble.style.display = 'none';
      rotReset.style.display = 'none';
      return;
    }
    const effectiveRect = draft || quadToRect(draftQuad);
    draftEl.style.cssText = perspectiveMode && draftQuad
      ? getGeometryStyle(draftQuad, `position:absolute; display:block; pointer-events:none; border:2px solid ${C}; background:${F};`)
      : getRectStyle(draft, `position:absolute; display:block; pointer-events:none; border:2px solid ${C}; background:${F}; transform:rotate(${rotationDeg.toFixed(1)}deg); transform-origin:center center;`);
    const P = perspectiveMode && draftQuad
      ? { nw: draftQuad[0], ne: draftQuad[1], se: draftQuad[2], sw: draftQuad[3] }
      : { nw: [draft[0], draft[1]], ne: [draft[2], draft[1]], sw: [draft[0], draft[3]], se: [draft[2], draft[3]] };
    handles.forEach(h => { const p = P[h.dataset.pos]; h.style.display = ''; h.style.left = `calc(${(p[0] * 100).toFixed(2)}% - 6px)`; h.style.top = `calc(${(p[1] * 100).toFixed(2)}% - 6px)`; });
    const cx = (((effectiveRect?.[0] || 0) + (effectiveRect?.[2] || 0)) / 2) * 100;
    const top = (effectiveRect?.[1] || 0) * 100;
    const box = host.getBoundingClientRect();
    const handleLen = 30;
    const angleRad = rotationDeg * Math.PI / 180;
    const knobOffsetX = box.width ? (Math.sin(angleRad) * handleLen / box.width) * 100 : 0;
    const knobOffsetY = box.height ? ((1 - Math.cos(angleRad)) * handleLen / box.height) * 100 : 0;
    if (perspectiveMode) {
      rotLine.style.display = 'none';
      rotKnob.style.display = 'none';
      rotBubble.style.display = 'none';
      rotReset.style.display = 'none';
    } else {
      rotLine.style.display = '';
      rotLine.style.left = `calc(${cx.toFixed(2)}% - 1px)`;
      rotLine.style.top = `calc(${top.toFixed(2)}% - ${handleLen + 2}px)`;
      rotLine.style.transform = `rotate(${rotationDeg.toFixed(1)}deg)`;
      rotKnob.style.display = '';
      rotKnob.style.left = `calc(${(cx + knobOffsetX).toFixed(2)}% - 8px)`;
      rotKnob.style.top = `calc(${(top + knobOffsetY).toFixed(2)}% - ${handleLen + 16}px)`;
      rotBubble.style.left = `calc(${(cx + knobOffsetX).toFixed(2)}% + 12px)`;
      rotBubble.style.top = `calc(${(top + knobOffsetY).toFixed(2)}% - ${handleLen + 21}px)`;
      rotReset.style.left = `calc(${(cx + knobOffsetX).toFixed(2)}% + 12px)`;
      rotReset.style.top = `calc(${(top + knobOffsetY).toFixed(2)}% - ${handleLen}px)`;
      syncRotationUi(false);
    }
    syncModeBtn();
  };
  modeBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  modeBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (perspectiveMode) {
      const nextRect = quadToRect(draftQuad) || draft;
      draft = nextRect ? nextRect.slice() : draft;
      draftQuad = null;
      perspectiveMode = false;
    } else if (draft) {
      draftQuad = rectToQuad(draft);
      perspectiveMode = !!draftQuad;
      rotationDeg = 0;
    }
    place();
  });
  rotReset.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  rotReset.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    rotationDeg = 0;
    place();
    syncRotationUi(false);
  });
  const beginRotate = (e) => {
    if (!draft) return;
    e.preventDefault();
    e.stopPropagation();
    const pxPerDeg = Math.max(8, Math.min(18, host.getBoundingClientRect().width / 80));
    const startX = e.clientX;
    const startRotation = rotationDeg;
    rotKnob.style.cursor = 'grabbing';
    rotLine.style.cursor = 'grabbing';
    syncRotationUi(true);
    const onMove = (ev) => {
      rotationDeg = clampCropRotationDeg(startRotation + ((ev.clientX - startX) / pxPerDeg));
      place();
      syncRotationUi(true);
    };
    const onUp = () => {
      rotKnob.style.cursor = 'grab';
      rotLine.style.cursor = 'grab';
      syncRotationUi(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  rotLine.addEventListener('mousedown', beginRotate);
  rotKnob.addEventListener('mousedown', beginRotate);
  const detect = (px, py, box) => {
    if (perspectiveMode && draftQuad) {
      const tx = Math.max(0.014, 12 / box.width), ty = Math.max(0.014, 12 / box.height);
      const keys = [['nw', draftQuad[0]], ['ne', draftQuad[1]], ['se', draftQuad[2]], ['sw', draftQuad[3]]];
      for (const [key, pt] of keys) {
        if (Math.abs(px - pt[0]) <= tx && Math.abs(py - pt[1]) <= ty) return `quad-${key}`;
      }
      const bbox = quadToRect(draftQuad);
      if (bbox && px >= bbox[0] && px <= bbox[2] && py >= bbox[1] && py <= bbox[3]) return 'move-quad';
      return 'draw';
    }
    const r = draft; if (!r) return 'draw';
    const tx = Math.max(0.012, 12 / box.width), ty = Math.max(0.012, 12 / box.height);
    const nL = Math.abs(px - r[0]) <= tx, nR = Math.abs(px - r[2]) <= tx, nT = Math.abs(py - r[1]) <= ty, nB = Math.abs(py - r[3]) <= ty;
    const iX = px >= r[0] && px <= r[2], iY = py >= r[1] && py <= r[3];
    if (nL && nT) return 'resize-nw'; if (nR && nT) return 'resize-ne'; if (nL && nB) return 'resize-sw'; if (nR && nB) return 'resize-se';
    if (nL && iY) return 'resize-w'; if (nR && iY) return 'resize-e'; if (nT && iX) return 'resize-n'; if (nB && iX) return 'resize-s';
    if (iX && iY) return 'move'; return 'draw';
  };
  const moveQuad = (quad, dx, dy) => {
    const moved = quad.map(([x, y]) => [x + dx, y + dy]);
    const rect = quadToRect(moved);
    if (!rect) return quad;
    let shiftX = 0;
    let shiftY = 0;
    if (rect[0] < 0) shiftX = -rect[0];
    else if (rect[2] > 1) shiftX = 1 - rect[2];
    if (rect[1] < 0) shiftY = -rect[1];
    else if (rect[3] > 1) shiftY = 1 - rect[3];
    return normalizeQuad(moved.map(([x, y]) => [x + shiftX, y + shiftY])) || quad;
  };
  const resize = (m, r, dx, dy) => {
    const a = r.slice();
    if (m.includes('w')) a[0] += dx; if (m.includes('e')) a[2] += dx;
    if (m.includes('n')) a[1] += dy; if (m.includes('s')) a[3] += dy;
    const mn = 0.02;
    if (a[2] - a[0] < mn) { if (m.includes('w')) a[0] = a[2] - mn; else a[2] = a[0] + mn; }
    if (a[3] - a[1] < mn) { if (m.includes('n')) a[1] = a[3] - mn; else a[3] = a[1] + mn; }
    return normalizeRect(a);
  };
  editor.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const sx = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    const sy = Math.max(0, Math.min(1, (e.clientY - box.top) / box.height));
    const mode = detect(sx, sy, box);
    const start = draft ? draft.slice() : null;
    const startQuad = cloneQuad(draftQuad);
    if (mode === 'draw') {
      draft = [sx, sy, sx, sy];
      if (perspectiveMode) draftQuad = rectToQuad(draft);
      place();
    }
    const onMove = (ev) => {
      const mx = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
      const my = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
      if (mode === 'draw') {
        draft = normalizeRect([Math.min(sx, mx), Math.min(sy, my), Math.max(sx, mx), Math.max(sy, my)]);
        if (perspectiveMode) draftQuad = rectToQuad(draft);
      }
      else if (mode === 'move-quad' && startQuad) {
        draftQuad = moveQuad(startQuad, mx - sx, my - sy);
        draft = quadToRect(draftQuad);
      }
      else if (mode.startsWith('quad-') && startQuad) {
        const key = mode.replace('quad-', '');
        const idxMap = { nw: 0, ne: 1, se: 2, sw: 3 };
        const next = cloneQuad(startQuad);
        const idx = idxMap[key];
        if (next && idx != null) {
          next[idx] = [mx, my];
          draftQuad = normalizeQuad(next) || startQuad;
          draft = quadToRect(draftQuad);
        }
      }
      else if (mode === 'move' && start) {
        const dx = mx - sx, dy = my - sy, w = start[2] - start[0], h = start[3] - start[1];
        const nl = Math.max(0, Math.min(1 - w, start[0] + dx)), nt = Math.max(0, Math.min(1 - h, start[1] + dy));
        draft = [nl, nt, nl + w, nt + h];
        draftQuad = null;
      } else if (start) {
        draft = resize(mode.replace('resize-', ''), start, mx - sx, my - sy);
        draftQuad = null;
      }
      place();
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  });
  place();
  host.appendChild(editor);
  return {
    getRect: () => draft || quadToRect(draftQuad),
    getQuad: () => normalizeQuad(draftQuad),
    getRotationDeg: () => perspectiveMode ? 0 : clampCropRotationDeg(rotationDeg),
    isPerspective: () => !!(perspectiveMode && normalizeQuad(draftQuad)),
  };
}

function beginNewFigureSelection(book, page) {
  if (!book || !page) return;
  const nextFigure = getChildQueuedImagesForPage(book, page.pageNum).length + 1;
  enterIllustCropEditing(page.pageNum, ILLUST_NEW_FIGURE_TOKEN);
  refreshPageDetailWorkspace(book.id, page.pageNum);
  toast(`框选当前页中的新插图，保存后会自动排为图 ${nextFigure}`, 'info');
}

function getMergeImageItems(book, ownerImg) {
  if (!book || !ownerImg) return [];
  const ids = Array.isArray(ownerImg.imageMerge?.items) ? ownerImg.imageMerge.items : [];
  return ids
    .map(id => state.illustrations.find(img => img?.id === id))
    .filter(Boolean)
    .map(img => {
      const page = getBookPageRecord(book, Number(img?.pdfSource?.pageNum));
      return page ? { img, page } : null;
    })
    .filter(Boolean);
}

function getNextMergeCandidate(book, currentImg) {
  if (!book || !currentImg?.id) return null;
  const items = getIllustrationNavItems(book).filter(item => item.img && !item.img.mergedInto);
  const idx = items.findIndex(item => item.img?.id === currentImg.id);
  if (idx < 0) return null;
  return items.slice(idx + 1).find(item => item.img && item.img.id !== currentImg.id) || null;
}

function getDefaultMergeOrderIds(book, ownerImg, nextImg) {
  const pageOrder = getBookTraits(book)?.pageOrder === 'ltr' ? 'ltr' : 'rtl';
  if (pageOrder === 'rtl') return [nextImg.id, ownerImg.id];
  return [ownerImg.id, nextImg.id];
}

function getIllustrationImageUrlForMerge(book, item) {
  const img = item?.img;
  const page = item?.page;
  if (!book || !img || !page) return '';
  const isSub = isSplitIllustrationRecord(img);
  const rect = isSub
    ? normalizeRect(img?.pdfSource?.annotateRect) || normalizeRect(img?.pdfSource?.cropRect)
    : normalizeRect(page.cropRect) || normalizeRect(page.contentRect);
  const quad = isSub
    ? normalizeQuad(img?.pdfSource?.annotateQuad) || normalizeQuad(img?.pdfSource?.cropQuad)
    : normalizeQuad(page.cropQuad);
  const rotation = isSub
    ? clampCropRotationDeg(img?.pdfSource?.rotationDeg || 0)
    : clampCropRotationDeg(page.cropRotationDeg || page.rotationDeg || 0);
  if (rect) return pageHiResUrl(book.id, pdfPageOf(page), rect, 1400, rotation, quad);
  return img.url || getPagePreviewUrl(page, 'crop') || page.thumbHi || page.thumb || '';
}

function mergeDistinctText(a, b, sep = ' / ') {
  const av = String(a || '').trim();
  const bv = String(b || '').trim();
  if (!av) return bv;
  if (!bv || av === bv) return av;
  const parts = [];
  for (const item of [...av.split(sep), ...bv.split(sep)]) {
    const v = String(item || '').trim();
    if (v && !parts.includes(v)) parts.push(v);
  }
  return parts.join(sep);
}

function mergeDistinctArray(a, b) {
  const out = [];
  for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const v = String(item || '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function conservativeConfidence(a, b) {
  const order = { low: 0, mid: 1, high: 2 };
  const av = order[a] ?? 1;
  const bv = order[b] ?? 1;
  return av <= bv ? (a || b || 'mid') : (b || a || 'mid');
}

function conservativeVerdict(a, b) {
  const order = { '矛盾': 0, '存疑': 1, '一致': 2 };
  if (!a) return b || '';
  if (!b) return a || '';
  return (order[a] ?? 1) <= (order[b] ?? 1) ? a : b;
}

function mergeAnnotationDraft(ownerImg, nextImg, orderedImgs = null) {
  const first = Array.isArray(orderedImgs) && orderedImgs[0] ? orderedImgs[0] : ownerImg;
  const second = Array.isArray(orderedImgs) && orderedImgs[1] ? orderedImgs[1] : nextImg;
  const a = deepClone(first?.annotation || first?.aiDraft || {});
  const b = deepClone(second?.annotation || second?.aiDraft || {});
  const merged = normalizeAnnotationShape({ ...a }) || {};
  for (const key of ['illustrationName', 'illustrationNamePinyin', 'subject', 'herbClassical', 'herbModern', 'species', 'procedureStep', 'meridian', 'style', 'preservation']) {
    merged[key] = mergeDistinctText(a[key], b[key]);
  }
  merged.parts = mergeDistinctArray(a.parts, b.parts);
  merged.points = mergeDistinctArray(a.points, b.points);
  merged.type = a.type && b.type && a.type !== b.type ? a.type : (a.type || b.type || '');
  merged.academicClass = merged.type || null;
  merged.academicSubclass = a.academicSubclass === b.academicSubclass ? (a.academicSubclass || b.academicSubclass || null) : (a.academicSubclass || b.academicSubclass || null);
  merged.aiVerdict = conservativeVerdict(a.aiVerdict, b.aiVerdict);
  merged.confidence = conservativeConfidence(a.confidence, b.confidence);
  merged.aiVerdictNote = mergeDistinctText(a.aiVerdictNote, b.aiVerdictNote, '\n');
  merged.correspondingText = a.correspondingText && b.correspondingText && a.correspondingText !== b.correspondingText
    ? `${a.correspondingText}\n\n【下一图】\n${b.correspondingText}`
    : (a.correspondingText || b.correspondingText || '');
  const notes = [a.note, b.note, '由当前图与下一图合并生成，待人工复核。'].filter(Boolean);
  merged.note = mergeDistinctText(notes.join('\n'), '', '\n');
  if (a.type && b.type && a.type !== b.type) {
    merged.note = `${merged.note}\n类型不一致：${a.type} / ${b.type}`.trim();
  }
  return normalizeAnnotationShape(merged) || merged;
}

function startMergeNextPreview(book, ownerImg) {
  const next = getNextMergeCandidate(book, ownerImg);
  if (!next?.img) {
    toast('没有可合并的下一张', 'warn');
    return;
  }
  state.mergePreview = {
    ownerId: ownerImg.id,
    nextId: next.img.id,
    items: getDefaultMergeOrderIds(book, ownerImg, next.img),
  };
  refreshPageDetailWorkspace(book.id, Number(ownerImg.pdfSource?.pageNum));
}

function cancelMergePreview(book, ownerImg) {
  state.mergePreview = null;
  refreshPageDetailWorkspace(book.id, Number(ownerImg?.pdfSource?.pageNum || state.currentBookPage));
}

function swapMergePreviewOrder(book, ownerImg) {
  if (!state.mergePreview || state.mergePreview.ownerId !== ownerImg?.id) return;
  const items = Array.isArray(state.mergePreview.items) && state.mergePreview.items.length === 2
    ? state.mergePreview.items.slice()
    : [state.mergePreview.ownerId, state.mergePreview.nextId].filter(Boolean);
  if (items.length !== 2) return;
  state.mergePreview.items = [items[1], items[0]];
  refreshPageDetailWorkspace(book.id, Number(ownerImg.pdfSource?.pageNum));
}

function swapAppliedMergeOrder(book, ownerImg) {
  if (!ownerImg?.imageMerge?.items || ownerImg.imageMerge.items.length < 2) return;
  ownerImg.imageMerge.items = ownerImg.imageMerge.items.slice().reverse();
  ownerImg.imageMerge.orderUpdatedAt = new Date().toISOString();
  persistImage(ownerImg);
  refreshPageDetailWorkspace(book.id, Number(ownerImg.pdfSource?.pageNum || state.currentBookPage));
}

function snapshotMergeOwnerState(ownerImg) {
  const has = (key) => Object.prototype.hasOwnProperty.call(ownerImg, key);
  return {
    hasAnnotation: has('annotation'),
    annotation: deepClone(ownerImg.annotation || null),
    hasAiDraft: has('aiDraft'),
    aiDraft: deepClone(ownerImg.aiDraft || null),
    hasReviewMeta: has('reviewMeta'),
    reviewMeta: deepClone(ownerImg.reviewMeta || null),
    hasReviewDiff: has('reviewDiff'),
    reviewDiff: deepClone(ownerImg.reviewDiff || null),
    status: ownerImg.status || 'todo',
    hasCanonicalId: has('canonicalId'),
    canonicalId: ownerImg.canonicalId || null,
    hasVerifiedAt: has('verifiedAt'),
    verifiedAt: ownerImg.verifiedAt || null,
    annotatedAt: ownerImg.annotatedAt || null,
    modelUsed: ownerImg.modelUsed || null,
  };
}

function restoreMergeOwnerState(ownerImg, snapshot) {
  if (!ownerImg || !snapshot) return false;
  if (snapshot.hasAnnotation) ownerImg.annotation = deepClone(snapshot.annotation || null);
  else delete ownerImg.annotation;
  if (snapshot.hasAiDraft) ownerImg.aiDraft = deepClone(snapshot.aiDraft || null);
  else delete ownerImg.aiDraft;
  if (snapshot.hasReviewMeta) ownerImg.reviewMeta = deepClone(snapshot.reviewMeta || null);
  else delete ownerImg.reviewMeta;
  if (snapshot.hasReviewDiff) ownerImg.reviewDiff = deepClone(snapshot.reviewDiff || null);
  else delete ownerImg.reviewDiff;
  ownerImg.status = snapshot.status || 'todo';
  if (snapshot.hasCanonicalId) ownerImg.canonicalId = snapshot.canonicalId;
  else delete ownerImg.canonicalId;
  if (snapshot.hasVerifiedAt) ownerImg.verifiedAt = snapshot.verifiedAt;
  else delete ownerImg.verifiedAt;
  ownerImg.annotatedAt = snapshot.annotatedAt || null;
  ownerImg.modelUsed = snapshot.modelUsed || null;
  return true;
}

async function applyMergeNext(book, ownerImg, nextImg, orderedIds = null) {
  if (!book || !ownerImg || !nextImg || ownerImg.id === nextImg.id) return;
  if (ownerImg.status === 'ok' || nextImg.status === 'ok') {
    const ok = await openConfirm('合并会把已确认记录退回待审核，并生成一条合并草稿。已确认内容会保存快照，可用“拆分合并”还原。是否继续？');
    if (!ok) return;
  }
  const items = Array.isArray(orderedIds) && orderedIds.length === 2 ? orderedIds.slice() : [ownerImg.id, nextImg.id];
  const orderedImgs = items.map(id => state.illustrations.find(img => img?.id === id)).filter(Boolean);
  ownerImg.imageMerge = {
    items,
    appliedAt: new Date().toISOString(),
    mode: 'adjacent_pair',
    ownerSnapshot: snapshotMergeOwnerState(ownerImg),
  };
  const annotationBeforeMerge = deepClone(ownerImg.annotation || {});
  const mergedAnnotation = mergeAnnotationDraft(ownerImg, nextImg, orderedImgs);
  ownerImg.annotation = mergedAnnotation;
  ownerImg.aiDraft = ownerImg.aiDraft || deepClone(ownerImg.annotation);
  ownerImg.status = 'review';
  ownerImg.reviewMeta = ownerImg.reviewMeta || {};
  ownerImg.reviewMeta.humanEditedAt = Date.now();
  ownerImg.reviewMeta.mergeAppliedAt = Date.now();
  ownerImg.reviewMeta.mergeSourceIds = [ownerImg.id, nextImg.id];
  // Gate 2.3：合并是系统生成的候选草稿，不是无归因的人为改写。对每个受追踪字段追加
  // system_generated 事件，避免它们在导出中落入 no_recorded_change / unattributed_diff。
  appendSystemGeneratedTrackedChanges(ownerImg, annotationBeforeMerge, mergedAnnotation);
  refreshReviewDiff(ownerImg);
  nextImg.mergedInto = ownerImg.id;
  nextImg.mergeHiddenAt = Date.now();
  state.mergePreview = null;
  state.selectedId = ownerImg.id;
  persistImages([ownerImg, nextImg]);
  refreshPageDetailWorkspace(book.id, Number(ownerImg.pdfSource?.pageNum));
  renderLeftList();
  toast('已合并到当前图，右侧基础信息已生成草稿，请继续编辑', 'success');
}

function undoImageMerge(book, ownerImg) {
  if (!ownerImg?.imageMerge?.items?.length) return;
  const ownerSnapshot = ownerImg.imageMerge.ownerSnapshot || null;
  const ids = ownerImg.imageMerge.items.filter(id => id && id !== ownerImg.id);
  ids.forEach(id => {
    const child = state.illustrations.find(img => img?.id === id);
    if (child?.mergedInto === ownerImg.id) {
      delete child.mergedInto;
      delete child.mergeHiddenAt;
    }
  });
  delete ownerImg.imageMerge;
  if (!restoreMergeOwnerState(ownerImg, ownerSnapshot)) {
    ownerImg.status = ownerImg.annotation || ownerImg.aiDraft ? 'review' : 'todo';
    noteHumanEdit(ownerImg);
  }
  persistImages([ownerImg, ...ids.map(id => state.illustrations.find(img => img?.id === id)).filter(Boolean)]);
  refreshPageDetailWorkspace(book.id, Number(ownerImg.pdfSource?.pageNum || state.currentBookPage));
  renderLeftList();
  toast('已拆分合并，下一张恢复显示', 'success');
}

function renderMergeImageStrip(book, items) {
  const strip = el('div', { class: 'merge-image-strip merged-composite-frame' });
  const image = el('img', {
    class: 'merged-composite-image',
    alt: `合并插图（${items.length} 个来源）`,
  });
  image.setAttribute('aria-busy', 'true');
  buildMergedIllustrationDataUrlFromItems(items, 1800)
    .then(src => {
      image.src = src;
      image.dataset.compositeReady = 'true';
      image.setAttribute('aria-busy', 'false');
    })
    .catch(error => {
      const fallback = getIllustrationImageUrlForMerge(book, items[0]);
      if (fallback) image.src = fallback;
      image.dataset.compositeError = error?.message || '合并图生成失败';
      image.setAttribute('aria-busy', 'false');
      console.warn('render merge preview failed', error);
    });
  strip.appendChild(image);
  return strip;
}

function renderIllustMode(book, page) {
  const wrap = el('div');
  // 插图框选：无论当前处于插图视图还是全页视图，都固定按整页坐标保存。
  const rawCropEditing = state.illustCropEditing && state.illustCropEditingPage === page.pageNum;
  const pageMarkedMulti = pageHasMultipleIllustrations(book, page.pageNum);
  const activeImg = getActiveQueuedImageForPage(book, page.pageNum, state.selectedId);
  const mainQueuedImg = getMainQueuedImageForPage(book, page.pageNum);
  const childRecords = getChildQueuedImagesForPage(book, page.pageNum);
  const activeIsSub = !!activeImg && isSplitIllustrationRecord(activeImg);
  const cropEditingNewFigure = rawCropEditing && state.illustCropEditingImageId === ILLUST_NEW_FIGURE_TOKEN;
  const cropEditTarget = rawCropEditing && state.illustCropEditingImageId && state.illustCropEditingImageId !== ILLUST_NEW_FIGURE_TOKEN
    ? state.illustrations.find(img => img?.id === state.illustCropEditingImageId) || null
    : null;
  const cropEditingFigure = !!(cropEditTarget && isSplitIllustrationRecord(cropEditTarget));
  const cropEditing = rawCropEditing;
  // 框选插图/新增插图一律固定在整页坐标系，避免视图切换或已有图项污染坐标。
  const editBaseRect = cropEditing ? [0, 0, 1, 1] : null;
  const viewFull = cropEditing ? true : ((pageMarkedMulti && !activeImg) ? true : !!state.pageIllustViewFull);
  const nextMergeCandidate = activeImg ? getNextMergeCandidate(book, activeImg) : null;
  const mergePreviewOn = !!(activeImg && state.mergePreview?.ownerId === activeImg.id && state.mergePreview?.nextId);
  const mergePreviewNext = mergePreviewOn
    ? state.illustrations.find(img => img?.id === state.mergePreview.nextId && !img?.mergedInto) || null
    : null;
  const mergePreviewItems = mergePreviewOn
    ? (Array.isArray(state.mergePreview.items) ? state.mergePreview.items : [activeImg.id, state.mergePreview.nextId])
        .map(id => state.illustrations.find(img => img?.id === id))
        .filter(Boolean)
        .map(img => {
          const itemPage = getBookPageRecord(book, Number(img?.pdfSource?.pageNum));
          return itemPage ? { img, page: itemPage } : null;
        })
        .filter(Boolean)
    : [];
  const appliedMergeItems = activeImg ? getMergeImageItems(book, activeImg) : [];
  const mergeItems = mergePreviewItems.length > 1
    ? mergePreviewItems
    : (appliedMergeItems.length > 1 ? appliedMergeItems : []);
  const showMergeStrip = !cropEditing && mergeItems.length > 1;

  const frame = el('div', {
    class: 'pd-illust-frame',
    ...(cropEditing ? { style: 'padding:4px 8px; min-height:calc(100vh - 205px);' } : {})
  });
  // mediaHost 紧包裹图片；右下角的「插图/整页」视图切换随图片一起重建（见 placeImg）
  const mediaHost = el('div', {
    style: showMergeStrip
      ? 'position:relative; display:block; line-height:0; width:100%; max-width:100%;'
      : cropEditing
      ? 'position:relative; display:inline-block; line-height:0; max-width:100%;'
      : 'position:relative; display:inline-block; line-height:0; max-width:100%;'
  });
  frame.appendChild(mediaHost);
  const doc = pdfDocs[book.id];
  // 「插图」视图固定显示框选后的插图本体（cropRect 优先）；没框选才退回版心(contentRect)
  const pageRect = normalizeRect(page.cropRect) || normalizeRect(page.contentRect);
  const activeRect = activeIsSub
    ? normalizeRect(activeImg?.pdfSource?.annotateRect) || normalizeRect(activeImg?.pdfSource?.cropRect) || pageRect
    : pageRect;
  const activeQuad = activeIsSub
    ? normalizeQuad(activeImg?.pdfSource?.annotateQuad) || normalizeQuad(activeImg?.pdfSource?.cropQuad) || normalizeQuad(page.cropQuad)
    : normalizeQuad(page.cropQuad);
  const activeRotationDeg = activeIsSub
    ? clampCropRotationDeg(activeImg?.pdfSource?.rotationDeg || 0)
    : clampCropRotationDeg(page.cropRotationDeg || page.rotationDeg || 0);
  const cropSrc = activeIsSub
    ? (activeImg?.url || getPagePreviewUrl(page, 'crop') || page.thumbHi || page.thumb)
    : (getPagePreviewUrl(page, 'crop') || page.thumbHi || page.thumb);
  const fullSrc   = getPagePreviewUrl(page, 'full_page') || page.thumbHi || page.thumb;
  // 裁剪编辑态强制用整页预览；保存时直接得到整页归一化坐标。
  const previewSrc = cropEditing
    ? (pageHiResUrl(book.id, pdfPageOf(page), [0, 0, 1, 1], 1800) || page.thumbHi || page.thumb || fullSrc)
    : (viewFull ? fullSrc : cropSrc);
  let loadingNote = null;

  // 右下角 ⊡/⛶ 视图切换：裁剪态(只看插图)显 ⛶ 可展开整页；整页态显 ⊡ 可还原裁剪
  const makeViewToggle = () => el('button', {
    class: 'pd-view-toggle-btn',
    style: 'top:auto; bottom:8px; right:8px;',
    title: viewFull ? '还原为裁剪视图（只看插图）' : '展开为整页视图',
    onclick: (e) => { e.stopPropagation(); state.pageIllustViewFull = !state.pageIllustViewFull; refreshPageDetailWorkspace(book.id, page.pageNum); },
  }, viewFull ? '⊡' : '⛶');
  // 每次重建 mediaHost 都重挂图片与右下角切换（避免被 innerHTML 清空）
  const placeImg = (src) => {
    mediaHost.innerHTML = '';
    const im = el('img', {
      src,
      style: cropEditing
        ? 'max-height:calc(100vh - 220px); width:auto; height:auto; max-width:100%; display:block;'
        : 'max-width:100%; display:block;'
    });
    attachImgRetry(im, src);
    mediaHost.appendChild(im);
    if (!cropEditing) mediaHost.appendChild(makeViewToggle());
  };
  if (showMergeStrip) {
    mediaHost.innerHTML = '';
    mediaHost.appendChild(renderMergeImageStrip(book, mergeItems));
  } else {
    placeImg(previewSrc);   // 先用缩略图占位（含右下角切换）
  }

  if (!cropEditing && !showMergeStrip) {
    // 升级为服务端高清：整页 or 裁剪区域（preload 后替换，又快又清晰，不再走慢的 pdf.js renderPageCrop）
    const hiUrl = (viewFull || !activeRect)
      ? pageHiResUrl(book.id, pdfPageOf(page))
      : pageHiResUrl(book.id, pdfPageOf(page), activeRect, 1400, activeRotationDeg, activeQuad);
    const stillHere = () => state.mainView === 'page-detail' && state.currentBookId === book.id
      && state.currentBookPage === page.pageNum && state.pageDetailMode === 'illust';
    const pre = new Image();
    pre.onload = () => { if (stillHere()) placeImg(hiUrl); };
    pre.src = hiUrl;
    if (!doc) ensurePdfDoc(book).catch(() => {});   // 后台恢复 PDF，供框选/版心检测用
  }

  const cropLabel = showMergeStrip
    ? el('div', { style: 'font-size:11px; color:#5b7fa6; text-align:center; margin-top:4px' },
        mergePreviewOn ? '合并预览：按当前顺序生成一张整体图，尚未保存' : '已合并：作为一张整体图展示和标注，来源编号保留')
    : !viewFull
    ? (activeRect
        ? el('div', { style: 'font-size:11px; color:#4caf50; text-align:center; margin-top:4px' },
            activeIsSub
              ? `✓ 当前查看图 ${activeImg?.figureIndex || activeImg?.subIndex || Math.max(1, childRecords.findIndex(img => img.id === activeImg?.id) + 1)} 的独立选框`
              : (pageMarkedMulti
                  ? '✓ 当前处于多图页整体验证视图'
                  : (page.forceContentRect ? '✓ 当前使用手动正文框作为标注区域' : '✓ 当前使用自动裁剪区域')))
        : el('div', { style: 'font-size:11px; color:#ff9800; text-align:center; margin-top:4px' }, '⚠ 标注区域缺失'))
    : el('div', { style: 'font-size:11px; color:var(--c-text-mute); text-align:center; margin-top:4px' }, '全页视图');
  wrap.appendChild(frame);
  wrap.appendChild(cropLabel);
  if (loadingNote) wrap.appendChild(loadingNote);

  // 插图框选编辑态：在整页图上直接叠加可拖拽绿框
  if (cropEditing) {
    const cropCtl = attachIllustCropEditor(mediaHost, page, {
      initialRect: cropEditingNewFigure
        ? null
        : rectToRelativeWithinBase(
            cropEditingFigure ? (cropEditTarget?.pdfSource?.annotateRect || cropEditTarget?.pdfSource?.cropRect) : page.cropRect,
            editBaseRect
          ),
      initialQuad: cropEditingNewFigure
        ? null
        : quadToRelativeWithinBase(
            cropEditingFigure
              ? (cropEditTarget?.pdfSource?.annotateQuad || cropEditTarget?.pdfSource?.cropQuad)
              : page.cropQuad,
            editBaseRect
          ),
      rotationDeg: cropEditingNewFigure
        ? 0
        : (cropEditingFigure
            ? cropEditTarget?.pdfSource?.rotationDeg
            : (page.cropRotationDeg || page.rotationDeg || 0)),
      allowEmptyInitial: cropEditingNewFigure,
      hintText: cropEditingNewFigure
        ? `拖框新增一个插图（当前将保存为图 ${childRecords.length + 1}）；点击蓝色框可复制已有图项范围`
        : (cropEditingFigure
            ? '拖框重新圈定当前图项范围；点击蓝色框可切换编辑其他图项'
            : '拖框圈插图本体，可拉四角微调'),
      referenceRects: (cropEditingNewFigure || cropEditingFigure)
        ? childRecords
            .filter(img => cropEditingNewFigure || img.id !== cropEditTarget?.id)
            .map((img, idx) => ({
              id: img.id,
              rect: rectToRelativeWithinBase(
                normalizeRect(img?.pdfSource?.annotateRect) || normalizeRect(img?.pdfSource?.cropRect),
                editBaseRect
              ),
              quad: quadToRelativeWithinBase(
                normalizeQuad(img?.pdfSource?.annotateQuad) || normalizeQuad(img?.pdfSource?.cropQuad),
                editBaseRect
              ),
              label: `图 ${img.figureIndex || img.subIndex || idx + 1}`,
              rotationDeg: clampCropRotationDeg(img?.pdfSource?.rotationDeg || 0),
              actionLabel: cropEditingNewFigure ? '复制' : '编辑',
              title: cropEditingNewFigure ? '点击复制该图项范围作为新插图' : '点击编辑该图项范围',
              copyOnClick: cropEditingNewFigure,
            }))
        : [],
      onReferenceClick: (cropEditingNewFigure || cropEditingFigure)
        ? item => {
            if (!item?.id) return;
            if (cropEditingNewFigure) {
              toast('已复制该图项范围，可继续调整后加入插图', 'info');
              return;
            }
            enterIllustCropEditing(page.pageNum, item.id);
            refreshPageDetailWorkspace(book.id, page.pageNum);
            toast('已切换为编辑该图项范围', 'info');
          }
        : null,
    });
    wrap.appendChild(el('div', { style: 'display:flex; justify-content:flex-end; gap:8px; margin-top:8px;' },
      el('button', { class: 'btn', onclick: () => {
        exitIllustCropEditing();
        refreshPageDetailWorkspace(book.id, page.pageNum);
      } }, '✕ 取消'),
      el('button', { class: 'btn primary', onclick: async () => {
        const draftRect = cropCtl.getRect();
        const draftQuadRel = cropCtl.getQuad();
        const rotationDeg = cropCtl.getRotationDeg();
        const r = rectFromRelativeWithinBase(draftRect, editBaseRect);
        const q = quadFromRelativeWithinBase(draftQuadRel, editBaseRect);
        if ((!r || rectArea(r) < 0.01) && (!q || quadArea(q) < 0.01)) { toast('插图框过小，请重新框选', 'warn'); return; }
        if (cropEditingNewFigure) {
          exitIllustCropEditing();
          const createdId = await createPageFigureRecord(book, page, draftRect, { baseRect: editBaseRect, rotationDeg, quad: q });
          if (!createdId) refreshPageDetailWorkspace(book.id, page.pageNum);
          return;
        }
        if (cropEditingFigure && cropEditTarget) {
          const ok = await setFigureCropRect(book, page, cropEditTarget, r, rotationDeg, q);
          if (!ok) return;
        } else {
          await setPageCropRect(book, page, r, rotationDeg, q);
        }
        exitIllustCropEditing();
        persist();
        refreshPageDetailWorkspace(book.id, page.pageNum);
        toast(cropEditingFigure ? '图项框已保存' : '插图框已保存，成果/审核台将只显示插图本体', 'success');
      } }, cropEditingNewFigure ? '✓ 加入插图' : '✓ 保存框选')));
    return wrap;
  }

  // 图像增强控件（getSource 延迟取 mediaHost 中的 img 或 canvas）
  const { toggleBtn: _pdEnhToggle, enhBar: _pdEnhBar } = buildImgEnhanceSection(
    () => mediaHost.querySelector('canvas') || mediaHost.querySelector('img')
  );
  const canBoxCurrentFigure = !pageMarkedMulti || activeIsSub;
  const mergeActionButtons = [];
  if (activeImg && mergePreviewOn && mergePreviewNext) {
    const orderedIds = mergeItems.map(item => item.img.id);
    mergeActionButtons.push(
      el('button', {
        class: 'icon-btn',
        title: '交换两张图的左右顺序',
        onclick: () => swapMergePreviewOrder(book, activeImg),
      }, '交换顺序'),
      el('button', {
        class: 'icon-btn',
        title: '将当前图与下一图合并为一条待编辑记录',
        onclick: async () => applyMergeNext(book, activeImg, mergePreviewNext, orderedIds),
      }, '✓ 应用合并'),
      el('button', {
        class: 'icon-btn',
        title: '取消合并预览',
        onclick: () => cancelMergePreview(book, activeImg),
      }, '取消合并')
    );
  } else if (activeImg?.imageMerge?.items?.length > 1) {
    mergeActionButtons.push(
      el('button', {
        class: 'icon-btn',
        title: '交换两张图的左右顺序',
        onclick: () => swapAppliedMergeOrder(book, activeImg),
      }, '交换顺序'),
      el('button', {
        class: 'icon-btn',
        title: '拆分当前合并，恢复下一张显示',
        onclick: () => undoImageMerge(book, activeImg),
      }, '拆分合并')
    );
  } else if (activeImg && nextMergeCandidate?.img) {
    mergeActionButtons.push(el('button', {
      class: 'icon-btn',
      title: '与导航中的下一张组成并列合并预览',
      onclick: () => startMergeNextPreview(book, activeImg),
    }, '合并下一张'));
  }
  const _pdEnhRow = el('div', { style: 'display:flex; justify-content:flex-end; gap:6px; margin-top:6px; flex-wrap:wrap;' },
    ...mergeActionButtons,
    ...(canBoxCurrentFigure ? [el('button', { class: 'icon-btn', title: activeIsSub ? '重新框选当前图项的范围' : '重新框选当前页插图范围',
      onclick: () => {
        enterIllustCropEditing(page.pageNum, activeIsSub ? activeImg.id : null);
        refreshPageDetailWorkspace(book.id, page.pageNum);
        toast(activeIsSub ? '已进入图项重框模式，可按当前插图预览范围重画' : '已进入插图框选模式，可重新框选当前页插图', 'success');
      } }, '✂ 框选插图')] : []),
    el('button', { class: 'icon-btn', title: '新增一个独立插图，固定在整页视图框选，保存后自动排为图1、图2、图3……',
      onclick: () => {
        beginNewFigureSelection(book, page);
      } }, '+ 新增插图'),
    (!pageMarkedMulti && page.forceCropRect) ? el('button', { class: 'icon-btn', title: '清除本页插图框，恢复整页/版心展示',
      onclick: () => {
        page.cropRect = null;
        page.cropQuad = null;
        page.forceCropRect = false;
        page.cropRotationDeg = 0;
        page.cropThumb = '';
        page.cropThumbHi = '';
        syncPageAssetIntoQueuedImages(book, page);
        persist();
        refreshPageDetailWorkspace(book.id, page.pageNum);
        toast(`已清除第 ${page.pageNum} 页插图框`, 'success');
      } }, '✕ 清除插图框') : null,
    _pdEnhToggle,
  );
  wrap.appendChild(_pdEnhRow);
  wrap.appendChild(_pdEnhBar);
  if (pageMarkedMulti || childRecords.length) {
    wrap.appendChild(renderMultiIllustBanner(book, page, mediaHost, activeImg, childRecords));
  }
  return wrap;
}

function renderMultiIllustBanner(book, page, frame, activeImg, childRecords = []) {
  const wrap = el('div', {
    style: 'margin-top:10px; padding:12px 14px; border:1px solid #f0c36d; border-radius:10px; background:#fff6df; display:grid; gap:10px;'
  });
  wrap.appendChild(el('div', { style: 'font-size:13px; font-weight:700; color:#8a5a00;' }, '⚠ 该页需要拆成多个图项'));
  wrap.appendChild(el('div', {
    style: 'font-size:12px; color:#8b6a20; line-height:1.7;'
  }, '请依次框出图1、图2……框选时固定使用整页视图；每个框选结果都会直接加入待标注队列；页面本身不再作为整页记录入队。'));

  if (childRecords.length) {
    const list = el('div', { style: 'display:grid; gap:8px;' });
    list.appendChild(el('div', { style: 'font-size:12px; font-weight:600; color:#6d5316;' }, '本页图项'));
    const grid = el('div', { style: 'display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px; align-items:start;' });
    childRecords.forEach((sub, idx) => {
      const statusLabel = { todo: '待标注', review: '待核查', ok: '已确认', bad: '废弃' }[sub.status] || (sub.status || '待标注');
      const selected = activeImg?.id === sub.id;
      const figureQuad = normalizeQuad(sub?.pdfSource?.annotateQuad) || normalizeQuad(sub?.pdfSource?.cropQuad);
      const figureRect = normalizeRect(sub?.pdfSource?.annotateRect) || normalizeRect(sub?.pdfSource?.cropRect);
      const figureRotationDeg = clampCropRotationDeg(sub?.pdfSource?.rotationDeg || 0);
      const figureSrc = figureRect
        ? pageHiResUrl(book.id, pdfPageOf(page), figureRect, 900, figureRotationDeg, figureQuad)
        : (sub.url || '');
      const selectFigure = () => {
        state.selectedId = sub.id;
        deferPersist();
        refreshPageDetailWorkspace(book.id, page.pageNum);
      };
      const card = el('div', {
        style: `display:grid; gap:8px; text-align:left; padding:8px; border-radius:10px; border:1px solid ${selected ? '#2b6cb0' : 'rgba(195,160,86,0.45)'}; background:${selected ? 'rgba(43,108,176,0.1)' : 'rgba(255,255,255,0.82)'}; box-shadow:${selected ? '0 0 0 2px rgba(43,108,176,0.12)' : 'none'};`
      });
      card.appendChild(el('div', {
        role: 'button',
        tabindex: '0',
        style: 'display:grid; gap:8px; cursor:pointer;',
        onclick: selectFigure,
        onkeydown: (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          selectFigure();
        }
      },
        el('div', {
          style: 'display:flex; align-items:center; justify-content:center; overflow:visible; border-radius:8px; background:#fffdf7; border:1px solid rgba(201,183,138,0.35); padding:8px;'
        },
          el('img', {
            src: figureSrc,
            style: 'max-width:100%; width:auto; height:auto; object-fit:contain; display:block;'
          })
        ),
        el('div', { style: 'font-size:12px; color:#5c4d25; line-height:1.6;' },
          el('div', { style: 'font-weight:600;' }, `图 ${sub.figureIndex || sub.subIndex || idx + 1}${selected ? ' · 当前查看' : ''}`),
          el('div', null, `${sub.page || `第 ${page.pageNum} 页`} · ${statusLabel}`)
        )
      ));
      card.appendChild(el('div', { style: 'display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap;' },
        el('button', {
          class: 'btn',
          style: 'font-size:11px; padding:3px 8px;',
          title: '重新框选这个图项',
          onclick: (e) => {
            e.stopPropagation();
            state.selectedId = sub.id;
            deferPersist();
            enterIllustCropEditing(page.pageNum, sub.id);
            refreshPageDetailWorkspace(book.id, page.pageNum);
            toast(`重新框选图 ${sub.figureIndex || sub.subIndex || idx + 1}`, 'info');
          }
        }, '编辑'),
        el('button', {
          class: 'btn danger-ghost',
          style: 'font-size:11px; padding:3px 8px;',
          title: '删除这个图项',
          onclick: async (e) => {
            e.stopPropagation();
            await deletePageFigureRecord(book, page, sub);
          }
        }, '删除')
      ));
      grid.appendChild(card);
    });
    list.appendChild(grid);
    wrap.appendChild(list);
  }

  wrap.appendChild(el('div', { class: 'ta-actions', style: 'margin-top:0;' },
    el('button', {
      class: 'btn primary',
      onclick: () => { beginNewFigureSelection(book, page); }
    }, '+ 新增插图')
  ));
  wrap.appendChild(el('div', {
    style: 'font-size:11px; color:#9a7d32; line-height:1.7;'
  }, '建议一次只框选一个独立图项；框选完成后会直接加入待标注队列，可继续框选下一项或稍后批量标注。'));
  return wrap;
}

function startSubRegionDraw(frame, onComplete) {
  if (!frame || frame.dataset.subdrawActive === '1') return;
  const box = frame.getBoundingClientRect();
  if (!box.width || !box.height) {
    toast('插图预览尚未完成加载，请稍后再试', 'warn');
    return;
  }
  frame.dataset.subdrawActive = '1';
  frame.style.cursor = 'crosshair';
  const overlay = el('div', {
    style: 'position:absolute; inset:0; cursor:crosshair; background:rgba(33,150,243,0.06); z-index:3;'
  });
  const hint = el('div', {
    style: 'position:absolute; left:10px; top:10px; background:rgba(26,58,92,0.86); color:#fff; padding:6px 10px; border-radius:999px; font-size:12px; pointer-events:none;'
  }, '拖拽框选单个图项区域');
  const draftEl = el('div', {
    style: 'display:none; position:absolute; border:2px dashed #2196f3; background:rgba(33,150,243,0.14); pointer-events:none;'
  });
  overlay.appendChild(hint);
  overlay.appendChild(draftEl);
  frame.appendChild(overlay);

  let drawing = false;
  let startX = 0;
  let startY = 0;

  const cleanup = () => {
    overlay.remove();
    frame.dataset.subdrawActive = '';
    frame.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKeyDown);
  };

  const getPoint = (evt) => {
    const current = overlay.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (evt.clientX - current.left) / current.width));
    const y = Math.max(0, Math.min(1, (evt.clientY - current.top) / current.height));
    return [x, y];
  };

  const paintDraft = (rect) => {
    const draft = normalizeRect(rect);
    if (!draft) {
      draftEl.style.display = 'none';
      return;
    }
    draftEl.style.display = '';
    draftEl.style.left = `${(draft[0] * 100).toFixed(3)}%`;
    draftEl.style.top = `${(draft[1] * 100).toFixed(3)}%`;
    draftEl.style.width = `${((draft[2] - draft[0]) * 100).toFixed(3)}%`;
    draftEl.style.height = `${((draft[3] - draft[1]) * 100).toFixed(3)}%`;
  };

  const onMove = (evt) => {
    if (!drawing) return;
    const [x, y] = getPoint(evt);
    paintDraft([Math.min(startX, x), Math.min(startY, y), Math.max(startX, x), Math.max(startY, y)]);
  };

  const onUp = async (evt) => {
    if (!drawing) return;
    drawing = false;
    const [x, y] = getPoint(evt);
    const draft = normalizeRect([Math.min(startX, x), Math.min(startY, y), Math.max(startX, x), Math.max(startY, y)]);
    cleanup();
    if (!draft || rectArea(draft) < 0.005) {
      toast('框选区域太小，已取消', 'warn');
      return;
    }
    try {
      await onComplete(draft);
    } catch (err) {
      console.error(err);
      toast(err?.message || '图项创建失败', 'warn');
    }
  };

  const onKeyDown = (evt) => {
    if (evt.key !== 'Escape') return;
    cleanup();
    toast('已取消图项框选', 'warn');
  };

  overlay.addEventListener('pointerdown', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    drawing = true;
    [startX, startY] = getPoint(evt);
    paintDraft([startX, startY, startX, startY]);
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKeyDown);
}

async function createPageFigureRecord(book, page, relRect, { baseRect = [0, 0, 1, 1], rotationDeg = 0, quad = null } = {}) {
  const figureRotationDeg = clampCropRotationDeg(rotationDeg);
  async function buildFigureRecord(absRect, figureIndex, { askConfirm = true, selectAfter = true, absQuad = null } = {}) {
    const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } }) || page.textAsset || {};
    const inheritedText = (ta.associatedText || getEffectivePageText(ta) || '').trim();
    const previewUrl = await renderFigurePreviewUrl(book, page, absRect, {
      maxLong: 1100,
      targetWidth: 560,
      quality: 0.9,
      rotationDeg: figureRotationDeg,
      quad: absQuad,
    });
    if (!previewUrl) {
      toast('无法生成新增插图预览，已取消新增，避免加入错误尺寸图项', 'warn');
      return null;
    }

    if (askConfirm) {
      const ok = await openImagePreviewConfirm(previewUrl, {
        title: `新增选框预览（图 ${figureIndex}）`,
        okLabel: '✓ 加入待标注',
        note: '确认后加入待标注队列，可批量/单图标注后再审核；如框错请取消重框。',
      });
      if (!ok) { toast('已取消新增选框', 'warn'); return null; }
    }

    const figureId = `${book.id}_p${String(page.pageNum).padStart(3, '0')}_i${String(figureIndex).padStart(2, '0')}`;
    state.illustrations.push({
      id: figureId,
      isSplitIllustration: true,
      figureIndex,
      subIndex: figureIndex,
      pageGroupId: getPageIllustrationGroupId(book, page.pageNum),
      name: `第${page.pageNum}页（图${figureIndex}）`,
      bookRef: `${book.title} · 第${page.pageNum}页 · 图${figureIndex}`,
      url: previewUrl,
      source: book.title,
      page: `第 ${page.pageNum} 页`,
      status: 'todo',
      aiDraft: null,
      annotation: null,
      reviewDiff: {},
      reviewMeta: {},
      crossref: { classical: inheritedText, verdict: '', note: '' },
      createdAt: Date.now(),
      annotatedAt: null,
      modelUsed: null,
      hasMultipleIllustrations: true,
      pdfSource: {
        bookId: book.id,
        bookTitle: book.title,
        dynasty: book.dynasty || '',
        pageNum: page.pageNum,
        cropRect: absRect,
        cropQuad: absQuad,
        contentRect: page.contentRect || null,
        annotateRect: absRect,
        annotateQuad: absQuad,
        rotationDeg: figureRotationDeg,
        selectionMode: 'crop',
      },
    });
    if (selectAfter) state.selectedId = figureId;
    return figureId;
  }

  const normalizedBaseRect = normalizeRect(baseRect);
  const relativeRect = normalizeRect(relRect);
  if (!normalizedBaseRect || !relativeRect) throw new Error('当前页面缺少可用框选区域');
  const absRect = normalizeRect([
    normalizedBaseRect[0] + (normalizedBaseRect[2] - normalizedBaseRect[0]) * relativeRect[0],
    normalizedBaseRect[1] + (normalizedBaseRect[3] - normalizedBaseRect[1]) * relativeRect[1],
    normalizedBaseRect[0] + (normalizedBaseRect[2] - normalizedBaseRect[0]) * relativeRect[2],
    normalizedBaseRect[1] + (normalizedBaseRect[3] - normalizedBaseRect[1]) * relativeRect[3],
  ]);
  const absQuad = normalizeQuad(quad);
  if (!absRect || rectArea(absRect) < 0.0025) throw new Error('框选区域过小，无法生成图项');

  let figureIndex = 1;
  while (state.illustrations.some(img =>
    img?.pdfSource?.bookId === book.id &&
    Number(img?.pdfSource?.pageNum) === Number(page.pageNum) &&
    Number(img?.figureIndex || img?.subIndex) === figureIndex
  )) figureIndex++;

  const entry = getIllustrationPageEntry(book, page.pageNum) || getBookPageRecord(book, page.pageNum);
  if (entry) {
    if (!Array.isArray(book.illustrationPages)) book.illustrationPages = [];
    if (!book.illustrationPages.some(p => Number(p.pageNum) === Number(page.pageNum))) {
      book.illustrationPages.push(entry);
      book.illustrationPages.sort((a, b) => a.pageNum - b.pageNum);
    }
    entry.confirmed = true;
    entry.hasMultipleIllustrations = true;
  }

  const figureId = await buildFigureRecord(absRect, figureIndex, { askConfirm: true, selectAfter: true, absQuad });
  if (!figureId) return null;
  sortQueuedImages();
  state.selectedId = figureId;
  markBookDirty(book.id);
  persist();
  // 不直接跳审核：新选框是 todo，应先标注（批量/单图 AI）再进审核
  refreshPageDetailWorkspace(book.id, page.pageNum);
  toast(`已新增图 ${figureIndex}，已加入待标注队列；可继续框选图2、图3，或稍后批量标注`, 'success');
  return figureId;
}

function getSpreadSequence(pages, coverPageNum) {
  const spreads = [];
  let i = 0;
  while (i < pages.length) {
    if (coverPageNum != null && pages[i].pageNum === coverPageNum) {
      spreads.push([pages[i]]);
      i++;
    } else if (
      i + 1 < pages.length &&
      (coverPageNum == null || pages[i + 1].pageNum !== coverPageNum)
    ) {
      spreads.push([pages[i], pages[i + 1]]);
      i += 2;
    } else {
      spreads.push([pages[i]]);
      i++;
    }
  }
  return spreads;
}

/* ============================================================
   高清页图（统一 PDF 处理器的清晰度地基）
   每页首次打开时用 pdf.js 渲一次原生分辨率高清图 → 上传存盘
   (data/books/<id>/pages_hires/)，之后翻页/缩放/截图都直接读这张，
   秒显且清晰。扫描影像古籍 pdf.js 解码极慢(~9s/页)，所以只渲一次。
   ============================================================ */
// 高清整页/裁剪图地址。服务端(PyMuPDF 原生解码)按需现场渲染(~120ms)→存盘→返回，
// 浏览器据此惰性加载+缓存。带 rect 时服务端直接裁渲该区域(版心/插图)，前端无需 canvas。
// 不再用浏览器 pdf.js 渲高清(那对扫描页要数十秒)。
function pageHiResUrl(bookId, pageNum, rect, w, rotationDeg = 0, quad = null) {
  let u = `${BRIDGE_BASE}/api/page-image/${encodeURIComponent(bookId)}/${Number(pageNum)}`;
  const r = rect ? normalizeRect(rect) : null;
  const q = quad ? normalizeQuad(quad) : null;
  const rot = clampCropRotationDeg(rotationDeg);
  if (r || q) {
    u += '?';
    if (q) u += `quad=${quadToQueryValue(q)}`;
    else if (r) u += `rect=${r.map(n => n.toFixed(4)).join(',')}`;
    if (w) u += `&w=${Math.round(w)}`;
    if (!q && rot) u += `&rot=${rot.toFixed(1)}`;
  }
  return u;
}
async function ensurePageHiRes(book, pageNum) {
  if (!book) return null;
  const rec = getBookPageRecord(book, Number(pageNum));
  return pageHiResUrl(book.id, rec ? pdfPageOf(rec) : Number(pageNum));
}

// 从服务端裁出某归一化矩形并转 base64（用于存储缩略图 / AI 输入）。服务端 PyMuPDF 直接裁渲，
// 不再前端 canvas 裁剪+toDataURL（那是裁剪加载慢的根源）。maxLong→长边像素。失败返回 ''。
async function cropFromHiRes(book, page, rect, maxLong = 0, rotationDeg = 0, quad = null) {
  if (!book || !page) return '';
  const r = normalizeRect(rect);
  const q = normalizeQuad(quad);
  if (!r) return '';
  try {
    const resp = await fetch(pageHiResUrl(book.id, pdfPageOf(page), r, maxLong || 1200, rotationDeg, q));
    if (!resp.ok) return '';
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch (e) { return ''; }
}

function renderPageMode(book, page) {
  const wrap = el('div');
  const traits = getBookTraits(book) || {};
  const pageOrder = traits.pageOrder === 'ltr' ? 'ltr' : 'rtl';
  const pages = getBookPages(book);
  const spreads = getSpreadSequence(pages, traits.coverPageNum ?? null);
  const currentSpread = spreads.find(s => s.some(p => p.pageNum === page.pageNum)) || [page];
  const isSolo = state.pageSoloMode || currentSpread.length === 1;
  const visualSpreadPages = (!state.pageSoloMode && currentSpread.length === 2)
    ? (pageOrder === 'ltr' ? [currentSpread[0], currentSpread[1]] : [currentSpread[1], currentSpread[0]])
    : [page];
  const doc = pdfDocs[book.id];
  const zoom = state.pageZoom || 1;
  const viewFull = !!state.pageIllustViewFull;
  const spreadStyle = (zoom !== 1 ? `zoom:${zoom};` : '') + 'position:relative;';
  const spread = el('div', { class: 'pd-page-spread' + (isSolo ? ' solo' : ''), style: spreadStyle });
  const stage = el('div', { class: 'pd-page-stage' + (state.pageRectEditing ? ' editing' : '') });

  const renderOverlay = (targetPage, host, editable = false) => {
    if (state.pageRectEditing && targetPage.contentRect) {
      host.appendChild(el('div', {
        class: 'pd-overlay text',
        style: getRectStyle(targetPage.contentRect, 'pointer-events:none; border:2px solid #ff9800; background:rgba(255,152,0,0.12);')
      }));
    }
    if (state.pageRectEditing && targetPage.cropRect) {
      host.appendChild(el('div', {
        class: 'pd-overlay illust',
        style: getRectStyle(targetPage.cropRect, 'pointer-events:none;')
      }));
    }
    if (!editable || !state.pageRectEditing) return;

    const isCropTarget = state.pageRectTarget === 'crop';
    const rectColor = isCropTarget ? '#2e9e5b' : '#ff9800';
    const rectFill  = isCropTarget ? 'rgba(46,158,91,0.18)' : 'rgba(255,152,0,0.18)';
    const editor = el('div', {
      class: 'pd-overlay',
      style: 'left:0; top:0; width:100%; height:100%; cursor:crosshair; background:rgba(255,255,255,0.01);'
    });
    const hint = el('div', {
      style: 'position:absolute; left:10px; top:10px; background:rgba(26,58,92,0.86); color:#fff; padding:6px 10px; border-radius:999px; font-size:12px; pointer-events:none;'
    }, isCropTarget ? '拖拽框选插图区域（只圈插图本体，可拉边微调）' : '拖拽框选正文边框，可继续拖动或拉边微调');
    editor.appendChild(hint);
    const doneBtn = el('button', {
      style: `position:absolute; right:10px; top:10px; z-index:5; cursor:pointer; pointer-events:auto; background:${isCropTarget ? '#2e9e5b' : '#1a3a5c'}; color:#fff; border:none; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:600;`,
      onclick: (ev) => {
        ev.stopPropagation();
        state.pageRectEditing = false;
        if (isCropTarget) state.pageDetailMode = 'illust';   // 插图框选完成 → 回到插图模式看结果
        persist();
        refreshPageDetailWorkspace(book.id, targetPage.pageNum);
        toast(isCropTarget ? '插图框选完成' : '正文框选完成', 'success');
      }
    }, '✓ 完成');
    editor.appendChild(doneBtn);
    let draft = normalizeRect(isCropTarget ? targetPage.cropRect : targetPage.contentRect);
    let startX = 0;
    let startY = 0;
    let startRect = null;
    let dragMode = 'draw';
    const draftEl = el('div', {
      class: 'pd-overlay text',
      style: `display:none; pointer-events:none; border:2px solid ${rectColor}; background:${rectFill};`
    });
    editor.appendChild(draftEl);
    const handles = ['nw', 'ne', 'sw', 'se'].map(pos => {
      const h = el('div', {
        style: `display:none; position:absolute; width:10px; height:10px; border-radius:999px; background:${rectColor}; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.18); pointer-events:none;`
      });
      h.dataset.pos = pos;
      editor.appendChild(h);
      return h;
    });

    const placeHandles = (rect) => {
      const r = normalizeRect(rect);
      if (!r) {
        handles.forEach(h => { h.style.display = 'none'; });
        return;
      }
      const positions = {
        nw: [r[0], r[1]],
        ne: [r[2], r[1]],
        sw: [r[0], r[3]],
        se: [r[2], r[3]],
      };
      for (const h of handles) {
        const pos = positions[h.dataset.pos];
        h.style.display = '';
        h.style.left = `calc(${(pos[0] * 100).toFixed(3)}% - 7px)`;
        h.style.top = `calc(${(pos[1] * 100).toFixed(3)}% - 7px)`;
      }
    };

    const updateDraft = (rect) => {
      draft = normalizeRect(rect);
      if (!draft) {
        draftEl.style.display = 'none';
        placeHandles(null);
        return;
      }
      draftEl.style.display = '';
      draftEl.style.cssText = getRectStyle(draft, `display:block; pointer-events:none; border:2px solid ${rectColor}; background:${rectFill};`);
      placeHandles(draft);
    };

    const detectDragMode = (px, py, rect, box) => {
      const r = normalizeRect(rect);
      if (!r) return 'draw';
      const tolX = Math.max(0.012, 10 / box.width);
      const tolY = Math.max(0.012, 10 / box.height);
      const nearL = Math.abs(px - r[0]) <= tolX;
      const nearR = Math.abs(px - r[2]) <= tolX;
      const nearT = Math.abs(py - r[1]) <= tolY;
      const nearB = Math.abs(py - r[3]) <= tolY;
      const insideX = px >= r[0] && px <= r[2];
      const insideY = py >= r[1] && py <= r[3];
      if (nearL && nearT) return 'resize-nw';
      if (nearR && nearT) return 'resize-ne';
      if (nearL && nearB) return 'resize-sw';
      if (nearR && nearB) return 'resize-se';
      if (nearL && insideY) return 'resize-w';
      if (nearR && insideY) return 'resize-e';
      if (nearT && insideX) return 'resize-n';
      if (nearB && insideX) return 'resize-s';
      if (insideX && insideY) return 'move';
      return 'draw';
    };

    const resizeRect = (mode, rect, dx, dy) => {
      const r = rect.slice();
      if (mode.includes('w')) r[0] += dx;
      if (mode.includes('e')) r[2] += dx;
      if (mode.includes('n')) r[1] += dy;
      if (mode.includes('s')) r[3] += dy;
      const minSize = 0.02;
      if (r[2] - r[0] < minSize) {
        if (mode.includes('w')) r[0] = r[2] - minSize;
        else r[2] = r[0] + minSize;
      }
      if (r[3] - r[1] < minSize) {
        if (mode.includes('n')) r[1] = r[3] - minSize;
        else r[3] = r[1] + minSize;
      }
      return normalizeRect(r);
    };

    updateDraft(draft);

    editor.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const box = host.getBoundingClientRect();
      const px = (e.clientX - box.left) / box.width;
      const py = (e.clientY - box.top) / box.height;
      startX = Math.max(0, Math.min(1, px));
      startY = Math.max(0, Math.min(1, py));
      startRect = draft ? draft.slice() : null;
      dragMode = detectDragMode(startX, startY, draft, box);
      if (dragMode === 'draw') {
        updateDraft([startX, startY, startX, startY]);
      }

      const onMove = (ev) => {
        const mx = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
        const my = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
        if (dragMode === 'draw') {
          updateDraft([
            Math.min(startX, mx),
            Math.min(startY, my),
            Math.max(startX, mx),
            Math.max(startY, my),
          ]);
          return;
        }
        if (!startRect) return;
        if (dragMode === 'move') {
          const dx = mx - startX;
          const dy = my - startY;
          const width = startRect[2] - startRect[0];
          const height = startRect[3] - startRect[1];
          const nextLeft = Math.max(0, Math.min(1 - width, startRect[0] + dx));
          const nextTop = Math.max(0, Math.min(1 - height, startRect[1] + dy));
          updateDraft([nextLeft, nextTop, nextLeft + width, nextTop + height]);
          return;
        }
        updateDraft(resizeRect(dragMode.replace('resize-', ''), startRect, mx - startX, my - startY));
      };
      const onUp = async () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (!draft || rectArea(draft) < 0.02) {
          persist();
          refreshPageDetailWorkspace(book.id, targetPage.pageNum);
          toast(isCropTarget ? '插图框过小，已取消' : '正文框过小，已取消', 'warn');
          return;
        }
        if (isCropTarget) await setPageCropRect(book, targetPage, draft);
        else await setPageContentRect(book, targetPage, draft);
        persist();
        refreshPageDetailWorkspace(book.id, targetPage.pageNum);
        toast(isCropTarget
          ? `已更新第 ${targetPage.pageNum} 页插图框，可继续微调`
          : `已更新第 ${targetPage.pageNum} 页正文框，可继续拖动微调`, 'success');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    host.appendChild(editor);
  };

  const renderPagePane = (targetPage, { editable = false, side = 'left' } = {}) => {
    const pane = el('div', { class: 'pd-page-pane' + (state.pageRectEditing ? '' : ' reading') });
    if (state.pageRectEditing) {
      pane.appendChild(el('div', { class: 'pd-page-pane-label' },
        `${side === 'left' ? '左页' : '右页'} · 第 ${targetPage.pageNum} 页${editable ? ' · 当前编辑页' : ''}`));
    }
    const frame = el('div', { class: 'pd-page-wrap' });
    pane.appendChild(frame);

    const appendImage = (src) => {
      frame.innerHTML = '';
      const img = el('img', { src, class: 'pd-page-image', style: 'max-width:100%' });
      frame.appendChild(img);
      renderOverlay(targetPage, frame, editable);
    };

    // 阅读态优先用「正文裁剪缩略图」(预处理剪裁时已生成 contentThumbHi)，这样剪裁后立即可见、且无需实时渲染；
    // 编辑态/全页态用整页缩略图（编辑需要整页对位，全页本就是看整页）。
    const baseThumb = (state.pageRectEditing || viewFull)
      ? (targetPage.thumbHi || targetPage.thumb)
      : (targetPage.contentThumbHi || targetPage.contentThumb || targetPage.thumbHi || targetPage.thumb);
    appendImage(baseThumb);
    // 升级为高清（服务端 PyMuPDF 渲染 ~120ms）：版心态用带 rect 的端点(服务端直接裁渲)，
    // 全页/编辑态用整页端点。两者都是「下载即显示」，裁剪和整页一样快（不再前端 canvas 裁）。
    {
      const stillHere = () => state.mainView === 'page-detail' && state.currentBookId === book.id && state.currentBookPage === page.pageNum;
      const cropForView = (!state.pageRectEditing && !viewFull) ? normalizeRect(targetPage.contentRect) : null;
      const showUrl = cropForView
        ? pageHiResUrl(book.id, pdfPageOf(targetPage), cropForView, 1300)
        : pageHiResUrl(book.id, pdfPageOf(targetPage));
      const pre = new Image();
      pre.onload = () => { if (stillHere()) appendImage(showUrl); };
      pre.src = showUrl;
    }
    pane.appendChild(el('div', { class: 'pd-page-page-num' },
      traits.coverPageNum === targetPage.pageNum ? `封面 · 第 ${targetPage.pageNum} 页` : `第 ${targetPage.pageNum} 页`
    ));
    return pane;
  };

  for (let i = 0; i < visualSpreadPages.length; i++) {
    const targetPage = visualSpreadPages[i];
    spread.appendChild(renderPagePane(targetPage, {
      editable: targetPage.pageNum === page.pageNum,
      side: i === 0 ? 'left' : 'right',
    }));
  }
  if (!doc) {
    stage.appendChild(el('div', { style: 'font-size:11px; color:#aaa; text-align:center; margin-bottom:8px' },
      book.pdfStorage?.url ? '正在恢复 PDF 文档，暂时显示缩略图…' : 'PDF 未加载，显示缩略图'));
  }
  stage.appendChild(spread);

  // 右上角最大化/还原按钮，放在 spread 上（紧贴书页展示区右上角）
  spread.appendChild(el('button', {
    class: 'pd-view-toggle-btn',
    title: viewFull ? '还原为裁剪视图' : '展开为全页视图',
    onclick: () => { state.pageIllustViewFull = !state.pageIllustViewFull; refreshPageDetailWorkspace(book.id, page.pageNum); },
  }, viewFull ? '⊡' : '⛶'));
  wrap.appendChild(stage);

  if (state.pageRectEditing) {
    wrap.appendChild(el('div', { style: 'margin-top:8px; font-size:12px; color:var(--c-text-soft);' },
      '书页顺序以导入时页码为准，当前仅按古籍阅读习惯以“右页到左页”方式展示。正文框编辑仅作用于“当前编辑页”。'));
  }
  return wrap;
}

function referenceScopeId(book) {
  return String(book?.groupId || book?.id || '').trim();
}

function referenceReaderStorageKey(scopeId, referenceId) {
  const datasetId = typeof getDataSourceId === 'function' ? (getDataSourceId() || 'unknown') : 'unknown';
  return `gjbz.reference-reader.v1.${datasetId}.${scopeId}.${referenceId}`;
}

function loadReferenceReaderPrefs(scopeId, referenceId) {
  try {
    return JSON.parse(localStorage.getItem(referenceReaderStorageKey(scopeId, referenceId))) || {};
  } catch {
    return {};
  }
}

function saveReferenceReaderPrefs(scopeId, referenceId, patch = {}) {
  if (!scopeId || !referenceId) return;
  const key = referenceReaderStorageKey(scopeId, referenceId);
  const current = loadReferenceReaderPrefs(scopeId, referenceId);
  try {
    localStorage.setItem(key, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

function setReferencePaneCollapsed(collapsed) {
  try { localStorage.setItem('gjbz.reference-pane-collapsed.v1', collapsed ? '1' : '0'); } catch {}
  const pane = $('#reference-pane');
  pane?.classList.toggle('is-collapsed', !!collapsed);
  if (state.mainView === 'page-detail' && state.pageDetailMode === 'text') applyRightCollapsed();
}

function isReferencePaneCollapsed() {
  try { return localStorage.getItem('gjbz.reference-pane-collapsed.v1') === '1'; }
  catch { return false; }
}

function isProofEditorCollapsed() {
  try { return localStorage.getItem('gjbz.proof-editor-collapsed.v1') === '1'; }
  catch { return false; }
}

function setProofEditorCollapsed(collapsed) {
  try { localStorage.setItem('gjbz.proof-editor-collapsed.v1', collapsed ? '1' : '0'); } catch {}
}

async function fetchReferenceJson(url, options) {
  const response = await fetch(url, options);
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || `参考文本请求失败（HTTP ${response.status}）`);
  return payload;
}

function resetReferenceReaderScope(scopeId) {
  referenceReaderState.scopeId = scopeId;
  referenceReaderState.items = [];
  referenceReaderState.selectedId = '';
  referenceReaderState.documents = new Map();
  referenceReaderState.loading = false;
  referenceReaderState.loaded = false;
  referenceReaderState.error = '';
  referenceReaderState.search = '';
  referenceReaderState.searchIndex = 0;
  referenceReaderState.selectedRange = null;
  referenceReaderState.editing = false;
  referenceReaderState.editDraft = '';
  referenceReaderState.savingEdit = false;
  referenceReaderState.showOriginal = false;
  referenceReaderState.comparisonSource = null;
  referenceReaderState.comparisonActive = false;
  referenceReaderState.comparisonLoading = false;
  referenceReaderState.comparisonError = '';
  referenceReaderState.comparisonResult = null;
  referenceReaderState.comparisonIndex = 0;
  referenceReaderState.comparisonStale = false;
  referenceReaderState.comparisonExpanded = false;
  referenceReaderState.comparisonRequestId += 1;
  referenceReaderState.comparisonPageRanges = new Map();
  referenceReaderState.savingUncertainty = false;
  referenceReaderState.uncertaintyIndex = -1;
  referenceReaderState.pendingUncertaintyMarks = new Map();
}

async function ensureReferenceIndex(book) {
  const scopeId = referenceScopeId(book);
  if (!scopeId) return;
  if (referenceReaderState.scopeId !== scopeId) resetReferenceReaderScope(scopeId);
  if (referenceReaderState.loaded || referenceReaderState.loading) return;
  referenceReaderState.loading = true;
  referenceReaderState.error = '';
  renderReferencePane(book, referenceReaderState.editor);
  try {
    const payload = await fetchReferenceJson(BRIDGE_TEXT_REFERENCES_URL(scopeId));
    if (referenceReaderState.scopeId !== scopeId) return;
    referenceReaderState.items = Array.isArray(payload.items) ? payload.items : [];
    referenceReaderState.loaded = true;
    if (!referenceReaderState.items.some(item => item.id === referenceReaderState.selectedId)) {
      referenceReaderState.selectedId = referenceReaderState.items[0]?.id || '';
    }
  } catch (error) {
    if (referenceReaderState.scopeId === scopeId) referenceReaderState.error = error.message || '参考文本读取失败';
  } finally {
    if (referenceReaderState.scopeId === scopeId) {
      referenceReaderState.loading = false;
      renderReferencePane(book, referenceReaderState.editor);
    }
  }
}

async function ensureReferenceDocument(book, referenceId) {
  const scopeId = referenceScopeId(book);
  if (!scopeId || !referenceId || referenceReaderState.documents.has(referenceId)) return;
  if (referenceReaderState.loadingDocument === referenceId) return;
  referenceReaderState.loadingDocument = referenceId;
  referenceReaderState.error = '';
  renderReferencePane(book, referenceReaderState.editor);
  try {
    const payload = await fetchReferenceJson(BRIDGE_TEXT_REFERENCE_URL(scopeId, referenceId));
    if (referenceReaderState.scopeId !== scopeId) return;
    referenceReaderState.documents.set(referenceId, payload);
  } catch (error) {
    if (referenceReaderState.scopeId === scopeId) referenceReaderState.error = error.message || '参考文本读取失败';
  } finally {
    if (referenceReaderState.scopeId === scopeId && referenceReaderState.loadingDocument === referenceId) {
      referenceReaderState.loadingDocument = '';
      renderReferencePane(book, referenceReaderState.editor);
    }
  }
}

async function saveReferenceEditedCopy(book, referenceId, viewSnapshot = null) {
  const scopeId = referenceScopeId(book);
  if (!scopeId || !referenceId || referenceReaderState.savingEdit) return;
  const content = String(referenceReaderState.editDraft || '').trim();
  if (!content) {
    toast('整理稿不能为空', 'warn');
    return;
  }
  // 保存期间会发生“正在保存”和“保存完成”两次重绘。固定使用点击保存前的
  // 视图快照，避免两个 requestAnimationFrame 之间相互捕获到临时的 scrollTop=0。
  const saveViewSnapshot = viewSnapshot || captureReferencePaneViewState();
  const pendingUncertaintyMarks = referenceReaderState.pendingUncertaintyMarks.get(referenceId);
  const pendingUncertaintyCount = Array.isArray(pendingUncertaintyMarks)
    ? pendingUncertaintyMarks.length
    : 0;
  referenceReaderState.savingEdit = true;
  renderReferencePane(book, referenceReaderState.editor, { viewSnapshot: saveViewSnapshot });
  try {
    const payload = await fetchReferenceJson(BRIDGE_TEXT_REFERENCE_URL(scopeId, referenceId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        ...(pendingUncertaintyMarks ? { uncertain_marks: pendingUncertaintyMarks } : {}),
      }),
    });
    if (referenceReaderState.scopeId !== scopeId) return;
    referenceReaderState.documents.set(referenceId, payload);
    referenceReaderState.items = referenceReaderState.items.map(item =>
      item.id === referenceId ? { ...item, ...(payload.item || {}), has_edits: true } : item);
    referenceReaderState.editing = false;
    referenceReaderState.editDraft = '';
    referenceReaderState.showOriginal = false;
    referenceReaderState.pendingUncertaintyMarks.delete(referenceId);
    const dropped = Number(payload.dropped_uncertain_marks) || 0;
    if (dropped) {
      toast(`整理稿已保存；${dropped} 处存疑标记因文字变化无法继续定位，已移除`, 'warn');
    } else {
      toast(
        pendingUncertaintyMarks
          ? `整理稿与 ${pendingUncertaintyCount} 处存疑标记已保存；原始导入文本未改变`
          : '整理稿已保存；原始导入文本未改变',
        'success',
      );
    }
  } catch (error) {
    toast(error.message || '整理稿保存失败', 'error');
  } finally {
    if (referenceReaderState.scopeId === scopeId) {
      referenceReaderState.savingEdit = false;
      renderReferencePane(book, referenceReaderState.editor, { viewSnapshot: saveViewSnapshot });
    }
  }
}

function referenceUncertainMarks(payload) {
  return Array.isArray(payload?.uncertain_marks)
    ? payload.uncertain_marks
      .filter(mark =>
        mark
        && Number.isInteger(mark.start)
        && Number.isInteger(mark.end)
        && mark.end > mark.start
        && typeof mark.quote === 'string')
      .sort((left, right) => left.start - right.start || left.end - right.end)
    : [];
}

function reanchorReferenceUncertainMarks(marks, content) {
  const text = String(content || '');
  const reanchored = [];
  let dropped = 0;
  referenceUncertainMarks({ uncertain_marks: marks }).forEach(mark => {
    const quote = mark.quote;
    let start = Number(mark.start);
    if (text.slice(start, start + quote.length) !== quote) {
      start = text.indexOf(quote);
      if (start < 0 || text.indexOf(quote, start + 1) >= 0) {
        dropped += 1;
        return;
      }
    }
    const candidate = { ...mark, start, end: start + quote.length };
    if (reanchored.some(item => candidate.start < item.end && candidate.end > item.start)) {
      dropped += 1;
      return;
    }
    reanchored.push(candidate);
  });
  return { marks: reanchored, dropped };
}

async function saveReferenceUncertainMarks(book, referenceId, marks, viewSnapshot = null) {
  const scopeId = referenceScopeId(book);
  if (!scopeId || !referenceId || referenceReaderState.savingUncertainty) return false;
  referenceReaderState.savingUncertainty = true;
  try {
    const result = await fetchReferenceJson(
      BRIDGE_TEXT_REFERENCE_UNCERTAINTY_URL(scopeId, referenceId),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marks }),
      },
    );
    if (referenceReaderState.scopeId !== scopeId) return false;
    const payload = referenceReaderState.documents.get(referenceId);
    if (payload) payload.uncertain_marks = Array.isArray(result.marks) ? result.marks : [];
    referenceReaderState.selectedRange = null;
    referenceReaderState.savingUncertainty = false;
    renderReferencePane(book, referenceReaderState.editor, {
      viewSnapshot: viewSnapshot || captureReferencePaneViewState(),
    });
    return true;
  } catch (error) {
    toast(error.message || '存疑标记保存失败', 'error');
    return false;
  } finally {
    referenceReaderState.savingUncertainty = false;
  }
}

function newReferenceUncertainMark(content, range) {
  const start = Math.max(0, Math.min(Number(range?.start) || 0, content.length));
  const end = Math.max(start, Math.min(Number(range?.end) || start, content.length));
  const quote = content.slice(start, end);
  if (!quote.trim()) return null;
  return {
    id: `uncertain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    start,
    end,
    quote,
    created_at: new Date().toISOString(),
  };
}

function referenceUncertainMarkForCurrentDraft(documentPayload, range) {
  return newReferenceUncertainMark(currentReferenceWorkingContent(documentPayload), range);
}

function nextReferenceUncertaintyIndex(markCount, currentIndex, direction = 1) {
  const count = Math.max(0, Math.floor(Number(markCount) || 0));
  if (!count) return -1;
  const step = Number(direction) < 0 ? -1 : 1;
  const current = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < count
    ? currentIndex
    : (step < 0 ? 0 : -1);
  return (current + step + count) % count;
}

function setReferenceSelectedRange(referenceId, start, end) {
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.max(safeStart, Number(end) || safeStart);
  const selectedRange = { referenceId, start: safeStart, end: safeEnd };
  referenceReaderState.selectedRange = selectedRange;
  return selectedRange;
}

function syncReferenceSelectedRange(documentNode, referenceId) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !documentNode.contains(selection.anchorNode)) return null;
  const selectedRange = selection.getRangeAt(0);
  if (selectedRange.collapsed || !selectedRange.toString()) return null;
  const beforeRange = selectedRange.cloneRange();
  beforeRange.selectNodeContents(documentNode);
  try {
    beforeRange.setEnd(selectedRange.startContainer, selectedRange.startOffset);
  } catch {
    return null;
  }
  return setReferenceSelectedRange(
    referenceId,
    beforeRange.toString().length,
    beforeRange.toString().length + selectedRange.toString().length,
  );
}

function referenceUncertainMarkAtRange(marks, range) {
  if (!range) return null;
  const start = Number(range.start) || 0;
  const end = Number(range.end) || start;
  return marks.find(mark => start < mark.end && end > mark.start)
    || marks.find(mark => start === end && start >= mark.start && start <= mark.end)
    || null;
}

function applyReferenceUncertainMarks(documentNode, marks, selectedMarkId = '') {
  const safeMarks = referenceUncertainMarks({ uncertain_marks: marks });
  safeMarks.forEach(mark => {
    const walker = document.createTreeWalker(documentNode, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nextOffset = offset + node.nodeValue.length;
      if (mark.start < nextOffset && mark.end > offset) {
        textNodes.push({
          node,
          start: Math.max(0, mark.start - offset),
          end: Math.min(node.nodeValue.length, mark.end - offset),
        });
      }
      offset = nextOffset;
    }
    textNodes.reverse().forEach(part => {
      if (part.end <= part.start) return;
      const range = document.createRange();
      range.setStart(part.node, part.start);
      range.setEnd(part.node, part.end);
      const span = el('span', {
        class: `reference-uncertain-mark${mark.id === selectedMarkId ? ' is-selected' : ''}`,
        'data-reference-uncertain-id': mark.id,
        title: `存疑：${mark.quote}`,
      });
      range.surroundContents(span);
    });
  });
}

function normalizeReferenceEditText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function referenceEditHasChanges(original, draft) {
  return normalizeReferenceEditText(original) !== normalizeReferenceEditText(draft);
}

function currentReferenceWorkingContent(documentPayload) {
  if (!documentPayload) return '';
  if (referenceReaderState.editing) return String(referenceReaderState.editDraft || '');
  if (referenceReaderState.showOriginal) {
    return String(documentPayload.original_content || documentPayload.content || '');
  }
  return String(documentPayload.content || '');
}

function referenceExportFilename(item) {
  const title = String(item?.title || '整书整理稿')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || '整书整理稿';
  return `${title}_整理稿.txt`;
}

function exportReferenceEditedCopy(documentPayload, item) {
  if (referenceReaderState.editing) {
    toast('请先保存当前整理稿修改，再导出', 'warn');
    return false;
  }
  if (!(documentPayload?.has_edits || documentPayload?.item?.has_edits)) {
    toast('当前尚无已保存的整理稿修改', 'warn');
    return false;
  }
  const content = String(documentPayload.content || '');
  if (!content.trim()) {
    toast('整理稿为空，无法导出', 'warn');
    return false;
  }
  download(referenceExportFilename(item), content, 'text/plain;charset=utf-8');
  toast('已导出当前整理稿（不含存疑旁注）', 'success');
  return true;
}

function referenceComparisonPageKey(book, page) {
  return `${book?.id || ''}:${page?.pageNum || ''}`;
}

function referenceComparisonRangeKey(book, referenceId = referenceReaderState.selectedId) {
  return `${referenceReaderState.scopeId}:${referenceId || ''}:${book?.id || ''}`;
}

function getReferenceComparisonRanges(book, referenceId = referenceReaderState.selectedId) {
  return referenceReaderState.comparisonPageRanges.get(
    referenceComparisonRangeKey(book, referenceId),
  ) || [];
}

function rememberReferenceComparisonRange(book, page, referenceId, range) {
  const pageNum = Number(page?.pageNum);
  if (!book || !Number.isFinite(pageNum) || !range) return;
  const key = referenceComparisonRangeKey(book, referenceId);
  const current = getReferenceComparisonRanges(book, referenceId)
    .filter(item => Number(item.pageNum) !== pageNum);
  const ocrStart = Number(range.ocrStart);
  const ocrEnd = Number(range.ocrEnd);
  const savedRange = {
    pageNum,
    referenceStart: Number(range.referenceStart),
    referenceEnd: Number(range.referenceEnd),
    manual: !!range.manual,
  };
  if (Number.isFinite(ocrStart)) savedRange.ocrStart = ocrStart;
  if (Number.isFinite(ocrEnd)) savedRange.ocrEnd = ocrEnd;
  current.push(savedRange);
  referenceReaderState.comparisonPageRanges.set(key, current);
}

function clearReferenceComparisonRanges(book, referenceId = referenceReaderState.selectedId) {
  if (book) {
    referenceReaderState.comparisonPageRanges.delete(referenceComparisonRangeKey(book, referenceId));
    return;
  }
  const prefix = `${referenceReaderState.scopeId}:${referenceId || ''}:`;
  Array.from(referenceReaderState.comparisonPageRanges.keys())
    .filter(key => key.startsWith(prefix))
    .forEach(key => referenceReaderState.comparisonPageRanges.delete(key));
}

function setReferenceComparisonStartFromRange(book, page, referenceId, range) {
  if (
    !range
    || !referenceId
    || !Number.isFinite(Number(range.start))
    || !book
    || !page
  ) {
    return false;
  }
  rememberReferenceComparisonRange(book, page, referenceId, {
    referenceStart: Number(range.start),
    referenceEnd: Math.max(Number(range.start), Number(range.end) || Number(range.start)),
    ocrStart: 0,
    ocrEnd: getEffectivePageText(page).length,
    manual: true,
  });
  return true;
}

function resolveReferenceComparisonLocation(book, page, referenceId) {
  const ranges = getReferenceComparisonRanges(book, referenceId);
  const savedStart = chooseReferenceStartHint({ pageNum: page?.pageNum, ranges });
  if (savedStart !== null && savedStart !== '' && Number.isFinite(Number(savedStart))) {
    return { referenceStartHint: Number(savedStart), source: 'saved' };
  }
  return { referenceStartHint: null, source: 'unique-text' };
}

function setReferenceComparisonStartFromSelection() {
  const selected = referenceReaderState.selectedRange;
  const source = referenceReaderState.comparisonSource;
  const referenceId = referenceReaderState.selectedId;
  if (selected?.referenceId !== referenceId
    || !setReferenceComparisonStartFromRange(source?.book, source?.page, referenceId, selected)) {
    toast('请先在右侧整理稿中选中一个字或一小段文字', 'warn');
    return false;
  }
  markReferenceComparisonStale('已指定本页起点，正在从选中位置逐字对照');
  return true;
}

function markReferenceComparisonStale(
  message = '内容已变化，请执行当前正文页对照',
  { preserveOcrHighlights = false } = {},
) {
  if (!referenceReaderState.comparisonActive) return;
  const previousResult = referenceReaderState.comparisonResult;
  if (!preserveOcrHighlights) referenceReaderState.comparisonResult = null;
  referenceReaderState.comparisonError = '';
  referenceReaderState.comparisonLoading = false;
  referenceReaderState.comparisonStale = true;
  referenceReaderState.comparisonIndex = 0;
  referenceReaderState.comparisonRequestId += 1;
  const status = document.querySelector('[data-reference-comparison-status]');
  if (status) status.textContent = message;
  document.querySelectorAll('[data-reference-comparison-nav]').forEach(button => {
    button.disabled = true;
  });
  renderOcrComparisonHighlights(
    referenceReaderState.comparisonSource?.editor,
    preserveOcrHighlights ? previousResult : null,
    0,
  );
}

function updateReferenceComparisonSource(book, page, editor) {
  const nextKey = referenceComparisonPageKey(book, page);
  const previousKey = referenceReaderState.comparisonSource?.pageKey || '';
  referenceReaderState.comparisonSource = {
    book,
    page,
    editor,
    ocrText: String(editor?.value || ''),
    pageKey: nextKey,
  };
  if (previousKey && previousKey !== nextKey) {
    markReferenceComparisonStale('已切换到当前正文页，可执行本页对照');
    const action = document.querySelector('[data-reference-comparison-action]');
    if (action) action.textContent = '对照本页';
  }
}

async function canonicalizeReferenceComparisonText(text) {
  const source = String(text || '');
  if (!source) return '';
  const key = `${source.length}:${fieldHash(source)}`;
  if (referenceComparisonCanonicalCache.has(key)) {
    return referenceComparisonCanonicalCache.get(key);
  }
  const response = await fetch(BRIDGE_TEXT_CONVERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: source, direction: 't2s' }),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    throw new Error(payload.error || `繁简归一失败（HTTP ${response.status}）`);
  }
  const canonical = String(payload.text || '');
  if (!canonical && source.trim()) throw new Error('繁简归一返回空文本');
  referenceComparisonCanonicalCache.set(key, canonical);
  while (referenceComparisonCanonicalCache.size > 12) {
    referenceComparisonCanonicalCache.delete(referenceComparisonCanonicalCache.keys().next().value);
  }
  return canonical;
}

function buildReferenceComparisonRangeSummary(text, result) {
  const source = String(text || '');
  const start = Math.max(0, Math.min(Number(result?.referenceStart) || 0, source.length));
  const end = Math.max(start, Math.min(Number(result?.referenceEnd) || start, source.length));
  const compared = source.slice(start, end).replace(/\s+/g, ' ').trim();
  const snippetLength = 18;
  return {
    start,
    end,
    displayStart: start + 1,
    displayEnd: end,
    length: Math.max(0, end - start),
    startSnippet: compared.slice(0, snippetLength),
    endSnippet: compared.slice(Math.max(0, compared.length - snippetLength)),
  };
}

function renderOcrComparisonHighlights(editor, result, activeIndex = 0) {
  const stack = editor?.closest?.('.ocr-proof-textarea-stack');
  const layer = stack?.querySelector?.('.ocr-proof-comparison-layer');
  if (!stack || !layer) return;
  layer.innerHTML = '';
  const differences = Array.isArray(result?.differences) ? result.differences : [];
  if (!result?.matched || !differences.length) {
    stack.classList.remove('has-comparison');
    return;
  }

  const text = String(editor.value || '');
  layer.style.width = `${editor.clientWidth}px`;
  layer.style.height = `${editor.clientHeight}px`;
  const ocrDifferences = differences.map(difference => ({
    ...difference,
    referenceStart: difference.ocrStart,
    referenceEnd: difference.ocrEnd,
  }));
  buildDifferenceHighlightSegments(text, ocrDifferences, activeIndex).forEach(segment => {
    if (segment.type === 'text') {
      layer.appendChild(document.createTextNode(segment.text));
      return;
    }
    const mark = el('mark', {
      class: `ocr-comparison-highlight${segment.text ? '' : ' is-empty'}${segment.active ? ' is-current' : ''}`,
      'data-reference-comparison-index': String(segment.differenceIndex),
      title: '校正文与整理稿在此处不同',
    }, segment.text);
    layer.appendChild(mark);
  });
  layer.scrollTop = editor.scrollTop;
  layer.scrollLeft = editor.scrollLeft;
  stack.classList.add('has-comparison');
}

function revealReferenceComparisonDifference(index = 0) {
  const result = referenceReaderState.comparisonResult;
  if (!result?.matched) return;
  const differences = Array.isArray(result.differences) ? result.differences : [];
  const documentNode = document.querySelector('.reference-document');
  const scroll = document.querySelector('.reference-document-scroll');
  const payload = referenceReaderState.documents.get(referenceReaderState.selectedId);
  const content = currentReferenceWorkingContent(payload);
  const source = referenceReaderState.comparisonSource;
  if (!documentNode || !scroll || !content || !source) return;

  if (!differences.length) {
    const ratio = Math.max(0, Math.min(1, Number(result.referenceStart || 0) / content.length));
    scroll.scrollTop = ratio * Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    return;
  }
  const safeIndex = (Number(index) + differences.length) % differences.length;
  referenceReaderState.comparisonIndex = safeIndex;
  const difference = differences[safeIndex];
  const referenceMark = documentNode.querySelector('[data-reference-comparison-current]');
  if (referenceMark) {
    scroll.scrollTop = Math.max(0, referenceMark.offsetTop - scroll.clientHeight / 2);
  }
  const editor = source.editor;
  if (editor && typeof editor.setSelectionRange === 'function') {
    editor.setSelectionRange(difference.ocrStart, difference.ocrStart);
    editor.focus?.({ preventScroll: true });
    const layer = editor.closest?.('.ocr-proof-textarea-stack')
      ?.querySelector?.('.ocr-proof-comparison-layer');
    const currentMark = layer?.querySelector?.('.ocr-comparison-highlight.is-current');
    if (currentMark && layer) {
      layer.scrollTop = Math.max(0, currentMark.offsetTop - layer.clientHeight / 2);
      editor.scrollTop = layer.scrollTop;
    }
  }
}

function activateReferenceComparisonDifference(index = 0) {
  const result = referenceReaderState.comparisonResult;
  const differences = Array.isArray(result?.differences) ? result.differences : [];
  if (!differences.length) return;
  const safeIndex = (Number(index) + differences.length) % differences.length;
  referenceReaderState.comparisonIndex = safeIndex;

  document.querySelectorAll('[data-reference-comparison-index]').forEach(node => {
    const isCurrent = Number(node.getAttribute('data-reference-comparison-index')) === safeIndex;
    node.classList.toggle('is-current', isCurrent);
    if (node.matches?.('.reference-comparison-highlight')) {
      if (isCurrent) node.setAttribute('data-reference-comparison-current', '');
      else node.removeAttribute('data-reference-comparison-current');
    }
  });
  const count = document.querySelector('[data-reference-comparison-count]');
  if (count) count.textContent = `${safeIndex + 1}/${differences.length}`;
  renderOcrComparisonHighlights(
    referenceReaderState.comparisonSource?.editor,
    result,
    safeIndex,
  );
  revealReferenceComparisonDifference(safeIndex);
}

async function runReferenceTextComparison() {
  const source = referenceReaderState.comparisonSource;
  const selectedId = referenceReaderState.selectedId;
  const payload = referenceReaderState.documents.get(selectedId);
  const book = source?.book;
  if (!source || !book || !payload || !selectedId) return;
  if (referenceReaderState.showOriginal) {
    toast('请先切回整理稿，再执行差异核对', 'warn');
    return;
  }
  const ocrText = String(source.editor?.value || '');
  source.ocrText = ocrText;
  const referenceText = currentReferenceWorkingContent(payload);
  const comparisonRanges = getReferenceComparisonRanges(book, selectedId);
  const comparisonLocation = resolveReferenceComparisonLocation(
    book,
    source.page,
    selectedId,
  );
  if (!ocrText.trim()) {
    toast('本页没有可对照的 OCR 文字', 'warn');
    return;
  }
  if (!referenceText.trim()) {
    toast('整理稿为空，无法执行差异核对', 'warn');
    return;
  }

  referenceReaderState.comparisonActive = true;
  referenceReaderState.comparisonLoading = true;
  referenceReaderState.comparisonError = '';
  referenceReaderState.comparisonResult = null;
  referenceReaderState.comparisonIndex = 0;
  referenceReaderState.comparisonStale = false;
  referenceReaderState.search = '';
  referenceReaderState.searchIndex = 0;
  const requestId = referenceReaderState.comparisonRequestId + 1;
  referenceReaderState.comparisonRequestId = requestId;
  renderReferencePane(book, source.editor);

  try {
    const [ocrCanonical, referenceCanonical] = await Promise.all([
      canonicalizeReferenceComparisonText(ocrText),
      canonicalizeReferenceComparisonText(referenceText),
    ]);
    if (requestId !== referenceReaderState.comparisonRequestId) return;
    const result = compareContinuousText({
      ocrRaw: ocrText,
      ocrCanonical,
      referenceRaw: referenceText,
      referenceCanonical,
      referenceStartHint: comparisonLocation.referenceStartHint,
    });
    referenceReaderState.comparisonResult = result;
    if (result.matched) {
      rememberReferenceComparisonRange(book, source.page, selectedId, {
        referenceStart: result.referenceStart,
        referenceEnd: result.referenceEnd,
        ocrStart: 0,
        ocrEnd: ocrText.length,
        manual: comparisonRanges.some(range =>
          Number(range.pageNum) === Number(source.page?.pageNum) && range.manual),
      });
    }
  } catch (error) {
    if (requestId !== referenceReaderState.comparisonRequestId) return;
    referenceReaderState.comparisonError =
      `差异核对未执行：${error.message || '繁简归一失败'}。为避免把普通繁简误报为差异，系统没有降级为原字比较。`;
  } finally {
    if (requestId === referenceReaderState.comparisonRequestId) {
      referenceReaderState.comparisonLoading = false;
      renderOcrComparisonHighlights(source.editor, referenceReaderState.comparisonResult, 0);
      renderReferencePane(book, source.editor);
      requestAnimationFrame(() => revealReferenceComparisonDifference(0));
    }
  }
}

function renderReferenceComparisonToolbar() {
  const result = referenceReaderState.comparisonResult;
  const differences = Array.isArray(result?.differences) ? result.differences : [];
  const currentIndex = differences.length
    ? Math.min(referenceReaderState.comparisonIndex, differences.length - 1)
    : 0;
  const needsAttention = referenceReaderState.comparisonLoading
    || referenceReaderState.comparisonStale
    || !!referenceReaderState.comparisonError;
  const expanded = referenceReaderState.comparisonExpanded || needsAttention;
  const wrapper = el('section', {
    class: `reference-comparison${referenceReaderState.comparisonStale ? ' is-stale' : ''}${expanded ? ' is-expanded' : ''}`,
    id: 'reference-comparison-toolbar',
    'aria-label': '正文差异核对',
  });
  const actionLabel = referenceComparisonActionLabel(referenceReaderState.comparisonLoading);

  let statusText = '对照只用于定位和提醒，不会自动修改 OCR 或整理稿。';
  if (referenceReaderState.comparisonLoading) statusText = '正在归一繁简并定位连续整理稿中的对应段落…';
  else if (referenceReaderState.comparisonError) statusText = referenceReaderState.comparisonError;
  else if (referenceReaderState.comparisonStale) statusText = '内容或页面已变化，请执行当前正文页对照。';
  else if (result && !result.matched) statusText = result.reason || '未找到可靠对应段落。';
  else if (result?.matched && !differences.length) {
    statusText = `${result.locationStrategy === 'hinted' ? '已按连续位置逐字对照；' : ''}未发现需要核对的实质文字差异。`;
  } else if (result?.matched) {
    statusText = `${result.locationStrategy === 'hinted' ? '已按连续位置逐字对照；' : ''}发现 ${differences.length} 处需要核对的文字差异。`;
  }

  const compactStatus = referenceReaderState.comparisonLoading
    ? '对照中'
    : referenceReaderState.comparisonStale
      ? '需重对照'
      : differences.length
        ? `差异 ${differences.length}`
        : result?.matched
          ? '无差异'
          : '未对照';
  const toggleDetails = el('button', {
    class: 'btn reference-comparison-toggle',
    title: expanded ? '收起差异核对说明' : '展开差异核对说明',
    'aria-expanded': expanded ? 'true' : 'false',
    onclick: () => {
      referenceReaderState.comparisonExpanded = !wrapper.classList.contains('is-expanded');
      wrapper.classList.toggle('is-expanded', referenceReaderState.comparisonExpanded);
      toggleDetails.setAttribute('aria-expanded', referenceReaderState.comparisonExpanded ? 'true' : 'false');
      toggleDetails.textContent = referenceReaderState.comparisonExpanded ? '收起' : '详情';
    },
  }, expanded ? '收起' : '详情');
  const compactActions = el('div', { class: 'reference-comparison-compact-actions' });
  if (differences.length) {
    compactActions.append(
      el('button', {
        class: 'btn', title: '上一处差异',
        onclick: () => activateReferenceComparisonDifference(referenceReaderState.comparisonIndex - 1),
      }, '‹'),
      el('span', { class: 'reference-comparison-compact-count' }, `${currentIndex + 1}/${differences.length}`),
      el('button', {
        class: 'btn', title: '下一处差异',
        onclick: () => activateReferenceComparisonDifference(referenceReaderState.comparisonIndex + 1),
      }, '›'),
    );
  }
  compactActions.append(el('button', {
    class: 'btn primary',
    'data-reference-comparison-action': '',
    disabled: referenceReaderState.comparisonLoading ? '' : null,
    onclick: () => runReferenceTextComparison(),
  }, actionLabel), toggleDetails);
  wrapper.appendChild(el('div', { class: 'reference-comparison-head' },
    el('div', { class: 'reference-comparison-summary' },
      el('strong', null, '正文核对'),
      el('span', { class: 'reference-comparison-compact-status' }, compactStatus)),
    compactActions));

  const detail = el('div', { class: 'reference-comparison-detail' },
    el('div', { class: 'reference-comparison-detail-head' },
      el('small', null, '忽略标点、空格、换行和普通繁简'),
      el('button', {
        class: 'btn',
        title: '先在右侧整理稿中选中文字，再从该位置开始本页逐字对照',
        disabled: referenceReaderState.comparisonLoading ? '' : null,
        onclick: () => {
          if (setReferenceComparisonStartFromSelection()) runReferenceTextComparison();
        },
      }, '从选中处')),
    el('div', {
    class: referenceReaderState.comparisonError || (result && !result.matched)
      ? 'reference-comparison-status has-warning'
      : 'reference-comparison-status',
    'data-reference-comparison-status': '',
    }, statusText));

  if (result?.matched && differences.length) {
    detail.appendChild(el('div', { class: 'reference-comparison-nav' },
      el('button', {
        class: 'btn',
        'data-reference-comparison-nav': '',
        onclick: () => activateReferenceComparisonDifference(
          referenceReaderState.comparisonIndex - 1,
        ),
      }, '上一处'),
      el('span', { 'data-reference-comparison-count': '' }, `${currentIndex + 1}/${differences.length}`),
      el('button', {
        class: 'btn',
        'data-reference-comparison-nav': '',
        onclick: () => activateReferenceComparisonDifference(
          referenceReaderState.comparisonIndex + 1,
        ),
      }, '下一处')));
  }
  wrapper.appendChild(detail);
  return wrapper;
}

function referenceComparisonActionLabel(loading = false) {
  return loading ? '正在对照…' : '对照本页';
}

function openReferenceImportDialog(book) {
  const scopeId = referenceScopeId(book);
  if (!scopeId) return;
  const fileInput = el('input', {
    type: 'file',
    accept: '.txt,.md,.markdown,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    style: 'width:100%;',
  });
  const titleInput = el('input', {
    type: 'text',
    placeholder: '参考文本名称（可选，默认使用文件名）',
    style: 'width:100%; height:34px; padding:0 9px; border:1px solid var(--c-border-strong); border-radius:6px;',
  });
  const body = el('div', { class: 'modal-body', style: 'display:grid; gap:12px;' },
    el('div', { style: 'font-size:13px; line-height:1.75; color:var(--c-text-soft);' },
      `导入范围：${book.groupId ? '合并书组' : '当前书籍'}「${book.groupTitle || book.title || scopeId}」。`,
      el('br'),
      '文件保持为一份连续全文，不按页切分，不自动匹配 OCR，也不会进入论文统计。'),
    el('label', { style: 'display:grid; gap:6px; font-size:12px; color:var(--c-text-soft);' },
      '完整文本文件（TXT / Markdown / DOCX，最大 20 MB）', fileInput),
    el('label', { style: 'display:grid; gap:6px; font-size:12px; color:var(--c-text-soft);' },
      '显示名称', titleInput),
  );
  const close = () => scrim.remove();
  const importBtn = el('button', {
    class: 'btn primary',
    ...(isDataSourceReadOnly() ? { disabled: '', title: '当前数据源只读，不能导入参考文本' } : {}),
    onclick: async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        toast('请先选择完整文本文件', 'warn');
        return;
      }
      importBtn.disabled = true;
      importBtn.textContent = '正在导入…';
      try {
        const form = new FormData();
        form.append('file', file);
        if (titleInput.value.trim()) form.append('title', titleInput.value.trim());
        const payload = await fetchReferenceJson(BRIDGE_TEXT_REFERENCES_URL(scopeId), { method: 'POST', body: form });
        referenceReaderState.loaded = false;
        referenceReaderState.selectedId = payload.item?.id || '';
        referenceReaderState.editing = false;
        referenceReaderState.editDraft = '';
        referenceReaderState.showOriginal = false;
        close();
        toast('整书参考文本已导入，仅用于校文对照', 'success');
        await ensureReferenceIndex(book);
      } catch (error) {
        toast(error.message || '参考文本导入失败', 'error');
        importBtn.disabled = false;
        importBtn.textContent = '导入';
      }
    },
  }, isDataSourceReadOnly() ? '当前数据源只读' : '导入');
  const modal = el('div', { class: 'modal', style: 'max-width:620px;' },
    el('div', { class: 'modal-head' },
      el('h3', null, '导入整书参考文本'),
      el('button', { class: 'modal-close', onclick: close }, '×')),
    body,
    el('div', { class: 'modal-foot' },
      el('button', { class: 'btn', onclick: close }, '取消'),
      importBtn));
  const scrim = el('div', { class: 'scrim', onclick: event => { if (event.target === scrim) close(); } }, modal);
  $('#overlay-root').appendChild(scrim);
}

function appendReferenceHighlightedText(container, text, query, currentIndex) {
  if (!query) {
    container.appendChild(document.createTextNode(text));
    return [];
  }
  const matches = referenceSearchMatchOffsets(text, query);
  let offset = 0;
  matches.forEach((index, matchIndex) => {
    if (index > offset) container.appendChild(document.createTextNode(text.slice(offset, index)));
    const mark = el('mark', {
      class: matchIndex === currentIndex ? 'current' : '',
      'data-reference-match': String(matchIndex),
    }, text.slice(index, index + query.length));
    container.appendChild(mark);
    offset = index + query.length;
  });
  container.appendChild(document.createTextNode(text.slice(offset)));
  return matches;
}

function referenceSearchMatchOffsets(text, query, limit = 500) {
  const source = String(text || '');
  const needle = String(query || '').trim();
  if (!needle) return [];
  const haystack = source.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const matches = [];
  let cursor = 0;
  while (matches.length < limit) {
    const index = haystack.indexOf(normalizedNeedle, cursor);
    if (index < 0) break;
    matches.push(index);
    cursor = index + Math.max(normalizedNeedle.length, 1);
  }
  return matches;
}

function referenceSearchComparableMap(text) {
  const source = String(text || '');
  const ignored = /[\s\p{P}\p{Z}\u200b\u2060]/u;
  const characters = [];
  const offsets = [];
  let offset = 0;
  for (const character of source) {
    const normalized = character.normalize('NFKC').toLocaleLowerCase();
    for (const normalizedCharacter of normalized) {
      if (ignored.test(normalizedCharacter)) continue;
      characters.push(normalizedCharacter);
      offsets.push(offset);
    }
    offset += character.length;
  }
  return { text: characters.join(''), offsets, source };
}

function referenceSearchCommonSuffixLength(left, right) {
  const max = Math.min(left.length, right.length);
  let length = 0;
  while (length < max && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
}

function referenceSearchCommonPrefixLength(left, right) {
  const max = Math.min(left.length, right.length);
  let length = 0;
  while (length < max && left[length] === right[length]) length += 1;
  return length;
}

function approximateReferenceRangeTargetPage(book, content, start, end) {
  const pages = getBookPages(book);
  if (!pages.length) return null;
  const weights = pages.map(page => Math.max(1, referenceSearchComparableMap(getEffectivePageText(page)).text.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const midpoint = (Math.max(0, Number(start) || 0) + Math.max(0, Number(end) || 0)) / 2;
  const progress = Math.max(0, Math.min(1, midpoint / Math.max(1, String(content || '').length)));
  const targetWeight = progress * totalWeight;
  let accumulated = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const next = accumulated + weights[index];
    if (targetWeight <= next || index === pages.length - 1) {
      const pageText = getEffectivePageText(pages[index]);
      const pageProgress = Math.max(0, Math.min(1, (targetWeight - accumulated) / weights[index]));
      const ocrStart = Math.round(pageProgress * pageText.length);
      return {
        pageNum: Number(pages[index].pageNum),
        ocrStart,
        ocrEnd: ocrStart,
        source: 'progress',
      };
    }
    accumulated = next;
  }
  return null;
}

function findReferenceSearchTargetPage(
  book,
  referenceId,
  content,
  matchStart,
  matchEnd,
  { allowSingleCharacter = false, allowApproximatePosition = false } = {},
) {
  if (!book) return null;
  const start = Math.max(0, Number(matchStart) || 0);
  const end = Math.max(start, Number(matchEnd) || start);
  const referenceMap = referenceSearchComparableMap(String(content || '').slice(start, end));
  const needle = referenceMap.text;
  if (!needle) return null;
  const before = referenceSearchComparableMap(String(content || '').slice(Math.max(0, start - 32), start)).text;
  const after = referenceSearchComparableMap(String(content || '').slice(end, end + 32)).text;
  const candidates = [];
  getBookPages(book).forEach(page => {
    const pageMap = referenceSearchComparableMap(getEffectivePageText(page));
    let matchIndex = pageMap.text.indexOf(needle);
    while (matchIndex >= 0) {
      const score = referenceSearchCommonSuffixLength(
        before,
        pageMap.text.slice(Math.max(0, matchIndex - before.length), matchIndex),
      ) + referenceSearchCommonPrefixLength(
        after,
        pageMap.text.slice(matchIndex + needle.length, matchIndex + needle.length + after.length),
      );
      const endIndex = matchIndex + needle.length - 1;
      candidates.push({
        pageNum: Number(page.pageNum),
        ocrStart: pageMap.offsets[matchIndex] || 0,
        ocrEnd: (pageMap.offsets[endIndex] || 0) + (pageMap.source[pageMap.offsets[endIndex]]?.length || 0),
        score,
        source: 'text',
      });
      matchIndex = pageMap.text.indexOf(needle, matchIndex + Math.max(needle.length, 1));
    }
  });
  const mappedRanges = getReferenceComparisonRanges(book, referenceId)
    .filter(range =>
      Number.isFinite(Number(range?.pageNum))
      && Number(range?.referenceStart) <= start
      && Number(range?.referenceEnd) >= end);
  if (mappedRanges.length === 1) {
    const mappedRange = mappedRanges[0];
    const onMappedPage = candidates
      .filter(candidate => Number(candidate.pageNum) === Number(mappedRange.pageNum))
      .sort((left, right) => right.score - left.score || left.ocrStart - right.ocrStart);
    if (onMappedPage.length) return { ...onMappedPage[0], source: 'comparison-text' };

    const page = getBookPages(book).find(item => Number(item.pageNum) === Number(mappedRange.pageNum));
    const pageTextLength = getEffectivePageText(page).length;
    const referenceSpan = Math.max(1, Number(mappedRange.referenceEnd) - Number(mappedRange.referenceStart));
    const rangeProgress = Math.max(0, Math.min(1, (start - Number(mappedRange.referenceStart)) / referenceSpan));
    const rangeEndProgress = Math.max(rangeProgress, Math.min(1,
      (end - Number(mappedRange.referenceStart)) / referenceSpan));
    const mappedOcrStart = Number.isFinite(Number(mappedRange.ocrStart)) ? Number(mappedRange.ocrStart) : 0;
    const mappedOcrEnd = Number.isFinite(Number(mappedRange.ocrEnd))
      ? Number(mappedRange.ocrEnd)
      : pageTextLength;
    return {
      pageNum: Number(mappedRange.pageNum),
      ocrStart: Math.round(mappedOcrStart + (mappedOcrEnd - mappedOcrStart) * rangeProgress),
      ocrEnd: Math.round(mappedOcrStart + (mappedOcrEnd - mappedOcrStart) * rangeEndProgress),
      source: 'comparison-progress',
    };
  }
  if (needle.length < 2 && !allowSingleCharacter) return null;
  if (!candidates.length) {
    return allowApproximatePosition
      ? approximateReferenceRangeTargetPage(book, content, start, end)
      : null;
  }
  candidates.sort((left, right) => right.score - left.score || left.pageNum - right.pageNum);
  const best = candidates[0];
  const tied = candidates.filter(candidate => candidate.score === best.score);
  if (tied.length > 1 || (needle.length < 2 && best.score < 8)) {
    return allowApproximatePosition
      ? approximateReferenceRangeTargetPage(book, content, start, end)
      : null;
  }
  return best;
}

function focusReferenceSearchProofText(target) {
  if (!target || !Number.isFinite(Number(target.ocrStart))) return;
  requestAnimationFrame(() => {
    const editor = referenceReaderState.editor;
    if (!editor || !String(editor.value || '')) return;
    const start = Math.max(0, Math.min(Number(target.ocrStart), editor.value.length));
    const end = Math.max(start, Math.min(Number(target.ocrEnd) || start, editor.value.length));
    editor.focus?.({ preventScroll: true });
    editor.setSelectionRange?.(start, end);
  });
}

function syncReferenceRangeToProofPage(book, content, range, options = {}) {
  const start = Math.max(0, Number(range?.start) || 0);
  const end = Math.max(start, Number(range?.end) || start);
  if (end <= start) return false;
  const target = findReferenceSearchTargetPage(
    book,
    referenceReaderState.selectedId,
    content,
    start,
    end,
    options,
  );
  if (!target) return false;
  const targetPage = Number(target.pageNum);
  if (!Number.isFinite(targetPage)) return false;
  if (state.currentBookId !== book.id || Number(state.currentBookPage) !== targetPage) {
    openPageDetail(book.id, targetPage, 'text');
  }
  focusReferenceSearchProofText(target);
  return true;
}

function referenceProofNavigationRange(content, referenceId = referenceReaderState.selectedId) {
  const selected = referenceReaderState.selectedRange;
  if (
    selected?.referenceId === referenceId
    && Number(selected.end) > Number(selected.start)
  ) {
    return { range: selected, source: 'selection' };
  }
  const matches = referenceSearchMatchOffsets(content, referenceReaderState.search);
  if (matches.length && referenceReaderState.search) {
    const safeIndex = (Number(referenceReaderState.searchIndex) + matches.length) % matches.length;
    return {
      range: { start: matches[safeIndex], end: matches[safeIndex] + referenceReaderState.search.length },
      source: 'search',
    };
  }
  const result = referenceReaderState.comparisonResult;
  if (!referenceReaderState.comparisonStale
    && result?.matched
    && Number(result.referenceEnd) > Number(result.referenceStart)) {
    return {
      range: { start: result.referenceStart, end: result.referenceEnd },
      source: 'comparison',
    };
  }
  return null;
}

function openReferenceProofPage(book, content, referenceId = referenceReaderState.selectedId, intent = null) {
  const currentIntent = intent || referenceProofNavigationRange(content, referenceId);
  if (!currentIntent?.range) {
    toast('请先查找、选择存疑文字或完成本页对照，再查看原页', 'info');
    return false;
  }
  const moved = syncReferenceRangeToProofPage(book, content, currentIntent.range, {
    allowSingleCharacter: ['selection', 'uncertainty', 'search'].includes(currentIntent.source),
    allowApproximatePosition: ['selection', 'uncertainty', 'search'].includes(currentIntent.source),
  });
  if (!moved) {
    toast('未能唯一定位原页；请选中更具体的文字或存疑标记', 'info');
  }
  return moved;
}

function appendReferenceComparisonText(container, text, result, activeIndex = 0) {
  const differences = Array.isArray(result?.differences) ? result.differences : [];
  if (!Array.isArray(differences) || !differences.length) {
    container.appendChild(document.createTextNode(text));
    return;
  }
  const range = buildReferenceComparisonRangeSummary(text, result);
  if (range.end <= range.start) {
    container.appendChild(document.createTextNode(text));
    return;
  }
  container.appendChild(document.createTextNode(text.slice(0, range.start)));
  const rangeText = text.slice(range.start, range.end);
  const rangeDifferences = differences.map(difference => ({
    ...difference,
    referenceStart: Math.max(0, Number(difference.referenceStart) - range.start),
    referenceEnd: Math.max(0, Number(difference.referenceEnd) - range.start),
  }));
  const rangeNode = el('span', {
    class: 'reference-comparison-range',
    'data-reference-comparison-range': '',
    title: `本页对照范围：整理稿第 ${range.displayStart}–${range.displayEnd} 字；开头“${range.startSnippet}”；结尾“${range.endSnippet}”`,
  });
  buildDifferenceHighlightSegments(rangeText, rangeDifferences, activeIndex).forEach(segment => {
    if (segment.type === 'text') {
      rangeNode.appendChild(document.createTextNode(segment.text));
      return;
    }
    const mark = el('mark', {
      class: `reference-comparison-highlight${segment.text ? '' : ' is-empty'}${segment.active ? ' is-current' : ''}`,
      'data-comparison-highlight': '',
      'data-reference-comparison-index': String(segment.differenceIndex),
    }, segment.text);
    if (segment.active) mark.setAttribute('data-reference-comparison-current', '');
    rangeNode.appendChild(mark);
  });
  container.appendChild(rangeNode);
  container.appendChild(document.createTextNode(text.slice(range.end)));
}

let _referenceScrollTimer = null;

// 翻页等重渲染前的视图快照，作为恢复滚动位置的保险
function captureReferencePaneViewState() {
  const scroll = document.querySelector('.reference-document-scroll');
  return {
    scrollTop: scroll?.scrollTop || 0,
    selectedId: referenceReaderState.selectedId,
    search: referenceReaderState.search,
    searchIndex: referenceReaderState.searchIndex,
    showOriginal: referenceReaderState.showOriginal,
    editing: referenceReaderState.editing,
    editDraft: referenceReaderState.editDraft,
  };
}

// 重渲染后按需恢复滚动位置；scrollToSearch=true 时仅用户主动搜索/翻页结果才滚到高亮
function restoreReferencePaneViewState(snapshot, { scrollToSearch = false } = {}) {
  requestAnimationFrame(() => {
    const scroll = document.querySelector('.reference-document-scroll');
    if (!scroll) return;
    if (scrollToSearch && referenceReaderState.search) {
      const currentMark = scroll.querySelector('mark.current');
      currentMark?.scrollIntoView({ block: 'center' });
    } else {
      scroll.scrollTop = Math.max(0, Number(snapshot?.scrollTop) || 0);
    }
  });
}

function renderReferencePane(book, editor, {
  restoreScroll = true,
  scrollToSearch = false,
  viewSnapshot: suppliedViewSnapshot = null,
} = {}) {
  const pane = $('#reference-pane');
  const root = $('#reference-pane-content');
  if (!pane || !root || !book) return;
  referenceReaderState.editor = editor || referenceReaderState.editor;
  const scopeId = referenceScopeId(book);
  if (referenceReaderState.scopeId !== scopeId) resetReferenceReaderScope(scopeId);
  pane.classList.toggle('is-collapsed', isReferencePaneCollapsed());
  // 重渲染前捕获视图状态，用于后续恢复滚动位置（默认不自动滚到搜索结果）
  const viewSnapshot = suppliedViewSnapshot || (restoreScroll ? captureReferencePaneViewState() : null);
  root.innerHTML = '';

  const titleRow = el('div', { class: 'reference-pane-title-row' },
      el('div', null,
      el('div', { class: 'reference-pane-title' }, '整书整理稿'),
      el('div', { class: 'reference-pane-subtitle' },
        `基于导入参考文本 · ${book.groupId ? `合并书组 · ${book.groupTitle || book.title}` : (book.title || scopeId)}`)));
  const head = el('div', { class: 'reference-pane-head' }, titleRow);
  root.appendChild(head);

  if (referenceReaderState.loading && !referenceReaderState.loaded) {
    root.appendChild(el('div', { class: 'reference-pane-loading' }, '正在读取参考文本索引…'));
    return;
  }
  if (referenceReaderState.error) {
    root.appendChild(el('div', { class: 'reference-pane-error' },
      referenceReaderState.error,
      el('div', { style: 'margin-top:10px;' },
        el('button', {
          class: 'btn',
          onclick: () => {
            referenceReaderState.error = '';
            referenceReaderState.loaded = false;
            ensureReferenceIndex(book);
          },
        }, '重试'))));
    return;
  }
  if (!referenceReaderState.items.length) {
    root.appendChild(el('div', { class: 'reference-pane-empty' },
      el('div', { style: 'font-family:var(--f-serif); font-size:17px; color:#514331; margin-bottom:6px;' }, '尚未导入参考文本'),
      el('div', null, '导入连续文本后，可在此对照原图和 OCR 形成整理稿。'),
      el('button', {
        class: 'btn primary',
        style: 'margin-top:12px;',
        ...(isDataSourceReadOnly() ? { disabled: '', title: '当前数据源只读' } : {}),
        onclick: () => openReferenceImportDialog(book),
      }, isDataSourceReadOnly() ? '当前数据源只读' : '导入完整文本')));
    return;
  }

  const selectedId = referenceReaderState.selectedId || referenceReaderState.items[0].id;
  referenceReaderState.selectedId = selectedId;
  const select = el('select', {
    class: 'reference-pane-select',
    onchange: event => {
      referenceReaderState.pendingUncertaintyMarks.delete(referenceReaderState.selectedId);
      referenceReaderState.selectedId = event.target.value;
      referenceReaderState.search = '';
      referenceReaderState.searchIndex = 0;
      referenceReaderState.selectedRange = null;
      referenceReaderState.editing = false;
      referenceReaderState.editDraft = '';
      referenceReaderState.showOriginal = false;
      referenceReaderState.comparisonActive = false;
      referenceReaderState.comparisonLoading = false;
      referenceReaderState.comparisonError = '';
      referenceReaderState.comparisonResult = null;
      referenceReaderState.comparisonIndex = 0;
      referenceReaderState.comparisonStale = false;
      referenceReaderState.comparisonRequestId += 1;
      renderReferencePane(book, referenceReaderState.editor);
      ensureReferenceDocument(book, event.target.value);
    },
  }, ...referenceReaderState.items.map(item =>
    el('option', { value: item.id, ...(item.id === selectedId ? { selected: '' } : {}) },
      `${item.title}${item.has_edits ? ' · 已编辑' : ''} · ` +
      `${Number((item.has_edits ? item.edited_character_count : item.character_count) || 0).toLocaleString()}字`)));
  const documentRow = el('div', { class: 'reference-pane-document-row' }, select);
  head.appendChild(documentRow);

  const prefs = loadReferenceReaderPrefs(scopeId, selectedId);
  const fontSize = Math.max(16, Math.min(32, Number(prefs.fontSize) || 22));
  const documentPayload = referenceReaderState.documents.get(selectedId);
  const hasEdits = !!(documentPayload?.has_edits || documentPayload?.item?.has_edits);
  const exportButton = el('button', {
    class: 'btn',
    ...(hasEdits && !referenceReaderState.editing
      ? { onclick: () => exportReferenceEditedCopy(documentPayload, referenceReaderState.items.find(item => item.id === selectedId)) }
      : { disabled: '', title: referenceReaderState.editing ? '请先保存当前整理稿修改' : '保存整理稿修改后可导出' }),
  }, '导出整理稿');
  const moreMenu = el('div', { class: 'reference-pane-more-menu' },
    el('button', {
      class: 'btn',
      ...(isDataSourceReadOnly() ? { disabled: '', title: '当前数据源只读' } : {}),
      onclick: () => openReferenceImportDialog(book),
    }, '导入另一版本'),
    ...(hasEdits && !referenceReaderState.editing ? [el('button', {
      class: 'btn',
      onclick: () => {
        referenceReaderState.showOriginal = !referenceReaderState.showOriginal;
        referenceReaderState.searchIndex = 0;
        referenceReaderState.selectedRange = null;
        referenceReaderState.comparisonResult = null;
        referenceReaderState.comparisonError = '';
        referenceReaderState.comparisonStale = referenceReaderState.comparisonActive;
        referenceReaderState.comparisonIndex = 0;
        referenceReaderState.comparisonRequestId += 1;
        renderReferencePane(book, referenceReaderState.editor);
      },
    }, referenceReaderState.showOriginal ? '返回整理稿' : '查看原始导入')] : []),
    el('button', {
      class: 'btn',
      title: '减小参考文字',
      onclick: () => { saveReferenceReaderPrefs(scopeId, selectedId, { fontSize: Math.max(16, fontSize - 2) }); renderReferencePane(book, referenceReaderState.editor); },
    }, 'A−'),
    el('button', {
      class: 'btn',
      title: '恢复为与 OCR 编辑区接近的字号',
      onclick: () => { saveReferenceReaderPrefs(scopeId, selectedId, { fontSize: 22 }); renderReferencePane(book, referenceReaderState.editor); },
    }, `${fontSize}px`),
    el('button', {
      class: 'btn',
      title: '放大参考文字',
      onclick: () => { saveReferenceReaderPrefs(scopeId, selectedId, { fontSize: Math.min(32, fontSize + 2) }); renderReferencePane(book, referenceReaderState.editor); },
    }, 'A+'),
    el('button', {
      class: 'btn',
      onclick: () => {
        const scroll = root.querySelector('.reference-document-scroll');
        if (scroll) saveReferenceReaderPrefs(scopeId, selectedId, { scrollTop: scroll.scrollTop });
        toast('已记住当前参考文本位置', 'success');
      },
      }, '记住此处'));
  const tools = el('div', { class: 'reference-pane-tools' },
    exportButton,
    el('details', { class: 'reference-pane-more' },
      el('summary', { class: 'btn reference-pane-more-trigger', title: '更多整理稿操作' }, '更多'),
      moreMenu));
  documentRow.appendChild(tools);

  if (!documentPayload) {
    root.appendChild(el('div', { class: 'reference-pane-loading' }, '正在读取连续全文…'));
    ensureReferenceDocument(book, selectedId);
    return;
  }
  const content = currentReferenceWorkingContent(documentPayload);
  const uncertaintyMarks = referenceUncertainMarks(documentPayload);
  const activeUncertaintyMarks = () =>
    referenceReaderState.pendingUncertaintyMarks.get(selectedId) || uncertaintyMarks;
  const uncertaintyCount = el('span', {
    class: 'reference-uncertainty-count',
    title: '整理稿中的存疑旁注数量；不写入正文',
  }, String(uncertaintyMarks.length));
  const markUncertainButton = el('button', {
    class: 'btn',
    disabled: '',
    title: '先在整理稿中选择尚不能确定的字或词',
  }, '标记存疑');
  const clearUncertainButton = el('button', {
    class: 'btn',
    disabled: '',
    title: '先选中已有存疑标记',
  }, '取消存疑');
  const updateUncertaintyActions = () => {
    const selected = referenceReaderState.selectedRange;
    const sameReference = selected?.referenceId === selectedId;
    const hasSelection = sameReference && Number(selected.end) > Number(selected.start);
    const existing = sameReference
      ? referenceUncertainMarkAtRange(activeUncertaintyMarks(), selected)
      : null;
    const blocked = isDataSourceReadOnly()
      || referenceReaderState.showOriginal
      || referenceReaderState.savingUncertainty;
    markUncertainButton.disabled = blocked || !hasSelection || !!existing;
    clearUncertainButton.disabled = blocked || !existing;
    markUncertainButton.title = referenceReaderState.editing
      ? (hasSelection ? '标记时会保存当前整理稿' : '先在整理稿中选择尚不能确定的字或词')
      : (hasSelection ? '将所选字词标记为存疑旁注' : '先在整理稿中选择尚不能确定的字或词');
    clearUncertainButton.title = existing ? `取消“${existing.quote}”的存疑标记` : '先选中已有存疑标记';
    contextActions.classList.toggle('is-visible', !blocked && (hasSelection || !!existing));
  };
  markUncertainButton.addEventListener('mousedown', event => event.preventDefault());
  clearUncertainButton.addEventListener('mousedown', event => event.preventDefault());
  markUncertainButton.onclick = async () => {
    const range = referenceReaderState.selectedRange;
    const mark = referenceUncertainMarkForCurrentDraft(documentPayload, range);
    if (!mark) {
      toast('请先在整理稿中选择文字或词语', 'warn');
      return;
    }
    const marks = activeUncertaintyMarks();
    if (referenceUncertainMarkAtRange(marks, range)) {
      toast('所选文字已包含存疑标记', 'info');
      return;
    }
    const snapshot = captureReferencePaneViewState();
    if (referenceReaderState.editing) {
      referenceReaderState.pendingUncertaintyMarks.set(selectedId, [...marks, mark]
        .sort((left, right) => left.start - right.start || left.end - right.end));
      referenceReaderState.selectedRange = null;
      await saveReferenceEditedCopy(book, selectedId, snapshot);
      return;
    }
    const saved = await saveReferenceUncertainMarks(
      book,
      selectedId,
      [...marks, mark],
      snapshot,
    );
    if (saved) toast(`已标记存疑：“${mark.quote}”`, 'success');
  };
  clearUncertainButton.onclick = async () => {
    const marks = activeUncertaintyMarks();
    const existing = referenceUncertainMarkAtRange(
      marks,
      referenceReaderState.selectedRange,
    );
    if (!existing) {
      toast('请先选中已有存疑标记', 'warn');
      return;
    }
    const snapshot = captureReferencePaneViewState();
    if (referenceReaderState.editing) {
      referenceReaderState.pendingUncertaintyMarks.set(
        selectedId,
        marks.filter(mark => mark.id !== existing.id),
      );
      referenceReaderState.selectedRange = null;
      await saveReferenceEditedCopy(book, selectedId, snapshot);
      return;
    }
    const saved = await saveReferenceUncertainMarks(
      book,
      selectedId,
      marks.filter(mark => mark.id !== existing.id),
      snapshot,
    );
    if (saved) toast(`已取消存疑：“${existing.quote}”`, 'success');
  };
  const contextActions = el('div', { class: 'reference-pane-context-actions' },
    markUncertainButton,
    clearUncertainButton,
    uncertaintyCount);
  head.appendChild(contextActions);
  const searchInput = el('input', {
    type: 'search',
    value: referenceReaderState.search,
    placeholder: '在整书参考文本中查找',
  });
  const uncertaintyFindButton = activeUncertaintyMarks().length
    ? el('button', {
      class: 'btn reference-uncertainty-find',
      title: `定位下一处存疑（共 ${activeUncertaintyMarks().length} 处）`,
    }, `存疑 ${activeUncertaintyMarks().length}`)
    : null;
  const renderSearchResult = () => {
    const matches = referenceSearchMatchOffsets(content, referenceReaderState.search);
    renderReferencePane(book, referenceReaderState.editor, { scrollToSearch: true });
    if (matches.length) openReferenceProofPage(book, content, selectedId, {
      range: {
        start: matches[(Number(referenceReaderState.searchIndex) + matches.length) % matches.length],
        end: matches[(Number(referenceReaderState.searchIndex) + matches.length) % matches.length]
          + referenceReaderState.search.length,
      },
      source: 'search',
    });
  };
  const runSearch = () => {
    referenceReaderState.comparisonActive = false;
    referenceReaderState.comparisonLoading = false;
    referenceReaderState.comparisonError = '';
    referenceReaderState.comparisonResult = null;
    referenceReaderState.comparisonIndex = 0;
    referenceReaderState.comparisonStale = false;
    referenceReaderState.comparisonRequestId += 1;
    referenceReaderState.search = String(searchInput.value || '').trim();
    referenceReaderState.searchIndex = 0;
    renderSearchResult();
  };
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });
  const searchRow = el('div', { class: 'reference-pane-search' },
    searchInput,
    el('button', { class: 'btn', onclick: runSearch }, '查找'),
    ...(uncertaintyFindButton ? [uncertaintyFindButton] : []),
    el('button', {
      class: 'btn reference-view-source-page',
      title: '按右侧当前查找、存疑、选中文字或本页对照范围，打开对应原书正文页',
      onclick: () => openReferenceProofPage(book, content, selectedId),
    }, '查看原页'),
    el('button', {
      class: 'btn',
      title: '上一个',
      onclick: () => {
        const matches = referenceSearchMatchOffsets(content, referenceReaderState.search);
        if (!matches.length) return;
        referenceReaderState.searchIndex = (referenceReaderState.searchIndex - 1 + matches.length) % matches.length;
        renderSearchResult();
      },
    }, '↑'),
    el('button', {
      class: 'btn',
      title: '下一个',
      onclick: () => {
        const matches = referenceSearchMatchOffsets(content, referenceReaderState.search);
        if (!matches.length) return;
        referenceReaderState.searchIndex = (referenceReaderState.searchIndex + 1) % matches.length;
        renderSearchResult();
      },
    }, '↓'));
  root.appendChild(searchRow);
  if (!referenceReaderState.showOriginal) {
    root.appendChild(renderReferenceComparisonToolbar());
  }

  const documentNode = el('div', {
    class: `reference-document${referenceReaderState.editing ? ' is-dirty' : ''}`,
    style: `--reference-font-size:${fontSize}px;`,
    contenteditable: (!isDataSourceReadOnly() && !referenceReaderState.showOriginal && !referenceReaderState.search)
      ? 'plaintext-only'
      : 'false',
    spellcheck: 'false',
    role: 'textbox',
    'aria-label': '整书整理稿，可直接编辑',
  });
  const comparisonDifferences = Array.isArray(referenceReaderState.comparisonResult?.differences)
    ? referenceReaderState.comparisonResult.differences
    : [];
  const visibleComparisonDifferences = !referenceReaderState.search
    && !referenceReaderState.comparisonStale
    && referenceReaderState.comparisonResult?.matched
    ? comparisonDifferences
    : [];
  let matches = [];
  if (visibleComparisonDifferences.length) {
    appendReferenceComparisonText(
      documentNode,
      content,
      referenceReaderState.comparisonResult,
      referenceReaderState.comparisonIndex,
    );
  } else {
    matches = appendReferenceHighlightedText(
      documentNode,
      content,
      referenceReaderState.search,
      referenceReaderState.searchIndex,
    );
  }
  const selectedUncertainMark = referenceUncertainMarkAtRange(
    activeUncertaintyMarks(),
    referenceReaderState.selectedRange,
  );
  applyReferenceUncertainMarks(
    documentNode,
    activeUncertaintyMarks(),
    selectedUncertainMark?.id || '',
  );
  if (uncertaintyFindButton) {
    uncertaintyFindButton.onclick = () => {
      const marks = activeUncertaintyMarks();
      const nextIndex = nextReferenceUncertaintyIndex(
        marks.length,
        referenceReaderState.uncertaintyIndex,
      );
      if (nextIndex < 0) return;
      referenceReaderState.uncertaintyIndex = nextIndex;
      const mark = marks[nextIndex];
      setReferenceSelectedRange(selectedId, mark.start, mark.end);
      documentNode.querySelectorAll('.reference-uncertain-mark').forEach(node => {
        node.classList.toggle(
          'is-selected',
          node.getAttribute('data-reference-uncertain-id') === mark.id,
        );
      });
      const target = Array.from(documentNode.querySelectorAll('[data-reference-uncertain-id]'))
        .find(node => node.getAttribute('data-reference-uncertain-id') === mark.id);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const moved = openReferenceProofPage(book, content, selectedId, {
        range: mark,
        source: 'uncertainty',
      });
      if (moved) {
        const source = referenceReaderState.comparisonSource;
        setReferenceComparisonStartFromRange(source?.book, source?.page, selectedId, mark);
      }
      updateUncertaintyActions();
    };
  }
  searchRow.appendChild(el('span', { class: 'reference-pane-search-count' },
    referenceReaderState.search
      ? (matches.length ? `${Math.min(referenceReaderState.searchIndex + 1, matches.length)}/${matches.length}${matches.length >= 500 ? '+' : ''}` : '0')
      : ''));
  const scroll = el('div', { class: 'reference-document-scroll' }, documentNode);
  const editActions = el('div', {
    class: `reference-inline-edit-actions${referenceReaderState.editing ? ' is-visible' : ''}`,
  },
  el('span', null, '整理稿有未保存修改'),
  el('button', {
    class: 'btn primary',
    disabled: referenceReaderState.savingEdit ? '' : null,
    onclick: () => {
      const saveViewSnapshot = captureReferencePaneViewState();
      saveReferenceReaderPrefs(scopeId, selectedId, { scrollTop: saveViewSnapshot.scrollTop, fontSize });
      saveReferenceEditedCopy(book, selectedId, saveViewSnapshot);
    },
  }, referenceReaderState.savingEdit ? '正在保存…' : '保存修改'));
  documentNode.addEventListener('input', () => {
    const draft = normalizeReferenceEditText(documentNode.innerText);
    const original = normalizeReferenceEditText(documentPayload.content || '');
    referenceReaderState.editDraft = draft;
    referenceReaderState.editing = referenceEditHasChanges(original, draft);
    const reanchored = reanchorReferenceUncertainMarks(activeUncertaintyMarks(), draft);
    referenceReaderState.pendingUncertaintyMarks.set(selectedId, reanchored.marks);
    referenceReaderState.selectedRange = null;
    clearReferenceComparisonRanges(null, selectedId);
    // 整理稿变动不会改变左侧 OCR 的字位：保留上一次高亮作视觉参照，
    // 但右侧旧偏移不再渲染，并明确要求重新执行当前正文页对照。
    markReferenceComparisonStale('整理稿已修改，请保存或执行当前正文页对照', {
      preserveOcrHighlights: true,
    });
    documentNode.classList.toggle('is-dirty', referenceReaderState.editing);
    editActions.classList.toggle('is-visible', referenceReaderState.editing);
    updateUncertaintyActions();
  });
  scroll.addEventListener('scroll', () => {
    clearTimeout(_referenceScrollTimer);
    _referenceScrollTimer = setTimeout(() => {
      saveReferenceReaderPrefs(scopeId, selectedId, { scrollTop: scroll.scrollTop, fontSize });
    }, 250);
  }, { passive: true });
  const updateSelectedRange = () => {
    syncReferenceSelectedRange(documentNode, selectedId);
    updateUncertaintyActions();
  };
  // 使用 pointerup + 键盘选择，而不是只监听 mouseup。存疑文本会被 span 包裹，
  // 第二次从不同节点拖选时仍必须重新同步偏移量。
  documentNode.addEventListener('pointerup', () => requestAnimationFrame(updateSelectedRange));
  documentNode.addEventListener('keyup', event => {
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      requestAnimationFrame(updateSelectedRange);
    }
  });
  documentNode.addEventListener('click', event => {
    const markNode = event.target.closest?.('[data-reference-uncertain-id]');
    if (!markNode) return;
    const mark = activeUncertaintyMarks().find(item =>
      item.id === markNode.getAttribute('data-reference-uncertain-id'));
    if (!mark) return;
    referenceReaderState.selectedRange = {
      referenceId: selectedId,
      start: mark.start,
      end: mark.end,
    };
    documentNode.querySelectorAll('.reference-uncertain-mark').forEach(node => {
      node.classList.toggle(
        'is-selected',
        node.getAttribute('data-reference-uncertain-id') === mark.id,
      );
    });
    updateUncertaintyActions();
  });
  updateUncertaintyActions();
  root.appendChild(scroll);
  if (!isDataSourceReadOnly() && !referenceReaderState.showOriginal) {
    root.appendChild(editActions);
  }
  root.appendChild(el('div', { class: 'reference-pane-footnote' },
    `${referenceReaderState.showOriginal ? '正在查看原始导入' : (hasEdits ? '正在编辑整理稿' : '整理稿基于原始导入')} · ` +
    `${referenceReaderState.showOriginal
      ? '原始导入只读'
      : (referenceReaderState.search ? '清除查找内容后可直接编辑' : '点击正文可直接编辑')} · ` +
    '保存只更新整理稿副本 · 不覆盖原始导入或 OCR · 不进入插图论文统计'));
  requestAnimationFrame(() => {
    if (scrollToSearch && referenceReaderState.search) {
      const currentMark = documentNode.querySelector('mark.current');
      currentMark?.scrollIntoView({ block: 'center' });
    } else if (viewSnapshot) {
      // 翻页/字号调整等重渲染：恢复翻页前的滚动位置，不主动滚到搜索结果
      scroll.scrollTop = Math.max(0, Number(viewSnapshot.scrollTop) || 0);
    } else {
      scroll.scrollTop = Math.max(0, Number(prefs.scrollTop) || 0);
    }
  });
}

function updateReferenceInsertTarget(editor) {
  referenceReaderState.editor = editor;
}

function isReferencePaneMounted(scopeId) {
  if (referenceReaderState.scopeId !== scopeId) return false;
  const root = $('#reference-pane-content');
  if (!root) return false;
  // 已挂载且内容有效：存在滚动容器或明确的无内容提示
  return !!root.querySelector('.reference-document-scroll')
    || !!root.querySelector('.reference-pane-empty')
    || !!root.querySelector('.reference-pane-loading')
    || !!root.querySelector('.reference-pane-error');
}

function mountReferencePane(book, editor, page = null) {
  const scopeId = referenceScopeId(book);
  if (referenceReaderState.scopeId !== scopeId) resetReferenceReaderScope(scopeId);
  referenceReaderState.editor = editor;
  if (page) {
    updateReferenceComparisonSource(book, page, editor);
  }
  // 同书翻页：scopeId 未变且右侧栏已有效挂载时，只更新差异跳转所用的校文框目标，不重建 DOM
  if (isReferencePaneMounted(scopeId)) {
    updateReferenceInsertTarget(editor);
    return;
  }
  renderReferencePane(book, editor);
  ensureReferenceIndex(book);
}

function clampProofreadingGuideRect(rect) {
  const minWidth = 0.06;
  const minHeight = 0.04;
  let [x0, y0, x1, y1] = Array.isArray(rect) ? rect.map(Number) : [0.7, 0.22, 0.9, 0.36];
  x0 = Math.max(0, Math.min(1 - minWidth, x0 || 0));
  y0 = Math.max(0, Math.min(1 - minHeight, y0 || 0));
  x1 = Math.max(x0 + minWidth, Math.min(1, x1 || x0 + minWidth));
  y1 = Math.max(y0 + minHeight, Math.min(1, y1 || y0 + minHeight));
  return [x0, y0, x1, y1].map(value => Math.round(value * 1000000) / 1000000);
}

function renderProofreadingGuideOverlay(stage) {
  if (!proofreadingGuideState.rect) return;
  const rect = clampProofreadingGuideRect(proofreadingGuideState.rect);
  const editing = proofreadingGuideState.editing;
  const overlay = el('div', {
    class: 'proofreading-guide' + (editing ? ' is-editing' : ''),
    role: 'img',
    'aria-label': '校文阅读提示框',
    title: editing ? '拖动矩形移动提示；拖动右下角改变大小' : '校文阅读提示',
  });
  const place = nextRect => {
    const [x0, y0, x1, y1] = clampProofreadingGuideRect(nextRect);
    overlay.style.left = `${x0 * 100}%`;
    overlay.style.top = `${y0 * 100}%`;
    overlay.style.width = `${(x1 - x0) * 100}%`;
    overlay.style.height = `${(y1 - y0) * 100}%`;
    overlay.dataset.rect = JSON.stringify([x0, y0, x1, y1]);
  };
  place(rect);
  if (!editing) {
    overlay.onclick = () => {
      proofreadingGuideState.editing = true;
      refreshPageDetailWorkspace();
    };
    stage.appendChild(overlay);
    return;
  }

  const actions = el('div', { class: 'proofreading-guide-actions' },
    el('button', {
      type: 'button',
      class: 'proofreading-bookmark-done',
      title: '完成调整',
      onclick: event => {
        event.stopPropagation();
        proofreadingGuideState.editing = false;
        proofreadingGuideState.rect = JSON.parse(overlay.dataset.rect);
        refreshPageDetailWorkspace();
      },
    }, '完成'),
    el('button', {
      type: 'button',
      class: 'proofreading-bookmark-delete',
      title: '删除阅读提示框',
      onclick: event => {
        event.stopPropagation();
        proofreadingGuideState.rect = null;
        proofreadingGuideState.editing = false;
        refreshPageDetailWorkspace();
      },
    }, '删除'),
  );
  const resizeHandle = el('span', {
    class: 'proofreading-guide-resize',
    title: '拖动改变提示框大小',
    'aria-hidden': 'true',
  });
  overlay.appendChild(actions);
  overlay.appendChild(resizeHandle);

  const startDrag = (event, mode) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = JSON.parse(overlay.dataset.rect);
    const pointerId = event.pointerId;
    try { overlay.setPointerCapture(pointerId); } catch {}
    const onMove = moveEvent => {
      const dx = (moveEvent.clientX - startX) / bounds.width;
      const dy = (moveEvent.clientY - startY) / bounds.height;
      let next;
      if (mode === 'resize') {
        next = [startRect[0], startRect[1], startRect[2] + dx, startRect[3] + dy];
      } else {
        const width = startRect[2] - startRect[0];
        const height = startRect[3] - startRect[1];
        const x0 = Math.max(0, Math.min(1 - width, startRect[0] + dx));
        const y0 = Math.max(0, Math.min(1 - height, startRect[1] + dy));
        next = [x0, y0, x0 + width, y0 + height];
      }
      place(next);
    };
    const onUp = () => {
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onUp);
      try { overlay.releasePointerCapture(pointerId); } catch {}
      proofreadingGuideState.rect = JSON.parse(overlay.dataset.rect);
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
  };
  overlay.addEventListener('pointerdown', event => startDrag(event, 'move'));
  resizeHandle.addEventListener('pointerdown', event => startDrag(event, 'resize'));
  stage.appendChild(overlay);
}

function renderTextProofMode(book, page) {
  const proofEditorCollapsed = isProofEditorCollapsed();
  const wrap = el('div', { class: `ocr-proof-wrap${proofEditorCollapsed ? ' editor-collapsed' : ''}` });
  const ta = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } }) || page.textAsset || {};
  const originalText = String(ta.fullText || '');
  const proofRect = normalizeRect(page.contentRect) || normalizeRect(book.contentRectTemplate);
  const imgUrl = proofRect
    ? pageHiResUrl(book.id, pdfPageOf(page), proofRect, 1600)
    : pageHiResUrl(book.id, pdfPageOf(page));
  const imageTitle = proofRect ? `正文框 · 第 ${page.pageNum} 页` : `原书页 · 第 ${page.pageNum} 页`;

  let proofImageZoom = 100;
  const proofImage = el('img', {
    src: imgUrl,
    class: 'ocr-proof-image',
    alt: `第 ${page.pageNum} 页原书图像`,
    style: 'width:100%; max-width:none; max-height:none;',
  });
  const proofImageStage = el('div', { class: 'ocr-proof-image-stage' }, proofImage);
  const proofImageFrame = el(
    'div',
    { class: 'ocr-proof-image-frame' + (proofRect ? ' cropped' : '') },
    proofImageStage,
  );
  const zoomValue = el('button', {
    class: 'btn ocr-proof-zoom-value',
    title: '恢复为适合正文框宽度',
  }, '100%');
  const zoomOut = el('button', {
    class: 'btn ocr-proof-zoom-button',
    title: '缩小正文图像',
    'aria-label': '缩小正文图像',
  }, '−');
  const zoomIn = el('button', {
    class: 'btn ocr-proof-zoom-button',
    title: '放大正文图像',
    'aria-label': '放大正文图像',
  }, '+');
  const applyProofImageZoom = nextZoom => {
    const oldWidth = Math.max(1, proofImageFrame.scrollWidth);
    const oldHeight = Math.max(1, proofImageFrame.scrollHeight);
    const centerX = (proofImageFrame.scrollLeft + proofImageFrame.clientWidth / 2) / oldWidth;
    const centerY = (proofImageFrame.scrollTop + proofImageFrame.clientHeight / 2) / oldHeight;
    proofImageZoom = Math.max(50, Math.min(250, Math.round(Number(nextZoom) / 10) * 10));
    proofImageStage.style.width = `${proofImageZoom}%`;
    zoomValue.textContent = `${proofImageZoom}%`;
    zoomOut.disabled = proofImageZoom <= 50;
    zoomIn.disabled = proofImageZoom >= 250;
    requestAnimationFrame(() => {
      proofImageFrame.scrollLeft = Math.max(
        0,
        centerX * proofImageFrame.scrollWidth - proofImageFrame.clientWidth / 2,
      );
      proofImageFrame.scrollTop = Math.max(
        0,
        centerY * proofImageFrame.scrollHeight - proofImageFrame.clientHeight / 2,
      );
    });
  };
  zoomOut.onclick = () => applyProofImageZoom(proofImageZoom - 10);
  zoomIn.onclick = () => applyProofImageZoom(proofImageZoom + 10);
  zoomValue.onclick = () => applyProofImageZoom(100);
  const guideButton = el('button', {
    class: 'btn ocr-proof-guide-button' + (proofreadingGuideState.rect ? ' has-guide' : ''),
    title: proofreadingGuideState.rect
      ? '阅读提示框会随当前校文浏览保留；点击可调整或删除'
      : '在正文框图像上添加独立阅读提示框',
    onclick: () => {
      if (!proofreadingGuideState.rect) {
        proofreadingGuideState.rect = [0.7, 0.22, 0.9, 0.36];
      }
      proofreadingGuideState.editing = !proofreadingGuideState.editing;
      refreshPageDetailWorkspace();
    },
  }, proofreadingGuideState.rect ? '▧ 调整提示' : '▧ 添加提示');
  renderProofreadingGuideOverlay(proofImageStage);
  const imageCard = el('div', { class: 'ocr-proof-image-card' },
    el('div', { class: 'ocr-proof-card-head' },
      el('span', null, imageTitle),
      el('div', { class: 'ocr-proof-image-tools' },
        guideButton,
        el('div', {
          class: 'ocr-proof-zoom-controls',
          role: 'group',
          'aria-label': '正文图像缩放',
        }, zoomOut, zoomValue, zoomIn),
      ),
    ),
    proofImageFrame,
  );

  const editorCard = el('div', { class: `ocr-proof-editor-card${proofEditorCollapsed ? ' is-collapsed' : ''}` });
  editorCard.appendChild(el('div', { class: 'ocr-proof-card-head' },
    el('span', { class: 'ocr-proof-editor-title' }, '校正文'),
    el('div', { class: 'ocr-proof-editor-head-actions' },
      el('span', { class: 'ocr-proof-state' + (ta.verified ? ' reviewed' : '') }, ta.verified ? '已校' : '未校'),
      el('button', {
        class: 'btn ocr-proof-editor-collapse',
        title: proofEditorCollapsed ? '展开校正文栏' : '折叠校正文栏',
        'aria-label': proofEditorCollapsed ? '展开校正文栏' : '折叠校正文栏',
        onclick: () => {
          setProofEditorCollapsed(!proofEditorCollapsed);
          refreshPageDetailWorkspace(book.id, page.pageNum);
        },
      }, proofEditorCollapsed ? '展开' : '折叠'),
    ),
  ));
  const meta = ['OCR'];
  if (ta.ocrModel) meta.push(ta.ocrModel);
  if (ta.updatedAt) meta.push(fmtDate(ta.updatedAt));
  editorCard.appendChild(el('div', { class: 'ocr-proof-meta' }, meta.join(' · ')));

  const readingContext = buildScanReadingContext(book);
  const readingWarnings = Array.isArray(ta.scanWarnings) ? ta.scanWarnings : [];
  const hasReadingWarning = ta.scanInputVersion !== SCAN_INPUT_VERSION || readingWarnings.length > 0;
  const directionCard = el('details', {
    class: 'ocr-proof-direction' + (hasReadingWarning ? ' has-warning' : ''),
    ...(hasReadingWarning ? { open: '' } : {}),
  });
  directionCard.appendChild(el('summary', null,
    `阅读顺序：正文 ${ta.detectedTextDirection || readingContext.text_direction || '不明'} · 题签 ${ta.detectedTitleLabelDirection || readingContext.title_label_direction || '不明'} · 页面 ${readingContext.page_order}`,
    hasReadingWarning ? el('span', { class: 'ocr-proof-direction-warning' }, '⚠ 需核对') : null));
  const directionDetails = el('div', { class: 'ocr-proof-direction-details' });
  directionDetails.appendChild(el('div', null,
    `书级规则：正文 ${readingContext.text_direction} · 题签 ${readingContext.title_label_direction} · 书页 ${readingContext.page_order}`));
  if (ta.scanInputVersion === SCAN_INPUT_VERSION) {
    const inputLabel = ta.scanInput?.region === 'full_page' ? '原始整页（降级输入）' : '原图正文框';
    directionDetails.appendChild(el('div', null,
      `本页识别：正文 ${ta.detectedTextDirection || '不明'} · 题签 ${ta.detectedTitleLabelDirection || '不明'} · ${inputLabel} ${ta.scanInput?.longSide || SCAN_CONTENT_LONG_SIDE}px`));
  } else {
    directionDetails.appendChild(el('div', { style: 'color:#8a7a4a;' },
      '当前为旧扫描结果，尚未记录正文框输入版本及页面方向；重新 OCR 后补齐。'));
  }
  if (readingWarnings.length) {
    directionDetails.appendChild(el('div', { class: 'ocr-proof-direction-warning-text' },
      `⚠ ${readingWarnings.join('；')}。请人工核对文字顺序，系统不会自动改写书级规则。`));
  }
  directionCard.appendChild(directionDetails);
  editorCard.appendChild(directionCard);

  const editTa = el('textarea', {
    class: 'ocr-proof-textarea',
    placeholder: '在这里校正文页文字',
  });
  editTa.value = String(ta.correctedText || originalText || '');
  const comparisonLayer = el('div', {
    class: 'ocr-proof-comparison-layer',
    'aria-hidden': 'true',
  });
  const editStack = el('div', { class: 'ocr-proof-textarea-stack' },
    comparisonLayer,
    editTa,
  );
  editTa.addEventListener('scroll', () => {
    comparisonLayer.scrollTop = editTa.scrollTop;
    comparisonLayer.scrollLeft = editTa.scrollLeft;
  }, { passive: true });
  editTa.addEventListener('input', () => {
    if (referenceReaderState.comparisonSource?.editor === editTa) {
      markReferenceComparisonStale('校正文已修改，请执行当前正文页对照');
    }
  });

  const pendingOcrRun = _pageOcrCandidates[pageOcrCandidateKey(book, page)];
  const pendingOcrPanel = renderPageOcrCandidatePanel(book, page, pendingOcrRun);
  if (pendingOcrPanel) editorCard.appendChild(pendingOcrPanel);

  const conversionSourceKey = `${book.id}:${page.pageNum}:${originalText.length}:${fieldHash(originalText)}`;
  if (ocrTextConversionState.sourceKey !== conversionSourceKey) {
    Object.assign(ocrTextConversionState, {
      sourceKey: conversionSourceKey,
      direction: '',
      text: '',
      loading: false,
      error: '',
      showOriginal: false,
    });
  }
  const conversionTool = el('section', {
    class: 'ocr-conversion-tool',
    'aria-label': 'OCR 繁简辅助',
  });
  const renderConversionTool = () => {
    conversionTool.innerHTML = '';
    const hasOriginal = Boolean(originalText.trim());
    const currentDirection = ocrTextConversionState.direction === 's2t' || ocrTextConversionState.direction === 't2s'
      ? ocrTextConversionState.direction
      : '';
    const currentLabel = currentDirection === 's2t' ? '繁' : '简';
    const nextDirection = currentDirection === '' || currentDirection === 's2t' ? 't2s' : 's2t';
    const title = el('div', { class: 'ocr-conversion-title' },
      el('strong', null, '繁简'),
      el('button', {
        class: 'btn ocr-conversion-toggle',
        title: '点击在繁体与简体辅助文本之间切换；只转换原始 OCR，不自动保存',
        disabled: !hasOriginal || ocrTextConversionState.loading,
        onclick: () => runConversion(nextDirection),
      }, ocrTextConversionState.loading ? '…' : currentLabel)
    );
    const runConversion = async (direction) => {
      ocrTextConversionState.loading = true;
      ocrTextConversionState.error = '';
      ocrTextConversionState.direction = direction;
      renderConversionTool();
      try {
        const response = await fetch(BRIDGE_TEXT_CONVERT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: originalText, direction }),
        });
        let payload = {};
        try { payload = await response.json(); } catch {}
        if (!response.ok) throw new Error(payload.error || `繁简转换失败（HTTP ${response.status}）`);
        if (ocrTextConversionState.sourceKey !== conversionSourceKey) return;
        ocrTextConversionState.text = String(payload.text || '');
      } catch (error) {
        if (ocrTextConversionState.sourceKey === conversionSourceKey) {
          ocrTextConversionState.error = error.message || '繁简转换失败';
          ocrTextConversionState.text = '';
        }
      } finally {
        if (ocrTextConversionState.sourceKey === conversionSourceKey) {
          ocrTextConversionState.loading = false;
          renderConversionTool();
        }
      }
    };
    const buttonRow = el('div', { class: 'ocr-conversion-actions' });
    if (ocrTextConversionState.text) {
      buttonRow.appendChild(el('button', {
        class: 'btn',
        onclick: () => {
          ocrTextConversionState.showOriginal = !ocrTextConversionState.showOriginal;
          renderConversionTool();
        },
      }, ocrTextConversionState.showOriginal ? '隐藏原 OCR' : '显示原 OCR 对照'));
    }
    conversionTool.appendChild(title);
    conversionTool.appendChild(buttonRow);
    if (!hasOriginal) {
      conversionTool.appendChild(el('div', { class: 'ocr-conversion-note' }, '本页没有原始 OCR，无法生成繁简辅助。'));
      return;
    }
    if (ocrTextConversionState.error) {
      conversionTool.appendChild(el('div', { class: 'ocr-conversion-error' }, ocrTextConversionState.error));
      return;
    }
    if (!ocrTextConversionState.text) {
      conversionTool.appendChild(el('div', { class: 'ocr-conversion-note' },
        'OpenCC 离线转换仅用于阅读和校文参考；异体字与语义用字仍须对照原图。'));
      return;
    }
    if (ocrTextConversionState.showOriginal) {
      conversionTool.appendChild(el('div', { class: 'ocr-conversion-block' },
        el('b', null, '原始 OCR'),
        el('pre', null, originalText)
      ));
    }
    const convertedLabel = ocrTextConversionState.direction === 't2s' ? '简体辅助' : '繁体辅助';
    conversionTool.appendChild(el('div', { class: 'ocr-conversion-block converted' },
      el('div', { class: 'ocr-conversion-result-head' },
        el('b', null, `${convertedLabel} · OpenCC`),
        el('button', {
          class: 'btn',
          title: '只替换当前编辑框内容；必须再次点击保存或标记已校才会写入',
          onclick: () => {
            editTa.value = ocrTextConversionState.text;
            editTa.focus();
            toast('辅助文本已放入编辑框；请对照原图核验后再保存', 'info');
          },
        }, '采用到编辑框')
      ),
      el('pre', null, ocrTextConversionState.text)
    ));
    conversionTool.appendChild(el('div', { class: 'ocr-conversion-warning' },
      '辅助转换不等于古籍校勘，不覆盖原始 OCR，也不单独进入论文统计。'));
  };
  renderConversionTool();
  editorCard.appendChild(editStack);
  editorCard.appendChild(conversionTool);

  const saveProof = ({ markReviewed = false } = {}) => {
    const nextText = String(editTa.value || '');
    const original = String(ta.fullText || '');
    const changedFromOcr = nextText !== original;
    const now = new Date().toISOString();
    if (changedFromOcr && nextText.trim()) {
      ta.correctedText = nextText;
      ta.correctedAt = now;
    } else {
      ta.correctedText = '';
      ta.correctedAt = '';
    }
    ta.updatedAt = now;
    if (!markReviewed) {
      ta.verified = false;
      ta.reviewedAt = '';
    }
    if (nextText.trim()) {
      ta.textStatus = markReviewed ? 'reviewed' : 'extracted';
      if (!ta.textSource || ta.textSource === 'none' || ta.textSource === 'manual_corrected') {
        ta.textSource = original.trim() ? (ta.ocrModel ? 'ai_ocr' : 'pdf_text_layer') : 'manual';
      }
    } else {
      ta.textStatus = 'missing';
    }
    if (markReviewed) {
      ta.verified = true;
      ta.textStatus = 'reviewed';
      ta.reviewedAt = now;
    }
    syncPageAssetIntoQueuedImages(book, page);
    markBookDirty(book.id);
    persist(book.id);
    toast(markReviewed ? '已保存并标记为人工已校' : '文字修订已保存', 'success');
    refreshPageDetailWorkspace(book.id, page.pageNum);
  };

  const saveBtn = el('button', { class: 'btn primary', onclick: () => saveProof({ markReviewed: false }) }, '保存');
  const reviewBtn = el('button', { class: 'btn success', onclick: () => saveProof({ markReviewed: true }) }, '标记已校');
  editorCard.appendChild(el('div', { class: 'ocr-proof-actions' },
    saveBtn,
    reviewBtn,
    el('button', {
      class: 'btn',
      title: '选择多页重新 OCR；非空结果直接采用，旧 OCR 保留在历史中',
      onclick: () => openPageOcrModal(book, page.pageNum),
    }, '批量 OCR'),
    el('button', {
      class: 'btn',
      onclick: async (ev) => {
        if (!(await guardVisionTask('页面 OCR', { book_id: book.id, page_num: page.pageNum }))) return;
        const btn = ev?.currentTarget;
        if (btn) {
          btn.disabled = true;
          btn.textContent = '重新 OCR 中…';
        }
        try {
          const doc = await ensurePdfDoc(book);
          if (!doc && !hasStoredPageScanSource(book)) {
            throw new Error('该书既没有可读取的 PDF，也没有可读取的图片书原始页图');
          }
          const run = await requestPageImageOcr(book, page, doc);
          if (!run) return;
          if (!String(run.text || '').trim()) {
            _pageOcrCandidates[pageOcrCandidateKey(book, page)] = run;
            toast(`第 ${page.pageNum} 页新 OCR 为空，未覆盖旧底稿；请检查后重试`, 'warn');
          } else {
            const targetTa = getPageTextAsset({ pdfSource: { bookId: book.id, pageNum: page.pageNum } });
            applyOcrRunToTextAsset(targetTa, run, { resetManualProof: false, archiveExisting: true });
            syncPageAssetIntoQueuedImages(book, page);
            markBookDirty(book.id);
            persist(book.id);
            const keepNote = hasManualCorrectedText(targetTa) ? '；人工校正文未覆盖' : '';
            toast(`第 ${page.pageNum} 页已直接采用新 OCR 底稿（${run.textLength || 0} 字）${keepNote}`, 'success');
          }
          refreshPageDetailWorkspace(book.id, page.pageNum);
        } catch (e) {
          toast(e.message || '重新 OCR 失败', 'error');
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = '重新 OCR';
          }
        }
      }
    }, '重新 OCR 并采用'),
    el('button', {
      class: 'btn',
      title: '查看本页历次 OCR 底稿，可恢复为某一次',
      onclick: () => openOcrHistoryModal(book, page),
    }, `OCR 历史${Array.isArray(ta.ocrRuns) && ta.ocrRuns.length ? '（' + ta.ocrRuns.length + '）' : ''}`)
  ));

  const originalBox = el('details', { class: 'ocr-proof-original' });
  originalBox.appendChild(el('summary', null, '原始 OCR'));
  originalBox.appendChild(el('pre', null, originalText || '（无原始文字）'));
  originalBox.appendChild(el('button', {
    class: 'btn',
    style: 'margin:0 10px 10px; font-size:12px;',
    onclick: () => {
      editTa.value = originalText || '';
      toast('已恢复为原始 OCR 文本，点击“保存”后生效', 'info');
    }
  }, '恢复到编辑框'));
  editorCard.appendChild(originalBox);

  wrap.appendChild(editorCard);
  wrap.appendChild(imageCard);
  mountReferencePane(book, editTa, page);
  return wrap;
}

function applyLeftCollapsed() {
  const pane = document.querySelector('.pane-left');
  const btn  = $('#btn-left-collapse');
  if (!pane) return;
  pane.classList.toggle('left-collapsed', !!state.leftCollapsed);
  if (btn) btn.textContent = state.leftCollapsed ? '▯▏' : '▏▯';
}

function applyRightPaneWidth() {
  if (state.rightPaneWidth === null || state.rightPaneWidth === undefined || state.rightPaneWidth === '') {
    document.documentElement.style.removeProperty('--pane-right-width');
    return;
  }
  const width = Math.max(260, Math.min(560, Number(state.rightPaneWidth) || 320));
  state.rightPaneWidth = width;
  document.documentElement.style.setProperty('--pane-right-width', `${width}px`);
}

function updateMainRightResizerVisibility() {
  const handle = $('#main-right-resizer');
  const pane = document.querySelector('.pane-right');
  const referencePane = $('#reference-pane');
  const referenceVisible = referencePane && referencePane.style.display !== 'none';
  const targetPane = referenceVisible ? referencePane : pane;
  if (!handle || !targetPane) return;
  const hidden = targetPane.style.display === 'none'
    || (referenceVisible ? isReferencePaneCollapsed() : state.rightCollapsed);
  handle.classList.toggle('hidden', hidden);
  handle.title = referenceVisible ? '拖动调整参考文本栏宽度' : '拖动调整右侧栏宽度';
}

function clampReferencePaneWidth(value) {
  return Math.max(260, Math.min(960, Math.round(Number(value) || 320)));
}

function applyRightCollapsed() {
  const pane = document.querySelector('.pane-right');
  const btn  = $('#btn-right-collapse');
  if (!pane) return;
  const referencePane = $('#reference-pane');
  const referenceVisible = referencePane && referencePane.style.display !== 'none';
  if (referenceVisible) {
    const collapsed = isReferencePaneCollapsed();
    referencePane.classList.toggle('is-collapsed', collapsed);
    if (btn) {
      btn.textContent = collapsed ? '▏▯' : '▯▏';
      btn.title = collapsed ? '展开参考文本栏' : '折叠参考文本栏';
    }
    updateMainRightResizerVisibility();
    return;
  }
  applyRightPaneWidth();
  pane.classList.toggle('right-collapsed', !!state.rightCollapsed);
  if (btn) btn.textContent = state.rightCollapsed ? '▏▯' : '▯▏';
  if (btn) btn.title = state.rightCollapsed ? '展开右侧栏' : '折叠右侧栏';
  updateMainRightResizerVisibility();
}

function enterIllustCropEditing(pageNum, imageId = null) {
  if (!_illustCropUiRestore) {
    _illustCropUiRestore = {
      leftCollapsed: !!state.leftCollapsed,
      rightCollapsed: !!state.rightCollapsed,
      pageIllustViewFull: !!state.pageIllustViewFull,
    };
  }
  state.illustCropEditing = true;
  state.illustCropEditingPage = pageNum;
  state.illustCropEditingImageId = imageId || null;
  state.pageIllustViewFull = true;
  state.rightCollapsed = true;
}

function exitIllustCropEditing() {
  state.illustCropEditing = false;
  state.illustCropEditingPage = null;
  state.illustCropEditingImageId = null;
  if (_illustCropUiRestore) {
    state.leftCollapsed = state.mainView === 'gallery' || state.mainView === 'page-detail'
      ? false
      : _illustCropUiRestore.leftCollapsed;
    state.rightCollapsed = _illustCropUiRestore.rightCollapsed;
    state.pageIllustViewFull = _illustCropUiRestore.pageIllustViewFull;
    _illustCropUiRestore = null;
  }
}

function updateShellLayout() {
  const shell = document.querySelector('.shell');
  if (!shell) return;
  const scroll = $('#main-scroll');
  const isBookWorkspace = state.mainView === 'gallery' || state.mainView === 'page-detail';
  const isHomeWorkspace = state.mainView === 'home';
  shell.classList.toggle('book-workspace', isBookWorkspace);
  shell.classList.toggle('home-workspace', isHomeWorkspace);
  if (scroll) scroll.classList.toggle('home-scroll', isHomeWorkspace);
  // 右栏（标注信息/审核表单）只在标注相关视图出现；图片列表在首页和书籍工作区均可使用。
  const RIGHT_PANEL_VIEWS = ['gallery', 'page-detail', 'review-queue', 'annotate'];
  const showRight = RIGHT_PANEL_VIEWS.includes(state.mainView);
  const showReference = state.mainView === 'page-detail' && state.pageDetailMode === 'text';
  shell.classList.toggle('reference-workspace', showReference);
  const hideLeft  = state.mainView === 'archive-manager' || state.mainView === 'run-history' || state.mainView === 'showcase' || state.mainView === 'asset-desk';
  const paneLeft  = document.querySelector('.pane-left');
  const paneRight = document.querySelector('.pane-right');
  const paneReference = $('#reference-pane');
  if (paneLeft)  paneLeft.style.display  = hideLeft ? 'none' : '';
  if (paneRight) paneRight.style.display = showRight && !showReference ? '' : 'none';
  if (paneReference) {
    paneReference.style.display = showReference ? 'flex' : 'none';
    paneReference.classList.toggle('is-collapsed', isReferencePaneCollapsed());
    if (!showReference) paneReference.style.removeProperty('--reference-pane-ratio');
  }
  const bookTabBtn = document.querySelector('.left-tab[data-ltab="books"]');
  const imageTabBtn = document.querySelector('.left-tab[data-ltab="images"]');
  if (bookTabBtn) bookTabBtn.style.display = '';
  if (imageTabBtn) imageTabBtn.style.display = '';
  // 首页：主内容区去掉 max-width 居中约束，让渐变铺满全宽
  const mainHeader = $('#main-header');
  if (mainHeader) {
    mainHeader.style.maxWidth = isHomeWorkspace ? 'none' : '';
    mainHeader.style.display = isHomeWorkspace ? 'none' : '';
  }
  applyLeftCollapsed();
  applyRightCollapsed();
  updateMainRightResizerVisibility();
}

function initShellResizeHandles() {
  const handle = $('#main-right-resizer');
  const pane = document.querySelector('.pane-right');
  const referenceExpand = $('#reference-pane-expand');
  if (referenceExpand && referenceExpand.dataset.bound !== '1') {
    referenceExpand.dataset.bound = '1';
    referenceExpand.addEventListener('click', () => setReferencePaneCollapsed(false));
  }
  if (!handle || !pane || handle.dataset.bound === '1') return;
  handle.dataset.bound = '1';
  handle.addEventListener('pointerdown', (e) => {
    const referencePane = $('#reference-pane');
    const referenceVisible = referencePane && referencePane.style.display !== 'none';
    const targetPane = referenceVisible ? referencePane : pane;
    const targetCollapsed = referenceVisible ? isReferencePaneCollapsed() : state.rightCollapsed;
    if (targetCollapsed || targetPane.style.display === 'none') return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = targetPane.getBoundingClientRect().width || Number(state.rightPaneWidth) || 320;
    const shellWidth = document.querySelector('.shell')?.getBoundingClientRect().width || window.innerWidth || 1;
    handle.classList.add('dragging');
    document.body.classList.add('is-resizing-pane');
    try { handle.setPointerCapture(e.pointerId); } catch {}
    const onMove = (ev) => {
      const next = clampReferencePaneWidth(startWidth - (ev.clientX - startX));
      if (referenceVisible) {
        // 参考栏只记录当前布局比例，不写入数据或 localStorage；窗口变化时仍能自适应。
        targetPane.style.setProperty('--reference-pane-ratio', String(next / shellWidth));
      } else {
        state.rightPaneWidth = next;
        applyRightPaneWidth();
      }
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('is-resizing-pane');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!referenceVisible) persist();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });
}

function renderAll() {
  updateShellLayout();
  initShellResizeHandles();
  activateLeftTab(state.leftTab || 'images');
  renderLeftList();
  renderBooksList();
  let mainRenderError = null;
  try {
    renderMain();
  } catch (e) {
    mainRenderError = e;
    console.error('renderMain failed', e);
  }
  const mainScroll = $('#main-scroll');
  if (mainScroll && mainScroll.children.length === 0) {
    const fallbackBook = getCurrentBook() || state.books?.[0];
    if (fallbackBook) {
      state.mainView = 'gallery';
      state.currentBookId = fallbackBook.id;
      state.galleryScope = state.galleryScope === 'illustrations' ? 'illustrations' : 'pages';
      try {
        renderMain();
      } catch (e) {
        mainRenderError = e;
        console.error('renderMain fallback failed', e);
        mainScroll.innerHTML = '';
        mainScroll.appendChild(el('div', { class: 'placeholder-state', style: 'height:240px; background:#fff; border-radius:10px; box-shadow:var(--shadow-card)' },
          el('div', { class: 'sub' }, `页面渲染失败：${mainRenderError?.message || '未知错误'}`)));
      }
    }
  }
  renderRightTab();
  renderNavStat();   // 顶栏「标注数据/审核队列」按钮显隐随视图切换刷新（首页隐藏，进工作区显示）
}


const _btnSelectAllTodo = $('#btn-select-all-todo');
if (_btnSelectAllTodo) _btnSelectAllTodo.addEventListener('click', () => {
  state.annotateSelection = getBatchScopeTodoImages().map(img => img.id);
  persist();
  renderLeftList();
});
const _btnClearImageSelection = $('#btn-clear-image-selection');
if (_btnClearImageSelection) _btnClearImageSelection.addEventListener('click', () => {
  state.annotateSelection = [];
  persist();
  renderLeftList();
});
const _btnRunSelected = $('#btn-run-selected');
if (_btnRunSelected) _btnRunSelected.addEventListener('click', async () => {
  const targetIds = getBatchScopeTodoImages(state.annotateSelection).map(img => img.id);
  if (targetIds.length === 0) {
    toast('请先勾选待标注项', 'warn');
    return;
  }
  await runBatch(targetIds);
});
const _btnRunAllTodo = $('#btn-run-all-todo');
if (_btnRunAllTodo) _btnRunAllTodo.addEventListener('click', async () => {
  await runBatch(getBatchScopeTodoImages().map(img => img.id));
});

function renderSourceTab() {
  const root = $('#tab-source');
  root.innerHTML = '';
  if (state.mainView === 'page-detail') {
    const book = getCurrentBook();
    const page = book ? getBookPageRecord(book, state.currentBookPage) : null;
    if (!book || !page) {
      root.appendChild(el('div', { class: 'placeholder-state', style: 'height:200px' },
        el('div', { class: 'sub' }, '当前页面不存在')));
      return;
    }

    root.appendChild(renderTextAssetPanel(book, page));
    return;
  }

  const img = getCurrent();
  if (!img) {
    // 无选中图片时，优先展示左侧面板点击的书籍/分组预览
    if (state.previewGroupId) { renderGroupPreviewTab(state.previewGroupId); return; }
    if (state.previewBookId)  { renderBookPreviewTab(); return; }
    root.appendChild(el('div', { class: 'placeholder-state', style: 'height:200px' },
      el('div', { class: 'sub' }, '尚未选择图片')));
    return;
  }

  const book = img.pdfSource?.bookId ? getBook(img.pdfSource.bookId) : null;

  // 来源字段
  root.appendChild(el('h4', null, '来源'));
  root.appendChild(el('div', { class: 'field' },
    el('label', null, '来源书籍'),
    el('div', { style: 'font-size:13px; color:#555' }, img.source || '—'),
  ));
  root.appendChild(el('div', { class: 'field' },
    el('label', null, '页码'),
    el('div', { style: 'font-size:13px; color:#555' }, img.page || '—'),
  ));
  if (img.pdfSource?.dynasty) {
    root.appendChild(el('div', { class: 'field' },
      el('label', null, '朝代'),
      el('div', { style: 'font-size:13px; color:#555' }, img.pdfSource.dynasty),
    ));
  }

  // 书籍简况（折叠）
  if (book) {
    root.appendChild(renderBookProfilePanel(book, { collapsible: true, open: false }));
  }
}

async function renderThumbnail(doc, pageNum, maxDim) {
  const page = await doc.getPage(pageNum);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = maxDim / Math.max(vp0.width, vp0.height);
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  return cv.toDataURL('image/jpeg', 0.85);
}

async function renderPageRectDataUrl(doc, pageNum, rect, targetWidth, quality = 0.88) {
  const cv = document.createElement('canvas');
  await renderPageCrop(doc, pageNum, rect, cv, targetWidth);
  return cv.toDataURL('image/jpeg', quality);
}

async function renderPageCrop(doc, pageNum, cropRect, canvas, targetWidth) {
  const page = await doc.getPage(pageNum);
  const vp0 = page.getViewport({ scale: 1 });
  const [fx0, fy0, fx1, fy1] = cropRect;
  const cropW = (fx1 - fx0) * vp0.width, cropH = (fy1 - fy0) * vp0.height;
  const scale = targetWidth / cropW;
  const vp = page.getViewport({ scale });
  canvas.width = Math.round(cropW * scale); canvas.height = Math.round(cropH * scale);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(-fx0 * vp0.width * scale, -fy0 * vp0.height * scale);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  ctx.restore();
}

function detectContentRectFromCanvas(cv) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  const mx = Math.max(1, Math.floor(W * 0.05));
  const my = Math.max(1, Math.floor(H * 0.05));
  const x0 = mx, x1 = Math.max(mx + 1, W - mx);
  const y0 = my, y1 = Math.max(my + 1, H - my);
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const gray = (data[i] + data[i+1] + data[i+2]) / 3;
      if (gray < 235) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!(maxX > minX && maxY > minY)) return null;
  const pad = 0.012;
  return normalizeRect([
    Math.max(0, minX / W - pad),
    Math.max(0, minY / H - pad),
    Math.min(1, maxX / W + pad),
    Math.min(1, maxY / H + pad),
  ]);
}

function buildRectThumbPairFromCanvas(cv, rect, smallLong = 220, largeLong = 420) {
  const r = normalizeRect(rect);
  if (!r) return { thumb: '', thumbHi: '' };
  const sx = r[0] * cv.width;
  const sy = r[1] * cv.height;
  const sw = (r[2] - r[0]) * cv.width;
  const sh = (r[3] - r[1]) * cv.height;
  if (!(sw > 1 && sh > 1)) return { thumb: '', thumbHi: '' };

  const make = (maxLong, quality) => {
    const scale = maxLong / Math.max(sw, sh);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    out.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', quality);
  };
  return {
    thumb: make(smallLong, 0.82),
    thumbHi: make(largeLong, 0.9),
  };
}

async function analyzePage(doc, pageNum, threshold) {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1.5 });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const W = cv.width, H = cv.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  const mx = Math.max(1, Math.floor(W * 0.05));
  const my = Math.max(1, Math.floor(H * 0.05));
  const x0 = mx, x1 = Math.max(mx + 1, W - mx);
  const y0 = my, y1 = Math.max(my + 1, H - my);

  let midtone = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const gray = (data[i] + data[i+1] + data[i+2]) / 3;
      total++;
      if (gray >= 60 && gray <= 190) midtone++;
    }
  }
  const imgDensity = total > 0 ? midtone / total * 100 : 0;
  const isIllust = imgDensity >= threshold;
  const contentRect = detectContentRectFromCanvas(cv);
  let cropRect = null;
  if (isIllust && contentRect) {
    cropRect = contentRect;
  }
  const sc180 = 180 / Math.max(W, H), sc400 = 400 / Math.max(W, H);
  const cv180 = document.createElement('canvas');
  cv180.width = Math.round(W*sc180); cv180.height = Math.round(H*sc180);
  cv180.getContext('2d').drawImage(cv, 0, 0, cv180.width, cv180.height);
  const thumb = cv180.toDataURL('image/jpeg', 0.82);
  const cv400 = document.createElement('canvas');
  cv400.width = Math.round(W*sc400); cv400.height = Math.round(H*sc400);
  cv400.getContext('2d').drawImage(cv, 0, 0, cv400.width, cv400.height);
  const thumbHi = cv400.toDataURL('image/jpeg', 0.88);
  const contentThumbs = contentRect ? buildRectThumbPairFromCanvas(cv, contentRect, 220, 460) : { thumb: '', thumbHi: '' };
  const cropThumbs = cropRect ? buildRectThumbPairFromCanvas(cv, cropRect, 220, 460) : { thumb: '', thumbHi: '' };
  return {
    isIllust,
    imgDensity,
    contentRect,
    cropRect,
    thumb,
    thumbHi,
    contentThumb: contentThumbs.thumb,
    contentThumbHi: contentThumbs.thumbHi,
    cropThumb: cropThumbs.thumb,
    cropThumbHi: cropThumbs.thumbHi,
  };
}

async function importFromPDF(ctx, render) {
  if (ctx.stage === 'scanning') return;
  if (typeof pdfjsLib === 'undefined') {
    ctx.stage = 'error';
    ctx.errorMsg = 'pdf.js 未加载，请先运行 download_pdfjs.py 下载本地文件，或检查网络连接。';
    render(); return;
  }
  const file = ctx.file;
  if (!file) {
    ctx.stage = 'error'; ctx.errorMsg = '请先选择 PDF 文件。'; render(); return;
  }
  ctx.stage = 'scanning'; ctx.progress = 0; render();
  let pdfDoc;
  try {
    const ab = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
  } catch(e) {
    ctx.stage = 'error'; ctx.errorMsg = 'PDF 加载失败：' + e.message; render(); return;
  }
  const totalPages = pdfDoc.numPages;
  ctx.totalPages = totalPages;
  const allPages = [];
  for (let p = 1; p <= totalPages; p++) {
    ctx.progress = { current: p, total: totalPages, step: 'scan-pages' }; render();
    let thumb = '', thumbHi = '';
    try {
      thumb = await renderThumbnail(pdfDoc, p, 220);
      thumbHi = await renderThumbnail(pdfDoc, p, 420);
    } catch(_) { continue; }
    let fullText = '', textSource = 'none';
    try {
      const pg = await pdfDoc.getPage(p);
      const tc = await pg.getTextContent();
      fullText = tc.items.map(it => it.str).join('');
      if (fullText.trim()) textSource = 'pdf_text_layer';
    } catch(_) {}
    const textAsset = {
      fullText, associatedText: '', textSource,
      textStatus: fullText.trim() ? 'extracted' : 'missing',
      verified: false, ocrModel: '',
      extractedAt: fullText.trim() ? new Date().toISOString() : '', updatedAt: '',
    };
    allPages.push({
       pageNum: p, thumb, thumbHi,
      cropRect: null, imgDensity: 0,
      text: fullText, textAsset,
    });
  }
  const bookId = 'book_' + Date.now();
  const book = {
    id: bookId,
    idShort: ctx.title.replace(/[^一-龥a-zA-Z0-9]/g,'').slice(0,8) || bookId.slice(-6),
    title: ctx.title, dynasty: ctx.dynasty || '', version: ctx.version || '',
    edition: ctx.edition || '', repository: ctx.repository || '', printYear: ctx.printYear || '',
    textLayout: ctx.textLayout || 'auto',
    totalPages, pages: allPages, illustrationPages: [], queueAdded: [],
    importedAt: Date.now(), sensitivity: ctx.sensitivity,
    copyright: { source: '用户上传', redistribute: '研究使用' },
    ...(ctx.groupId ? { groupId: ctx.groupId, groupTitle: ctx.groupTitle || ctx.title } : {}),
  };
  state.books.push(book);
  try {
    const upResult = await uploadPdfToBridge(file, bookId);
    if (upResult?.url) book.pdfStorage = { url: upResult.url, filename: upResult.filename };
    await maybeSyncBookMeta(book);
  } catch(e) { console.warn('PDF upload to bridge failed:', e.message); }
  pdfDocs[bookId] = pdfDoc;
  ctx.book = book; ctx.stage = 'done';
  markBookDirty(bookId); markGlobalDirty();
  persist(); refreshBookCount(); renderBooksList();
  render();
  if (!ctx.silent) toast('已导入《' + book.title + '》，可先浏览全页，再按需识别插图', 'success');
}

// 中文数字 → 整数（支持 一..九十九、十、二十一 等）
function _cnToNum(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const d = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  let m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0);
  m = s.match(/^([零〇一二三四五六七八九])$/);
  if (m) return d[m[1]];
  return null;
}

// 从文件名解析「书名 base + 卷次 num + 标记 marker」，用于多文件自动识别章节
function parseVolumeFromName(name) {
  let s = String(name || '').replace(/\.pdf$/i, '').trim();
  const fin = (base, num, marker) => ({ base: String(base || '').replace(/[\s_\-+·、]+$/, '').replace(/[（(]\s*$/, '').trim(), num, marker });
  // 上/中/下（册/卷/篇 可选）
  let m = s.match(/^(.*?)[\s_\-+·、（(]*([上中下])\s*(册|卷|篇)?\s*[）)]?\s*$/);
  if (m && m[2]) return fin(m[1], { 上: 1, 中: 2, 下: 3 }[m[2]], m[2] + (m[3] || ''));
  // 卷/册/章/回/集/篇 + 数字（前后皆可，含「第X卷」「卷X」「X卷」）
  m = s.match(/^(.*?)[\s_\-+·、（(]*(?:第)?\s*(卷|册|章|回|集|篇)?\s*([0-9０-９一二三四五六七八九十〇零]+)\s*(卷|册|章|回|集|篇)?\s*[）)]?\s*$/);
  if (m && (m[2] || m[4])) {
    const digits = m[3].replace(/[０-９]/g, c => '0123456789'['０１２３４５６７８９'.indexOf(c)]);
    return fin(m[1], _cnToNum(digits), (m[2] || '') + m[3] + (m[4] || ''));
  }
  // 结尾纯数字（如 xxx_1 / xxx 2 / xxx-3）
  m = s.match(/^(.*?)[\s_\-+·、]+([0-9０-９]+)\s*$/);
  if (m) { const digits = m[2].replace(/[０-９]/g, c => '0123456789'['０１２３４５６７８９'.indexOf(c)]); return fin(m[1], parseInt(digits, 10), m[2]); }
  return fin(s, null, '');
}

// 按文件名自动识别章节：找共同书名 → 排序 → 填卷次；多数文件同名则设为「合并为一本书」
function autoDetectChapters(ctx, render) {
  if (!ctx.files || ctx.files.length < 2) { toast('请先选 2 个以上文件', 'warn'); return; }
  const parsed = ctx.files.map((f, i) => ({ i, ...parseVolumeFromName(f.name) }));
  const freq = {};
  parsed.forEach(p => { if (p.base) freq[p.base] = (freq[p.base] || 0) + 1; });
  let commonBase = '', best = 0;
  for (const b in freq) if (freq[b] > best) { best = freq[b]; commonBase = b; }
  const sharedEnough = best >= Math.max(2, Math.ceil(ctx.files.length * 0.6));
  const order = parsed.slice().sort((a, b) => {
    if (a.num != null && b.num != null) return a.num - b.num;
    if (a.num != null) return -1;
    if (b.num != null) return 1;
    return a.i - b.i;
  });
  ctx.files = order.map(p => ctx.files[p.i]);
  ctx.fileMeta = order.map(p => ({ title: ctx.fileMeta[p.i].title, version: p.marker || ctx.fileMeta[p.i].version || '' }));
  if (sharedEnough) { ctx.mode = 'group'; if (!(ctx.groupTitle || '').trim()) ctx.groupTitle = commonBase; }
  render();
  toast(sharedEnough
    ? `已识别为《${commonBase}》${ctx.files.length} 卷/章并按序号排序`
    : '已按文件名中的序号排序（未发现共同书名，建议核对）', 'success');
}

// 多文件 / 分章节导入：循环复用 importFromPDF。mode='group' 时多文件归入同一分组（一本书多卷/章）
async function importBooks(ctx, render) {
  const files = ctx.files && ctx.files.length ? ctx.files : (ctx.file ? [ctx.file] : []);
  if (!files.length) { ctx.stage = 'error'; ctx.errorMsg = '请先选择 PDF 文件'; render(); return; }
  const grouped = ctx.mode === 'group' && files.length > 1;
  const groupId = grouped ? ('group_' + Date.now()) : null;
  const groupTitle = grouped ? ((ctx.groupTitle || '').trim() || (ctx.fileMeta?.[0]?.title) || files[0].name.replace(/\.pdf$/i, '')) : '';
  ctx.importedBooks = [];
  ctx.fileCount = files.length;
  ctx.stage = 'multi';
  for (let i = 0; i < files.length; i++) {
    ctx.fileIndex = i + 1;
    const meta = (ctx.fileMeta && ctx.fileMeta[i]) || {};
    ctx.file = files[i];
    ctx.title = (meta.title || files[i].name.replace(/\.pdf$/i, '')).trim() || files[i].name;
    ctx.version = meta.version || (grouped ? `卷${i + 1}` : (ctx.version || ''));
    ctx.groupId = groupId;
    ctx.groupTitle = groupTitle;
    ctx.silent = true;
    ctx.stage = 'multi';
    await importFromPDF(ctx, render);
    if (ctx.stage === 'error') { ctx.errorMsg = `第 ${i + 1} 个文件「${ctx.title}」导入失败：${ctx.errorMsg || ''}`; render(); return; }
    if (ctx.book) ctx.importedBooks.push(ctx.book);
  }
  ctx.grouped = grouped ? { title: groupTitle, count: files.length } : null;
  ctx.stage = 'done';
  render();
  toast(grouped ? `已导入《${groupTitle}》共 ${files.length} 卷/章` : `已导入 ${files.length} 本书`, 'success');
}

// ── 自动重连：bridge.py 晚于页面启动时，后台轮询直到连通并加载数据 ──
let _autoReconnectTimer = null;
let _autoReconnectAttempts = 0;
const AUTO_RECONNECT_MAX = 20; // 最多 20 次 × 3s ≈ 1 分钟

function scheduleAutoReconnect() {
  if (_autoReconnectTimer) return;
  _autoReconnectAttempts = 0;
  _autoReconnectTimer = setTimeout(_tryAutoReconnect, 2000);
}

async function _tryAutoReconnect() {
  _autoReconnectTimer = null;
  _bridgeAvailable = null; // 重置缓存，让 checkBridge 重新探测
  const ok = await initFromBridge();
  if (ok) {
    migrateIllustrationPages();
    refreshBookCount();
    if (typeof renderNavStat === 'function') renderNavStat();
    renderAll();
    if (typeof renderBooksList === 'function') renderBooksList();
    toast('已连接本地服务，数据已加载', 'success');
    return;
  }
  _autoReconnectAttempts++;
  if (_autoReconnectAttempts < AUTO_RECONNECT_MAX) {
    _autoReconnectTimer = setTimeout(_tryAutoReconnect, 3000);
  }
}

async function bootstrapApp() {
  let bridgeOk = false;
  try { bridgeOk = await initFromBridge(); } catch(e) {
    const main = document.getElementById('main') || document.body;
    main.innerHTML = '<div style="padding:40px;color:#c00;font-size:14px;">'
      + '<b>启动失败</b>：' + e.message + '<br>'
      + '请确认 bridge.py 已启动（python bridge.py）并刷新。</div>';
    return;
  }
  migrateIllustrationPages(); // 旧数据一次性迁移
  refreshBookCount();
  if (typeof renderNavStat === 'function') renderNavStat();
  renderAll();
  if (typeof renderBooksList === 'function') renderBooksList();
  // 尝试从 bridge config.json 恢复密钥（localStorage 为空时）
  restoreConfigFromBridge();
  // 若 bridge 未就绪（先开页面后启动 bridge.py），后台自动重连
  if (!bridgeOk) scheduleAutoReconnect();
}

// ── 迁移：将旧版 state.illustrations 条目同步回 illustrationPages（confirmed=true）──
function migrateIllustrationPages() {
  let changed = false;
  for (const book of state.books) {
    if (!Array.isArray(book.illustrationPages)) book.illustrationPages = [];
    const illustNums = new Map(book.illustrationPages.map(p => [Number(p.pageNum), p]));
    // state.illustrations 里有的页 → 确保在 illustrationPages 且 confirmed=true
    for (const img of state.illustrations) {
      if (img?.pdfSource?.bookId !== book.id) continue;
      const pn = Number(img.pdfSource?.pageNum);
      if (!Number.isFinite(pn)) continue;
      if (illustNums.has(pn)) {
        const entry = illustNums.get(pn);
        if (!entry.confirmed) { entry.confirmed = true; changed = true; }
      } else {
        const page = getBookPageRecord(book, pn);
        if (page) {
          page.confirmed = true;
          book.illustrationPages.push(page);
          book.illustrationPages.sort((a, b) => a.pageNum - b.pageNum);
          illustNums.set(pn, page);
          changed = true;
        }
      }
    }
  }
  if (changed) { state.books.forEach(b => markBookDirty(b.id)); persist(); }
}

/* ============================================================
   D-Data Center V1｜标注数据中心前端模块
   - 只读标注数据用于总览/健康；不写 aiDraft/annotation/reviewDiff/status/reviewEvents。
   - 不暴露数据根目录/datasetId/环境变量给用户。
   - 恢复需二次确认；只读库禁用写操作。
   ============================================================ */
const DC_BASE = `${BRIDGE_BASE}/api/data-center`;
let _dcState = {
  open: false,
  tab: 'overview',
  summary: null,
  health: null,
  backups: [],
  loading: false,
  restoreTarget: null,  // {backup_id, manifest}
};

function openDataCenter() {
  const ov = document.getElementById('data-center-overlay');
  if (!ov) return;
  ov.hidden = false;
  _dcState.open = true;
  _dcState.tab = 'overview';
  _dcRefreshAll();
  _dcWireTabs();
  _dcWireClose();
}

function closeDataCenter() {
  const ov = document.getElementById('data-center-overlay');
  if (!ov) return;
  ov.hidden = true;
  _dcState.open = false;
  _dcState.restoreTarget = null;
}

function _dcWireClose() {
  document.getElementById('dc-close-btn')?.addEventListener('click', closeDataCenter);
  document.getElementById('data-center-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'data-center-overlay') closeDataCenter();
  });
}

function _dcWireTabs() {
  document.querySelectorAll('.dc-tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.dc-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      _dcState.tab = t.dataset.dctab;
      _dcRenderPanel();
    };
  });
}

async function _dcRefreshAll() {
  _dcState.loading = true;
  _dcRenderPanel();
  try {
    const [sumR, bkR] = await Promise.all([
      fetch(`${DC_BASE}/summary`).then(r => r.json()),
      fetch(`${DC_BASE}/backups`).then(r => r.json()),
    ]);
    _dcState.summary = sumR.ok ? sumR.summary : null;
    _dcState.backups = bkR.ok ? bkR.backups : [];
    // 更新顶部数据集徽章
    const badge = document.getElementById('dc-dataset-badge');
    if (badge && _dcState.summary) {
      const ds = _dcState.summary.dataset || {};
      const ro = ds.read_only ? '只读' : '可写';
      badge.textContent = `${ds.label || '—'} · ${ro}`;
    }
  } catch (e) {
    _dcState.summary = null;
    _dcState.backups = [];
  } finally {
    _dcState.loading = false;
    _dcRenderPanel();
  }
}

function _dcRenderPanel() {
  const panel = document.getElementById('dc-panel');
  if (!panel) return;
  if (_dcState.loading) { panel.innerHTML = '<div class="dc-loading">加载中…</div>'; return; }
  if (_dcState.tab === 'overview') return _dcRenderOverview(panel);
  if (_dcState.tab === 'health') return _dcRenderHealth(panel);
  if (_dcState.tab === 'backups') return _dcRenderBackups(panel);
  if (_dcState.tab === 'exports') return _dcRenderExports(panel);
}

function _dcRenderOverview(panel) {
  const s = _dcState.summary;
  if (!s) { panel.innerHTML = '<div class="dc-empty">无法读取总览，请确认桥接服务运行中。</div>'; return; }
  const ds = s.dataset || {};
  const roBadge = ds.read_only
    ? '<span class="dc-readonly-badge yes">只读</span>'
    : '<span class="dc-readonly-badge no">可写</span>';
  const c = s.counts || {};
  const sc = s.status_counts || {};
  const v = s.versions || {};
  panel.innerHTML = `
    <div class="dc-section">
      <h3>当前工作数据</h3>
      <div><strong>${escapeHtml(s.project || '—')}</strong>${roBadge}</div>
      <div style="font-size:12px;color:var(--c-muted,#6b7280);margin-top:4px">
        ${escapeHtml(ds.label || '—')} · ${escapeHtml(ds.mode || '—')}
      </div>
      <div style="font-size:12px;color:var(--c-muted,#6b7280);margin-top:2px">
        全局元数据：${s.global_present ? '已生成' : '未生成（不影响按书读取）'}
      </div>
    </div>
    <div class="dc-section">
      <h3>数据统计</h3>
      <div class="dc-grid">
        <div class="dc-stat"><div class="label">书籍</div><div class="value">${c.books ?? 0}</div></div>
        <div class="dc-stat"><div class="label">页面</div><div class="value">${c.pages ?? 0}</div></div>
        <div class="dc-stat"><div class="label">插图</div><div class="value">${c.illustrations ?? 0}</div></div>
        <div class="dc-stat"><div class="label">已确认</div><div class="value">${sc.confirmed ?? 0}</div></div>
        <div class="dc-stat"><div class="label">待审核</div><div class="value">${sc.pending_review ?? 0}</div></div>
        <div class="dc-stat"><div class="label">待标注</div><div class="value">${sc.pending_annotate ?? 0}</div></div>
        <div class="dc-stat"><div class="label">异常</div><div class="value">${sc.abnormal ?? 0}</div></div>
        <div class="dc-stat"><div class="label">备份</div><div class="value">${c.backups ?? 0}</div></div>
      </div>
    </div>
    <div class="dc-section">
      <h3>时间</h3>
      <div class="dc-grid">
        <div class="dc-stat"><div class="label">最近写入</div><div style="font-size:13px;margin-top:4px">${escapeHtml(fmtDate(s.last_write_at) || '—')}</div></div>
        <div class="dc-stat"><div class="label">最近备份</div><div style="font-size:13px;margin-top:4px">${escapeHtml(fmtDate(s.last_backup_at) || '—')}</div></div>
      </div>
    </div>
    <div class="dc-section">
      <h3>规范版本</h3>
      <div style="font-size:12px;color:var(--c-muted,#6b7280)">
        评价规范：<code>${escapeHtml(v.schemaVersion || '—')}</code>　·　
        分类：<code>${escapeHtml(v.classificationVersion || '—')}</code>　·　
        Prompt：<code>${escapeHtml(v.promptVersion || '—')}</code>
      </div>
    </div>
    <div class="dc-section">
      <h3>素材扫描</h3>
      <div class="dc-grid">
        <div class="dc-stat"><div class="label">已扫描素材包</div><div class="value">${c.asset_sources ?? 0}</div></div>
        <div class="dc-stat"><div class="label">Stale</div><div class="value">${c.asset_stale ?? 0}</div></div>
      </div>
    </div>
    <div class="dc-section">
      <h3>常用操作</h3>
      <div class="dc-actions">
        <button class="dc-btn primary" id="dc-act-backup">立即备份</button>
        <button class="dc-btn" id="dc-act-health">运行健康检查</button>
        <button class="dc-btn" id="dc-act-paper">导出论文冻结包</button>
        <button class="dc-btn" id="dc-act-showcase">导出展示数据</button>
      </div>
      <div id="dc-action-result" style="font-size:12px;margin-top:6px"></div>
    </div>
  `;
  document.getElementById('dc-act-backup')?.addEventListener('click', _dcDoBackup);
  document.getElementById('dc-act-health')?.addEventListener('click', () => {
    document.querySelectorAll('.dc-tab').forEach(x => x.classList.remove('active'));
    document.querySelector('.dc-tab[data-dctab="health"]').classList.add('active');
    _dcState.tab = 'health';
    _dcRenderPanel();
  });
  document.getElementById('dc-act-paper')?.addEventListener('click', () => _dcDoExport('paper-freeze'));
  document.getElementById('dc-act-showcase')?.addEventListener('click', () => _dcDoExport('showcase'));
}

async function _dcRenderHealth(panel) {
  panel.innerHTML = '<div class="dc-loading">运行健康检查中…（只读，不写任何数据）</div>';
  try {
    const r = await fetch(`${DC_BASE}/health`);
    const j = await r.json();
    _dcState.health = j.ok ? j.health : null;
  } catch (e) {
    _dcState.health = null;
  }
  const h = _dcState.health;
  if (!h) { panel.innerHTML = '<div class="dc-empty">健康检查失败，请确认桥接服务运行中。</div>'; return; }
  const sevLabel = { error: '错误', warning: '警告', info: '提示' };
  let html = `
    <div class="dc-section">
      <h3>健康检查结果</h3>
      <div style="font-size:12px;color:var(--c-muted,#6b7280);margin-bottom:8px">
        ${h.ok ? '✅ 未发现错误级问题' : '❌ 发现错误级问题'}　·　
        错误 ${h.error_count}　警告 ${h.warning_count}　提示 ${h.info_count}
      </div>
      <div style="font-size:11px;color:var(--c-muted,#6b7280);margin-bottom:8px">
        已检查项：${h.checked_items?.map(i => escapeHtml(i)).join('、') || '—'}
      </div>
  `;
  if (!h.problems || h.problems.length === 0) {
    html += '<div class="dc-empty">未发现问题</div>';
  } else {
    h.problems.forEach(p => {
      html += `<div class="dc-problem ${p.severity}">
        <span class="sev">${sevLabel[p.severity] || p.severity}</span>
        <strong>${escapeHtml(p.item || '—')}</strong>
        ${p.book_id ? ` · 书 ${escapeHtml(p.book_id)}` : ''}
        ${p.illustration_id ? ` · 插图 ${escapeHtml(p.illustration_id)}` : ''}
        <div style="margin-top:2px">${escapeHtml(p.cause || '—')}</div>
        <div style="color:var(--c-muted,#6b7280);margin-top:2px">影响：${escapeHtml(p.impact || '—')}</div>
        <div style="color:var(--c-muted,#6b7280)">建议：${escapeHtml(p.suggestion || '—')}</div>
      </div>`;
    });
  }
  html += '</div>';
  panel.innerHTML = html;
}

function _dcRenderBackups(panel) {
  const isReadOnly = _dcState.summary?.dataset?.read_only;
  const list = _dcState.backups || [];
  let html = '<div class="dc-section"><h3>备份与恢复</h3>';
  html += '<div class="dc-actions"><button class="dc-btn primary" id="dc-bk-create">立即备份</button></div>';
  html += '<div id="dc-bk-result" style="font-size:12px;margin:6px 0"></div>';
  if (list.length === 0) {
    html += '<div class="dc-empty">暂无备份</div>';
  } else {
    html += '<table class="dc-table"><thead><tr><th>备份</th><th>原因</th><th>时间</th><th>书数</th><th>记录数</th><th>大小</th><th>操作</th></tr></thead><tbody>';
    list.forEach(b => {
      const sm = b.summary || {};
      const sizeKb = sm.total_size ? Math.round(sm.total_size / 1024) : 0;
      const reasonLabel = { manual: '手动', automatic: '自动', before_restore: '恢复前' }[b.reason] || b.reason;
      html += `<tr>
        <td title="${escapeHtml(b.backup_id)}">${escapeHtml(b.backup_id.slice(0, 24))}…</td>
        <td>${escapeHtml(reasonLabel)}</td>
        <td>${escapeHtml(fmtDate(b.created_at) || '—')}</td>
        <td>${sm.book_count ?? 0}</td>
        <td>${sm.record_count ?? 0}</td>
        <td>${sizeKb} KB</td>
        <td>
          <a class="dc-btn" href="${DC_BASE}/backups/${encodeURIComponent(b.backup_id)}/download" target="_blank">下载</a>
          <button class="dc-btn" data-dc-restore="${escapeHtml(b.backup_id)}" ${isReadOnly ? 'disabled title="只读库禁用恢复"' : ''}>恢复</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
  }
  html += '</div>';
  panel.innerHTML = html;
  document.getElementById('dc-bk-create')?.addEventListener('click', _dcDoBackup);
  panel.querySelectorAll('[data-dc-restore]').forEach(btn => {
    btn.addEventListener('click', () => _dcStartRestore(btn.getAttribute('data-dc-restore')));
  });
}

function _dcStartRestore(backupId) {
  const bid = String(backupId || '').trim();
  if (!bid) return;
  const b = (_dcState.backups || []).find(x => x.backup_id === bid);
  if (!b) { toast('未找到该备份', 'error'); return; }
  _dcState.restoreTarget = { backup_id: bid, manifest: b.manifest || {} };
  _dcShowRestoreConfirm();
}

function _dcShowRestoreConfirm() {
  const t = _dcState.restoreTarget;
  if (!t) return;
  const panel = document.getElementById('dc-panel');
  if (!panel) return;
  const sm = (t.manifest?.summary) || {};
  const ds = (t.manifest?.dataset) || {};
  panel.innerHTML = `
    <div class="dc-section">
      <h3>恢复备份</h3>
      <div class="dc-warning-box">
        <strong>⚠ 恢复警告</strong><br>
        恢复会将备份中的标注工作数据写回当前工作数据。系统会先自动备份当前状态。<br>
        PDF、素材包和源代码不会被恢复或删除。
      </div>
      <div style="margin:10px 0;font-size:12px">
        <strong>备份概要</strong><br>
        备份 ID：${escapeHtml(t.backup_id)}<br>
        创建时间：${escapeHtml(fmtDate(t.manifest?.created_at) || '—')}<br>
        书数：${sm.book_count ?? 0}　·　记录数：${sm.record_count ?? 0}　·　文件数：${sm.file_count ?? 0}<br>
        源数据集：${escapeHtml(ds.id || '—')}（${escapeHtml(ds.label || '—')}）
      </div>
      <div style="margin:10px 0">
        <label style="font-size:12px">请输入「恢复」以二次确认：</label><br>
        <input type="text" id="dc-restore-input" placeholder="恢复" style="padding:5px 8px;margin-top:4px;width:200px;border:1px solid var(--c-border,#d1d5db);border-radius:4px">
      </div>
      <div class="dc-actions">
        <button class="dc-btn danger" id="dc-restore-confirm">确认恢复</button>
        <button class="dc-btn" id="dc-restore-cancel">取消</button>
      </div>
      <div id="dc-restore-result" style="font-size:12px;margin-top:8px"></div>
    </div>
  `;
  document.getElementById('dc-restore-cancel')?.addEventListener('click', () => {
    _dcState.restoreTarget = null;
    _dcRenderPanel();
  });
  document.getElementById('dc-restore-confirm')?.addEventListener('click', _dcDoRestore);
}

async function _dcDoRestore() {
  const t = _dcState.restoreTarget;
  if (!t) return;
  const input = document.getElementById('dc-restore-input')?.value?.trim();
  const resultEl = document.getElementById('dc-restore-result');
  if (input !== '恢复') {
    if (resultEl) resultEl.textContent = '请输入「恢复」二字以确认';
    return;
  }
  if (resultEl) resultEl.textContent = '恢复中…';
  try {
    const r = await fetch(`${DC_BASE}/backups/${encodeURIComponent(t.backup_id)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_text: '恢复' }),
    });
    const j = await r.json();
    if (j.ok) {
      if (resultEl) resultEl.innerHTML = `✅ 恢复完成：已替换 ${j.restored?.count ?? 0} 个文件。<br>恢复前备份：${escapeHtml(j.before_restore_backup?.backup_id || '—')}<br>${escapeHtml(j.notice || '')}`;
      toast('恢复完成', 'success');
      _dcState.restoreTarget = null;
      // 刷新总览
      setTimeout(() => _dcRefreshAll(), 1000);
    } else {
      if (resultEl) resultEl.textContent = `❌ ${j.error || '恢复失败'}（${j.code || ''}）`;
    }
  } catch (e) {
    if (resultEl) resultEl.textContent = '❌ 恢复请求失败：' + (e.message || e);
  }
}

function _dcRenderExports(panel) {
  panel.innerHTML = `
    <div class="dc-section">
      <h3>导出</h3>
      <div style="margin-bottom:12px;font-size:12px;color:var(--c-muted,#6b7280)">
        三种导出口：完整备份（灾备）、论文冻结包（论文复算）、展示数据（accepted-only）。
      </div>
      <div class="dc-actions">
        <button class="dc-btn primary" id="dc-ex-paper">论文数据冻结包</button>
        <button class="dc-btn" id="dc-ex-showcase">展示数据导出</button>
        <button class="dc-btn" id="dc-ex-backup">完整工作数据备份</button>
      </div>
      <div id="dc-ex-result" style="font-size:12px;margin-top:8px"></div>
      <div style="margin-top:16px;font-size:11px;color:var(--c-muted,#6b7280)">
        <strong>差别说明：</strong><br>
        · 完整备份：用于灾备，含全部白名单标注工作数据，与手动备份等价。<br>
        · 论文冻结包：已确认记录 + 版本上下文 + 审核归因 + 有效审核时间 + 统计 + 数据字典；标记「仅供论文复算，不代表公开发布许可」。<br>
        · 展示数据：accepted-only，不含未确认记录、模型原始响应、超长 _rawText 或密钥。
      </div>
    </div>
  `;
  document.getElementById('dc-ex-paper')?.addEventListener('click', () => _dcDoExport('paper-freeze'));
  document.getElementById('dc-ex-showcase')?.addEventListener('click', () => _dcDoExport('showcase'));
  document.getElementById('dc-ex-backup')?.addEventListener('click', _dcDoBackup);
}

async function _dcDoBackup() {
  try {
    const r = await fetch(`${DC_BASE}/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    });
    const j = await r.json();
    if (j.ok) {
      toast(`已创建备份：${j.backup?.backup_id}`, 'success');
      await _dcRefreshAll();
    } else {
      toast(`备份失败：${j.error || '未知错误'}（${j.code || ''}）`, 'error');
    }
  } catch (e) {
    toast('备份请求失败：' + (e.message || e), 'error');
  }
}

async function _dcDoExport(kind) {
  const url = kind === 'paper-freeze'
    ? `${DC_BASE}/exports/paper-freeze`
    : `${DC_BASE}/exports/showcase`;
  try {
    const r = await fetch(url, { method: 'POST' });
    const j = await r.json();
    if (j.ok) {
      const ex = j.export || {};
      toast(`已导出：${ex.file}（${ex.record_count ?? 0} 条记录）`, 'success');
    } else {
      toast(`导出失败：${j.error || '未知错误'}`, 'error');
    }
  } catch (e) {
    toast('导出请求失败：' + (e.message || e), 'error');
  }
}

// 数据中心入口接线
$('#btn-data-center')?.addEventListener('click', openDataCenter);

document.addEventListener('DOMContentLoaded', function() { bootstrapApp(); });
