export function rowState(row) {
  if (!row || !row.title) return 'UNKNOWN';
  const parts = row.title.split(' · ');
  const lastPart = parts[parts.length - 1];
  if (!lastPart) return 'UNKNOWN';
  const stateMatch = lastPart.match(/^[A-Z_]+$/);
  return stateMatch ? lastPart : 'UNKNOWN';
}

export function filterRows(rows, filter = {}) {
  if (!Array.isArray(rows)) return [];
  const { state, text } = filter;
  const filtered = rows.filter(row => {
    const rowStateValue = rowState(row);
    const stateOk = state === 'ALL' || state === '' || !state || rowStateValue === state;
    const textOk = !text || row.title?.toLowerCase().includes(text.trim().toLowerCase()) || row.detail?.toLowerCase().includes(text.trim().toLowerCase());
    return stateOk && textOk;
  });
  return filtered;
}

export function stateCounts(rows) {
  if (!Array.isArray(rows)) return {};
  const counts = {};
  rows.forEach(row => {
    const state = rowState(row);
    counts[state] = (counts[state] || 0) + 1;
  });
  return counts;
}
