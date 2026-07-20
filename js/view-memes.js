import { getAllMemes, getMediaSource, pickVideosDirectory, getVideosDirName, resolveMediaForDisplay, revokeBlobUrl, cleanupBlobCache, migrateFromLocalStorage, escapeHtml, showToast, createEl, emptyEl, FAVORITE_IDS_KEY } from './app.js';
import { hasConfig, syncToIndexedDB, startListener, onChange } from './firebase.js';
import { buildIndex, search } from './search.js';
import { activateVideo, toggleGreenScreen, initTrimmer, openFullscreen, observeLazyMedia, handleDragStart, closeFullscreen } from './player.js';
import { exportTrimmed, exportTransparent } from './export.js';
import { categories, audioExts, imageExts } from './categories.js';
import { trackView, trackDownload, getMostViewed, getMostDownloaded, getMostFavorited, getTrending } from './stats.js';
import { PER_PAGE, SEARCH_DEBOUNCE_MS } from './config.js';
import { initLanguage, createLangToggle } from './i18n.js';

initLanguage();

function sanitizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    return u.href;
  } catch {
    return '';
  }
}

let currentPage = 1;
let debounceTimer = null;
let activeCardIndex = -1;
let firstRenderDone = false;
let cacheReady = false;
const wavesurferInstances = new Map();

let approvedCache = [];

export async function getApprovedMemes() {
  const all = await getAllMemes();
  approvedCache = all.filter(m => m.status === 'approved');
  return approvedCache;
}

function getApprovedMemesSync() {
  return approvedCache.length ? approvedCache : (() => {
    try { return JSON.parse(localStorage.getItem('approvedMemes') || '[]'); } catch (e) { return []; }
  })();
}

async function loadMemesIntoCache() {
  approvedCache = await getApprovedMemes();
  cacheReady = true;
  return approvedCache;
}

function showGridSkeleton(grid) {
  for (let i = 0; i < 6; i++) {
    grid.appendChild(createEl('div', { className: 'meme-card skeleton-card skeleton' }, [
      createEl('div', { className: 'skeleton' }, []),
      createEl('div', { className: 'skeleton skeleton-text' }, []),
      createEl('div', { className: 'skeleton skeleton-chip' }, [])
    ]));
  }
}

async function refreshMemesView() {
  await loadMemesIntoCache();
  renderCategoryOptions();
  renderMemes();
}

function getFavoriteIds() {
  try { return (JSON.parse(localStorage.getItem(FAVORITE_IDS_KEY)) || []).map(String); } catch (e) { return []; }
}

function toggleFavorite(id) {
  const favs = getFavoriteIds();
  const sid = String(id);
  const next = favs.includes(sid) ? favs.filter(i => i !== sid) : [...favs, sid];
  try { localStorage.setItem(FAVORITE_IDS_KEY, JSON.stringify(next)); } catch (e) { alert('Storage full.'); }
  renderMemes();
}

function handleCopyPath(id) {
  const m = getApprovedMemesSync().find(x => String(x.id) === String(id));
  if (!m) return;
  navigator.clipboard.writeText(getMediaSource(m)).then(() => showToast('Path copied!')).catch(() => alert('Copy failed.'));
}

