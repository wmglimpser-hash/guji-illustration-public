/* 医图志 — 展示站（hash 路由，纯静态）
   数据源：data/（标注台导出的、已经核准公开的数据）。 */
'use strict';

const $ = s => document.querySelector(s);
const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
};

let DATA = [];        // 标注记录（归一化后）
let BOOKS = [];       // 书籍元数据
let MANIFEST = null;  // 导出清单（数据版本）
let FEATURED = null;  // 精选清单（可选，data/featured.json）
let MODE = 'empty'; // 'data' 正式导出 | 'empty' 无公开数据
const DATA_CACHE_VERSION = '20260811c';

/* 公开代码镜像不附带扫描图；正式 data 记录自带 page_image/page_thumb。 */
const SAMPLE_PAGE_IMG = {};

const bookOf = d => BOOKS.find(b => b.id === d.book.id) || BOOKS[0] || { title: d.book.title, dynasty: d.book.dynasty };
const hasVideo = d => !!(d.video && d.video.available !== false && d.video.src);
const labelOf = v => (v || '未分类').trim();
const categoryLabel = d => [d?.class, d?.subclass].map(x => (x || '').trim()).filter(Boolean).join(' · ') || '未分类';

// 展示主标题统一口径：name(=illustrationName||subject) 优先，回退 subject，与标注台对齐。
const displayName = d => ((d && (d.name || d.subject)) || '').trim() || '（未命名插图）';
const displayPinyin = d => ((d && d.name_pinyin) || '').trim();
const mergedItems = d => Array.isArray(d?.merged_items) && d.merged_items.length > 1
  ? d.merged_items
  : [{ file: d?.file, page_num: d?.page_num, crop_rect: d?.crop_rect, page_image: d?.page_image }];
const primaryFile = d => mergedItems(d)[0]?.file || d?.file || '';
// 名称 + 灰字小拼音 DOM 片段；无拼音退化为纯文本节点（调用处行为不变）。
function nameWithPinyin(d) {
  const name = displayName(d), py = displayPinyin(d);
  if (!py) return document.createTextNode(name);
  return el('span', { class: 'name-py', style: 'display:inline-flex; align-items:baseline; gap:6px; flex-wrap:wrap;' },
    el('span', null, name),
    el('span', { class: 'py', style: 'font-size:0.7em; color:var(--ink-mute,#9aa7b5); font-weight:400; letter-spacing:.3px;' }, py));
}

function safeDecodeHash(raw) {
  try { return decodeURIComponent(raw); }
  catch (_) { return raw; }
}

function dynastiesLabel() {
  const names = [...new Set(BOOKS.map(b => b.dynasty).filter(Boolean))];
  if (!names.length) return '古籍';
  return names.length === 1 ? names[0] : `${names.slice(0, 2).join('、')}${names.length > 2 ? '等' : ''}`;
}

function corpusTitle() {
  if (!BOOKS.length) return '医图志';
  const titles = BOOKS.map(b => (b.title || '').trim()).filter(Boolean);
  if (titles.length === 1) return titles[0];
  // 多卷同一部书：剥掉「（卷N）」「卷N」等卷次后缀，若同源则用书名（卷数由副标题展示）；
  // 多部不同书：用通用标题。不写死任何具体书名/卷数，后续上传新书自动适配。
  // 剥掉结尾卷次后缀：「（卷1）」「卷1」「（卷上）」「卷下」「卷首」等（带或不带括号）。
  const baseName = t => t
    .replace(/\s*[（(]?\s*卷[上中下首末一二三四五六七八九十百千零〇\d]+\s*[)）]?\s*$/, '')
    .trim();
  const bases = [...new Set(titles.map(baseName).filter(Boolean))];
  if (bases.length === 1) return bases[0];
  return '中医古籍插图活化展示';
}

function annotationText(d, key, fallback = '') {
  const v = d?.annotation?.[key];
  if (Array.isArray(v)) return v.filter(Boolean).join(' ');
  if (v && typeof v === 'object') return Object.values(v).filter(Boolean).join(' ');
  return (v || fallback || '').toString();
}

function featuredScore(d) {
  let score = 0;
  if (d.page_image) score += 12;
  if (annotationText(d, 'quote').length > 20) score += 10;
  if ((annotationText(d, 'description') || annotationText(d, 'summary')).length > 20) score += 8;
  if (d.subclass === '药物炮制图') score += 8;
  if (d.subclass === '药物形态图') score += 5;
  return score;
}

