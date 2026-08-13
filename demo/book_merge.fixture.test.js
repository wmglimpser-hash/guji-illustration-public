'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const illustrationNameRules = require('./illustration_name_rules');
const annotationRun = require('./annotation_run');
const textProofDiff = require('./text_proof_diff');

function loadMergeHelpers() {
  let source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  source += [
    '',
    'globalThis.__bookMerge = {',
    '  partitionBooksForList,',
    '  applyMergeResultToBooks,',
    '  hasStoredPageScanSource,',
    '  buildBookOcrExport,',
    '  renderBookOcrText,',
    '};',
  ].join('\n');
  const noop = () => {};
  const fakeElement = {
    addEventListener: noop,
    append: noop,
    appendChild: noop,
    setAttribute: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: {
      add: noop,
      remove: noop,
      toggle: noop,
      contains: () => false,
    },
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    innerHTML: '',
  };
  const document = {
    addEventListener: noop,
    getElementById: () => fakeElement,
    querySelector: () => fakeElement,
    querySelectorAll: () => [],
    createElement: () => fakeElement,
    createTextNode: () => fakeElement,
    body: fakeElement,
    documentElement: fakeElement,
    hidden: false,
    visibilityState: 'visible',
  };
  const storage = { getItem: () => null, setItem: noop, removeItem: noop };
  const window = {
    addEventListener: noop,
    localStorage: storage,
    location: { href: 'http://127.0.0.1:5678/', hostname: '127.0.0.1' },
    navigator: { userAgent: 'node' },
    crypto: {
      getRandomValues: bytes => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
        return bytes;
      },
    },
  };
  const context = {
    IllustrationNameRules: illustrationNameRules,
    AnnotationRun: annotationRun,
    TextProofDiff: textProofDiff,
    document,
    window,
    localStorage: storage,
    location: window.location,
    navigator: window.navigator,
    crypto: window.crypto,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    RegExp,
    Error,
    Blob: function Blob() {},
    URL: { createObjectURL: () => '', revokeObjectURL: noop },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    alert: noop,
    confirm: () => true,
    prompt: () => '',
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    atob: () => '',
    btoa: () => '',
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.__bookMerge;
}

const {
  partitionBooksForList,
  applyMergeResultToBooks,
  hasStoredPageScanSource,
  buildBookOcrExport,
  renderBookOcrText,
} = loadMergeHelpers();

assert.strictEqual(hasStoredPageScanSource({
  imageBookImport: {
    schema: 'image-book-import-v1',
    originalsPreserved: true,
  },
  pages: [{ pageNum: 1 }],
}), true);
assert.strictEqual(hasStoredPageScanSource({
  pages: [{ pageNum: 1 }],
}), false);

const partition = partitionBooksForList([
  { id: 'vol-1', groupId: 'legacy-singleton-1', groupTitle: '杏林杂话' },
  { id: 'vol-2', groupId: 'legacy-singleton-2', groupTitle: '杏林杂话' },
]);
assert.strictEqual(partition.ungrouped.length, 2);
assert.strictEqual(Object.keys(partition.groups).length, 0);

const books = [
  { id: 'vol-1', version: '卷1' },
  { id: 'vol-2', version: '卷1' },
];
const changedIds = applyMergeResultToBooks(books, {
  groupId: 'group-new',
  books: [
    { bookId: 'vol-1', version: '卷1', groupOrder: 0 },
    { bookId: 'vol-2', version: '卷2', groupOrder: 1 },
  ],
}, '杏林杂话');
assert.deepStrictEqual(Array.from(changedIds), ['vol-1', 'vol-2']);
assert.strictEqual(books[1].version, '卷2');
assert.strictEqual(books[1].groupOrder, 1);
assert.strictEqual(books[1].groupId, 'group-new');

const exportBooks = [
  {
    id: 'ocr-vol-2',
    title: '杏林杂话',
    groupTitle: '杏林杂话',
    version: '卷2',
    groupOrder: 1,
    pages: [
      { pageNum: 1, textAsset: { fullText: '卷二 OCR', fullScanDone: true, ocrModel: 'model-b' } },
    ],
  },
  {
    id: 'ocr-vol-1',
    title: '杏林杂话',
    groupTitle: '杏林杂话',
    version: '卷1',
    groupOrder: 0,
    pages: [
      {
        pageNum: 1,
        textAsset: {
          fullText: '卷一 OCR',
          correctedText: '卷一人工校文',
          verified: true,
          fullScanDone: true,
          ocrModel: 'model-a',
        },
      },
      { pageNum: 2, textAsset: { fullScanDone: true } },
    ],
  },
];
const readableExport = buildBookOcrExport(exportBooks);
assert.strictEqual(readableExport.schema, 'book-ocr-export-v1');
assert.strictEqual(readableExport.summary.volume_count, 2);
assert.strictEqual(readableExport.summary.page_count, 3);
assert.strictEqual(readableExport.volumes[0].pages[0].text, '卷一人工校文');
assert.strictEqual(readableExport.volumes[0].pages[0].full_text, '卷一 OCR');
assert.strictEqual(readableExport.volumes[0].pages[0].corrected_text, '卷一人工校文');
assert.strictEqual(readableExport.summary.empty_pages, 1);
assert.strictEqual(readableExport.volumes[1].volume, '卷2');

const rawExport = buildBookOcrExport(exportBooks, { textMode: 'raw' });
assert.strictEqual(rawExport.volumes[0].pages[0].text, '卷一 OCR');
assert.strictEqual(rawExport.volumes[0].pages[0].corrected_text, '卷一人工校文');
const readableText = renderBookOcrText(readableExport);
assert.ok(readableText.includes('# 卷1'));
assert.ok(readableText.includes('## 第 2 页\n\n[无文字]'));

console.log('book_merge.fixture.test.js: 20 assertions passed');
