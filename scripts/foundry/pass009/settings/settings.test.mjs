import { SETTINGS } from './config.mjs'
import { renderSettings } from './view.mjs'

if (SETTINGS.theme !== 'midnight') {
  throw new Error(`Expected theme midnight, got ${SETTINGS.theme}`)
}
if (!renderSettings().includes('midnight')) {
  throw new Error(`view still renders old theme: ${renderSettings()}`)
}
console.log('PASS pass009 settings theme=midnight')
