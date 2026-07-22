import { getAllMemes, putMeme, deleteMeme, getMediaSource, escapeHtml, showToast, checkStorageLimit, ADMIN_TOKEN_KEY, ADMIN_SESSION_KEY, ADMIN_FINGERPRINT_KEY, createEl, emptyEl, checkAdminAccess, getDeviceFingerprint, generateId } from './app.js';
import { initLanguage, createLangToggle } from './i18n.js';
import { categories, specialTags, languages, audioExts, imageExts } from './categories.js';
import { exportTrimmed, exportTransparent } from './export.js';
import { syncToIndexedDB, hasSupabaseConfig, startRealtimeListener, uploadMemeToSupabase, saveMemeToSupabase, updateMemeInSupabase, deleteMemeFromSupabase, uploadToSupabaseStorage, deleteFromSupabaseStorage, signInAdmin, signOutAdmin, onAdminAuthChange, onChange } from './supabase.js';

initLanguage();

let firstTableRenderDone = false;

const ADMIN_HASH = '620926d23b807342d97429ed665995727000f85c91ff9d80d9aa9033e049851c';

function sha256Fallback(str) {
  const msg = str;
  const utf8 = [];
  for (let i = 0; i < msg.length; i++) {
    let c = msg.charCodeAt(i);
    if (c < 128) utf8.push(c);
    else if (c < 2048) { utf8.push(192 | (c >> 6), 128 | (c & 63)); }
    else if (c > 0xD7FF && c < 0xE000) { utf8.push(239, 191, 191); }
    else { utf8.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
  }
  const len = utf8.length * 8;
  utf8.push(128);
  while ((utf8.length * 8) % 512 !== 448) utf8.push(0);
  const words = [];
  for (let i = 0; i < utf8.length; i += 4) {
    words.push((utf8[i] << 24) | (utf8[i+1] << 16) | (utf8[i+2] << 8) | utf8[i+3]);
  }
  words.push(0, len);
  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let i = 0; i < words.length; i += 16) {
    let w = words.slice(i, i + 16);
    while (w.length < 64) w.push(0);
    for (let t = 16; t < 64; t++) {
      const s0 = ((w[t-15] >>> 7) | (w[t-15] << 25)) ^ ((w[t-15] >>> 18) | (w[t-15] << 14)) ^ (w[t-15] >>> 3);
      const s1 = ((w[t-2] >>> 17) | (w[t-2] << 15)) ^ ((w[t-2] >>> 19) | (w[t-2] << 13)) ^ (w[t-2] >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const hex = [h0, h1, h2, h3, h4, h5, h6, h7].map(x => ((x >>> 0).toString(16)).padStart(8, '0')).join('');
  return hex;
}

async function hashPassword(pwd) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const enc = new TextEncoder();
      const data = enc.encode(pwd);
      const buf = await crypto.subtle.digest('SHA-256', data);
      const arr = Array.from(new Uint8Array(buf));
      return arr.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('crypto.subtle failed, using fallback:', e);
    }
  }
  return sha256Fallback(pwd);
}

function showLoginForm() {
  document.getElementById('accessDenied').style.display = 'flex';
  document.getElementById('adminContent').classList.add('hidden');
  document.getElementById('deniedTitle').textContent = '🔒 Admin Login';
  document.getElementById('deniedMessage').textContent = 'Enter admin password (or email for Supabase Auth).';
  document.getElementById('adminPasswordInput').classList.remove('hidden');
  document.getElementById('adminPasswordInput').placeholder = 'Password';
  document.getElementById('adminPasswordConfirm').classList.add('hidden');
  document.getElementById('adminActionBtn').classList.remove('hidden');
  document.getElementById('adminActionBtn').textContent = 'Sign In';
  document.getElementById('adminLoginError').textContent = '';
  document.getElementById('adminActionBtn').onclick = function () { handleLogin(); };
  document.getElementById('adminPasswordInput').onkeydown = function (e) {
    if (e.key === 'Enter') handleLogin();
  };
}

