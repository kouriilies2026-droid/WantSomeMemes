import { escapeHtml } from './app.js';

const lazyObserver = new IntersectionObserver((entries, obs) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const el = e.target;
      if (el.dataset.lazySrc) { el.src = el.dataset.lazySrc; el.removeAttribute('data-lazy-src'); }
      obs.unobserve(el);
    }
  });
}, { rootMargin: '120px' });

let trimStartTime = 0;
let trimEndTime = 0;
let currentMediaSrc = '';

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function parseTime(str) {
  const parts = str.split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  return 0;
}

function getUrlWithTrim(name, start, end) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  if (name) url.searchParams.set('name', name);
  if (start > 0) url.searchParams.set('start', formatTime(start));
  else url.searchParams.delete('start');
  if (end > 0) url.searchParams.set('end', formatTime(end));
  else url.searchParams.delete('end');
  return url.toString();
}

export function openFullscreen(src, name) {
  currentMediaSrc = src;
  const overlay = document.getElementById('fullscreenOverlay');
  const content = document.getElementById('fullscreenContent');
  const ext = (src || '').split('.').pop().toLowerCase();
  const isAudio = ['mp3','wav','ogg','m4a','aac'].includes(ext);
  const tag = isAudio ? 'audio' : 'video';

  content.innerHTML = ''
    + '<div class="fs-media-wrap">'
    + '<' + tag + ' id="fsMedia" src="' + escapeHtml(src) + '" controls autoplay playsinline class="media-fullsize"></' + tag + '>'
    + '</div>'
    + '<div class="fs-trim-bar" id="fsTrimBar">'
    + '<div class="fs-trim-row">'
    + '<label class="fs-trim-label">In: <input id="fsTrimIn" type="text" value="0:00" class="fs-time-input">'
    + '<input id="fsTrimInRange" type="range" min="0" max="100" value="0" step="0.1" class="fs-trim-range"></label>'
    + '<label class="fs-trim-label">Out: <input id="fsTrimOut" type="text" value="0:00" class="fs-time-input">'
    + '<input id="fsTrimOutRange" type="range" min="0" max="100" value="100" step="0.1" class="fs-trim-range"></label>'
    + '</div>'
    + '<div class="fs-trim-actions">'
    + '<button id="fsCopyLinkBtn" type="button" class="fs-copy-link">Copy Link with Trim</button>'
    + '<button id="fsResetTrimBtn" type="button" class="fs-reset-trim">Reset</button>'
    + '</div>'
    + '</div>';

  overlay.classList.add('visible');

  const media = document.getElementById('fsMedia');
  const inVal = document.getElementById('fsTrimIn');
  const outVal = document.getElementById('fsTrimOut');
  const inRange = document.getElementById('fsTrimInRange');
  const outRange = document.getElementById('fsTrimOutRange');

  trimStartTime = 0;
  trimEndTime = 0;

  media.addEventListener('loadedmetadata', () => {
    const dur = media.duration || 10;
    inRange.max = dur; outRange.max = dur;
    outRange.value = dur; outVal.value = formatTime(dur);
    trimEndTime = dur;
  });

  function syncInSlider() {
    const t = parseTime(inVal.value);
    if (!isNaN(t) && t >= 0 && t <= parseFloat(inRange.max)) {
      inRange.value = t;
      if (t >= parseFloat(outRange.value)) {
        const newOut = Math.min(t + 1, parseFloat(inRange.max));
        outRange.value = newOut; outVal.value = formatTime(newOut);
        trimEndTime = newOut;
      }
      trimStartTime = t;
      media.currentTime = t;
    }
  }

  function syncOutSlider() {
    const t = parseTime(outVal.value);
    if (!isNaN(t) && t >= 0 && t <= parseFloat(outRange.max)) {
      outRange.value = t;
      if (t <= parseFloat(inRange.value)) {
        const newIn = Math.max(t - 1, 0);
        inRange.value = newIn; inVal.value = formatTime(newIn);
        trimStartTime = newIn;
      }
      trimEndTime = t;
    }
  }

  inVal.addEventListener('change', syncInSlider);
  outVal.addEventListener('change', syncOutSlider);

  inRange.addEventListener('input', () => {
    const v = parseFloat(inRange.value);
    inVal.value = formatTime(v);
    if (v >= parseFloat(outRange.value)) {
      const newOut = Math.min(v + 1, parseFloat(inRange.max));
      outRange.value = newOut; outVal.value = formatTime(newOut);
      trimEndTime = newOut;
    }
    trimStartTime = v;
    media.currentTime = v;
  });

  outRange.addEventListener('input', () => {
    const v = parseFloat(outRange.value);
    outVal.value = formatTime(v);
    if (v <= parseFloat(inRange.value)) {
      const newIn = Math.max(v - 1, 0);
      inRange.value = newIn; inVal.value = formatTime(newIn);
      trimStartTime = newIn;
    }
    trimEndTime = v;
  });

  let trimActive = false;

  document.getElementById('fsCopyLinkBtn').addEventListener('click', () => {
    const startT = parseTime(inVal.value);
    const endT = parseTime(outVal.value);
    const link = getUrlWithTrim(name, startT, endT > 0 && endT < parseFloat(inRange.max) ? endT : 0);
    navigator.clipboard.writeText(link).then(() => {
      const btn = document.getElementById('fsCopyLinkBtn');
      btn.textContent = '✔ Copied!';
      setTimeout(() => { btn.textContent = 'Copy Link with Trim'; }, 2000);
    }).catch(() => alert('Copy failed.'));
  });

  document.getElementById('fsResetTrimBtn').addEventListener('click', () => {
    const dur = media.duration || 10;
    inVal.value = '0:00'; inRange.value = 0;
    outVal.value = formatTime(dur); outRange.value = dur;
    trimStartTime = 0; trimEndTime = dur;
    media.currentTime = 0;
    trimActive = false;
  });

  media.addEventListener('timeupdate', () => {
    if (trimEndTime > 0 && media.currentTime >= trimEndTime) {
      if (trimStartTime > 0) {
        media.currentTime = trimStartTime;
        media.play().catch(() => {});
      } else {
        media.pause();
      }
    }
  });

  const params = new URLSearchParams(window.location.search);
  const paramStart = params.get('start');
  const paramEnd = params.get('end');
  if (paramStart) {
    media.addEventListener('loadedmetadata', () => {
      const st = parseTime(paramStart);
      if (!isNaN(st) && st < media.duration) {
        inVal.value = paramStart; inRange.value = st;
        trimStartTime = st;
        media.currentTime = st;
        if (paramEnd) {
          const et = parseTime(paramEnd);
          if (!isNaN(et) && et > st && et <= media.duration) {
            outVal.value = paramEnd; outRange.value = et;
            trimEndTime = et;
          }
        }
        media.play().catch(() => {});
      }
    }, { once: true });
  }
}

