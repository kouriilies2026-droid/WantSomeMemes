import { getAllMemes, putMeme, deleteMeme, getMediaSource, escapeHtml, showToast, checkStorageLimit, ADMIN_TOKEN_KEY, ADMIN_SESSION_KEY, ADMIN_FINGERPRINT_KEY, createEl, emptyEl, checkAdminAccess, getDeviceFingerprint, generateId } from './app.js';
import { initLanguage, createLangToggle } from './i18n.js';
import { categories, specialTags, languages, audioExts, imageExts } from './categories.js';
import { exportTrimmed, exportTransparent } from './export.js';

initLanguage();

let firstTableRenderDone = false;

const ADMIN_HASH = '620926d23b807342d97429ed665995727000f85c91ff9d80d9aa9033e049851c';

async function hashPassword(pwd) {
  const enc = new TextEncoder();
  const data = enc.encode(pwd);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('');
}

let firebase = null;

async function loadFirebase() {
  if (firebase) return firebase;
  try {
    firebase = await import('./firebase.js');
    return firebase;
  } catch (e) {
    console.warn('Firebase not available:', e);
    return null;
  }
}

function showLoginForm() {
  document.getElementById('accessDenied').style.display = 'flex';
  document.getElementById('adminContent').classList.add('hidden');
  document.getElementById('deniedTitle').textContent = '🔒 Admin Login';
  document.getElementById('deniedMessage').textContent = 'Enter admin password (or email for Firebase Auth).';
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
  const fb = await loadFirebase();
  const hasFirebase = fb && fb.hasConfig();

  if (hasFirebase && pwd.includes('@')) {
    const email = pwd;
    const passwordInput = prompt('Enter Firebase password for ' + email);
    if (!passwordInput) { error.textContent = 'Password required.'; return; }
    const result = await fb.signInAdmin(email, passwordInput);
    if (result.ok) {
      localStorage.setItem(ADMIN_TOKEN_KEY, 'firebase:' + email);
      localStorage.setItem(ADMIN_FINGERPRINT_KEY, getDeviceFingerprint());
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
      showAdminPanel(fb);
      fb.startListener();
      fb.onChange(function () { loadMemes(); updateAdminStatus(); });
      fb.onAdminAuthChange(user => {
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
    showAdminPanel(fb);
    if (hasFirebase) {
      fb.startListener();
      fb.onChange(function () { loadMemes(); updateAdminStatus(); });
    }
  } else {
    error.textContent = 'Wrong password.';
    document.getElementById('adminPasswordInput').value = '';
    document.getElementById('adminPasswordInput').focus();
  }
}

async function showAdminPanel(fb) {
  document.getElementById('accessDenied').style.display = 'none';
  document.getElementById('adminContent').classList.remove('hidden');
  if (!fb) fb = await loadFirebase();
  if (fb) {
    document.getElementById('cloudStatus').textContent = fb.hasConfig()
      ? 'Cloud sync: enabled and ready.' : 'Cloud sync: not configured, using local storage only.';
  } else {
    document.getElementById('cloudStatus').textContent = 'Cloud sync: not available.';
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
    const fb = await loadFirebase();
    if (fb) await fb.syncToIndexedDB();
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
  const target = all.find(m => m.id === id);
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
  const target = all.find(m => m.id === id && m.status === 'pending');
  if (!target) return;
  const tagInput = document.getElementById('tag-' + id);
  if (tagInput) target.tag = tagInput.value.trim() || target.tag;
  target.status = 'approved';
  target.updatedAt = Date.now();
  await putMeme(target);
  const fb = await loadFirebase();
  if (fb && target.cloudDocId) await fb.updateMeme(target, 'approved');
  await loadMemes();
  updateAdminStatus();
  alert('Meme approved!');
}

async function rejectMeme(id, listType) {
  if (!checkAdminAccess()) { showToast('Access denied. Please log in.'); showLoginForm(); return; }
  const all = await getAllMemes();
  const target = all.find(m => m.id === id);
  if (!target) return;
  const fb = await loadFirebase();
  if (fb && target.cloudDocId) await fb.deleteCloudMeme(target);
  await deleteMeme(target.id);
  await loadMemes();
  updateAdminStatus();
  alert(listType === 'pending' ? 'Meme rejected.' : 'Meme deleted from library.');
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
    const fb = await loadFirebase();
    if (fb && m.cloudDocId) await fb.deleteCloudMeme(m);
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
    const fb = await loadFirebase();
    if (fb && m.cloudDocId) await fb.deleteCloudMeme(m);
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

  if (token && (token === ADMIN_HASH || token.startsWith('firebase:'))) {
    if (sessionStorage.getItem(ADMIN_SESSION_KEY) !== 'true') {
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    }
    showAdminPanel();
    loadFirebase().then(fb => {
      if (fb && fb.hasConfig()) {
        fb.startListener();
        fb.onChange(function () { loadMemes(); updateAdminStatus(); });
        if (token.startsWith('firebase:')) {
          fb.onAdminAuthChange(user => {
            if (!user) {
              localStorage.removeItem(ADMIN_TOKEN_KEY);
              localStorage.removeItem(ADMIN_FINGERPRINT_KEY);
              sessionStorage.removeItem(ADMIN_SESSION_KEY);
              showLoginForm();
            }
          });
        }
      }
    });
  } else {
    showLoginForm();
  }

  updateAdminStatus();
  checkStorageLimit();
  const langWrap = document.getElementById('langToggleWrap');
  if (langWrap) langWrap.appendChild(createLangToggle());
  loadMemes();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => init());
} else {
  setTimeout(init, 50);
}