function featuredItems(limit = 28) {
  const ids = FEATURED?.item_ids || FEATURED?.items?.map(x => x.image_id) || [];
  const byId = new Map(DATA.map(d => [d.image_id, d]));
  const fromFile = ids.map(id => byId.get(id)).filter(Boolean);
  if (fromFile.length) return fromFile;
  const byBook = new Map();
  const bySub = new Map();
  const picked = [];
  const list = DATA
    .slice()
    .sort((a, b) => featuredScore(b) - featuredScore(a) || a.page_num - b.page_num);
  for (const d of list) {
    const bookCount = byBook.get(d.book.id) || 0;
    const subCount = bySub.get(d.subclass) || 0;
    const subLimit = d.subclass === '药物炮制图' ? 12 : d.subclass === '药物形态图' ? 16 : 4;
    if (bookCount >= 10 || subCount >= subLimit) continue;
    picked.push(d);
    byBook.set(d.book.id, bookCount + 1);
    bySub.set(d.subclass, subCount + 1);
    if (picked.length >= limit) break;
  }
  return picked;
}

/* 图片渐显：纸色占位 → 墨色渐显 */
function fadeImg(src, attrs = {}) {
  const img = el('img', { src, loading: 'lazy', ...attrs });
  if (img.complete) img.classList.add('loaded');
  else img.addEventListener('load', () => img.classList.add('loaded'));
  return img;
}

/* ============ 路由 ============ */
function route() {
  const hash = location.hash || '#/';
  const app = $('#app');
  const render = () => {
    app.innerHTML = '';
    closeReader(); closeLightbox();
    if (hash.startsWith('#/item/')) renderDetail(safeDecodeHash(hash.slice(7)));
    else if (hash.startsWith('#/gallery')) renderGallery();
    else if (hash.startsWith('#/featured')) renderFeatured();
    else if (hash.startsWith('#/about')) renderAbout();
    else renderHome();
    document.querySelectorAll('.site-nav a').forEach(a => {
      const k = a.dataset.nav;
      a.classList.toggle('on',
        (k === 'home' && (hash === '#/' || hash === '')) ||
        (k === 'gallery' && (hash.startsWith('#/gallery') || hash.startsWith('#/item/'))) ||
        (k === 'featured' && hash.startsWith('#/featured')) ||
        (k === 'about' && hash.startsWith('#/about')));
    });
  };
  const resetScroll = () => requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  if (document.startViewTransition) {
    document.startViewTransition(render).finished.then(resetScroll, resetScroll);
  } else {
    render();
    resetScroll();
  }
}

