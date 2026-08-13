'use strict';

const assert = require('assert');
const {
  createAnnotationRunModule,
} = require('./annotation_run');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function validResult(overrides = {}) {
  return {
    annotation: {
      illustrationName: '黄芩',
      academicClass: '药物图',
      type: '药物图',
      _outputQualityFlags: [],
      ...(overrides.annotation || {}),
    },
    model: 'qwen3.5-flash',
    evidenceMode: 'text',
    hasMultiple: false,
    ...overrides,
  };
}

async function runTests() {
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  };

  await test('运行使用启动时冻结的证据快照', async () => {
    const record = { id: 'img-1', text: '旧文字' };
    let seenSnapshot = null;
    const runner = createAnnotationRunModule({
      captureEvidence: async current => ({
        imageHash: 'img-hash-1',
        text: current.text,
        apiKey: 'secret-must-not-enter-receipt',
        receipt: {
          imageHash: 'img-hash-1',
          textHash: 'text-hash-1',
          promptVersion: 'prompt-v1',
        },
      }),
      invokeModel: async snapshot => {
        seenSnapshot = snapshot;
        record.text = '运行中被修改的新文字';
        return validResult();
      },
      promoteCandidate: async () => ({ status: 'review' }),
    });

    const outcome = await runner.run(record);
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(seenSnapshot.text, '旧文字');
    assert.strictEqual(Object.isFrozen(seenSnapshot), true);
    assert.strictEqual(Object.isFrozen(seenSnapshot.receipt), true);
    assert.strictEqual(JSON.stringify(outcome.receipt).includes('secret-must-not-enter-receipt'), false);
  });

  await test('同一插图并发运行只调用一次模型', async () => {
    const gate = deferred();
    let calls = 0;
    const runner = createAnnotationRunModule({
      captureEvidence: async () => ({ receipt: { imageHash: 'same' } }),
      invokeModel: async () => {
        calls += 1;
        await gate.promise;
        return validResult();
      },
      promoteCandidate: async () => ({ status: 'review' }),
    });
    const record = { id: 'img-2' };
    const first = runner.run(record);
    const duplicate = await runner.run(record);
    assert.strictEqual(duplicate.ok, false);
    assert.strictEqual(duplicate.code, 'RUN_ALREADY_ACTIVE');
    assert.strictEqual(calls, 1);
    gate.resolve();
    assert.strictEqual((await first).ok, true);
    assert.strictEqual(runner.isActive(record.id), false);
  });

  await test('截断或部分恢复结果不得提升为待审核草稿', async () => {
    const record = {
      id: 'img-3',
      status: 'ok',
      annotation: { illustrationName: '旧终稿' },
    };
    const before = JSON.stringify(record);
    let promoted = 0;
    const receipts = [];
    const runner = createAnnotationRunModule({
      captureEvidence: async () => ({ receipt: { imageHash: 'bad-output' } }),
      invokeModel: async () => validResult({
        annotation: {
          illustrationName: '半条结果',
          academicClass: '药物图',
          _outputQualityFlags: ['output_truncated', 'recovered_partial_output'],
        },
      }),
      promoteCandidate: async () => { promoted += 1; },
      recordReceipt: async (_record, receipt) => receipts.push(receipt),
    });
    const outcome = await runner.run(record);
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.code, 'OUTPUT_INCOMPLETE');
    assert.strictEqual(promoted, 0);
    assert.strictEqual(JSON.stringify(record), before);
    assert.strictEqual(receipts[0].status, 'failed');
  });

  await test('分类、多图标记和名称不完整时拒绝提升', async () => {
    const invalidResults = [
      validResult({ annotation: { illustrationName: '', academicClass: '药物图' } }),
      validResult({ annotation: { illustrationName: '黄芩', academicClass: '不存在的分类' } }),
      validResult({ hasMultiple: undefined }),
    ];
    for (const result of invalidResults) {
      const runner = createAnnotationRunModule({
        captureEvidence: async () => ({ receipt: { imageHash: 'invalid' } }),
        invokeModel: async () => result,
        promoteCandidate: async () => { throw new Error('不应执行提升'); },
      });
      const outcome = await runner.run({ id: `invalid-${Math.random()}` });
      assert.strictEqual(outcome.ok, false);
      assert.strictEqual(outcome.code, 'OUTPUT_INVALID');
    }
  });

  await test('失败后释放运行占用并允许重试', async () => {
    let calls = 0;
    const runner = createAnnotationRunModule({
      captureEvidence: async () => ({ receipt: { imageHash: 'retry' } }),
      invokeModel: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary failure');
        return validResult();
      },
      promoteCandidate: async () => ({ status: 'review' }),
    });
    const record = { id: 'img-4' };
    const failed = await runner.run(record);
    const retried = await runner.run(record);
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, 'MODEL_CALL_FAILED');
    assert.strictEqual(retried.ok, true);
    assert.strictEqual(calls, 2);
  });

  await test('候选提升或持久化失败时完整回滚原记录', async () => {
    const record = {
      id: 'img-5',
      status: 'ok',
      annotation: { illustrationName: '旧人工终稿', academicClass: '药物图' },
      reviewMeta: { pendingReason: '' },
    };
    const before = JSON.stringify(record);
    const runner = createAnnotationRunModule({
      captureEvidence: async () => ({ receipt: { imageHash: 'rollback' } }),
      invokeModel: async () => validResult(),
      promoteCandidate: async current => {
        current.status = 'review';
        current.annotation = { illustrationName: '未落盘的新候选' };
        const error = new Error('bridge save failed');
        error.code = 'PROMOTION_PERSIST_FAILED';
        throw error;
      },
    });
    const outcome = await runner.run(record);
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.code, 'PROMOTION_PERSIST_FAILED');
    assert.strictEqual(JSON.stringify(record), before);
  });

  console.log(`标注运行 module：${passed} 项通过`);
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});
