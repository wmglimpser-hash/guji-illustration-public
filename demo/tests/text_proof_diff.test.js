'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeForComparison,
  compareContinuousText,
  chooseReferenceStartHint,
  buildDifferenceHighlightSegments,
  splitHighlightRange,
} = require('../text_proof_diff');

function compare(ocrRaw, ocrCanonical, referenceRaw, referenceCanonical) {
  return compareContinuousText({
    ocrRaw,
    ocrCanonical,
    referenceRaw,
    referenceCanonical,
  });
}

{
  const normalized = normalizeForComparison('藥，味苦。\n', '药，味苦。\n');
  assert.strictEqual(normalized.characters.join(''), '药味苦');
}

{
  const result = compare('藥，味苦。', '药，味苦。', '药味苦', '药味苦');
  assert.strictEqual(result.matched, true);
  assert.deepStrictEqual(result.differences, []);
}

{
  const result = compare(
    '黃芩味苦，入肺經。',
    '黄芩味苦，入肺经。',
    '杏林序。黄芩味苦入肺经。卷二',
    '杏林序。黄芩味苦入肺经。卷二',
  );
  assert.strictEqual(result.matched, true);
  assert.deepStrictEqual(result.differences, []);
  assert(result.referenceStart > 0, '应定位到连续整理稿中间，而不是固定从开头比较');
}

{
  const result = compare(
    '黃芩味苦氣寒',
    '黄芩味苦气寒',
    '黃連味苦氣寒',
    '黄连味苦气寒',
  );
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.differences.length, 1);
  assert.strictEqual(result.differences[0].kind, 'content');
  assert.strictEqual(result.differences[0].ocrText, '芩');
  assert.strictEqual(result.differences[0].referenceText, '連');
}

{
  const result = compare(
    '黃芩味苦入肺經',
    '黄芩味苦入肺经',
    '黄芩味苦肺经',
    '黄芩味苦肺经',
  );
  assert.strictEqual(result.matched, true);
  assert(result.differences.some(item => item.ocrText === '入' && item.referenceText === ''));
}

{
  const referenceRaw = '卷首序文。黃連味苦入肺經。卷二';
  const result = compare(
    '黃芩味苦入肺經',
    '黄芩味苦入肺经',
    referenceRaw,
    '卷首序文。黄连味苦入肺经。卷二',
  );
  const difference = result.differences[0];
  assert.strictEqual(
    referenceRaw.slice(difference.referenceStart, difference.referenceEnd),
    '連',
    '忽略窗口前导文字后，右侧逐字高亮坐标仍须指向实际差异字',
  );
}

{
  const ocr = '卷首通用题记甲乙丙丁正文异';
  const reference = '卷首通用题记甲乙丙丁正文甲。中间若干文字。卷首通用题记甲乙丙丁正文乙';
  const secondStart = reference.lastIndexOf('卷首通用题记');
  const result = compareContinuousText({
    ocrRaw: ocr,
    referenceRaw: reference,
    referenceStartHint: secondStart,
  });
  assert.strictEqual(result.matched, true);
  assert(
    result.referenceStart >= secondStart,
    '人工或连续页起点必须把重复段落定位限制在指定位置附近',
  );
  assert.strictEqual(result.locationStrategy, 'hinted');
}

{
  const ocr = '同文正文甲乙丙丁戊己庚辛';
  const reference = `卷首。${ocr}。卷中。${ocr}。卷末。`;
  const result = compareContinuousText({ ocrRaw: ocr, referenceRaw: reference });
  assert.strictEqual(result.matched, false);
  assert(
    result.reason.includes('重复位置'),
    '没有当前页锚点的重复正文必须要求定位，不能静默跳到整理稿首页',
  );
}