/* ============ 书架（首页） ============ */
function renderHome() {
  const main = BOOKS[0] || { title: '—', dynasty: '', note: '' };
  const videoCount = DATA.filter(hasVideo).length;
  // 首页总封面应展示卷册题签/封面；不要把第一条插图页误当成整站封面。
  const coverItem = DATA.find(d => d.book?.id === main.id && d.page_image) || DATA.find(d => d.page_image);
  const cover = MODE === 'empty'
    ? null
    : ((MODE === 'data' && main.cover) ? main.cover : (coverItem?.page_image || SAMPLE_PAGE_IMG[1]));
  const classCount = new Set(DATA.map(d => d.class).filter(Boolean)).size;
  const intro = BOOKS.length > 1
    ? `本站展示 ${BOOKS.length} 个卷册的已确认插图与语义标注，涵盖${classCount || '多'}类图像，可回到原书页查证图像的原始语境。`
    : (main.note || '本站展示经人工审核确认的古籍插图与语义标注，可回到原书页查证图像的原始语境。');
  const home = el('div', null);
  home.appendChild(
    el('section', { class: 'hero' },
      el('div', { class: 'hero-cover rise' }, cover ? fadeImg(cover, { alt: '卷首', class: 'loaded' }) : null),
      el('div', null,
        el('div', { class: 'hero-kicker rise' }, '中医古籍插图 · 数字展示'),
        el('h1', { class: 'rise', style: 'animation-delay:.06s' }, corpusTitle()),
        el('div', { class: 'dynasty rise', style: 'animation-delay:.12s' },
          `古籍插图${BOOKS.length > 1 ? ` · 共 ${BOOKS.length} 卷` : ''}`),
        el('p', { class: 'intro rise', style: 'animation-delay:.18s' }, intro),
        el('div', { class: 'hero-stats rise', style: 'animation-delay:.24s' },
          el('div', null, el('div', { class: 'n' }, String(DATA.length)),
            el('div', { class: 'l' }, MODE === 'empty' ? '等待导入公开数据' : '已确认插图')),
          el('div', null, el('div', { class: 'n' }, String(BOOKS.length)), el('div', { class: 'l' }, '收录卷册')),
        ),
        el('div', { class: 'hero-actions rise', style: 'animation-delay:.3s' },
          el('a', { class: 'btn-ink', href: '#/gallery' }, '进入插图'),
          el('a', { class: 'btn-line hero-link', href: '#/featured', style: 'padding:12px 34px; font-size:15px; letter-spacing:4px;' }, '看精选案例'),
        ),
      ),
    ));
  if (BOOKS.length) {
    const shelf = el('section', { class: 'book-shelf rise', style: 'animation-delay:.36s' },
      el('div', { class: 'section-kicker' }, '收录卷册'),
      el('div', { class: 'book-grid' },
        BOOKS.map((book, i) => {
          const count = DATA.filter(d => d.book.id === book.id).length || book.illustration_count || 0;
          const first = DATA.find(d => d.book.id === book.id);
          const coverSrc = book.cover || first?.file || SAMPLE_PAGE_IMG[1];
          return el('button', {
            class: 'book-card',
            style: `animation-delay:${Math.min(i * 60, 360)}ms`,
            onclick: () => { galleryBook = book.id; galleryFilter = '全部'; location.hash = '#/gallery'; },
          },
            coverSrc ? el('span', { class: 'book-cover' }, fadeImg(coverSrc, { alt: book.title, class: 'loaded' })) : null,
            el('span', { class: 'book-meta' },
              el('span', { class: 'book-title' }, book.title),
              el('span', { class: 'book-sub' }, `${count} 幅插图${book.total_pages ? ` · ${book.total_pages} 页` : ''}`),
            ),
          );
        })
      )
    );
    home.appendChild(shelf);
  }
  $('#app').appendChild(home);
}

