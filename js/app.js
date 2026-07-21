import {
  ADMIN_TOKEN_KEY, ADMIN_FINGERPRINT_KEY, ADMIN_SESSION_KEY,
  BASE_FOLDER_KEY, FAVORITE_IDS_KEY, STORAGE_LIMIT
} from './config.js';

const DB_NAME = 'WantSomeMemesDB';
const DB_VERSION = 1;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('memes')) {
        const store = db.createObjectStore('memes', { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('tag', 'tag', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('prefs')) {
        db.createObjectStore('prefs', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllMemes(status) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('memes', 'readonly');
    const store = tx.objectStore('memes');
    const req = status ? store.index('status').getAll(status) : store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export function notifyMemesChanged() {
  try {
    window.dispatchEvent(new CustomEvent('memes:updated'));
  } catch (e) {
    console.warn('Failed to notify memes update:', e);
  }
}

export async function putMeme(meme) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('memes', 'readwrite');
    const store = tx.objectStore('memes');
    const entry = { ...meme, id: meme.id || generateId() };
    const req = store.put(entry);
    req.onsuccess = () => {
      notifyMemesChanged();
      resolve(entry);
    };
    req.onerror = () => reject(req.error);
  });
}

function generateId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { console.warn('crypto.randomUUID unavailable:', e); }
  return Date.now() + '-' + Math.floor(Math.random() * 1000000);
}

export async function deleteMeme(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('memes', 'readwrite');
    const store = tx.objectStore('memes');
    const key = typeof id === 'string' ? id : String(id);
    const req = store.delete(key);
    req.onsuccess = () => {
      notifyMemesChanged();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPref(key, def) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('prefs', 'readonly').objectStore('prefs').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : def);
    req.onerror = () => reject(req.error);
  });
}

