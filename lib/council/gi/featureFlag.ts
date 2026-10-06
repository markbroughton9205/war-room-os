/**
 * GI-ENG-01 feature flag. Default OFF.
 * Production SHORT_PATH requires a later explicit Commander order:
 * ENABLE GI-ENG-01 SHORT_PATH
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

export const GI_ENG_01_SHORT_PATH_ENV = 'GI_ENG_01_SHORT_PATH'

export function isGiEng01ShortPathEnabled(
  env: NodeJS.Dict<string> | undefined = typeof process !== 'undefined' ? process.env : undefined,
): boolean {
  const raw = env?.[GI_ENG_01_SHORT_PATH_ENV]
  if (typeof raw !== 'string') return false
  return TRUTHY.has(raw.trim().toLowerCase())
}