/* ============ 画廊 ============ */
let galleryFilter = '全部';
let galleryBook = '';
let gallerySearch = '';
let galleryLimit = 60;
function renderGallery() {
  const wrap = el('div', { class: 'page-wrap' });
  wrap.appendChild(el('h1', { class: 'page-title rise' }, '插图'));
  const verTag = MANIFEST ? `数据版本 ${MANIFEST.exported_at.slice(0, 10)}` : '';
  if (verTag) wrap.appendChild(el('div', { class: 'page-sub rise' }, verTag));

  // 网格容器 + 计数：筛选变化时只重渲染这里，不重建整页（保住搜索框焦点）
  const countEl = el('div', { class: 'page-sub rise', style: 'margin-top:-6px;' });
  const gridHost = el('div');

  // 一组按钮型筛选；value 为内部值，label 为展示，selected 比较用 getter
  const chipGroup = (label, options, getCur, setCur) => {
    const row = el('div', { class: 'filter-row rise' });
    if (label) row.appendChild(el('span', { class: 'filter-label' }, label));
    options.forEach(o => row.appendChild(el('button', {
      class: 'filter-chip' + (getCur() === o.value ? ' on' : ''),
      onclick: () => { setCur(o.value); applyFilters(true); },
    }, o.label)));
    return row;
  };

  const cats = ['全部', ...[...new Set(DATA.map(d => d.class).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))];
  // 类型 + 书目
  const typeRow = chipGroup('类型',
    cats.map(c => ({ value: c, label: c === '全部' ? '全部' : `${c} ${DATA.filter(d => d.class === c).length}` })),
    () => galleryFilter, v => { galleryFilter = v; });
  if (BOOKS.length > 1) {
    typeRow.appendChild(el('span', { style: 'width:1px; background:var(--line); margin:0 4px;' }));
    typeRow.appendChild(el('span', { class: 'filter-label', style: 'min-width:auto;' }, '卷册'));
    typeRow.appendChild(el('select', {
      class: 'filter-select',
      onchange: e => { galleryBook = e.target.value; applyFilters(true); },
    },
      el('option', { value: '', ...(galleryBook === '' ? { selected: '' } : {}) }, '全部卷册'),
      ...BOOKS.map(b => el('option', { value: b.id, ...(galleryBook === b.id ? { selected: '' } : {}) }, b.short_title || b.title)),
    ));
  }
  wrap.appendChild(typeRow);
  // 名称、对象、书名搜索
  const searchRow = el('div', { class: 'filter-row rise' },
    el('span', { class: 'filter-label' }, '搜索'));
  const searchInput = el('input', {
    class: 'filter-search', type: 'search', placeholder: '搜索插图名称、对象或书名…', value: gallerySearch,
    oninput: e => { gallerySearch = e.target.value; applyFilters(true); },
  });
  searchRow.appendChild(searchInput);
  wrap.appendChild(searchRow);

  wrap.appendChild(countEl);
  wrap.appendChild(gridHost);
  $('#app').appendChild(wrap);

  function applyFilters(resetLimit = false) {
    if (resetLimit) galleryLimit = 60;
    const q = gallerySearch.trim().toLowerCase();
    const list = DATA.filter(d => {
      if (!(galleryFilter === '全部' || d.class === galleryFilter)) return false;
      if (galleryBook && d.book.id !== galleryBook) return false;
      if (q) {
        const a = d.annotation || {};
        const hay = `${d.name || ''} ${d.subject || ''} ${d.book?.title || ''} ${a.description || ''} ${a.quote || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    countEl.textContent = `共 ${list.length} 幅` + (list.length !== DATA.length ? `（全部 ${DATA.length}）` : '');
    gridHost.innerHTML = '';
    const grid = el('div', { class: 'gallery-grid' });
    list.slice(0, galleryLimit).forEach((d, i) => {
      const img = fadeImg(primaryFile(d), { alt: displayName(d) });
      // 图文互证/置信度属内部审核属性，公开画廊卡不展示（保留为筛选维度，详情页仍呈现）。
      const card = el('div', {
        class: 'g-card rise', style: `animation-delay:${Math.min(i * 60, 480)}ms`,
        onclick: () => { img.style.viewTransitionName = 'hero-img'; location.hash = `#/item/${d.image_id}`; },
      },
        el('div', { class: 'frame' },
          img,
          el('div', { class: 'tag' + (hasVideo(d) ? ' video' : '') },
            mergedItems(d).length > 1 ? `合并图 ${mergedItems(d).length}` : (hasVideo(d) ? 'AI 演示' : labelOf(d.subclass))),
        ),
        el('div', { class: 'cap' },
          el('div', { class: 'name' }, displayName(d)),
          el('div', { class: 'g-badges' }, el('span', { class: 'g-badge' },
            [d.class, d.subclass].map(x => (x || '').trim()).filter(Boolean).join(' · ') || '未分类')),
          el('div', { class: 'meta' }, `${d.book.title} · 第 ${d.page_num} 页`),
        ));
      grid.appendChild(card);
    });
    gridHost.appendChild(grid);
    if (galleryLimit < list.length) {
      gridHost.appendChild(el('div', { class: 'gallery-more' },
        el('button', { class: 'btn-line', onclick: () => { galleryLimit += 60; applyFilters(); } },
          `加载更多（还有 ${list.length - galleryLimit} 幅）`)));
    }
    if (!list.length) gridHost.appendChild(el('p', { style: 'color:var(--ink-mute)' }, '当前筛选下暂无插图。'));
  }
  applyFilters();
}

/* ============ 精选案例 ============ */
function renderFeatured() {
  const items = featuredItems();
  const wrap = el('div', { class: 'page-wrap featured-wrap' },
    el('h1', { class: 'page-title rise' }, '精选案例'),
    el('div', { class: 'featured-stats rise', style: 'animation-delay:.12s' },
      el('span', null, `全量 ${DATA.length} 条`),
      el('span', null, `${items.filter(d => d.subclass === '药物形态图').length} 条形态图`),
      el('span', null, `${items.filter(d => d.subclass === '药物炮制图').length} 条炮制图`),
      MANIFEST ? el('span', null, `导出 ${MANIFEST.exported_at.slice(0, 10)}`) : null,
    ),
    el('div', { class: 'featured-actions rise', style: 'animation-delay:.14s; margin:14px 0 2px;' },
      el('button', { class: 'btn-line', style: 'font-size:13px; padding:6px 16px; letter-spacing:1px;', onclick: () => startSlideshow(items) }, '▶ 开始放映')),
    el('div', { class: 'featured-grid' },
      items.map((d, i) => renderFeaturedCard(d, i)))
  );
  $('#app').appendChild(wrap);
}

