'use strict';

const assert = require('assert');
const {
  analyzeImageFiles,
  applyModePreset,
  buildManifest,
  countLogicalPages,
  naturalCompare,
  validatePlan,
} = require('./image_book_import');

function fakeFile(name, relativePath) {
  return { name, webkitRelativePath: relativePath, size: 100 };
}

const files = [
  fakeFile('杏林雑話2-00010.jpg', '1865杏林杂话/1865杏林杂话/杏林雑話2/杏林雑話2-00010.jpg'),
  fakeFile('杏林雑話1-00002.jpg', '1865杏林杂话/1865杏林杂话/杏林雑話1/杏林雑話1-00002.jpg'),
  fakeFile('杏林雑話1-00001.jpg', '1865杏林杂话/1865杏林杂话/杏林雑話1/杏林雑話1-00001.jpg'),
  fakeFile('杏林雑話2-00001.jpg', '1865杏林杂话/1865杏林杂话/杏林雑話2/杏林雑話2-00001.jpg'),
  fakeFile('notes.txt', '1865杏林杂话/notes.txt'),
];

const plan = analyzeImageFiles(files);
assert.strictEqual(plan.title, '杏林杂话');
assert.strictEqual(plan.sourceScanCount, 4);
assert.strictEqual(plan.unsupportedCount, 1);
assert.deepStrictEqual(plan.volumes.map(v => v.sourceName), ['杏林雑話1', '杏林雑話2']);
assert.deepStrictEqual(
  plan.volumes[0].scans.map(scan => scan.filename),
  ['杏林雑話1-00001.jpg', '杏林雑話1-00002.jpg'],
);
assert.deepStrictEqual(plan.volumes[0].scans.map(scan => scan.mode), ['single', 'single']);
assert.strictEqual(plan.logicalPageCount, 4);
assert(naturalCompare('p2.jpg', 'p10.jpg') < 0);

applyModePreset(plan, 'all-single');
assert.strictEqual(countLogicalPages(plan.volumes), 4);
applyModePreset(plan, 'volume-first-single');
assert.strictEqual(countLogicalPages(plan.volumes), 6);

const manifest = buildManifest(plan, { title: '杏林杂话', dynasty: '清' });
assert.strictEqual(manifest.schema, 'image-book-import-v1');
assert.strictEqual(manifest.title, '杏林杂话');
assert.strictEqual(manifest.volumes[0].scans[0].relativePath.endsWith('00001.jpg'), true);
assert.deepStrictEqual(validatePlan(plan, { title: '杏林杂话' }), []);

const separatelyUploadedVolume2 = analyzeImageFiles([
  fakeFile(
    '杏林雑話2-00001.jpg',
    '1865杏林杂话/1865杏林杂话/杏林雑話2/杏林雑話2-00001.jpg',
  ),
]);
assert.strictEqual(separatelyUploadedVolume2.volumes[0].version, '卷2');

plan.volumes[0].scans.forEach(scan => { scan.mode = 'skip'; });
assert(validatePlan(plan, { title: '杏林杂话' }).some(msg => msg.includes('不能全部跳过')));

console.log('image_book_import.fixture.test.js: 19 assertions passed');
