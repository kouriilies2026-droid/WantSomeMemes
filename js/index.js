import { getAllMemes, migrateFromLocalStorage } from './app.js';
import { initLanguage, createLangToggle } from './i18n.js';

initLanguage();

async function updateHomeStats() {
  const memes = await getAllMemes();
  const pending = memes.filter(m => m.status === 'pending');
  const approved = memes.filter(m => m.status === 'approved');
  document.getElementById('homePending').textContent = pending.length;
  document.getElementById('homeApproved').textContent = approved.length;
  document.getElementById('homeLibrary').textContent = approved.length + ' memes';
}

window.addEventListener('memes:updated', updateHomeStats);
window.addEventListener('focus', updateHomeStats);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') updateHomeStats();
});

window.addEventListener('DOMContentLoaded', async () => {
  await migrateFromLocalStorage();
  updateHomeStats();
  document.getElementById('langToggleWrap').appendChild(createLangToggle());
});

window.addEventListener('storage', updateHomeStats);