function handleDownload(event, id) {
  event.preventDefault();
  const m = getApprovedMemesSync().find(x => String(x.id) === String(id));
  if (!m) return;
  trackDownload(id);
  const src = sanitizeUrl(getMediaSource(m)) || getMediaSource(m);
  const a = createEl('a', { href: src, download: m.name, target: '_blank' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function renderCategoryOptions() {
  const cf = document.getElementById('categoryFilter');
  const cur = cf.value;
  emptyEl(cf);
  cf.appendChild(createEl('option', { value: '' }, ['All Categories']));
  categories.forEach(c => {
    const opt = createEl('option', { value: c }, [c]);
    if (c === cur) opt.selected = true;
    cf.appendChild(opt);
  });
}

function destroyWaveforms() {
  wavesurferInstances.forEach(ws => { try { ws.destroy(); } catch (e) { console.warn('WaveSurfer destroy failed:', e); } });
  wavesurferInstances.clear();
}

function renderPagination(total) {
  const controls = document.getElementById('paginationControls');
  const pageInfo = document.getElementById('pageInfo');
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  controls.classList.toggle('hidden', total <= PER_PAGE);
  pageInfo.textContent = 'Page ' + currentPage + ' of ' + totalPages + ' (' + total + ' memes)';
  document.getElementById('prevPageBtn').disabled = currentPage <= 1;
  document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

async function buildCard(meme, favIds, filtered) {
  const isFav = favIds.includes(String(meme.id));
  const ext = meme.name.split('.').pop().toLowerCase();
  const src = await resolveMediaForDisplay(meme);
  const sid = String(meme.id);
  const isVideo = !audioExts.includes(ext) && !imageExts.includes(ext);

  const card = createEl('div', { className: 'meme-card', dataset: { memeId: sid }, tabindex: '0' });
  const sourceLabel = meme.source === 'url' ? '🔗 Link' : '';
  if (sourceLabel) card.appendChild(createEl('span', { className: 'source-badge' }, [sourceLabel]));
  card.addEventListener('focus', () => {
    activeCardIndex = Array.from(document.querySelectorAll('.meme-card')).indexOf(card);
  });

  // Media wrap
  const mediaWrap = createEl('div', { className: 'media-wrap' });
  if (audioExts.includes(ext)) {
    const audioEl = createEl('audio', { 'data-lazy-src': src, controls: '', preload: 'metadata', playsinline: '' });
    audioEl.addEventListener('play', () => trackView(sid));
    mediaWrap.appendChild(audioEl);
  } else if (imageExts.includes(ext)) {
    const img = createEl('img', { 'data-lazy-src': src, alt: meme.name, draggable: 'true' });
    img.addEventListener('dragstart', e => handleDragStart(e, meme.name, src));
    mediaWrap.appendChild(img);
  } else if (meme.thumbnailUrl) {
    const img = createEl('img', { src: meme.thumbnailUrl, alt: meme.name });
    const po = createEl('div', { className: 'play-overlay' }, [
      createEl('span', { className: 'material-icons play-icon' }, ['play_circle_filled'])
    ]);
    mediaWrap.appendChild(img);
    mediaWrap.appendChild(po);
    mediaWrap.addEventListener('click', () => { trackView(sid); activateVideo(mediaWrap, src, sid); });
    addGreenScreenControls(mediaWrap);
  } else {
    const video = createEl('video', {
      'data-lazy-src': src, crossorigin: 'anonymous', muted: '', loop: '',
      controls: '', preload: 'metadata', playsinline: '', draggable: 'true'
    });
    video.addEventListener('play', () => trackView(sid));
    video.addEventListener('mouseenter', () => video.play());
    video.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
    video.addEventListener('dragstart', e => handleDragStart(e, meme.name, src));
    mediaWrap.appendChild(video);
    addGreenScreenControls(mediaWrap);
  }
  card.appendChild(mediaWrap);

  // Trimmer (video only)
  if (isVideo) {
    const trimmerWrap = createEl('div', { className: 'trimmer-wrap', id: 'trimmer-' + sid });
    const inRow = createEl('div', { className: 'trimmer-row' }, [
      createEl('label', {}, ['In']),
      createEl('input', { type: 'range', className: 'trim-in', min: '0', max: '10', value: '0', step: '0.1' }),
      createEl('span', { className: 'trim-in-val trim-val' }, ['0:00'])
    ]);
    const outRow = createEl('div', { className: 'trimmer-row' }, [
      createEl('label', {}, ['Out']),
      createEl('input', { type: 'range', className: 'trim-out', min: '0', max: '10', value: '10', step: '0.1' }),
      createEl('span', { className: 'trim-out-val trim-val' }, ['0:10'])
    ]);
    const trimActions = createEl('div', { className: 'trimmer-actions' });
    const exportTrimBtn = createEl('button', { className: 'export-trimmed-btn' }, ['Export Trimmed']);
    exportTrimBtn.addEventListener('click', () => exportTrimmed(sid, filtered));
    trimActions.appendChild(exportTrimBtn);
    const exportTransBtn = createEl('button', { className: 'export-transparent-btn' }, ['Export Transparent']);
    exportTransBtn.addEventListener('click', () => exportTransparent(sid, filtered));
    trimActions.appendChild(exportTransBtn);
    const exportProg = createEl('div', { className: 'export-progress' }, [
      createEl('span', {}, ['Exporting...']),
      createEl('div', { className: 'export-progress-bar' }, [
        createEl('div', { className: 'export-progress-fill' })
      ])
    ]);
    trimmerWrap.appendChild(inRow);
    trimmerWrap.appendChild(outRow);
    trimmerWrap.appendChild(trimActions);
    trimmerWrap.appendChild(exportProg);
    card.appendChild(trimmerWrap);
  }

  // Name
  card.appendChild(createEl('div', { className: 'status-text' }, [escapeHtml(meme.name)]));

  // Tags row
  card.appendChild(createEl('div', { className: 'tag-row' }, [
    createEl('span', { className: 'chip' }, [escapeHtml(meme.mediaType)]),
    createEl('span', { className: 'chip' }, [escapeHtml(meme.category)]),
    createEl('span', { className: 'chip' }, [escapeHtml(meme.specialTag)])
  ]));

  // Tag text
  card.appendChild(createEl('p', { className: 'tag-text' }, ['Tag: #' + escapeHtml(meme.tag)]));

  // Actions
  const actions = createEl('div', { className: 'actions' });

  const favBtn = createEl('button', { className: 'favorite-btn' + (isFav ? ' active' : ''), type: 'button' }, [
    createEl('span', { className: 'material-icons' }, [isFav ? 'favorite' : 'favorite_border']),
    ' ' + (isFav ? 'Favorited' : 'Favorite')
  ]);
  favBtn.addEventListener('click', () => toggleFavorite(sid));
  actions.appendChild(favBtn);

  const safeSrc = sanitizeUrl(src) || src;
  const openLink = createEl('a', { href: safeSrc, target: '_blank', rel: 'noopener' }, ['Open']);
  actions.appendChild(openLink);

  if (isVideo || audioExts.includes(ext)) {
    const fsBtn = createEl('button', { className: 'fullscreen-btn', type: 'button', title: 'Fullscreen' }, [
      createEl('span', { className: 'material-icons icon-fs' }, ['fullscreen'])
    ]);
    fsBtn.addEventListener('click', () => openFullscreen(src, meme.name));
    actions.appendChild(fsBtn);
  }

  const copyBtn = createEl('button', { className: 'copy-path-btn', type: 'button' }, ['Copy Path']);
  copyBtn.addEventListener('click', () => handleCopyPath(sid));
  actions.appendChild(copyBtn);

  const dlBtn = createEl('button', { className: 'download-btn', type: 'button' }, ['Download']);
  dlBtn.addEventListener('click', e => handleDownload(e, sid));
  actions.appendChild(dlBtn);

  const dragBtn = createEl('button', { className: 'drag-btn', type: 'button', draggable: 'true', title: 'Drag to NLE' }, ['Drag ↗']);
  dragBtn.addEventListener('dragstart', e => handleDragStart(e, meme.name, src));
  actions.appendChild(dragBtn);

  card.appendChild(actions);

  return card;
}

function addGreenScreenControls(wrap) {
  const gc = createEl('div', { className: 'green-screen-controls' });
  const gsBtn = createEl('button', { className: 'green-screen-btn', type: 'button' }, ['Apply Chroma Key']);
  gsBtn.addEventListener('click', e => { e.stopPropagation(); toggleGreenScreen(gsBtn); });
  gc.appendChild(gsBtn);
  const csw = createEl('div', { className: 'chroma-slider-wrap' }, [
    createEl('label', {}, ['Tolerance']),
    createEl('input', { type: 'range', min: '10', max: '110', value: '35' }),
    createEl('span', { className: 'chroma-val' }, ['35'])
  ]);
  gc.appendChild(csw);
  wrap.appendChild(gc);
}

async function renderMemes() {
  destroyWaveforms();
  const grid = document.getElementById('memeGrid');
  let memes = getApprovedMemesSync();
  const ac = memes.length;
  const favIds = getFavoriteIds();
  document.getElementById('approvedCount').textContent = 'Approved: ' + ac;
  document.getElementById('favoritesCount').textContent = 'Favorites: ' + favIds.length;

  if (ac === 0) {
    emptyEl(grid);
    if (!cacheReady) {
      showGridSkeleton(grid);
    } else {
      grid.appendChild(createEl('div', { className: 'empty-state' }, [
        createEl('span', { className: 'material-icons empty-icon' }, ['video_library']),
        createEl('p', { className: 'empty-title' }, ['Waiting for approved content...']),
        createEl('p', { className: 'empty-sub' }, ['Go to the admin panel to approve submitted memes.'])
      ]));
    }
    emptyEl(document.getElementById('downloadTableContainer'));
    document.getElementById('resultsCount').textContent = 'Showing 0 entries';
    renderPagination(0); firstRenderDone = true; return;
  }

  const searchQuery = document.getElementById('searchInput').value.trim();
  const type = document.getElementById('typeFilter').value;
  const category = document.getElementById('categoryFilter').value;
  const sort = document.getElementById('sortFilter').value;
  const favOnly = document.getElementById('favoritesFilter').value === 'favorites';

  buildIndex(memes);
  const filtered = search(searchQuery, { type, category, sort, favOnly, favIds });

  if (filtered.length === 0) {
    emptyEl(grid);
    grid.appendChild(createEl('div', { className: 'empty-state' }, [
      createEl('p', { className: 'empty-title' }, ['No memes match your filters.']),
      createEl('p', { className: 'empty-sub' }, ['Try a different search or clear filters.'])
    ]));
    emptyEl(document.getElementById('downloadTableContainer'));
    document.getElementById('resultsCount').textContent = 'Showing 0 entries';
    renderPagination(0); return;
  }

  const start = (currentPage - 1) * PER_PAGE;
  const page = filtered.slice(start, start + PER_PAGE);
  const showingTo = Math.min(start + PER_PAGE, filtered.length);
  document.getElementById('resultsCount').textContent = 'Showing ' + (start + 1) + '–' + showingTo + ' of ' + filtered.length + ' entries';
  renderPagination(filtered.length);

  emptyEl(grid);
  for (const meme of page) {
    const card = await buildCard(meme, favIds, filtered);
    if (!firstRenderDone) card.classList.add('animate-in');
    grid.appendChild(card);

    const ext = meme.name.split('.').pop().toLowerCase();
    const sid = String(meme.id);
    const src = getMediaSource(meme);

    if (audioExts.includes(ext)) {
      setTimeout(() => {
        const wfEl = document.getElementById('waveform-' + sid);
        if (wfEl && typeof WaveSurfer !== 'undefined') {
          try {
            const ws = WaveSurfer.create({
              container: wfEl, waveColor: '#333', progressColor: '#00e6ff',
              cursorColor: '#00ff66', barWidth: 2, barRadius: 2,
              height: 48, responsive: true, url: src
            });
            wavesurferInstances.set(sid, ws);
          } catch (e) { console.warn('WaveSurfer init failed for', sid, e); }
        }
      }, 100);
    }

    if (!audioExts.includes(ext) && !imageExts.includes(ext)) {
      setTimeout(() => {
        const vEl = card.querySelector('video');
        if (!vEl) return;
        const ensureInit = () => {
          if (vEl.readyState >= 1 || vEl.src) {
            initTrimmer(vEl);
          } else {
            vEl.addEventListener('loadedmetadata', () => initTrimmer(vEl), { once: true });
          }
        };
        ensureInit();
      }, 100);
    }
  }

  observeLazyMedia();
  renderDownloadTable(filtered);
  firstRenderDone = true;
}

function renderDownloadTable(memes) {
  const c = document.getElementById('downloadTableContainer');
  if (!c) return;

  const h3 = createEl('h3', { className: 'dl-table-title' }, ['Download Table']);
  const table = createEl('table', { className: 'download-table' });
  const thead = createEl('thead', {}, [
    createEl('tr', {}, [
      createEl('th', {}, ['Name']),
      createEl('th', {}, ['Type']),
      createEl('th', {}, ['Category']),
      createEl('th', {}, ['Special']),
      createEl('th', {}, ['Tag']),
      createEl('th', {}, ['Download'])
    ])
  ]);
  table.appendChild(thead);
  const tbody = createEl('tbody', {});
  memes.forEach(m => {
    const sn = escapeHtml(m.name);
    const ss = escapeHtml(getMediaSource(m));
    const dlLink = createEl('a', { href: ss, download: sn }, ['Download']);
    tbody.appendChild(createEl('tr', {}, [
      createEl('td', {}, [sn]),
      createEl('td', {}, [escapeHtml(m.mediaType)]),
      createEl('td', {}, [escapeHtml(m.category)]),
      createEl('td', {}, [escapeHtml(m.specialTag)]),
      createEl('td', {}, ['#' + escapeHtml(m.tag)]),
      createEl('td', {}, [dlLink])
    ]));
  });
  table.appendChild(tbody);
  emptyEl(c);
  c.appendChild(h3);
  c.appendChild(table);
}

document.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const cards = document.querySelectorAll('.meme-card');
  if (!cards.length) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    activeCardIndex = Math.min(activeCardIndex + 1, cards.length - 1);
    cards[activeCardIndex].focus();
    cards[activeCardIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeCardIndex = Math.max(activeCardIndex - 1, 0);
    cards[activeCardIndex].focus();
    cards[activeCardIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    const idx = activeCardIndex >= 0 ? activeCardIndex : 0;
    const v = cards[idx].querySelector('video');
    if (v) { v.paused ? v.play() : v.pause(); }
  } else if (e.key.toLowerCase() === 'f') {
    const idx = activeCardIndex >= 0 ? activeCardIndex : 0;
    const id = cards[idx].getAttribute('data-meme-id');
    if (id) toggleFavorite(id);
  } else if (e.key.toLowerCase() === 'c') {
    const idx = activeCardIndex >= 0 ? activeCardIndex : 0;
    const id = cards[idx].getAttribute('data-meme-id');
    if (id) handleCopyPath(id);
  } else if (e.key.toLowerCase() === 'm') {
    const idx = activeCardIndex >= 0 ? activeCardIndex : 0;
    const v = cards[idx].querySelector('video');
    if (v) v.muted = !v.muted;
  }
});

document.getElementById('prevPageBtn').addEventListener('click', function () {
  if (currentPage > 1) { currentPage--; renderMemes(); }
});
document.getElementById('nextPageBtn').addEventListener('click', function () {
  const total = document.querySelectorAll('.meme-card').length;
  if (currentPage * PER_PAGE < total) { currentPage++; renderMemes(); }
});

function filterChange() { currentPage = 1; renderMemes(); }

document.getElementById('searchInput').addEventListener('input', function () {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(filterChange, SEARCH_DEBOUNCE_MS);
});
['typeFilter', 'categoryFilter', 'sortFilter', 'favoritesFilter'].forEach(id => {
  document.getElementById(id).addEventListener('change', filterChange);
});

document.getElementById('clearFiltersBtn').addEventListener('click', function () {
  document.getElementById('searchInput').value = '';
  document.getElementById('typeFilter').value = '';
  document.getElementById('categoryFilter').value = '';
  document.getElementById('sortFilter').value = 'newest';
  document.getElementById('favoritesFilter').value = 'all';
  currentPage = 1;
  renderMemes();
});

document.getElementById('pickVideosFolderBtn').addEventListener('click', async function () {
  const name = await pickVideosDirectory();
  if (name) {
    document.getElementById('videosFolderStatus').textContent = '📁 ' + name;
    showToast('Videos folder set: ' + name);
  }
});

document.getElementById('closeFullscreenBtn').addEventListener('click', closeFullscreen);

window.addEventListener('memes:updated', () => {
  refreshMemesView();
});
window.addEventListener('focus', () => {
  refreshMemesView();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshMemesView();
});

document.addEventListener('DOMContentLoaded', async function () {
  const savedDir = getVideosDirName();
  if (savedDir) document.getElementById('videosFolderStatus').textContent = '📁 ' + savedDir;

  await migrateFromLocalStorage();
  await loadMemesIntoCache();

  const syncUI = document.getElementById('syncStatus');
  if (syncUI) syncUI.style.display = 'flex';
  try {
    if (syncToIndexedDB) {
      await syncToIndexedDB();
      await loadMemesIntoCache();
      if (hasConfig()) {
        startListener();
        onChange(async function () {
          await loadMemesIntoCache();
          renderCategoryOptions();
          renderMemes();
        });
      }
      if (syncUI) syncUI.style.display = 'none';
    }
  } catch (e) { console.warn('Cloud init:', e); if (syncUI) syncUI.style.display = 'none'; }

  renderCategoryOptions();
  renderMemes();
  document.getElementById('langToggleWrap').appendChild(createLangToggle());
  initStats();

  const params = new URLSearchParams(window.location.search);
  const nameParam = params.get('name');
  if (nameParam) {
    const all = await getAllMemes();
    const match = all.find(m => m.name === nameParam && m.status === 'approved');
    if (match) {
      const src = getMediaSource(match);
      setTimeout(() => {
        openFullscreen(src, match.name);
      }, 500);
    }
  }
});

function createStatsList(items, countKey, countLabel) {
  if (!items.length) return createEl('p', { className: 'stats-empty' }, ['No data yet.']);
  const list = createEl('ol', { className: 'stats-list' });
  items.forEach((item, i) => {
    const li = createEl('li', { className: 'stats-item' + (statsFirstRender ? ' animate-in' : '') });
    const rank = createEl('span', { className: 'stats-rank' }, [String(i + 1)]);
    const name = createEl('span', { className: 'stats-name' }, [escapeHtml(item.meme ? item.meme.name : 'Unknown')]);
    const count = createEl('span', { className: 'stats-count' }, [String(item[countKey] || 0) + ' ' + countLabel]);
    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(count);
    list.appendChild(li);
  });
  statsFirstRender = false;
  return list;
}

let statsLoading = false;
let statsFirstRender = true;

async function loadStatsTab(tab) {
  if (statsLoading) return;
  statsLoading = true;
  const content = document.getElementById('statsContent');
  content.innerHTML = '<p class="stats-loading">Loading...</p>';
  try {
    let items, labelKey, countKey, countLabel;
    switch (tab) {
      case 'viewed':
        items = await getMostViewed(10);
        countKey = 'views'; countLabel = 'views'; break;
      case 'downloaded':
        items = await getMostDownloaded(10);
        countKey = 'downloads'; countLabel = 'downloads'; break;
      case 'favorited':
        items = await getMostFavorited(10);
        countKey = 'favCount'; countLabel = 'favs'; break;
      case 'trending':
        items = await getTrending(10);
        countKey = 'recentViews'; countLabel = 'recent'; break;
      default: items = [];
    }
    emptyEl(content);
    content.appendChild(createStatsList(items, countKey, countLabel));
  } catch (e) { content.textContent = 'Error loading stats.'; }
  statsLoading = false;
}

function initStats() {
  const tabs = document.querySelectorAll('.stats-tab');
  if (!tabs.length) return;
  document.querySelector('.stats-section')?.classList.add('animate-in');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadStatsTab(tab.dataset.tab);
    });
  });
  loadStatsTab('viewed');
}
