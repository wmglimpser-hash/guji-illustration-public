'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const rerunStart = appSource.indexOf("btn.textContent = '重新 OCR 中…'");
const requestStart = appSource.indexOf(
  'const run = await requestPageImageOcr(book, page, doc);',
  rerunStart,
);

assert(rerunStart >= 0 && requestStart > rerunStart, '必须能定位校文页单页重新 OCR 调用链');

const sourceGuard = appSource.slice(rerunStart, requestStart);
assert(
  sourceGuard.includes('if (!doc && !hasStoredPageScanSource(book))'),
  '图片书存在持久化原始页图时，单页重新 OCR 不得硬性要求 PDF 文档对象',
);
assert(
  !sourceGuard.includes("if (!doc) throw new Error('PDF 文档未加载"),
  '不得继续显示与图片书来源不符的“PDF 文档未加载”错误',
);

console.log('page_ocr_source: 2 assertions passed');
