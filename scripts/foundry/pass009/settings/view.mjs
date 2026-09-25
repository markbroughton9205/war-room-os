import { SETTINGS } from './config.mjs'

export function renderSettings() {
  return `theme:${SETTINGS.theme};density:${SETTINGS.density}`
}