{
  const ranges = [
    { pageNum: 4, referenceStart: 100, referenceEnd: 180 },
    { pageNum: 6, referenceStart: 260, referenceEnd: 340 },
  ];
  assert.strictEqual(
    chooseReferenceStartHint({ pageNum: 5, ranges }),
    180,
    '未对照的新页应从最近前页的结束位置继续逐字定位',
  );
  assert.strictEqual(
    chooseReferenceStartHint({
      pageNum: 5,
      ranges: [...ranges, { pageNum: 5, referenceStart: 220, referenceEnd: 250, manual: true }],
    }),
    220,
    '人工指定或本页既有范围优先于前页连续位置',
  );
  assert.strictEqual(
    chooseReferenceStartHint({ pageNum: 3, ranges }),
    null,
    '没有前页依据时不得伪造连续定位起点',
  );
}

{
  const result = compare(
    '發髮',
    '发发',
    '髮發',
    '发发',
  );
  assert.strictEqual(result.matched, false, '过短文本不强行匹配，避免错误定位');
}

{
  const result = compare(
    '發髮生長良好',
    '发发生长良好',
    '髮發生长良好',
    '发发生长良好',
  );
  assert.strictEqual(result.matched, true);
  assert(result.differences.some(item => item.kind === 'glyph'), '一对多繁体字形异常应单列提示');
}

{
  const result = compare(
    '天地玄黃',
    '天地玄黄',
    '完全不同的参考段落',
    '完全不同的参考段落',
  );
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.differences.length, 0);
}

{
  const ocr = splitHighlightRange('黃芩味苦', 1, 2);
  const reference = splitHighlightRange('黄連味苦', 1, 2);
  assert.deepStrictEqual(
    ocr,
    { before: '黃', highlight: '芩', after: '味苦' },
    'OCR 当前差异必须有可持久显示的精确高亮范围',
  );
  assert.deepStrictEqual(
    reference,
    { before: '黄', highlight: '連', after: '味苦' },
    '整理稿对应差异必须与 OCR 同时生成高亮范围',
  );
}

{
  const text = '甲乙丙丁戊己';
  const differences = [
    { referenceStart: 1, referenceEnd: 2 },
    { referenceStart: 4, referenceEnd: 5 },
  ];
  const segments = buildDifferenceHighlightSegments(text, differences, 1);
  const highlighted = segments.filter(item => item.type === 'difference');
  assert.deepStrictEqual(
    highlighted.map(item => item.text),
    ['乙', '戊'],
    '整理稿必须同时保留全部差异高亮，而不是只渲染当前一处',
  );
  assert.deepStrictEqual(
    highlighted.map(item => item.active),
    [false, true],
    '上一处/下一处只切换当前焦点，不改变其他差异的可见性',
  );
  assert.strictEqual(
    segments.map(item => item.text).join(''),
    text,
    '生成全部差异高亮时不得改变整理稿正文',
  );
}

{
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(!appSource.includes('对照来源 · 原始 OCR 底稿'),
    '校文页不得新增第二个 OCR 对照文本框');
  assert(!htmlSource.includes('.ocr-proof-comparison-source'),
    '校文页只保留一个左侧文字框');
  assert(!appSource.includes("}, '采用选中文字')"),
    '右侧整理稿不再提供容易误写校文框的“采用选中文字”按钮');
  assert(!appSource.includes("class: 'reference-comparison-list'"),
    '差异不再以独立列表挤占右栏，全部差异改在正文范围内显示');
  assert(!appSource.includes('openLightbox(imgUrl)'),
    '校文正文图像不再打开独立弹窗');
  assert(appSource.includes("class: 'ocr-proof-zoom-controls'"),
    '校文正文图像在卡片内提供减小、还原和放大控件');
  assert(htmlSource.includes('overflow: auto;')
    && htmlSource.includes('.ocr-proof-image-frame.cropped'),
  '正文框图像卡片允许在卡片内滚动查看放大内容');
  assert(appSource.includes('renderReferencePane(book, referenceReaderState.editor, { viewSnapshot: saveViewSnapshot })'),
    '整理稿保存的两次重绘固定复用保存前视图快照');
}

console.log('text_proof_diff: 16 scenarios passed');
