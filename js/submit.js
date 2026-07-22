import { getAllMemes, putMeme, deleteMeme, createEl, emptyEl, checkIndexedDBQuota } from './app.js';
import { getSupabaseConfig, saveSupabaseConfig, hasSupabaseConfig, uploadMemeToSupabase, saveMemeToSupabase, uploadToSupabaseStorage } from './supabase.js';
import { categories, specialTags } from './categories.js';
import { initLanguage, createLangToggle } from './i18n.js';
import { SUPABASE_CONFIG_KEYS } from './config.js';

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

let previewUrl = null;
let selectedFile = null;
let method = 'upload';

function setFormMessage(message, type) {
  const banner = document.getElementById('formStatus');
  banner.textContent = message;
  banner.className = 'status-banner ' + type;
}

function clearPreview() {
  const pb = document.getElementById('previewBox');
  pb.textContent = 'Preview will appear here.';
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

function updateFileInfo(file) {
  const info = document.getElementById('fileInfo');
  const pb = document.getElementById('previewBox');
  if (!file) {
    info.textContent = 'No file chosen yet.';
    clearPreview();
    return;
  }
  const size = (file.size / 1024 / 1024).toFixed(2);
  info.textContent = 'Selected: ' + file.name + ' (' + size + ' MB)';
  if (file.size > 20 * 1024 * 1024) {
    pb.innerHTML = '<strong>Too large:</strong> Please keep files below 20 MB.';
    return;
  }
  const ext = file.name.split('.').pop().toLowerCase();
  const isAudio = ['mp3','wav','ogg','m4a','aac'].includes(ext);
  const isImage = ['png','jpg','jpeg','gif','webp'].includes(ext);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  if (isImage) pb.innerHTML = '<img src="' + previewUrl + '" alt="Preview" />';
  else if (isAudio) pb.innerHTML = '<audio src="' + previewUrl + '" controls preload="metadata"></audio>';
  else pb.innerHTML = '<video src="' + previewUrl + '" controls preload="metadata"></video>';
}

async function updateCounts() {
  const memes = await getAllMemes();
  document.getElementById('pendingCount').textContent = 'Pending: ' + memes.filter(m => m.status === 'pending').length;
  document.getElementById('approvedCount').textContent = 'Approved: ' + memes.filter(m => m.status === 'approved').length;
}

function loadCloudSettings() {
  const c = getSupabaseConfig();
  document.getElementById('supabaseUrl').value = c.url || '';
  document.getElementById('supabaseAnonKey').value = c.anonKey || '';
  document.getElementById('supabaseStorageBucket').value = c.storageBucket || 'memes';
}

function saveCloudSettings() {
  const config = {
    url: document.getElementById('supabaseUrl').value.trim(),
    anonKey: document.getElementById('supabaseAnonKey').value.trim(),
    storageBucket: document.getElementById('supabaseStorageBucket').value.trim() || 'memes'
  };
  saveSupabaseConfig(config);
  setFormMessage('Supabase settings saved.', 'success');
}

function generateSmartTags(fileName) {
  const cleaned = fileName.split('.').slice(0,-1).join('.').replace(/[_-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/\s+/g,' ').trim();
  if (!cleaned) return 'meme';
  const words = cleaned.split(' ').map(w => w.replace(/[^a-zA-Z0-9]+/g,'').trim()).filter(Boolean);
  const important = words.filter(w => !['the','and','for','with','video','mp4','mov','webm','png','jpg','jpeg','gif','audio','img','file'].includes(w.toLowerCase()));
  if (important.length >= 2) return important.slice(0,3).join(' ');
  return important.length ? important[0] : 'meme';
}

async function saveVideoToDirectory() {
  if (!selectedFile) { setFormMessage('Please choose a file first.', 'error'); return; }
  if (selectedFile.size > 20 * 1024 * 1024) { setFormMessage('File exceeds 20 MB limit.', 'error'); return; }
  const file = selectedFile;
  if (window.showDirectoryPicker) {
    try {
      const folder = await window.showDirectoryPicker();
      let target = folder;
      if (folder.name.toLowerCase() !== 'videos') target = await folder.getDirectoryHandle('videos', { create: true });
      const handle = await target.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
      setFormMessage('File saved to videos folder!', 'success');
    } catch (e) {
      if (e.name === 'AbortError') setFormMessage('Save cancelled.', 'error');
      else fallbackDownload(file);
    }
  } else {
    fallbackDownload(file);
  }
}

function fallbackDownload(file) {
  setFormMessage('Downloading — save to videos folder manually.', 'success');
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function updateSaveButton() {
  const btn = document.getElementById('saveFileButton');
  btn.disabled = !selectedFile;
}

function switchMethod(next) {
  method = next;
  document.querySelectorAll('.method-tab').forEach(t => t.classList.toggle('active', t.dataset.method === next));
  document.querySelectorAll('.method-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('panel-' + next);
  if (panel) panel.classList.remove('hidden');
}

async function testUrl() {
  const url = document.getElementById('memeUrl').value.trim();
  const status = document.getElementById('urlStatus');
  if (!url) { status.textContent = 'Please paste a link first.'; return; }
  status.textContent = 'Testing link…';
  const probe = document.createElement('video');
  probe.muted = true;
  probe.preload = 'metadata';
  probe.src = url;
  const ok = await new Promise(resolve => {
    const done = (v) => { probe.onloadedmetadata = probe.onerror = null; resolve(v); };
    probe.onloadedmetadata = () => done(true);
    probe.onerror = () => done(false);
    setTimeout(() => done(false), 8000);
  });
  if (ok) status.innerHTML = '<strong style="color:#00ff66">Link works!</strong> Preview below.';
  else status.innerHTML = '<strong style="color:#ff4d4d">Could not load.</strong> The link may need download mode on submit.';
}

document.getElementById('methodTabs').addEventListener('click', e => {
  const tab = e.target.closest('.method-tab');
  if (tab) switchMethod(tab.dataset.method);
});

document.getElementById('dropzone').addEventListener('click', () => document.getElementById('memeFile').click());
document.getElementById('dropzone').addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); });
document.getElementById('dropzone').addEventListener('dragleave', e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); });
document.getElementById('dropzone').addEventListener('drop', e => {
  e.preventDefault(); e.currentTarget.classList.remove('dragover');
  if (e.dataTransfer.files[0]) { selectedFile = e.dataTransfer.files[0]; updateFileInfo(selectedFile); updateSaveButton(); }
});
document.getElementById('memeFile').addEventListener('change', function () {
  if (this.files[0]) { selectedFile = this.files[0]; updateFileInfo(selectedFile); updateSaveButton(); }
});
document.getElementById('saveFileButton').addEventListener('click', saveVideoToDirectory);
document.getElementById('testUrlBtn').addEventListener('click', testUrl);
document.getElementById('saveCloudSettingsBtn').addEventListener('click', saveCloudSettings);
document.getElementById('clearData').addEventListener('click', async function () {
  if (confirm('Clear all submissions?')) {
    const memes = await getAllMemes();
    for (const m of memes) await deleteMeme(m.id);
    updateCounts();
    setFormMessage('All data cleared.', 'success');
  }
});