export async function closeFullscreen() {
  document.getElementById('fullscreenOverlay').classList.remove('visible');
  document.getElementById('fullscreenContent').innerHTML = '';
  if (currentMediaSrc) {
    const name = currentMediaSrc.split('/').pop();
    const { revokeBlobUrl } = await import('./app.js');
    revokeBlobUrl(name);
  }
  trimStartTime = 0;
  trimEndTime = 0;
  currentMediaSrc = '';
}

document.addEventListener('keydown', (e) => {
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'Escape') closeFullscreen();
});

export function initTrimmer(videoEl) {
  const wrap = videoEl.closest('.media-wrap');
  if (!wrap) return;
  const trimWrap = wrap.parentElement.querySelector('.trimmer-wrap');
  if (!trimWrap) return;
  const inSl = trimWrap.querySelector('.trim-in');
  const outSl = trimWrap.querySelector('.trim-out');
  const inV = trimWrap.querySelector('.trim-in-val');
  const outV = trimWrap.querySelector('.trim-out-val');
  videoEl.addEventListener('loadedmetadata', () => {
    const dur = videoEl.duration || 10;
    outSl.max = dur; outSl.value = dur; inSl.max = dur;
    inV.textContent = '0:00'; outV.textContent = formatTime(dur);
  });
  inSl.addEventListener('input', () => {
    const v = parseFloat(inSl.value);
    inV.textContent = formatTime(v);
    if (v >= parseFloat(outSl.value)) { outSl.value = v + 0.1; outV.textContent = formatTime(v + 0.1); }
  });
  outSl.addEventListener('input', () => {
    const v = parseFloat(outSl.value);
    outV.textContent = formatTime(v);
    if (v <= parseFloat(inSl.value)) { inSl.value = v - 0.1; inV.textContent = formatTime(v - 0.1); }
  });
}

