import { createClient } from '@supabase/supabase-js';
import { getAllMemes, putMeme, deleteMeme } from './app.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_BUCKET, SUPABASE_TABLE, SUPABASE_CONFIG_KEYS } from './config.js';

let supabase = null;
let channel = null;
const listeners = [];

export function getSupabaseConfig() {
  const c = {};
  Object.entries(SUPABASE_CONFIG_KEYS).forEach(([k, sk]) => {
    c[k] = localStorage.getItem(sk) || '';
  });
  if (!c.url && SUPABASE_URL) c.url = SUPABASE_URL;
  if (!c.anonKey && SUPABASE_ANON_KEY) c.anonKey = SUPABASE_ANON_KEY;
  if (!c.storageBucket && SUPABASE_STORAGE_BUCKET) c.storageBucket = SUPABASE_STORAGE_BUCKET;
  return c;
}

export function saveSupabaseConfig(config) {
  Object.entries(SUPABASE_CONFIG_KEYS).forEach(([k, sk]) => {
    const v = (config[k] || '').trim();
    if (v) localStorage.setItem(sk, v); else localStorage.removeItem(sk);
  });
}

export function hasSupabaseConfig() {
  const c = getSupabaseConfig();
  return Boolean(c.url && c.anonKey);
}

export async function ensureSupabase() {
  if (supabase) return supabase;
  const c = getSupabaseConfig();
  if (!c.url || !c.anonKey) return null;
  supabase = createClient(c.url, c.anonKey, {
    auth: { persistSession: false }
  });
  return supabase;
}

export async function uploadToSupabaseStorage(file, path) {
  const client = await ensureSupabase();
  if (!client) throw new Error('Supabase not configured');
  const bucket = getSupabaseConfig().storageBucket || SUPABASE_STORAGE_BUCKET;
  const { data, error } = await client.storage
    .from(bucket)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream'
    });
  if (error) throw error;
  const { data: urlData } = client.storage
    .from(bucket)
    .getPublicUrl(path);
  return urlData.publicUrl;
}

export async function deleteFromSupabaseStorage(path) {
  const client = await ensureSupabase();
  if (!client) return;
  const bucket = getSupabaseConfig().storageBucket || SUPABASE_STORAGE_BUCKET;
  await client.storage.from(bucket).remove([path]);
}

export async function uploadMemeToSupabase(meme) {
  const client = await ensureSupabase();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  try {
    const payload = {
      ...meme,
      status: 'pending',
      cloud_synced_at: new Date().toISOString()
    };
    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .insert([payload])
      .select()
      .single();
    if (error) throw error;
    return { ok: true, meme: { ...data, cloudDocId: data.id } };
  } catch (e) {
    return { ok: false, error: e.message || 'Upload failed' };
  }
}

export async function saveMemeToSupabase(meme) {
  const client = await ensureSupabase();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  try {
    const payload = { ...meme, status: 'pending', cloud_synced_at: new Date().toISOString() };
    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .insert([payload])
      .select()
      .single();
    if (error) throw error;
    return { ok: true, meme: { ...data, cloudDocId: data.id } };
  } catch (e) {
    return { ok: false, error: e.message || 'Save failed' };
  }
}

export async function updateMemeInSupabase(meme, newStatus) {
  const client = await ensureSupabase();
  if (!client || !meme.cloudDocId) return { ok: false, error: 'No cloud record' };
  try {
    const { error } = await client
      .from(SUPABASE_TABLE)
      .update({
        ...meme,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', meme.cloudDocId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deleteMemeFromSupabase(meme) {
  const client = await ensureSupabase();
  if (!client || !meme.cloudDocId) return { ok: false, error: 'No cloud record' };
  try {
    const { error } = await client
      .from(SUPABASE_TABLE)
      .delete()
      .eq('id', meme.cloudDocId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function syncToIndexedDB() {
  const client = await ensureSupabase();
  if (!client) return;
  try {
    const { data: cloud, error } = await client
      .from(SUPABASE_TABLE)
      .select('*');
    if (error) throw error;
    const existing = await getAllMemes();
    const seen = new Map(existing.map(m => [String(m.cloudDocId || m.id), m]));
    for (const m of cloud) {
      const key = String(m.cloudDocId || m.id);
      const old = seen.get(key);
      if (!old) {
        await putMeme(m);
      } else {
        const cloudTime = m.updated_at ? new Date(m.updated_at).getTime() : (m.cloud_synced_at ? new Date(m.cloud_synced_at).getTime() : 0);
        const localTime = old.updatedAt || old.cloudSyncedAt || 0;
        if (cloudTime > localTime || old.status !== m.status || old.fileUrl !== m.fileUrl || old.image_url !== m.image_url) {
          await putMeme({ ...old, ...m });
        }
      }
    }
  } catch (e) {
    console.warn('Cloud sync:', e);
  }
}

export function onChange(cb) {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export async function startRealtimeListener() {
  const client = await ensureSupabase();
  if (!client || channel) return;
  channel = client
    .channel('public:memes')
    .on('postgres_changes', { event: '*', schema: 'public', table: SUPABASE_TABLE }, async () => {
      await syncToIndexedDB();
      listeners.forEach(fn => {
        try { fn('snapshot'); } catch (e) { console.warn(e); }
      });
    })
    .subscribe();
}

export function stopRealtimeListener() {
  if (channel) {
    channel.unsubscribe();
    channel = null;
  }
}

export function getConfig() {
  return getSupabaseConfig();
}

export function saveConfig(config) {
  saveSupabaseConfig(config);
}

export function hasConfig() {
  return hasSupabaseConfig();
}

export async function signInAdmin(email, password) {
  const client = await ensureSupabase();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: e.message || 'Sign in failed' };
  }
}

export async function signOutAdmin() {
  const client = await ensureSupabase();
  if (!client) return;
  try { await client.auth.signOut(); } catch (e) { console.warn(e); }
}

export function getCurrentUser() {
  return supabase?.auth?.getUser?.() || null;
}

export function onAdminAuthChange(cb) {
  ensureSupabase().then(client => {
    if (!client) { cb(null); return; }
    client.auth.getSession().then(({ data }) => cb(data.session?.user || null));
  });
}
