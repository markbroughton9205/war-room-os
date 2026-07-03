// Only allow same-origin relative paths as post-login redirect targets, so a
// crafted `next` value can't bounce the Commander off to an external site.
export function isSafeRedirectPath(path: string): boolean {
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  if (/http/i.test(path)) return false
  if (path.includes(':')) return false
  return true
}