/* ============ 放映模式（最小版：自动翻页 + crossfade + 键盘控制） ============ */
let _slideTimer = null;
function startSlideshow(items, startAt = 0) {
  if (!items || !items.length) return;
  const INTERVAL = 1000;  // 自动放映，1s 切换
  let idx = startAt, paused = false;

  const imgWrap = el('div', { class: 'ss-img' });
  const copy = el('div', { class: 'ss-copy' });
  const barFill = el('div', { class: 'ss-bar-fill' });
  const counter = el('div', { class: 'ss-counter' });
  const overlay = el('div', { class: 'slideshow' },
    el('button', { class: 'ss-close', title: '退出 (Esc)', onclick: () => close() }, '✕'),
    el('button', { class: 'ss-nav ss-prev', title: '上一张 (←)', onclick: () => next(-1) }, '‹'),
    el('div', { class: 'ss-stage' }, imgWrap, copy),
    el('button', { class: 'ss-nav ss-next', title: '下一张 (→)', onclick: () => next(1) }, '›'),
    el('div', { class: 'ss-bar' }, barFill),
    counter,
    el('div', { class: 'ss-hint' }, '自动放映 · ‹ › / ← → 切换 · 空格 暂停 · Esc 退出'),
  );
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  function render() {
    const d = items[idx];
    const img = el('img', { class: 'ss-photo', src: primaryFile(d), alt: displayName(d) });
    const summary = annotationText(d, 'description') || annotationText(d, 'summary');
    const quote = annotationText(d, 'quote');
    const inner = el('div', { class: 'ss-copy-inner' },
      el('div', { class: 'ss-kicker' }, `${d.book.title} · 第 ${d.page_num} 页`),
      el('h2', null, nameWithPinyin(d)),
      el('div', { class: 'd-badges' },
        el('span', { class: 'g-badge' }, categoryLabel(d))),
      summary ? el('p', null, summary.length > 120 ? summary.slice(0, 120) + '…' : summary) : null,
      quote ? el('blockquote', null, quote.length > 90 ? quote.slice(0, 90) + '…' : quote) : null,
    );
    imgWrap.innerHTML = ''; imgWrap.appendChild(img);
    copy.innerHTML = ''; copy.appendChild(inner);
    requestAnimationFrame(() => { img.classList.add('show'); inner.classList.add('show'); });
    counter.textContent = `${idx + 1} / ${items.length}`;
    const nx = items[(idx + 1) % items.length]; if (nx) { const p = new Image(); p.src = nx.file; }
    restartBar();
  }
  function restartBar() {
    barFill.style.transition = 'none'; barFill.style.width = '0%';
    requestAnimationFrame(() => { if (!paused) { barFill.style.transition = `width ${INTERVAL}ms linear`; barFill.style.width = '100%'; } });
  }
  function next(step = 1) { idx = (idx + step + items.length) % items.length; render(); resetTimer(); }
  function resetTimer() { clearInterval(_slideTimer); if (!paused) _slideTimer = setInterval(() => next(1), INTERVAL); }
  function togglePause() {
    paused = !paused;
    overlay.classList.toggle('paused', paused);
    if (paused) { clearInterval(_slideTimer); barFill.style.transition = 'none'; barFill.style.width = getComputedStyle(barFill).width; }
    else { restartBar(); resetTimer(); }
  }
  function close() { clearInterval(_slideTimer); document.removeEventListener('keydown', onKey); overlay.remove(); document.body.style.overflow = ''; }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'ArrowRight') next(1);
    else if (e.key === 'ArrowLeft') next(-1);
  }
  document.addEventListener('keydown', onKey);
  render(); resetTimer();
}

function renderFeaturedCard(d, i) {
  const summary = annotationText(d, 'description') || annotationText(d, 'summary');
  const quote = annotationText(d, 'quote');
  return el('article', {
    class: 'featured-card rise',
    style: `animation-delay:${Math.min(160 + i * 45, 760)}ms`,
    onclick: () => { location.hash = `#/item/${d.image_id}`; },
  },
    el('div', { class: 'featured-media' },
      fadeImg(primaryFile(d), { alt: displayName(d) }),
      el('span', { class: 'featured-rank' }, String(i + 1).padStart(2, '0')),
    ),
    el('div', { class: 'featured-copy' },
      el('div', { class: 'kicker' }, `${d.book.title} · 第 ${d.page_num} 页`),
      el('h2', null, nameWithPinyin(d)),
      el('div', { class: 'd-badges' },
        el('span', { class: 'g-badge' }, categoryLabel(d)),
      ),
      summary ? el('p', null, summary.length > 86 ? summary.slice(0, 86) + '…' : summary) : null,
      quote ? el('blockquote', null, quote.length > 72 ? quote.slice(0, 72) + '…' : quote) : null,
    ),
  );
}

