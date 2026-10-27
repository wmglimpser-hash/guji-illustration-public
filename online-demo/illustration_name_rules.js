(function exposeIllustrationNameRules(root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  if (root) root.IllustrationNameRules = rules;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createIllustrationNameRules() {
  'use strict';

  // Module interface:
  // - cleanIllustrationName(value)
  // - resolveIllustrationDisplayName(context)
  // 其余后缀表、证据正规化与回退算法均为 implementation，不对调用者暴露。
  const FALLBACK_NAME_SUFFIXES = [
    '产地生态环境', '植株形态', '全株形态', '药材形态', '矿物形态',
    '炮制场景', '炮制过程', '炮制操作', '炮制图', '炮制', '炮製',
    '采掘场景', '开采场景', '采集场景', '采药场景',
    '产地环境', '产地景观', '生境景观',
    '煎煮场景', '研磨场景',
    '形态图', '植株', '全株', '药材', '矿物药物', '矿物药', '矿石',
    '块状物', '颗粒状物', '形态', '插图', '图',
  ];

  function cleanIllustrationName(value = '') {
    return String(value || '')
      .replace(/[（(]\s*(?:推测|疑似|或作[^）)]*|或[^）)]*|图题示[^）)]*|题签示[^）)]*|题签作[^）)]*|图中题签[^）)]*)\s*[）)]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeEvidenceText(value) {
    return String(value || '').replace(/[\s，。、“”‘’：；·（）()\[\]【】]/g, '').trim();
  }

  function simplifyFallbackIllustrationName(value = '') {
    const original = cleanIllustrationName(value)
      .replace(/^图中(?:描绘|绘有|可见|展示)\s*/, '')
      .trim();
    if (!original) return '';

    let simplified = original;
    let changed = true;
    while (changed && simplified) {
      changed = false;
      for (const suffix of FALLBACK_NAME_SUFFIXES) {
        if (!simplified.endsWith(suffix) || simplified === suffix) continue;
        const next = simplified.slice(0, -suffix.length).replace(/[的之]\s*$/, '').trim();
        if (!next) continue;
        simplified = next;
        changed = true;
        break;
      }
    }
    if (simplified.includes('中的')) {
      const tail = simplified.split('中的').pop().trim();
      if (tail) simplified = tail;
    }
    const actionPrefix = simplified.match(/^(?:炮制|炮製|采掘|開採|开采|采集|採集)(.+)$/);
    if (actionPrefix && !/^(?:场景|場景|过程|過程|操作|图|圖)$/.test(actionPrefix[1].trim())) {
      simplified = actionPrefix[1].trim();
    }
    simplified = simplified
      .replace(/^(?:一株|一丛|一叢|一棵|一味|数株|數株|若干)\s*/, '')
      .trim();

    // 画面只有人物和操作、没有可确认实体时，不虚构药名；保留最小场景名。
    if (/^(?:一|二|两|兩|三|四|数|數|若干)?(?:名|位|个|個)?(?:人物|人|男子|女子|药工|藥工)/.test(simplified)) {
      if (/采掘|開採|开采|挖掘/.test(original)) return '采掘场景';
      if (/采集|採集|采药|採藥/.test(original)) return '采集场景';
      if (/煎煮|煎药|煎藥/.test(original)) return '煎煮场景';
      if (/研磨|捣药|搗藥|舂捣|舂搗/.test(original)) return '研磨场景';
      if (/炮制|炮製|加工/.test(original)) return '炮制场景';
    }
    const genericOnly = /^(?:植物|草本植物|药材|藥材|药物|藥物|矿物|礦物|矿石|礦石|块状物|塊狀物|颗粒状物|顆粒狀物|植株|全株)$/;
    return genericOnly.test(simplified) ? '' : simplified;
  }

  function resolveIllustrationDisplayName({
    sourceLabel = '',
    textInImage = '',
    explicitIllustrationName = '',
    mainSubject = '',
    hasDirectionConflict = false,
    unverifiedOcrTitle = false,
  } = {}) {
    const cleanedSourceLabel = cleanIllustrationName(sourceLabel);
    const cleanedExplicitName = cleanIllustrationName(explicitIllustrationName);
    const cleanedSubject = cleanIllustrationName(mainSubject);
    const sourceLabelKey = normalizeEvidenceText(cleanedSourceLabel);
    const visibleTextKey = normalizeEvidenceText(textInImage);
    // source_label 也可能来自对应原文。只有该称谓确实出现在插图裁图文字中，
    // 且读向可信时，才能把它当作“原图题签”覆盖目录名称。
    const sourceLabelReliable = !!(
      sourceLabelKey
      && visibleTextKey.includes(sourceLabelKey)
      && !hasDirectionConflict
      && !unverifiedOcrTitle
    );
    const qualityFlags = [];

    if (sourceLabelReliable) {
      if (cleanedExplicitName
        && normalizeEvidenceText(cleanedExplicitName) !== sourceLabelKey) {
        qualityFlags.push('illustration_name_normalized_to_source_label');
      }
      return {
        illustrationName: cleanedSourceLabel,
        sourceLabelReliable,
        qualityFlags,
      };
    }

    // 没有可靠题签时，subject 是“画了什么”的事实主轴，名称必须从它归一，
    // 不得让模型另写的 illustration_name 与主要对象相互矛盾。
    const subjectCoreName = simplifyFallbackIllustrationName(cleanedSubject);
    const explicitCoreName = simplifyFallbackIllustrationName(cleanedExplicitName);
    const illustrationName = subjectCoreName || explicitCoreName;
    const explicitChanged = !!(
      cleanedExplicitName
      && normalizeEvidenceText(illustrationName) !== normalizeEvidenceText(cleanedExplicitName)
    );
    const subjectChangedWithoutExplicit = !!(
      !cleanedExplicitName
      && cleanedSubject
      && normalizeEvidenceText(illustrationName) !== normalizeEvidenceText(cleanedSubject)
    );
    if (explicitChanged || subjectChangedWithoutExplicit) {
      qualityFlags.push('illustration_name_simplified_to_core_entity');
    }
    if (cleanedExplicitName && subjectCoreName
      && normalizeEvidenceText(explicitCoreName || cleanedExplicitName)
        !== normalizeEvidenceText(subjectCoreName)) {
      qualityFlags.push('unsafe_illustration_name_replaced');
    }

    return {
      illustrationName,
      sourceLabelReliable,
      qualityFlags,
    };
  }

  return Object.freeze({
    cleanIllustrationName,
    resolveIllustrationDisplayName,
  });
}));