async function handleLogin() {
  const pwd = document.getElementById('adminPasswordInput').value;
  const error = document.getElementById('adminLoginError');

  if (hasSupabaseConfig() && pwd.includes('@')) {
    const email = pwd;
    const passwordInput = prompt('Enter Supabase password for ' + email);
    if (!passwordInput) { error.textContent = 'Password required.'; return; }
    const result = await signInAdmin(email, passwordInput);
    if (result.ok) {
      localStorage.setItem(ADMIN_TOKEN_KEY, 'supabase:' + email);
      localStorage.setItem(ADMIN_FINGERPRINT_KEY, getDeviceFingerprint());
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
      showAdminPanel();
      startRealtimeListener();
      onChange(function () { loadMemes(); updateAdminStatus(); });
      onAdminAuthChange(user => {
        if (!user) {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          localStorage.removeItem(ADMIN_FINGERPRINT_KEY);
          sessionStorage.removeItem(ADMIN_SESSION_KEY);
          showLoginForm();
        }
      });
    } else {
      error.textContent = result.error;
      document.getElementById('adminPasswordInput').focus();
    }
    return;
  }

  const hash = await hashPassword(pwd);
  if (hash === ADMIN_HASH) {
    localStorage.setItem(ADMIN_TOKEN_KEY, hash);
    localStorage.setItem(ADMIN_FINGERPRINT_KEY, getDeviceFingerprint());
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    showAdminPanel();
    if (hasSupabaseConfig()) {
      startRealtimeListener();
      onChange(function () { loadMemes(); updateAdminStatus(); });
    }
  } else {
    error.textContent = 'Wrong password.';
    document.getElementById('adminPasswordInput').value = '';
    document.getElementById('adminPasswordInput').focus();
  }
}

async function showAdminPanel() {
  document.getElementById('accessDenied').style.display = 'none';
  document.getElementById('adminContent').classList.remove('hidden');
  if (hasSupabaseConfig()) {
    document.getElementById('cloudStatus').textContent = 'Cloud sync: enabled and ready.';
  } else {
    document.getElementById('cloudStatus').textContent = 'Cloud sync: not configured, using local storage only.';
  }
  await loadMemes();
  updateAdminStatus();
  checkStorageLimit();
}

async function loadMemes() {
  const tbody = document.getElementById('memeTableBody');
  const initialLoad = !firstTableRenderDone;
  if (initialLoad) {
    emptyEl(tbody);
    showTableSkeleton(tbody);
  } else {
    emptyEl(tbody);
  }
  try {
    await syncToIndexedDB();
  } catch (e) { console.warn('Sync error:', e); }

  const all = await getAllMemes();
  const search = document.getElementById('adminSearch').value.trim().toLowerCase();
  const statusFilter = document.getElementById('adminStatusFilter').value;
  const filter = all.filter(m => {
    if (statusFilter === 'pending' && m.status !== 'pending') return false;
    if (statusFilter === 'approved' && m.status !== 'approved') return false;
    if (!search) return true;
    return [m.name, m.tag, m.category, m.specialTag, m.lang].some(v => String(v||'').toLowerCase().includes(search));
  });
  const pending = filter.filter(m => m.status === 'pending');
  const approved = filter.filter(m => m.status === 'approved');

  if (initialLoad) emptyEl(tbody);
  if (pending.length === 0 && approved.length === 0) {
    tbody.appendChild(createEl('tr', {}, [
      createEl('td', { colspan: '3', className: 'empty-state' }, ['No memes match your current search.'])
    ]));
    return;
  }
  pending.forEach(m => renderRow(m, 'Pending', tbody));
  approved.forEach(m => renderRow(m, 'Approved', tbody));
  firstTableRenderDone = true;
}