export function toggleGreenScreen(button) {
  const mw = button.closest('.media-wrap');
  const video = mw ? mw.querySelector('video') : null;
  if (!video) return;
  const cw = mw.querySelector('.green-screen-controls');
  const sw = cw ? cw.querySelector('.chroma-slider-wrap') : null;
  const ts = sw ? sw.querySelector('input[type="range"]') : null;
  const tl = sw ? sw.querySelector('.chroma-val') : null;
  const active = button.classList.toggle('active');
  const ec = mw.querySelector('canvas.green-screen-canvas');
  if (!active) {
    if (video.dataset.renderFrameId) { cancelAnimationFrame(Number(video.dataset.renderFrameId)); delete video.dataset.renderFrameId; }
    video.dataset.greenScreenActive = 'false'; video.style.display = '';
    if (ec) ec.remove(); video.pause();
    button.textContent = 'Apply Chroma Key';
    if (sw) sw.classList.remove('visible');
    return;
  }
  button.textContent = 'Show Original'; video.style.display = 'none';
  if (sw) sw.classList.add('visible');
  let canvas = ec;
  if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'green-screen-canvas'; mw.appendChild(canvas); }
  if (ts && tl) { ts.oninput = function () { tl.textContent = ts.value; }; }
  const renderFrame = () => {
    if (video.dataset.greenScreenActive !== 'true') return;
    if (!video.paused && !video.ended) {
      const w = video.videoWidth || 640, h = video.videoHeight || 360;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      const imd = ctx.getImageData(0, 0, w, h);
      const d = imd.data;
      const tol = ts ? parseInt(ts.value, 10) : 35;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 90 && d[i + 1] > d[i] + tol && d[i + 1] > d[i + 2] + tol) d[i + 3] = 0;
      }
      ctx.putImageData(imd, 0, 0);
    }
    video.dataset.renderFrameId = requestAnimationFrame(renderFrame);
  };
  if (video.dataset.renderFrameId) { cancelAnimationFrame(Number(video.dataset.renderFrameId)); delete video.dataset.renderFrameId; }
  video.dataset.greenScreenActive = 'true'; video.muted = true;
  video.play().catch(() => {});
  video.dataset.renderFrameId = requestAnimationFrame(renderFrame);
}

export function activateVideo(wrap, src, memeId) {
  if (wrap.querySelector('video')) return;
  const img = wrap.querySelector('img');
  const po = wrap.querySelector('.play-overlay');
  if (po) po.remove();
  if (img) img.remove();
  const video = document.createElement('video');
  video.src = src; video.crossOrigin = 'anonymous'; video.muted = true;
  video.loop = true; video.controls = true; video.playsInline = true;
  video.preload = 'metadata';
  video.style.width = '100%'; video.style.display = 'block';
  wrap.insertBefore(video, wrap.firstChild);
  video.play().catch(() => {});
  const trimWrap = wrap.parentElement.querySelector('.trimmer-wrap');
  if (trimWrap) trimWrap.classList.add('visible');
  setTimeout(() => initTrimmer(video), 100);
}

export function handleDragStart(event, name, src) {
  event.dataTransfer.setData('text/plain', src);
  event.dataTransfer.setData('text/uri-list', src);
  event.dataTransfer.setData('downloadurl', name + ':' + src);
  event.dataTransfer.effectAllowed = 'copyLink';
}

export function observeLazyMedia() {
  document.querySelectorAll('[data-lazy-src]').forEach(el => lazyObserver.observe(el));
}