export async function setPref(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('prefs', 'readwrite').objectStore('prefs').put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function migrateFromLocalStorage() {
  const pending = JSON.parse(localStorage.getItem('pendingMemes') || '[]');
  const approved = JSON.parse(localStorage.getItem('approvedMemes') || '[]');
  const all = [...pending, ...approved];
  if (!all.length) return;
  for (const m of all) {
    if (!m.id) m.id = generateId();
    try { await putMeme(m); } catch (e) { console.warn('Migrate:', m.name, e); }
  }
  localStorage.removeItem('pendingMemes');
  localStorage.removeItem('approvedMemes');
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function getMediaSource(meme) {
  if (meme && meme.fileUrl) return meme.fileUrl;
  if (meme && meme.blobData) {
    const cached = blobUrlCache.get(meme.name);
    if (cached) return cached;
    evictBlobIfNeeded();
    const url = URL.createObjectURL(meme.blobData);
    blobUrlCache.set(meme.name, url);
    touchBlobAccess(meme.name);
    return url;
  }
  return 'videos/' + (meme ? meme.name : '');
}

export function getBaseFolderPath() {
  try { return (localStorage.getItem(BASE_FOLDER_KEY) || '').trim(); } catch (e) { return ''; }
}

export function buildFullMediaPath(fileName) {
  const base = getBaseFolderPath().replace(/\\/g, '/').replace(/\/+$/, '');
  const nf = fileName.replace(/\\/g, '/');
  return base ? base + '/videos/' + nf : 'videos/' + nf;
}

const VIDEOS_DIR_KEY = 'wantSomeMemesVideosDir';
let videosDirHandle = null;
const blobUrlCache = new Map();
const BLOB_CACHE_MAX = 30;
const blobAccessOrder = [];

function evictBlobIfNeeded() {
  while (blobUrlCache.size >= BLOB_CACHE_MAX) {
    const oldest = blobAccessOrder.shift();
    if (!oldest) break;
    const url = blobUrlCache.get(oldest);
    if (url) { URL.revokeObjectURL(url); }
    blobUrlCache.delete(oldest);
  }
}

function touchBlobAccess(name) {
  const idx = blobAccessOrder.indexOf(name);
  if (idx !== -1) blobAccessOrder.splice(idx, 1);
  blobAccessOrder.push(name);
}

export function revokeBlobUrl(name) {
  const url = blobUrlCache.get(name);
  if (url) { URL.revokeObjectURL(url); blobUrlCache.delete(name); }
  const idx = blobAccessOrder.indexOf(name);
  if (idx !== -1) blobAccessOrder.splice(idx, 1);
}

export function cleanupBlobCache() {
  for (const [name, url] of blobUrlCache) { URL.revokeObjectURL(url); }
  blobUrlCache.clear();
  blobAccessOrder.length = 0;
}

window.addEventListener('beforeunload', () => cleanupBlobCache());

export async function pickVideosDirectory() {
  if (!window.showDirectoryPicker) return null;
  try {
    videosDirHandle = await window.showDirectoryPicker();
    localStorage.setItem(VIDEOS_DIR_KEY, videosDirHandle.name);
    return videosDirHandle.name;
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('Directory picker:', e);
    return null;
  }
}

export function getVideosDirName() {
  try { return localStorage.getItem(VIDEOS_DIR_KEY) || ''; } catch (e) { return ''; }
}

export async function resolveMediaForDisplay(meme) {
  if (meme.fileUrl) return meme.fileUrl;
  if (meme.blobData) {
    if (blobUrlCache.has(meme.name)) {
      touchBlobAccess(meme.name);
      return blobUrlCache.get(meme.name);
    }
    evictBlobIfNeeded();
    const url = URL.createObjectURL(meme.blobData);
    blobUrlCache.set(meme.name, url);
    touchBlobAccess(meme.name);
    return url;
  }
  const name = meme.name;
  if (blobUrlCache.has(name)) {
    touchBlobAccess(name);
    return blobUrlCache.get(name);
  }
  if (videosDirHandle) {
    try {
      const fh = await videosDirHandle.getFileHandle(name);
      const file = await fh.getFile();
      evictBlobIfNeeded();
      const url = URL.createObjectURL(file);
      blobUrlCache.set(name, url);
      touchBlobAccess(name);
      return url;
    } catch (e) { console.warn('Failed to read file from videos folder:', name, e); }
  }
  return 'videos/' + name;
}

export function getDeviceFingerprint() {
  const parts = [
    navigator.userAgent, navigator.language, navigator.platform,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  ];
  return btoa(unescape(encodeURIComponent(parts.join('|'))));
}

export function checkAdminAccess() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return false;
  if (sessionStorage.getItem(ADMIN_SESSION_KEY) !== 'true') {
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
  }
  return true;
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2200);
}

export function storageUsed() {
  let total = 0;
  for (const key in localStorage) {
    if (localStorage.hasOwnProperty(key)) total += localStorage[key].length * 2;
  }
  return total;
}

export function checkStorageLimit() {
  const warn = document.getElementById('storageWarning');
  if (!warn) return;
  const pct = Math.round((storageUsed() / STORAGE_LIMIT) * 100);
  if (pct > 70) {
    warn.textContent = '⚠️ Local storage ' + pct + '% full.';
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
}

export async function checkIndexedDBQuota() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  try {
    const est = await navigator.storage.estimate();
    const usedMB = (est.usage || 0) / 1024 / 1024;
    const quotaMB = (est.quota || 0) / 1024 / 1024;
    const pct = quotaMB > 0 ? Math.round((est.usage / est.quota) * 100) : 0;
    if (pct > 70) {
      const warn = document.getElementById('storageWarning');
      if (warn) { warn.textContent = '⚠️ Storage ' + pct + '% full (' + usedMB.toFixed(0) + '/' + quotaMB.toFixed(0) + ' MB).'; warn.classList.remove('hidden'); }
    }
  } catch (e) { console.warn('IndexedDB quota check failed:', e); }
}

export function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

export function emptyEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export { ADMIN_TOKEN_KEY, ADMIN_FINGERPRINT_KEY, ADMIN_SESSION_KEY, FAVORITE_IDS_KEY, generateId };
