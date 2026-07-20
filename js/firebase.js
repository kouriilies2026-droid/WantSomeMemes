import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, addDoc, doc, setDoc, deleteDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { FIREBASE_CONFIG_KEYS } from './config.js';
import { getAllMemes, putMeme } from './app.js';

let app = null;
let db = null;
let storage = null;
let auth = null;
let unsubscribe = null;
const listeners = [];

export function getConfig() {
  const c = {};
  Object.entries(FIREBASE_CONFIG_KEYS).forEach(([k, sk]) => { c[k] = localStorage.getItem(sk) || ''; });
  return c;
}

export function saveConfig(config) {
  Object.entries(FIREBASE_CONFIG_KEYS).forEach(([k, sk]) => {
    const v = (config[k] || '').trim();
    if (v) localStorage.setItem(sk, v); else localStorage.removeItem(sk);
  });
}

export function hasConfig() {
  const c = getConfig();
  return Boolean(c.projectId && c.storageBucket && c.apiKey && c.authDomain && c.appId);
}

export async function ensure() {
  if (db) return { app, db, storage, auth };
  if (!hasConfig()) return null;
  const c = getConfig();
  if (!getApps().length) {
    app = initializeApp({
      apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId,
      storageBucket: c.storageBucket, appId: c.appId, measurementId: c.measurementId || ''
    });
  }
  db = getFirestore(app);
  storage = getStorage(app);
  auth = getAuth(app);
  return { app, db, storage, auth };
}

export async function signInAdmin(email, password) {
  const r = await ensure();
  if (!r) return { ok: false, error: 'Firebase not configured' };
  try {
    await signInWithEmailAndPassword(r.auth, email, password);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Sign in failed' };
  }
}

export async function signOutAdmin() {
  if (!auth) return;
  try { await signOut(auth); } catch (e) { console.warn(e); }
}

export function onAdminAuthChange(cb) {
  ensure().then(r => {
    if (r && r.auth) {
      onAuthStateChanged(r.auth, user => cb(user));
    } else {
      cb(null);
    }
  });
}

export function getCurrentUser() {
  return auth ? auth.currentUser : null;
}

export async function uploadMeme(file, meme, thumbDataUrl) {
  const r = await ensure();
  if (!r) return { ok: false, error: 'Cloud not configured' };
  try {
    const safeName = Date.now() + '-' + String(meme.name || 'meme').replace(/\s+/g, '_');
    const storageRef = ref(r.storage, 'memes/' + safeName);
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);
    let thumbnailUrl = null;
    if (thumbDataUrl) {
      const tRef = ref(r.storage, 'thumbnails/' + (meme.id || safeName) + '.jpg');
      const thumbBlob = await (await fetch(thumbDataUrl)).blob();
      await uploadBytes(tRef, thumbBlob);
      thumbnailUrl = await getDownloadURL(tRef);
    }
    const payload = { ...meme, status: 'pending', fileName: meme.name, filePath: 'memes/' + safeName, fileUrl, thumbnailUrl, cloudSyncedAt: Date.now() };
    const docRef = await addDoc(collection(r.db, 'memes'), payload);
    payload.cloudDocId = docRef.id;
    return { ok: true, meme: payload };
  } catch (e) {
    return { ok: false, error: e.message || 'Upload failed' };
  }
}

export async function saveMemeToCloud(meme) {
  const r = await ensure();
  if (!r) return { ok: false, error: 'Cloud not configured' };
  try {
    const payload = { ...meme, status: 'pending', fileName: meme.name, cloudSyncedAt: Date.now() };
    const docRef = await addDoc(collection(r.db, 'memes'), payload);
    payload.cloudDocId = docRef.id;
    return { ok: true, meme: payload };
  } catch (e) {
    return { ok: false, error: e.message || 'Save failed' };
  }
}

export async function updateMeme(meme, newStatus) {
  const r = await ensure();
  if (!r || !meme.cloudDocId) return { ok: false, error: 'No cloud record' };
  try {
    await setDoc(doc(r.db, 'memes', meme.cloudDocId), { ...meme, status: newStatus, updatedAt: Date.now() }, { merge: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function deleteCloudMeme(meme) {
  const r = await ensure();
  if (!r || !meme.cloudDocId) return { ok: false, error: 'No cloud record' };
  try {
    await deleteDoc(doc(r.db, 'memes', meme.cloudDocId));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function syncToIndexedDB() {
  const r = await ensure();
  if (!r) return;
  try {
    const snap = await getDocs(collection(r.db, 'memes'));
    const cloud = snap.docs.map(d => ({ ...d.data(), cloudDocId: d.id }));
    const existing = await getAllMemes();
    const seen = new Set(existing.map(m => String(m.cloudDocId || m.id)));
    for (const m of cloud) {
      const key = String(m.cloudDocId || m.id);
      if (seen.has(key)) {
        const old = existing.find(x => String(x.cloudDocId || x.id) === key);
        if (old && (m.updatedAt || m.cloudSyncedAt || 0) > (old.updatedAt || old.cloudSyncedAt || 0)) {
          await putMeme({ ...old, ...m });
        }
      } else {
        await putMeme(m);
        seen.add(key);
      }
    }
  } catch (e) { console.warn('Cloud sync:', e); }
}

export function onChange(cb) {
  listeners.push(cb);
  return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
}

export async function startListener() {
  const r = await ensure();
  if (!r || unsubscribe) return;
  unsubscribe = onSnapshot(collection(r.db, 'memes'), async () => {
    await syncToIndexedDB();
    listeners.forEach(fn => { try { fn('snapshot'); } catch (e) { console.warn(e); } });
  }, console.warn);
}

export function stopListener() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
