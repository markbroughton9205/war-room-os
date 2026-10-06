// `server-only` is Next.js's client/server boundary marker — it has no real behavior of its own
// and is normally resolved through Next's bundler alias, not a real npm package. Validation
// scripts that transitively import any file marked `import 'server-only'` (there are several
// across lib/) fail plain-node module resolution without this stub.
const SERVER_ONLY_STUB_URL = 'data:text/javascript,export default undefined;'

async function resolveBase(specifier, context, defaultResolve) {
  if (specifier === 'server-only' || specifier === 'client-only') {
    return { url: SERVER_ONLY_STUB_URL, format: 'module', shortCircuit: true }
  }
  if (specifier === 'next/server') {
    return defaultResolve('next/server.js', context, defaultResolve)
  }
  if (specifier === 'next/headers') {
    return defaultResolve('next/headers.js', context, defaultResolve)
  }
  if (specifier.startsWith('@/')) {
    return resolveBase(`./${specifier.slice(2)}`, { ...context, parentURL: new URL('../', import.meta.url).href }, defaultResolve)
  }

  try {
    return await defaultResolve(specifier, context, defaultResolve)
  } catch (error) {
    if (
      error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT' &&
      (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'))
    ) {
      // A same-named sibling file (e.g. `providers.ts` next to a `providers/` directory) is what
      // real bundlers (webpack/Next.js) resolve first in this ambiguity — try that before
      // falling back to the directory's index.ts, or a real file can get shadowed by a directory
      // that has no index at all.
      try {
        return await defaultResolve(`${specifier}.ts`, context, defaultResolve)
      } catch {
        return defaultResolve(`${specifier}/index.ts`, context, defaultResolve)
      }
    }
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[cm]?[tj]sx?$/.test(specifier)
    ) {
      return defaultResolve(`${specifier}.ts`, context, defaultResolve)
    }
    throw error
  }
}

// Opt-in file overlay (used by Foundry's repair engine to run a validator against a CANDIDATE version of a file without touching the repository):
// FOUNDRY_OVERLAY is a JSON object { "<absolute path>": "<absolute path of the replacement>" }. Unset, nothing changes.
const OVERLAY = (() => {
  try { return process.env.FOUNDRY_OVERLAY ? JSON.parse(process.env.FOUNDRY_OVERLAY) : null } catch { return null }
})()

export async function resolve(specifier, context, defaultResolve) {
  const resolved = await resolveBase(specifier, context, defaultResolve)
  if (OVERLAY && typeof resolved?.url === 'string' && resolved.url.startsWith('file://')) {
    const replacement = OVERLAY[decodeURIComponent(new URL(resolved.url).pathname)]
    if (replacement) return { ...resolved, url: new URL(`file://${replacement}`).href, shortCircuit: true }
  }
  return resolved
}
