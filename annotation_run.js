(function exposeAnnotationRun(root, factory) {
  const moduleInterface = factory();
  if (typeof module === 'object' && module.exports) module.exports = moduleInterface;
  if (root) root.AnnotationRun = moduleInterface;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAnnotationRunInterface() {
  'use strict';

  const VALID_ACADEMIC_CLASSES = Object.freeze([
    '疾病图', '诊法图', '医疗图', '药物图', '器具图', '养生图',
    '脏腑图', '经穴图', '部位图', '理论图', '符咒图', '人物图',
  ]);
  const FATAL_OUTPUT_FLAGS = Object.freeze([
    'output_truncated',
    'parse_failed',
    'recovered_partial_output',
  ]);
  const INVALID_OUTPUT_FLAGS = Object.freeze([
    'missing_illustration_name',
    'empty_illustration_name',
    'missing_has_multiple_illustrations',
    'invalid_academic_class',
  ]);

  function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (value && typeof value === 'object') {
      const cloned = {};
      for (const [key, item] of Object.entries(value)) cloned[key] = clonePlain(item);
      return cloned;
    }
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
    return value;
  }

  function restoreRecordInPlace(record, snapshot) {
    for (const key of Object.keys(record)) delete record[key];
    Object.assign(record, clonePlain(snapshot));
  }

  function validateAnnotationResult(result) {
    if (!result || typeof result !== 'object' || !result.annotation || typeof result.annotation !== 'object') {
      return { ok: false, code: 'OUTPUT_INVALID', message: '模型没有返回完整标注对象' };
    }
    const annotation = result.annotation;
    const flags = Array.isArray(annotation._outputQualityFlags)
      ? annotation._outputQualityFlags.filter(Boolean)
      : [];
    const fatalFlags = flags.filter(flag => FATAL_OUTPUT_FLAGS.includes(flag));
    if (fatalFlags.length) {
      return {
        ok: false,
        code: 'OUTPUT_INCOMPLETE',
        message: `模型输出不完整：${fatalFlags.join(', ')}`,
        details: { qualityFlags: flags },
      };
    }
    const invalidFlags = flags.filter(flag => INVALID_OUTPUT_FLAGS.includes(flag));
    if (invalidFlags.length) {
      return {
        ok: false,
        code: 'OUTPUT_INVALID',
        message: `模型输出未通过字段校验：${invalidFlags.join(', ')}`,
        details: { qualityFlags: flags },
      };
    }
    const name = String(annotation.illustrationName || '').trim();
    const academicClass = String(annotation.academicClass || annotation.type || '').trim();
    if (!name || !VALID_ACADEMIC_CLASSES.includes(academicClass) || typeof result.hasMultiple !== 'boolean') {
      return {
        ok: false,
        code: 'OUTPUT_INVALID',
        message: '模型输出未通过名称、分类或多图标记校验',
        details: {
          hasIllustrationName: !!name,
          academicClass,
          hasMultipleType: typeof result.hasMultiple,
          qualityFlags: flags,
        },
      };
    }
    return { ok: true, details: { qualityFlags: flags } };
  }

  function normalizeError(error, fallbackCode) {
    if (error && typeof error === 'object' && error.code && error.message) {
      return { code: error.code, message: error.message, details: error.details || null };
    }
    return {
      code: fallbackCode,
      message: error?.message || String(error || '未知错误'),
      details: null,
    };
  }

  function createAnnotationRunModule({
    captureEvidence,
    invokeModel,
    promoteCandidate,
    recordReceipt = async () => {},
    validateCandidate = validateAnnotationResult,
    now = () => Date.now(),
    random = () => Math.random(),
  } = {}) {
    if (typeof captureEvidence !== 'function') throw new TypeError('captureEvidence 必须是函数');
    if (typeof invokeModel !== 'function') throw new TypeError('invokeModel 必须是函数');
    if (typeof promoteCandidate !== 'function') throw new TypeError('promoteCandidate 必须是函数');
    if (typeof validateCandidate !== 'function') throw new TypeError('validateCandidate 必须是函数');

    const activeRuns = new Map();

    function makeRunId() {
      return `ar-${now().toString(36)}-${random().toString(36).slice(2, 10)}`;
    }

    async function persistReceipt(record, receipt) {
      try {
        await recordReceipt(record, clonePlain(receipt));
        return '';
      } catch (error) {
        return error?.message || String(error || '运行凭据保存失败');
      }
    }

    async function run(record, options = {}) {
      const imageId = String(record?.id || '').trim();
      if (!imageId) {
        return { ok: false, code: 'RECORD_ID_REQUIRED', message: '插图记录缺少 id' };
      }
      if (activeRuns.has(imageId)) {
        const active = activeRuns.get(imageId);
        return {
          ok: false,
          code: 'RUN_ALREADY_ACTIVE',
          message: '该插图正在标注中，请等待当前请求完成',
          runId: active.runId,
        };
      }

      const startedAtMs = now();
      const runId = makeRunId();
      const active = { runId, imageId, startedAtMs };
      activeRuns.set(imageId, active);
      let frozenSnapshot = null;
      let promotionStarted = false;
      let recordBeforePromotion = null;

      try {
        let captured;
        try {
          captured = await captureEvidence(record, options);
        } catch (error) {
          throw { ...normalizeError(error, 'EVIDENCE_CAPTURE_FAILED') };
        }
        frozenSnapshot = deepFreeze(clonePlain(captured || {}));

        let result;
        try {
          result = await invokeModel(frozenSnapshot, record, options);
        } catch (error) {
          throw { ...normalizeError(error, 'MODEL_CALL_FAILED') };
        }

        const validation = validateCandidate(result);
        if (!validation?.ok) {
          throw {
            code: validation?.code || 'OUTPUT_INVALID',
            message: validation?.message || '模型输出未通过校验',
            details: validation?.details || null,
          };
        }

        recordBeforePromotion = clonePlain(record);
        promotionStarted = true;
        let promotion;
        try {
          promotion = await promoteCandidate(record, result, {
            runId,
            snapshot: frozenSnapshot,
            startedAtMs,
            completedAtMs: now(),
            options,
          });
        } catch (error) {
          restoreRecordInPlace(record, recordBeforePromotion);
          throw { ...normalizeError(error, 'PROMOTION_FAILED') };
        }

        const completedAtMs = now();
        const receipt = {
          runId,
          imageId,
          status: 'succeeded',
          startedAt: new Date(startedAtMs).toISOString(),
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: Math.max(0, completedAtMs - startedAtMs),
          evidence: clonePlain(frozenSnapshot.receipt || {}),
          model: String(result?.model || ''),
          promptVersion: String(frozenSnapshot?.receipt?.promptVersion || ''),
        };
        const receiptWarning = await persistReceipt(record, receipt);
        return {
          ok: true,
          code: 'RUN_SUCCEEDED',
          runId,
          receipt,
          receiptWarning,
          result,
          promotion,
        };
      } catch (error) {
        if (promotionStarted && recordBeforePromotion) restoreRecordInPlace(record, recordBeforePromotion);
        const normalized = normalizeError(error, 'ANNOTATION_RUN_FAILED');
        const completedAtMs = now();
        const receipt = {
          runId,
          imageId,
          status: 'failed',
          startedAt: new Date(startedAtMs).toISOString(),
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: Math.max(0, completedAtMs - startedAtMs),
          evidence: clonePlain(frozenSnapshot?.receipt || {}),
          code: normalized.code,
          message: normalized.message,
          details: normalized.details,
        };
        const receiptWarning = await persistReceipt(record, receipt);
        return {
          ok: false,
          code: normalized.code,
          message: normalized.message,
          details: normalized.details,
          runId,
          receipt,
          receiptWarning,
        };
      } finally {
        activeRuns.delete(imageId);
      }
    }

    return Object.freeze({
      run,
      isActive(imageId) {
        return activeRuns.has(String(imageId || ''));
      },
      getActiveRun(imageId) {
        const active = activeRuns.get(String(imageId || ''));
        return active ? clonePlain(active) : null;
      },
    });
  }

  return Object.freeze({
    createAnnotationRunModule,
  });
}));
