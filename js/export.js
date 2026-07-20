import { getMediaSource, showToast } from './app.js';

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

function safeSrc(raw) {
  const s = sanitizeUrl(raw);
  return s || raw;
}

let ffInstance = null;

async function loadFFmpeg() {
  if (ffInstance) return ffInstance;
  try {
    const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/ffmpeg.min.js');
    const { toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
    const ff = new FFmpeg();
    const base = typeof SharedArrayBuffer !== 'undefined'
      ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'
      : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ff.load({
      coreURL: await toBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm')
    });
    ffInstance = ff;
    return ff;
  } catch (e) {
    console.warn('FFmpeg.wasm failed to load:', e);
    return null;
  }
}

function bestMimeType() {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
  return '';
}

async function fallbackTrimExport(m, inSl, outSl, prog, progF) {
  const rawSrc = getMediaSource(m);
  const src = safeSrc(rawSrc);
  if (!src) { showToast('Cannot resolve media source for export.'); return; }

  const tv = document.createElement('video');
  tv.src = src; tv.muted = true; tv.preload = 'auto';
  if (src.startsWith('http')) tv.crossOrigin = 'anonymous';
  await new Promise((r, j) => {
    tv.onloadedmetadata = () => r();
    tv.onerror = () => j(new Error('Failed to load video for export.'));
    setTimeout(() => j(new Error('Video load timeout.')), 15000);
  }).catch(e => { throw e; });

  const inTime = inSl ? parseFloat(inSl.value) : 0;
  const outTime = outSl ? parseFloat(outSl.value) : tv.duration;
  const dur = Math.max(0.1, Math.min(outTime - inTime, tv.duration || 10));
  tv.currentTime = inTime; await new Promise(r => { tv.onseeked = r; }).catch(() => {});

  const canvas = document.createElement('canvas');
  canvas.width = tv.videoWidth || 640; canvas.height = tv.videoHeight || 360;
  const ctx = canvas.getContext('2d');
  if (prog) { prog.classList.add('visible'); if (progF) progF.style.width = '0%'; }

  const stream = canvas.captureStream(30);
  const mime = bestMimeType();
  const chunks = [];
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = () => r(new Blob(chunks, { type: rec.mimeType || 'video/webm' })); });
  rec.start();

  let playing = false;
  const startPlay = async () => {
    try {
      await tv.play();
      playing = true;
    } catch (e) {
      console.warn('Fallback play failed:', e);
      rec.stop();
    }
  };

  const st = performance.now();
  const render = () => {
    if (!playing && rec.state === 'recording') { startPlay(); }
    const el = (performance.now() - st) / 1000;
    if (el >= dur || tv.ended) {
      if (rec.state === 'recording') rec.stop();
      tv.pause();
      return;
    }
    if (progF) progF.style.width = Math.min((el / dur) * 100, 100) + '%';
    ctx.drawImage(tv, 0, 0, canvas.width, canvas.height);
    tv.requestVideoFrameCallback ? tv.requestVideoFrameCallback(render) : requestAnimationFrame(render);
  };

  await startPlay();
  tv.requestVideoFrameCallback ? tv.requestVideoFrameCallback(render) : requestAnimationFrame(render);

  const blob = await done;
  if (blob.size === 0) { showToast('Export produced empty file.'); if (prog) prog.classList.remove('visible'); return; }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = m.name.replace(/\.[^.]+$/, '_trimmed.webm');
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  if (prog) prog.classList.remove('visible');
  showToast('Trimmed video exported (fallback).');
}

async function fallbackTransparentExport(m, tol, prog, progF) {
  const rawSrc = getMediaSource(m);
  const src = safeSrc(rawSrc);
  if (!src) { showToast('Cannot resolve media source for export.'); return; }

  const tv = document.createElement('video');
  tv.src = src; tv.muted = true; tv.preload = 'auto';
  if (src.startsWith('http')) tv.crossOrigin = 'anonymous';
  await new Promise((r, j) => {
    tv.onloadedmetadata = () => r();
    tv.onerror = () => j(new Error('Failed to load video for export.'));
    setTimeout(() => j(new Error('Video load timeout.')), 15000);
  }).catch(e => { throw e; });

  const w = tv.videoWidth || 640, h = tv.videoHeight || 360;
  if (prog) { prog.classList.add('visible'); if (progF) progF.style.width = '0%'; }
  const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
  const octx = oc.getContext('2d', { willReadFrequently: true });
  const stream = oc.captureStream(30);
  const mime = bestMimeType();
  const chunks = [];
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = () => r(new Blob(chunks, { type: rec.mimeType || 'video/webm' })); });
  rec.start();
  tv.currentTime = 0; await new Promise(r => { tv.onseeked = r; }).catch(() => {});

  let playing = false;
  const startPlay = async () => {
    try {
      await tv.play();
      playing = true;
    } catch (e) {
      console.warn('Fallback play failed:', e);
      rec.stop();
    }
  };

  const dur = tv.duration || 5;
  const st = performance.now();
  const render = () => {
    if (!playing && rec.state === 'recording') { startPlay(); }
    const el = (performance.now() - st) / 1000;
    if (el >= dur || tv.ended) {
      if (rec.state === 'recording') rec.stop();
      tv.pause();
      return;
    }
    if (progF) progF.style.width = Math.min((el / dur) * 100, 100) + '%';
    octx.drawImage(tv, 0, 0, w, h);
    const id = octx.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] > 90 && d[i + 1] > d[i] + tol && d[i + 1] > d[i + 2] + tol) d[i + 3] = 0;
    }
    octx.putImageData(id, 0, 0);
    tv.requestVideoFrameCallback ? tv.requestVideoFrameCallback(render) : requestAnimationFrame(render);
  };

  await startPlay();
  tv.requestVideoFrameCallback ? tv.requestVideoFrameCallback(render) : requestAnimationFrame(render);

  const blob = await done;
  if (blob.size === 0) { showToast('Export produced empty file.'); if (prog) prog.classList.remove('visible'); return; }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = m.name.replace(/\.[^.]+$/, '_transparent.webm');
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  if (prog) prog.classList.remove('visible');
  showToast('Transparent WebM exported (fallback).');
}

