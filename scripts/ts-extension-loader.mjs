export async function resolve(specifier, context, defaultResolve) {
  if (specifier === 'next/server') {
    return defaultResolve('next/server.js', context, defaultResolve)
  }
  if (specifier === 'next/headers') {
    return defaultResolve('next/headers.js', context, defaultResolve)
  }
  if (specifier.startsWith('@/')) {
    return resolve(`./${specifier.slice(2)}`, { ...context, parentURL: new URL('../', import.meta.url).href }, defaultResolve)
  }

  try {
    return await defaultResolve(specifier, context, defaultResolve)
  } catch (error) {
    if (
      error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT' &&
      (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'))
    ) {
      return defaultResolve(`${specifier}/index.ts`, context, defaultResolve)
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
