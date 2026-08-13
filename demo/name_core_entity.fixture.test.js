/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolveIllustrationDisplayName,
} = require('./illustration_name_rules');

const appPath = path.join(__dirname, 'app.js');
const source = fs.readFileSync(appPath, 'utf8');
const cases = [
  ['黄芩植株', '黄芩'],
  ['黄芩炮制场景', '黄芩'],
  ['自然铜采掘场景', '自然铜'],
  ['炮制续断', '续断'],
  ['山林溪流中的玉泉产地景观', '玉泉'],
  ['两名药工炮制药材', '炮制场景'],
  ['药材', ''],
];

for (const [input, expected] of cases) {
  assert.strictEqual(
    resolveIllustrationDisplayName({
      explicitIllustrationName: input,
    }).illustrationName,
    expected,
    `${input} 应归一为 ${expected || '空值'}`,
  );
}

assert(
  source.includes("const PROMPT_VERSION = 'quick_search_v7_core_entity_name'"),
  'Prompt 版本必须冻结为 v7',
);
assert(
  source.includes('illustration_name 均写“黄芩”'),
  'Prompt 必须给出核心实体名称示例',
);
assert(
  resolveIllustrationDisplayName({
    sourceLabel: '黄芩',
    textInImage: '黄芩',
    explicitIllustrationName: '黄芩植株',
    mainSubject: '黄芩植株',
  }).illustrationName === '黄芩',
  '裁图中可核验的题签必须优先',
);
const sourceTextOnly = resolveIllustrationDisplayName({
  sourceLabel: '黄芩',
  textInImage: '',
  explicitIllustrationName: '桔梗',
  mainSubject: '黄芩植株',
});
assert.strictEqual(sourceTextOnly.illustrationName, '黄芩');
assert.strictEqual(sourceTextOnly.sourceLabelReliable, false);
assert.deepStrictEqual(
  Array.from(sourceTextOnly.qualityFlags),
  ['illustration_name_simplified_to_core_entity', 'unsafe_illustration_name_replaced'],
  '对应原文称谓不得冒充题签，名称必须与主要对象一致',
);
const normalizedToEmpty = resolveIllustrationDisplayName({
  explicitIllustrationName: '药材',
  mainSubject: '药材',
});
assert.strictEqual(normalizedToEmpty.illustrationName, '');
assert.strictEqual(normalizedToEmpty.sourceLabelReliable, false);
assert.deepStrictEqual(
  Array.from(normalizedToEmpty.qualityFlags),
  ['illustration_name_simplified_to_core_entity'],
  '归一为空也必须记录质量标记',
);
assert.strictEqual(
  resolveIllustrationDisplayName({
    sourceLabel: '黄芩',
    textInImage: '黄芩',
    mainSubject: '黄芩植株',
    hasDirectionConflict: true,
  }).sourceLabelReliable,
  false,
  '读向冲突的文字不得作为可靠题签',
);

console.log(`名称核心实体规则：${cases.length + 7} 项通过`);