function showTableSkeleton(tbody) {
  for (let i = 0; i < 6; i++) {
    const tr = createEl('tr', { className: 'skeleton-row' }, [
      createEl('td', {}, [createEl('div', { className: 'skeleton' }, [])]),
      createEl('td', {}, [createEl('div', { className: 'skeleton skeleton-text' }, [])]),
      createEl('td', {}, [createEl('div', { className: 'skeleton skeleton-chip' }, [])])
    ]);
    tbody.appendChild(tr);
  }
}

function renderRow(meme, status, tbody) {
  const tr = document.createElement('tr');
  if (!firstTableRenderDone) tr.classList.add('animate-in');
  const ext = meme.name.split('.').pop().toLowerCase();
  const src = getMediaSource(meme);
  const isAudio = audioExts.includes(ext);
  const isImage = imageExts.includes(ext);

  const previewWrap = createEl('div', { className: 'preview-wrap' });
  if (isAudio) {
    previewWrap.appendChild(createEl('audio', { src, controls: '', preload: 'metadata' }));
  } else if (isImage) {
    previewWrap.appendChild(createEl('img', { src, alt: meme.name }));
  } else {
    previewWrap.appendChild(createEl('video', { src, controls: '', preload: 'metadata', playsinline: '' }));
  }

  const td0 = createEl('td', { dataset: { label: 'Media Preview' } }, [
    previewWrap,
    createEl('div', { className: 'meta-line' }, [escapeHtml(meme.name)])
  ]);

  const badge = status === 'Pending'
    ? createEl('span', { className: 'badge-pending' }, ['Pending Review'])
    : createEl('span', { className: 'badge-approved' }, ['Live in Library']);

  const td1 = createEl('td', { dataset: { label: 'Details' } }, [badge]);

  if (status === 'Pending') {
    const catSelect = createEl('select', { className: 'tag-editor cat-editor', id: 'cat-' + meme.id });
    categories.forEach(c => {
      const opt = createEl('option', { value: c }, [c]);
      if (c === meme.category) opt.selected = true;
      catSelect.appendChild(opt);
    });
    td1.appendChild(createEl('div', {}, [createEl('strong', {}, ['Category: ']), catSelect]));

    const langSelect = createEl('select', { className: 'tag-editor lang-editor', id: 'lang-' + meme.id });
    languages.forEach(l => {
      const opt = createEl('option', { value: l }, [l]);
      if (l === (meme.lang || 'Other / None')) opt.selected = true;
      langSelect.appendChild(opt);
    });
    td1.appendChild(createEl('div', {}, [createEl('strong', {}, ['Language: ']), langSelect]));

    td1.appendChild(createEl('div', {}, [
      createEl('strong', {}, ['Tag: ']),
      createEl('input', { className: 'tag-editor', type: 'text', value: meme.tag || '', id: 'tag-' + meme.id })
    ]));

    const specialSelect = createEl('select', { className: 'tag-editor special-editor', id: 'special-' + meme.id });
    specialTags.forEach(s => {
      const opt = createEl('option', { value: s }, [s]);
      if (s === meme.specialTag) opt.selected = true;
      specialSelect.appendChild(opt);
    });
    td1.appendChild(createEl('div', {}, [createEl('strong', {}, ['Special: ']), specialSelect]));
  } else {
    td1.appendChild(createEl('div', {}, [createEl('strong', {}, ['Category: ']), escapeHtml(meme.category)]));
    td1.appendChild(createEl('div', {}, [createEl('strong', {}, ['Language: ']), escapeHtml(meme.lang)]));
    td1.appendChild(createEl('div', {}, [createEl('strong', {}, ['Tag: #']), escapeHtml(meme.tag)]));
    td1.appendChild(createEl('div', {}, [createEl('strong', {}, ['Special: ']), escapeHtml(meme.specialTag)]));
  }

  const td2 = createEl('td', { dataset: { label: 'Actions' } });
  if (status === 'Pending') {
    const saveBtn = createEl('button', { className: 'btn-edit' }, ['💾 Save']);
    saveBtn.addEventListener('click', () => saveMeme(meme.id));
    td2.appendChild(saveBtn);

    const acceptBtn = createEl('button', { className: 'btn-accept' }, ['Accept']);
    acceptBtn.addEventListener('click', () => acceptMeme(meme.id));
    td2.appendChild(acceptBtn);

    const rejectBtn = createEl('button', { className: 'btn-reject' }, ['Reject']);
    rejectBtn.addEventListener('click', () => rejectMeme(meme.id, 'pending'));
    td2.appendChild(rejectBtn);
  } else {
    const delBtn = createEl('button', { className: 'btn-reject' }, ['Delete From Live']);
    delBtn.addEventListener('click', () => rejectMeme(meme.id, 'approved'));
    td2.appendChild(delBtn);
  }

  if (!isAudio && !isImage) {
    const sid = String(meme.id);
    const exportTrimBtn = createEl('button', { className: 'export-trimmed-btn' }, ['Export Trimmed']);
    exportTrimBtn.addEventListener('click', async () => {
      const all = await getAllMemes();
      exportTrimmed(sid, all);
    });
    td2.appendChild(exportTrimBtn);

    const exportTransBtn = createEl('button', { className: 'export-transparent-btn' }, ['Export Transparent']);
    exportTransBtn.addEventListener('click', async () => {
      const all = await getAllMemes();
      exportTransparent(sid, all);
    });
    td2.appendChild(exportTransBtn);
  }

  tr.appendChild(td0);
  tr.appendChild(td1);
  tr.appendChild(td2);
  tbody.appendChild(tr);
}