/* ============ 详情 ============ */
function railPages(d) {
  /* 详情只显示当前页附近，避免每次创建整卷全部缩略图。 */
  if (MODE === 'data') {
    const total = bookOf(d).total_pages || 0;
    const current = Number(d.page_num || 1);
    const start = Math.max(1, current - 5);
    const end = Math.min(total || current, current + 5);
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);
  }
  return [...new Set(DATA.map(x => x.page_num))].sort((a, b) => a - b);
}
function pageThumbSrc(d, p) {
  if (MODE === 'data') return `data/page_thumbs/${d.book.id}_p${p}.jpg`;
  return SAMPLE_PAGE_IMG[p] || null;
}

function renderDetail(id) {
  const d = DATA.find(x => x.image_id === id);
  if (!d) { location.hash = '#/gallery'; return; }
  const bookItems = DATA.filter(x => x.book.id === d.book.id);
  const globalIdx = DATA.findIndex(x => x.image_id === d.image_id);
  const prev = DATA[globalIdx - 1], next = DATA[globalIdx + 1];

  /* 缩略图轨 */
  const rail = el('div', { class: 'rail rise' });
  for (const p of railPages(d)) {
    const item = bookItems.find(x => x.page_num === p);
    const thumb = pageThumbSrc(d, p);
    let inner;
    if (thumb) {
      inner = fadeImg(thumb, { alt: `第${p}页`, class: 'loaded' });
      inner.addEventListener('error', () => {
        inner.replaceWith(el('div', { class: 'ph' }, item ? displayName(item).slice(0, 4) : ''));
      });
    } else {
      inner = el('div', { class: 'ph' }, item ? displayName(item).slice(0, 4) : '');
    }
    rail.appendChild(el('div', {
      class: 'rail-tile' + (p === d.page_num ? ' cur' : '') + (item ? '' : ' dim'),
      title: `第 ${p} 页` + (item ? ` · ${displayName(item)}` : ''),
      onclick: () => { if (item) location.hash = `#/item/${item.image_id}`; },
    }, inner, el('div', { class: 'pn' }, `p.${p}`)));
  }

  /* 主图列（图 / 视频切换） */
  const stage = el('div', { class: 'd-stage rise', style: 'animation-delay:.05s' });
  const frame = el('div', { class: 'd-frame' });
  const mainImg = fadeImg(primaryFile(d), { alt: displayName(d) });
  mainImg.style.viewTransitionName = 'hero-img';
  const renderImageMedia = () => {
    const items = mergedItems(d);
    if (items.length <= 1) return mainImg;
    return el('div', {
      style: 'width:100%; height:100%; display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; align-items:center; justify-items:center; padding:16px; overflow:auto;'
    }, items.map((item, idx) => el('div', {
        style: 'width:100%; height:100%; min-height:280px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;'
      },
        fadeImg(item.file, { alt: `${displayName(d)}-${idx + 1}`, style: 'max-width:100%; max-height:520px; object-fit:contain;' }),
        el('span', { style: 'font-size:12px; color:var(--ink-mute); letter-spacing:1px;' }, `合并图 ${idx + 1} · 第 ${item.page_num || '—'} 页`)
      )));
  };
  const appendFrameNav = () => {
    if (prev) frame.appendChild(el('button', {
      class: 'frame-nav prev',
      title: `上一张：${prev.book.title} · ${displayName(prev)}`,
      onclick: e => { e.stopPropagation(); location.hash = `#/item/${prev.image_id}`; },
    }, '‹'));
    if (next) frame.appendChild(el('button', {
      class: 'frame-nav next',
      title: `下一张：${next.book.title} · ${displayName(next)}`,
      onclick: e => { e.stopPropagation(); location.hash = `#/item/${next.image_id}`; },
    }, '›'));
  };
  frame.appendChild(renderImageMedia());
  appendFrameNav();

  const toggleBtns = [];
  function setMode(m) {
    frame.innerHTML = '';
    if (m === 'img') {
      frame.appendChild(renderImageMedia());
      mainImg.classList.add('loaded');
      appendFrameNav();
    } else {
      const videoSrc = d.video?.src;
      const vid = el('video', { src: videoSrc, poster: primaryFile(d), controls: '', preload: 'none',
        style: 'width:100%; opacity:1;' });
      let failed = false;
      vid.addEventListener('error', () => {
        if (failed) return; failed = true;
        frame.innerHTML = '';
        const poster = fadeImg(primaryFile(d), { alt: displayName(d), class: 'loaded', style: 'filter:saturate(.7) brightness(.85)' });
        frame.appendChild(poster);
        frame.appendChild(el('div', { class: 'video-pending' },
          el('div', { class: 'play' }, '▶'),
          el('div', { class: 'note' }, 'AI 演示视频尚未生成 · 占位态'),
          el('div', { class: 'ai-badge', style: 'border-color:var(--paper); color:var(--paper)' }, 'AI 生成')));
      });
      frame.appendChild(vid);
      frame.appendChild(el('div', { class: 'ai-corner ai-badge' }, 'AI 生成'));
      appendFrameNav();
    }
    toggleBtns.forEach(b => b.classList.toggle('on', b.dataset.m === m));
  }
  if (hasVideo(d)) {
    const tg = el('div', { class: 'media-toggle' });
    [['img', '插圖'], ['video', '演示視頻']].forEach(([m, label]) => {
      const b = el('button', { 'data-m': m, class: m === 'img' ? 'on' : '', onclick: () => setMode(m) }, label);
      toggleBtns.push(b); tg.appendChild(b);
    });
    stage.appendChild(tg);
  }
  stage.appendChild(frame);
  stage.appendChild(el('div', { class: 'd-actions' },
    el('button', { class: 'btn-line', onclick: () => openReader(d) }, '☰ 查看原书页'),
    el('button', { class: 'btn-line', onclick: () => openLightbox(primaryFile(d)) }, '⤢ 放大插图'),
  ));

  /* 信息列 */
  const a = d.annotation || {};
  const description = a.description || a.summary || '';
  const info = el('div', { class: 'd-info rise', style: 'animation-delay:.1s' },
    el('div', { class: 'kicker' }, categoryLabel(d) + (hasVideo(d) ? ' · 配 AI 演示' : '')),
    el('h1', null, nameWithPinyin(d)),
    el('div', { class: 'sub' }, `${d.book.title} · 第 ${d.page_num} 页`),
    mergedItems(d).length > 1 ? el('div', { class: 'd-field' },
      el('div', { class: 'k' }, '合并图'),
      el('div', { class: 'v' }, mergedItems(d).map((item, idx) => `图${idx + 1}：第 ${item.page_num || '—'} 页`).join('；'))) : null,
    description ? el('div', { class: 'd-field' },
      el('div', { class: 'k' }, '画面描述'),
      el('div', { class: 'v' }, description)) : null,
    a.quote ? el('div', { class: 'd-field' },
      el('div', { class: 'k' }, '对应原文'),
      el('div', { class: 'd-quote' }, a.quote)) : null,
    el('div', { class: 'd-nav-row' },
      prev ? el('a', { href: `#/item/${prev.image_id}` }, `← ${displayName(prev)}`) : el('span'),
      next ? el('a', { href: `#/item/${next.image_id}` }, `${displayName(next)} →`) : el('span'),
    ));

  $('#app').appendChild(el('div', { class: 'detail-wrap' }, rail, stage, info));

  requestAnimationFrame(() => {
    const cur = rail.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  });
}