export async function exportTrimmed(id, memes) {
  const m = memes.find(x => String(x.id) === String(id));
  if (!m) return;
  const ext = m.name.split('.').pop().toLowerCase();
  if (['mp3','wav','ogg','m4a','aac','png','jpg','jpeg','gif','webp'].includes(ext)) { alert('Video only.'); return; }
  const card = document.querySelector('[data-meme-id="' + id + '"]');
  const tw = card ? card.querySelector('.trimmer-wrap') : null;
  const inSl = tw ? tw.querySelector('.trim-in') : null;
  const outSl = tw ? tw.querySelector('.trim-out') : null;
  const prog = card ? card.querySelector('.export-progress') : null;
  const progF = card ? card.querySelector('.export-progress-fill') : null;

  const ff = await loadFFmpeg();
  if (!ff) {
    try { await fallbackTrimExport(m, inSl, outSl, prog, progF); }
    catch (e) { console.warn('Fallback trim failed:', e); showToast('Export failed.'); }
    return;
  }

  try {
    if (prog) { prog.classList.add('visible'); if (progF) progF.style.width = '10%'; }
    const src = safeSrc(getMediaSource(m));
    if (!src) { showToast('Cannot resolve media source.'); return; }
    const resp = await fetch(src);
    const buf = await resp.arrayBuffer();
    await ff.writeFile('input' + ext, new Uint8Array(buf));
    const inT = inSl ? parseFloat(inSl.value) : 0;
    const outT = outSl ? parseFloat(outSl.value) : '99:99';
    await ff.exec(['-i', 'input' + ext, '-ss', String(inT), '-to', String(outT), '-c', 'copy', '-copyts', 'output_trimmed' + ext]);
    if (progF) progF.style.width = '80%';
    const data = await ff.readFile('output_trimmed' + ext);
    const blob = new Blob([data.buffer], { type: 'video/' + (ext === 'mp4' ? 'mp4' : 'webm') });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = m.name.replace(/\.[^.]+$/, '_trimmed.' + ext);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (prog) prog.classList.remove('visible');
    showToast('Trimmed video exported!');
  } catch (e) {
    console.warn('FFmpeg trim failed, using fallback:', e);
    await fallbackTrimExport(m, inSl, outSl, prog, progF);
  }
}

export async function exportTransparent(id, memes) {
  const m = memes.find(x => String(x.id) === String(id));
  if (!m) return;
  const ext = m.name.split('.').pop().toLowerCase();
  if (['mp3','wav','ogg','m4a','aac','png','jpg','jpeg','gif','webp'].includes(ext)) { alert('Video only.'); return; }
  const card = document.querySelector('[data-meme-id="' + id + '"]');
  const sw = card ? card.querySelector('.chroma-slider-wrap') : null;
  const ts = sw ? sw.querySelector('input[type="range"]') : null;
  const tol = ts ? parseInt(ts.value, 10) : 35;
  const prog = card ? card.querySelector('.export-progress') : null;
  const progF = card ? card.querySelector('.export-progress-fill') : null;

  const ff = await loadFFmpeg();
  if (!ff) {
    try { await fallbackTransparentExport(m, tol, prog, progF); }
    catch (e) { console.warn('Fallback transparent failed:', e); showToast('Export failed.'); }
    return;
  }

  try {
    if (prog) { prog.classList.add('visible'); if (progF) progF.style.width = '10%'; }
    const src = safeSrc(getMediaSource(m));
    if (!src) { showToast('Cannot resolve media source.'); return; }
    const resp = await fetch(src);
    const buf = await resp.arrayBuffer();
    await ff.writeFile('input' + ext, new Uint8Array(buf));
    const filter = 'colorkey=0x00ff00:' + (tol / 100) + ':0.1';
    await ff.exec(['-i', 'input' + ext, '-vf', filter, '-c:v', 'libvpx-vp9', '-lossless', '1', 'output_transparent.webm']);
    if (progF) progF.style.width = '80%';
    const data = await ff.readFile('output_transparent.webm');
    const blob = new Blob([data.buffer], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = m.name.replace(/\.[^.]+$/, '_transparent.webm');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (prog) prog.classList.remove('visible');
    showToast('Transparent WebM exported!');
  } catch (e) {
    console.warn('FFmpeg transparent failed, using fallback:', e);
    await fallbackTransparentExport(m, tol, prog, progF);
  }
}