document.getElementById('uploadForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  let fileForCloud = null;
  let newMeme;

  if (method === 'upload') {
    if (!selectedFile) { setFormMessage('Please choose a file.', 'error'); return; }
    if (selectedFile.size > 20 * 1024 * 1024) { setFormMessage('File exceeds 20 MB limit.', 'error'); return; }
    fileForCloud = selectedFile;
    newMeme = buildMeme(selectedFile.name);
    newMeme.blobData = selectedFile;
    newMeme.source = 'upload';
  } else if (method === 'url') {
    const raw = document.getElementById('memeUrl').value.trim();
    const url = sanitizeUrl(raw);
    if (!url) { setFormMessage('Please paste a valid http(s) video link.', 'error'); return; }
    const name = url.split('/').pop().split('?')[0] || ('clip-' + Date.now());
    newMeme = buildMeme(name);
    newMeme.fileUrl = url;
    newMeme.source = 'url';
  } else {
    setFormMessage('Choose a method.', 'error'); return;
  }

  await putMeme(newMeme);

  if (hasSupabaseConfig() && fileForCloud) {
    setFormMessage('Uploading to cloud...', 'success');
    try {
      const supabasePath = 'memes/' + Date.now() + '-' + newMeme.name.replace(/\s+/g, '_');
      const publicUrl = await uploadToSupabaseStorage(fileForCloud, supabasePath);
      newMeme.fileUrl = publicUrl;
      newMeme.filePath = supabasePath;
      await putMeme({ ...newMeme, fileUrl: publicUrl, filePath: supabasePath });
      const result = await uploadMemeToSupabase({ ...newMeme, fileUrl: publicUrl, filePath: supabasePath });
      if (result.ok) await putMeme({ ...newMeme, ...result.meme });
      else { setFormMessage('Saved locally, cloud: ' + result.error, 'error'); resetForm(); return; }
    } catch (e) {
      setFormMessage('Saved locally, upload failed: ' + e.message, 'error');
    }
  } else if (hasSupabaseConfig() && newMeme.fileUrl) {
    setFormMessage('Saving to cloud...', 'success');
    const result = await saveMemeToSupabase(newMeme);
    if (result.ok) await putMeme({ ...newMeme, ...result.meme });
    else { setFormMessage('Saved locally, cloud: ' + result.error, 'error'); resetForm(); return; }
  }

  setFormMessage('Meme added to review queue!', 'success');
  checkIndexedDBQuota();
  resetForm();
});

function buildMeme(name) {
  const tag = document.getElementById('memeTag').value.trim();
  return {
    name: name,
    mediaType: document.getElementById('mediaType').value,
    lang: document.getElementById('memeLang').value,
    category: document.getElementById('memeCategory').value,
    tag: tag || generateSmartTags(name),
    specialTag: document.getElementById('specialTag').value,
    status: 'pending',
    createdAt: Date.now()
  };
}

function resetForm() {
  const form = document.getElementById('uploadForm');
  form.reset();
  selectedFile = null;
  clearPreview();
  updateFileInfo(null);
  updateSaveButton();
  document.getElementById('memeUrl').value = '';
  document.getElementById('urlStatus').textContent = 'No link tested yet.';
  updateCounts();
}

function populateSelect(id, options, current) {
  const el = document.getElementById(id);
  emptyEl(el);
  options.forEach(v => {
    const opt = createEl('option', { value: v }, [v]);
    if (v === current) opt.selected = true;
    el.appendChild(opt);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  populateSelect('memeCategory', categories, 'Sound Effect');
  populateSelect('specialTag', specialTags, 'None');
  updateSaveButton();
  updateCounts();
  loadCloudSettings();
  document.getElementById('langToggleWrap').appendChild(createLangToggle());
});
