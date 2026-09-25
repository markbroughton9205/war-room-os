export function status(value) {
  if (value == null) return 'EMPTY'
  const trimmed = String(value).trim()
  return trimmed || 'EMPTY'
}
