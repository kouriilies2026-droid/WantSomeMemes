import { getPref, setPref, getAllMemes } from './app.js';
import { FAVORITE_IDS_KEY } from './config.js';

const STATS_KEY = 'memeStats';

async function getStats() {
  const stats = await getPref(STATS_KEY, {});
  return typeof stats === 'object' && stats !== null ? stats : {};
}

async function saveStats(stats) {
  await setPref(STATS_KEY, stats);
}

function getFavIds() {
  try { return JSON.parse(localStorage.getItem(FAVORITE_IDS_KEY) || '[]'); } catch (e) { return []; }
}

export async function trackView(memeId) {
  const stats = await getStats();
  const id = String(memeId);
  if (!stats[id]) stats[id] = { views: 0, downloads: 0, viewHistory: [] };
  stats[id].views = (stats[id].views || 0) + 1;
  stats[id].viewHistory.push(Date.now());
  stats[id].lastViewed = Date.now();
  await saveStats(stats);
}

export async function trackDownload(memeId) {
  const stats = await getStats();
  const id = String(memeId);
  if (!stats[id]) stats[id] = { views: 0, downloads: 0, viewHistory: [] };
  stats[id].downloads = (stats[id].downloads || 0) + 1;
  await saveStats(stats);
}

export async function getMostViewed(limit = 10) {
  const stats = await getStats();
  const all = await getAllMemes('approved');
  return Object.entries(stats)
    .filter(([id]) => all.some(m => String(m.id) === id))
    .map(([id, s]) => {
      const meme = all.find(m => String(m.id) === id);
      return { meme, views: s.views || 0, downloads: s.downloads || 0 };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export async function getMostDownloaded(limit = 10) {
  const stats = await getStats();
  const all = await getAllMemes('approved');
  return Object.entries(stats)
    .filter(([id]) => all.some(m => String(m.id) === id))
    .map(([id, s]) => {
      const meme = all.find(m => String(m.id) === id);
      return { meme, views: s.views || 0, downloads: s.downloads || 0 };
    })
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, limit);
}

export async function getMostFavorited(limit = 10) {
  const favIds = getFavIds();
  const favCount = {};
  favIds.forEach(id => { favCount[id] = (favCount[id] || 0) + 1; });
  const all = await getAllMemes('approved');
  return Object.entries(favCount)
    .filter(([id]) => all.some(m => String(m.id) === id))
    .map(([id, count]) => {
      const meme = all.find(m => String(m.id) === id);
      return { meme, views: 0, downloads: 0, favCount: count };
    })
    .sort((a, b) => b.favCount - a.favCount)
    .slice(0, limit);
}

export async function getTrending(limit = 10, days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const stats = await getStats();
  const all = await getAllMemes('approved');
  return Object.entries(stats)
    .filter(([id]) => all.some(m => String(m.id) === id))
    .map(([id, s]) => {
      const recentViews = (s.viewHistory || []).filter(t => t >= cutoff).length;
      const meme = all.find(m => String(m.id) === id);
      return { meme, views: s.views || 0, downloads: s.downloads || 0, recentViews };
    })
    .filter(m => m.recentViews > 0)
    .sort((a, b) => b.recentViews - a.recentViews)
    .slice(0, limit);
}