/* ============ 阅读器：原书页 + 插图高亮 ============ */
function readerPageSrc(d) {
  if (d.page_image) return d.page_image;                      // data 模式：导出自带
  return SAMPLE_PAGE_IMG[d.page_num] || null;
}
function openReader(d) {
  const reader = $('#reader');
  reader.innerHTML = '';
  reader.hidden = false;
  document.body.classList.add('modal-open');
  const card = el('div', { class: 'reader-card' });
  const src = readerPageSrc(d);

  if (src) {
    const pg = el('div', { class: 'pg' });
    const img = el('img', { src, alt: `第${d.page_num}页` });
    pg.appendChild(img);
    img.addEventListener('load', () => {
      const r = d.crop_rect;
      if (r) {
        pg.appendChild(el('div', {
          class: 'hl-box',
          style: `left:${r.x * 100}%; top:${r.y * 100}%; width:${Math.min(r.w, 1 - r.x) * 100}%; height:${Math.min(r.h, 1 - r.y) * 100}%;`,
        }));
      }
    });
    card.appendChild(pg);
  } else {
    card.appendChild(el('div', { class: 'reader-missing' },
      `暂无第 ${d.page_num} 页的原书页图像。`, el('br'),
      '标注台前端打开过该页后会生成高清缓存，重新导出即可；后续版本由 pdf.js 直接渲染原书 PDF。'));
  }
  card.appendChild(el('div', { class: 'reader-cap' },
    el('span', null, `${d.book.title} · 第 ${d.page_num} 页 · 朱框为插图位置`),
    el('button', { class: 'reader-close', onclick: closeReader }, '关闭 ✕')));
  reader.appendChild(card);
  reader.onclick = e => { if (e.target === reader) closeReader(); };
}
function closeReader() { const r = $('#reader'); r.hidden = true; r.innerHTML = ''; document.body.classList.remove('modal-open'); }

