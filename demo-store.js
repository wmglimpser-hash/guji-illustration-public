/* Browser-only adapter for the released annotation workbench. No server writes. */
(function (root) {
  'use strict';
  const KEY = 'yituzhi.demo.volume.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  function createStore(fixture, storage) {
    let state = clone(fixture.state);
    try {
      const saved = JSON.parse(storage.getItem(KEY) || 'null');
      if (saved?.schema === fixture.schema && Array.isArray(saved.state?.books)
          && Array.isArray(saved.state?.illustrations)) state = saved.state;
    } catch (_) { /* First visit or unavailable browser storage: use fixture. */ }
    const books = new Set(fixture.state.books.map(book => book.id));
    const response = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    function save(next) {
      // Commit memory only after persistent storage succeeds.
      storage.setItem(KEY, JSON.stringify({ schema: fixture.schema, state: next }));
      state = next;
    }
    async function handle(path, method = 'GET', data = {}) {
      const url = new URL(path, 'https://demo.invalid');
      const p = url.pathname;
      try {
        if (p === '/api/status' && method === 'GET') return response({
          ok: true, provider: 'mock', model: '预置案例', has_key: false,
          data_source: { id: 'browser-preset', label: '浏览器案例', book_count: 1, read_only: false },
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
            return response({ ok: false, error: '仅支持当前预置卷册' }, 400);
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
          return response({ ok: true, pinyin: { '甘草': 'gān cǎo', '炮製甘草': 'pào zhì gān cǎo' }[text] || '' });
        }
        if (p.startsWith('/api/text-references/') && method === 'GET') return response({ ok: true, items: [] });
        if (p === '/api/model-runs' && method === 'GET') return response({ ok: true, records: [], runs: [] });
        if (p === '/api/log-client-error' && method === 'POST') return response({ ok: true, demo: true });
        return response({ ok: false, error: '此在线 Demo 提供预置案例体验；完整功能请在本地运行标注系统。' }, 501);
      } catch (_) {
        return response({ ok: false, error: '浏览器未能保存此次修改，请导出或重置案例后重试。' }, 507);
      }
    }
    return { handle, snapshot: () => clone(state), reset: () => { storage.removeItem(KEY); state = clone(fixture.state); } };
  }
  root.DemoStore = { createStore, KEY };
  if (typeof module !== 'undefined') module.exports = root.DemoStore;
})(globalThis);
