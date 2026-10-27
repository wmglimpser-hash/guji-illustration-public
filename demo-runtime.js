(function () {
  'use strict';
  const store = DemoStore.createStore(DEMO_FIXTURE, localStorage);
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      let data = {};
      try { data = JSON.parse(init.body || '{}'); } catch (_) {}
      return store.handle(url.pathname + url.search, (init.method || 'GET').toUpperCase(), data);
    }
    if (url.origin === location.origin || ['data:', 'blob:'].includes(url.protocol)) return realFetch(input, init);
    throw new Error('案例体验仅使用本站预置资源');
  };
  const images = new Map();
  const cache = new Map();
  const ready = Promise.all([20, 21].map(page => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { images.set(page, image); resolve(); };
    image.onerror = () => reject(new Error('案例书页加载失败，请刷新重试'));
    image.src = `assets/page-${page}.jpg`;
  })));

  // Solve an output-to-source homography for the workbench's four-corner crop.
  function homography(quad) {
    const points = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const m = [];
    points.forEach(([x, y], i) => {
      const [u, v] = quad[i];
      m.push([x, y, 1, 0, 0, 0, -u*x, -u*y, u]);
      m.push([0, 0, 0, x, y, 1, -v*x, -v*y, v]);
    });
    for (let i = 0; i < 8; i++) {
      let pivot = i;
      for (let j = i + 1; j < 8; j++) if (Math.abs(m[j][i]) > Math.abs(m[pivot][i])) pivot = j;
      [m[i], m[pivot]] = [m[pivot], m[i]];
      const scale = m[i][i];
      if (Math.abs(scale) < 1e-10) throw new Error('裁图四角不能重叠');
      for (let k = i; k <= 8; k++) m[i][k] /= scale;
      for (let j = 0; j < 8; j++) if (j !== i) {
        const f = m[j][i];
        for (let k = i; k <= 8; k++) m[j][k] -= f * m[i][k];
      }
    }
    return m.map(row => row[8]);
  }
  function urlFor(bookId, page, rect, width, rotation = 0, quad = null) {
    if (bookId !== 'sample-juan3' || !images.has(Number(page))) return '';
    if (!rect && !quad) return `assets/page-${Number(page)}.jpg`;
    const key = JSON.stringify([page, rect, width, rotation, quad]);
    if (cache.has(key)) return cache.get(key);
    const image = images.get(Number(page));
    const r = rect || [Math.min(...quad.map(p => p[0])), Math.min(...quad.map(p => p[1])),
      Math.max(...quad.map(p => p[0])), Math.max(...quad.map(p => p[1]))];
    const sw = Math.max(1, (r[2] - r[0]) * image.naturalWidth);
    const sh = Math.max(1, (r[3] - r[1]) * image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.min(1600, width || sw));
    canvas.height = Math.max(1, Math.round(canvas.width * sh / sw));
    const ctx = canvas.getContext('2d');
    if (quad) {
      const source = document.createElement('canvas');
      source.width = image.naturalWidth; source.height = image.naturalHeight;
      const sc = source.getContext('2d'); sc.drawImage(image, 0, 0);
      const src = sc.getImageData(0, 0, source.width, source.height);
      const out = ctx.createImageData(canvas.width, canvas.height), h = homography(quad);
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const u = x / Math.max(1, canvas.width - 1), v = y / Math.max(1, canvas.height - 1);
        const z = h[6]*u + h[7]*v + 1;
        const sx = Math.max(0, Math.min(source.width - 1, Math.round((h[0]*u+h[1]*v+h[2])/z*source.width)));
        const sy = Math.max(0, Math.min(source.height - 1, Math.round((h[3]*u+h[4]*v+h[5])/z*source.height)));
        const si = (sy*source.width+sx)*4, di = (y*canvas.width+x)*4;
        out.data.set(src.data.subarray(si, si+4), di);
      }
      ctx.putImageData(out, 0, 0);
    } else {
      ctx.fillStyle = '#faf8f0'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width/2, canvas.height/2);
      ctx.rotate(-Number(rotation || 0) * Math.PI/180);
      ctx.drawImage(image, r[0]*image.naturalWidth, r[1]*image.naturalHeight, sw, sh,
        -canvas.width/2, -canvas.height/2, canvas.width, canvas.height);
    }
    const url = canvas.toDataURL('image/jpeg', .9);
    if (cache.size > 24) cache.clear();
    cache.set(key, url);
    return url;
  }
  window.Demo = { store, ready, urlFor };
})();
