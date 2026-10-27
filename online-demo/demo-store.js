/* Browser-only adapter for the released annotation workbench. No server writes. */
(function (root) {
  'use strict';
  const KEY = 'yituzhi.demo.work.20261027.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  // Persist changed entities only; the immutable OCR/evidence baseline stays in fixture.js.
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function entityDelta(base, next, key) {
    const old = new Map(base.map(item => [item[key],item]));
    const ids = new Set(next.map(item => item[key]));
    return { changed: next.filter(item => !equal(old.get(item[key]),item)), removed: base.filter(item => !ids.has(item[key])).map(item => item[key]) };
  }
  function applyEntities(base, delta, key) {
    if (!delta) return clone(base);
    const removed = new Set(delta.removed || []), changed = new Map((delta.changed || []).map(item => [item[key],item]));
    return base.filter(item => !removed.has(item[key])).map(item => { const next=changed.get(item[key]) || item; changed.delete(item[key]); return clone(next); }).concat([...changed.values()].map(clone));
  }
  function makeDelta(base,next) {
    const metadata = clone(next); delete metadata.books; delete metadata.illustrations;
    return { metadata, illustrations:entityDelta(base.illustrations,next.illustrations,'id'), books:next.books.map(book => {
      const before=base.books.find(item=>item.id===book.id), meta=clone(book); delete meta.pages; delete meta.illustrationPages;
      return { meta, pages:entityDelta(before.pages,book.pages,'pageNum'), illustrationPages:entityDelta(before.illustrationPages,book.illustrationPages,'pageNum') };
    }) };
  }
  function applyDelta(base,delta) {
    return { ...clone(base),...delta.metadata, illustrations:applyEntities(base.illustrations,delta.illustrations,'id'), books:delta.books.map(book => {
      const before=base.books.find(item=>item.id===book.meta.id);
      if (!before) throw new Error('Unknown snapshot book');
      return {...clone(before),...book.meta,pages:applyEntities(before.pages,book.pages,'pageNum'),illustrationPages:applyEntities(before.illustrationPages,book.illustrationPages,'pageNum')};
    }) };
  }
  function createStore(fixture, storage) {
    let state = clone(fixture.state);
    try {
      const saved = JSON.parse(storage.getItem(KEY) || 'null');
      if (saved?.schema === fixture.schema && saved.delta) state = applyDelta(fixture.state,saved.delta);
    } catch (_) { /* First visit or unavailable browser storage: use fixture. */ }
    const books = new Set(fixture.state.books.map(book => book.id));
    const response = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    function save(next) {
      // Commit memory only after persistent storage succeeds.
      storage.setItem(KEY, JSON.stringify({ schema: fixture.schema, delta: makeDelta(fixture.state,next) }));
      state = next;
    }
    async function handle(path, method = 'GET', data = {}) {
      const url = new URL(path, 'https://demo.invalid');
      const p = url.pathname;
      try {
        if (p === '/api/status' && method === 'GET') return response({
          ok: true, provider: 'snapshot', model: '本地工作快照', has_key: false,
          data_source: { id: 'browser-work-snapshot', label: '卷三本地工作快照', book_count: 1, read_only: false },
        });
        if (p === '/api/config' && method === 'GET') return response({ ok: true });
        if (p === '/api/session' && method === 'GET') return response({ ok: true, state: clone(state) });
        if (p === '/api/session/global' && method === 'POST') {
          const next = clone(state);
          next.project = String(data.project || next.project);
          next.showcaseFeaturedIds = data.showcaseFeaturedIds || [];
          save(next);
          return response({ ok: true, demo: true });
        }
        if (p.startsWith('/api/session/book/') && method === 'POST') {
          const id = decodeURIComponent(p.slice('/api/session/book/'.length));
          if (!books.has(id) || data.book?.id !== id || !Array.isArray(data.images)
              || data.images.some(image => image.pdfSource?.bookId !== id)) {
            return response({ ok: false, error: '仅支持当前快照卷册' }, 400);
          }
          const next = clone(state);
          next.books = next.books.map(book => book.id === id ? clone(data.book) : book);
          next.illustrations = next.illustrations.filter(image => image.pdfSource?.bookId !== id)
            .concat(clone(data.images));
          save(next);
          return response({ ok: true, demo: true });
        }
        if (p === '/api/pinyin' && method === 'GET') {
          const text = url.searchParams.get('text');
          const record = fixture.state.illustrations.find(item => item.annotation?.illustrationName === text);
          return response({ ok:true,pinyin:record?.annotation?.illustrationNamePinyin || '' });
        }
        if (p.startsWith('/api/text-references/') && method === 'GET') return response({ ok: true, items: [] });
        if (p === '/api/model-runs' && method === 'GET') return response({ ok: true, records: [], runs: [] });
        if (p === '/api/log-client-error' && method === 'POST') return response({ ok: true, demo: true });
        return response({ ok: false, error: '此在线 Demo 提供本地工作快照体验；完整功能请在本地运行标注系统。' }, 501);
      } catch (_) {
        return response({ ok: false, error: '浏览器未能保存此次修改，请导出或重置案例后重试。' }, 507);
      }
    }
    return { handle, snapshot: () => clone(state), reset: () => { storage.removeItem(KEY); state = clone(fixture.state); } };
  }
  root.DemoStore = { createStore, KEY };
  if (typeof module !== 'undefined') module.exports = root.DemoStore;
})(globalThis);