async function saveMeme(id) {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  const all = await getAllMemes();
  const target = all.find(m => String(m.id) === String(id));
  if (!target || target.status !== 'pending') return;
  const tagEl = document.getElementById('tag-' + id);
  const catEl = document.getElementById('cat-' + id);
  const langEl = document.getElementById('lang-' + id);
  const specialEl = document.getElementById('special-' + id);
  if (tagEl) target.tag = tagEl.value.trim() || target.tag;
  if (catEl) target.category = catEl.value;
  if (langEl) target.lang = langEl.value;
  if (specialEl) target.specialTag = specialEl.value;
  target.updatedAt = Date.now();
  await putMeme(target);
  await loadMemes();
  updateAdminStatus();
}

async function acceptMeme(id) {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  const all = await getAllMemes();
  const target = all.find(m => String(m.id) === String(id) && m.status === 'pending');
  if (!target) return;
  const tagInput = document.getElementById('tag-' + id);
  if (tagInput) target.tag = tagInput.value.trim() || target.tag;
  target.status = 'approved';
  target.updatedAt = Date.now();
  await putMeme(target);
  await updateMemeInSupabase(target, 'approved');
  await loadMemes();
  updateAdminStatus();
  showToast('Meme approved!');
}

async function rejectMeme(id, listType) {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  const all = await getAllMemes();
  const target = all.find(m => String(m.id) === String(id));
  if (!target) return;
  await deleteMemeFromSupabase(target);
  await deleteMeme(target.id);
  await loadMemes();
  updateAdminStatus();
  showToast(listType === 'pending' ? 'Meme rejected.' : 'Meme deleted from library.');
}

function updateAdminStatus() {
  getAllMemes().then(all => {
    document.getElementById('pendingStatus').textContent = 'Pending: ' + all.filter(m => m.status === 'pending').length;
    document.getElementById('approvedStatus').textContent = 'Approved: ' + all.filter(m => m.status === 'approved').length;
  });
}

