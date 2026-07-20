let fuseInstance = null;
let lastMemes = [];

export function buildIndex(memes) {
  lastMemes = memes;
  if (typeof Fuse === 'undefined') return;
  fuseInstance = new Fuse(memes, {
    keys: [
      { name: 'name', weight: 1 },
      { name: 'tag', weight: 1.2 },
      { name: 'category', weight: 0.8 },
      { name: 'specialTag', weight: 0.6 },
      { name: 'lang', weight: 0.5 }
    ],
    threshold: 0.4,
    distance: 50,
    minMatchCharLength: 1,
    includeScore: true,
    shouldSort: true,
    findAllMatches: true,
    ignoreLocation: true
  });
}

export function search(query, filters) {
  let results = [];
  if (query && query.trim()) {
    if (fuseInstance) {
      results = fuseInstance.search(query.trim()).map(r => r.item);
    } else {
      const q = query.trim().toLowerCase();
      results = lastMemes.filter(m =>
        [m.name, m.tag, m.category, m.specialTag, m.lang].some(v =>
          String(v || '').toLowerCase().includes(q)
        )
      );
    }
  } else {
    results = [...lastMemes];
  }
  if (filters) {
    if (filters.type) results = results.filter(m => m.mediaType === filters.type);
    if (filters.category) results = results.filter(m => m.category === filters.category);
    if (filters.favOnly) results = results.filter(m => filters.favIds && filters.favIds.includes(String(m.id)));
  }
  if (filters && filters.sort) {
    results.sort((a, b) => {
      if (filters.sort === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      if (filters.sort === 'name') return String(a.name).localeCompare(String(b.name));
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }
  return results;
}