/* ============ 灯箱 ============ */
function openLightbox(src) {
  const lb = $('#lightbox');
  lb.innerHTML = '';
  lb.hidden = false;
  document.body.classList.add('modal-open');
  lb.appendChild(el('img', { src }));
  lb.onclick = closeLightbox;
}
function closeLightbox() { const lb = $('#lightbox'); lb.hidden = true; lb.innerHTML = ''; document.body.classList.remove('modal-open'); }

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeReader(); closeLightbox(); } });

/* ============ 关于 ============ */
function renderAbout() {
  const main = BOOKS[0] || {};
  $('#app').appendChild(el('div', { class: 'about-wrap rise' },
    el('h1', null, '关于本站'),
    el('p', null, '本站为中医古籍插图语义标注研究的展示站。插图与标注数据来自标注工作台导出的已确认（人工审核）记录。'),
    MANIFEST ? el('p', { style: 'font-family:var(--f-sans); font-size:13px; color:var(--ink-mute);' },
      `数据版本：${MANIFEST.exported_at} · ${MANIFEST.count} 条已确认标注 · ` +
      MANIFEST.books.map(b => `《${b.title}》${b.count} 条`).join('、')) :
      el('p', { style: 'font-family:var(--f-sans); font-size:13px; color:var(--ink-mute);' },
        `当前为开发样例数据（${DATA.length} 条）。`),
    el('h2', null, '数据来源'),
    el('p', null, `${dynastiesLabel()}·《${main.title || ''}》${BOOKS.length > 1 ? ` 等 ${BOOKS.length} 卷` : ''}，网络公开的原书扫描版。古籍本身已属公有领域；扫描件来源于网络公开传播版本，本站为非营利学术展示，注明来源，如涉权益请联系下架。`),
    el('h2', null, 'AI 生成内容标识'),
    el('p', null, '部分炮制图配有 AI 生成的动态演示视频，相应位置均以「AI 生成」标识，依据《人工智能生成合成内容标识办法》要求显式标注。AI 视频仅为图像的动态演绎，不构成炮制工艺的权威复原。'),
    el('h2', null, '免责声明'),
    el('p', null, '本站内容仅供学术研究与文化传播，不构成任何医疗建议；古籍所载炮制方法请勿自行尝试。'),
  ));
}

/* ============ 启动：只读取经过核准的 data/ 导出 ============ */
async function loadJson(url) {
  const sep = url.includes('?') ? '&' : '?';
  const r = await fetch(`${url}${sep}v=${DATA_CACHE_VERSION}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
function prefixPaths(rec, prefix) {
  for (const k of ['file', 'page_image']) {
    if (rec[k]) rec[k] = prefix + rec[k];
  }
  if (Array.isArray(rec.merged_items)) {
    rec.merged_items.forEach(item => {
      for (const k of ['file', 'page_image']) {
        if (item[k]) item[k] = prefix + item[k];
      }
    });
  }
  if (hasVideo(rec)) rec.video.src = prefix + rec.video.src;
  return rec;
}
async function init() {
  try {
    /* 正式数据：标注台「导出到展示站」产物 */
    const [ills, books] = await Promise.all([
      loadJson('data/illustrations.json'),
      loadJson('data/books.json'),
    ]);
    DATA = ills.map(r => prefixPaths(r, 'data/'));
    BOOKS = books.map(b => {
      if (b.cover) b.cover = 'data/' + b.cover;
      return b;
    });
    MANIFEST = await loadJson('data/export_manifest.json').catch(() => null);
    FEATURED = await loadJson('data/featured.json').catch(() => null);
    MODE = 'data';
  } catch (_) {
    /* 公开代码镜像不附带真实数据或扫描图；以可解释的空状态启动。 */
    DATA = [];
    BOOKS = [];
    MANIFEST = null;
    FEATURED = null;
    MODE = 'empty';
  }
  window.addEventListener('hashchange', route);
  route();
}
init();