document.getElementById('bulkImportBtn').addEventListener('click', async function () {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  const input = document.getElementById('bulkImportInput');
  const result = document.getElementById('bulkImportResult');
  const raw = input.value.trim();
  if (!raw) { result.textContent = 'Paste filenames first.'; return; }
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { result.textContent = 'No valid filenames.'; return; }
  const existing = await getAllMemes();
  const existingNames = new Set(existing.map(m => m.name.toLowerCase()));
  let added = 0, skipped = 0;
  for (const filename of lines) {
    const clean = filename.replace(/\\/g,'/').split('/').pop();
    if (existingNames.has(clean.toLowerCase())) { skipped++; continue; }
    const tag = clean.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim() || 'meme';
    const ext = clean.split('.').pop().toLowerCase();
    const isAudio = audioExts.includes(ext);
    const isImage = imageExts.includes(ext);
    await putMeme({
      id: generateId(),
      name: clean,
      mediaType: isAudio ? 'Audio' : isImage ? 'Image' : 'Video',
      lang: 'Other / None', category: 'Other', tag, specialTag: 'None',
      status: 'pending', createdAt: Date.now()
    });
    existingNames.add(clean.toLowerCase());
    added++;
  }
  input.value = '';
  result.textContent = 'Added: ' + added + ' | Skipped: ' + skipped;
  await loadMemes();
  updateAdminStatus();
});

function exportData() {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  getAllMemes().then(all => {
    const data = {
      version: 1, exportedAt: Date.now(),
      memes: all,
      favoriteMemeIds: JSON.parse(localStorage.getItem('favoriteMemeIds') || '[]')
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = createEl('a', { href: url, download: 'memes-backup-' + new Date().toISOString().slice(0,10) + '.json' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

function importData(file) {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.memes && !data.pendingMemes) { alert('Invalid backup.'); return; }
      const memes = data.memes || [];
      if (data.pendingMemes) memes.push(...data.pendingMemes.map(m => ({ ...m, status: 'pending' })));
      if (data.approvedMemes) memes.push(...data.approvedMemes.map(m => ({ ...m, status: 'approved' })));
      for (const m of memes) await putMeme(m);
      if (data.favoriteMemeIds) localStorage.setItem('favoriteMemeIds', JSON.stringify(data.favoriteMemeIds));
      alert('Imported ' + memes.length + ' memes.');
      await loadMemes();
      updateAdminStatus();
    } catch (err) { alert('Import failed: ' + err.message); }
  };
  reader.readAsText(file);
}

document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
document.getElementById('importFileInput').addEventListener('change', function (e) {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('clearPending').addEventListener('click', async function () {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  if (!confirm('Clear all pending memes?')) return;
  const all = await getAllMemes();
  for (const m of all.filter(m => m.status === 'pending')) {
    await deleteMemeFromSupabase(m);
    await deleteMeme(m.id);
  }
  await loadMemes();
  updateAdminStatus();
});

document.getElementById('clearApproved').addEventListener('click', async function () {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  if (!confirm('Clear all approved memes?')) return;
  const all = await getAllMemes();
  for (const m of all.filter(m => m.status === 'approved')) {
    await deleteMemeFromSupabase(m);
    await deleteMeme(m.id);
  }
  await loadMemes();
  updateAdminStatus();
});

document.getElementById('adminSearch').addEventListener('input', loadMemes);
document.getElementById('adminStatusFilter').addEventListener('change', loadMemes);
document.getElementById('clearAdminSearch').addEventListener('click', function () {
  document.getElementById('adminSearch').value = '';
  document.getElementById('adminStatusFilter').value = 'all';
  loadMemes();
});

let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);

   if (token && (token === ADMIN_HASH || token.startsWith('supabase:'))) {
     if (sessionStorage.getItem(ADMIN_SESSION_KEY) !== 'true') {
       sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
     }
     showAdminPanel();
     if (hasSupabaseConfig()) {
       startRealtimeListener();
       onChange(function () { loadMemes(); updateAdminStatus(); });
     }
   } else {
     showLoginForm();
   }

  updateAdminStatus();
  checkStorageLimit();
  const langWrap = document.getElementById('langToggleWrap');
  if (langWrap) langWrap.appendChild(createLangToggle());
  syncToIndexedDB().then(() => loadMemes());
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => init());
} else {
  setTimeout(init, 50);
}
