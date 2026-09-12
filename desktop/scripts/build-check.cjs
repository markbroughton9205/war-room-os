/**
 * Desktop foundation build check — Phase 11A loads full local UI (:3848).
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const required = [
  'src/main.cjs',
  'src/preload.cjs',
  'renderer/index.html',
  'renderer/app.js',
  'renderer/styles.css',
  'package.json',
]

const missing = required.filter(f => !fs.existsSync(path.join(root, f)))
const mainSrc = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8')
const loadsPublic = /loadURL\(\s*['"]https:\/\/warroomos\.com/i.test(mainSrc)
const loadsLocalUi = /3848|LOCAL_UI_ORIGIN|127\.0\.0\.1:3848/.test(mainSrc)
const secure =
  /nodeIntegration:\s*false/.test(mainSrc) &&
  /contextIsolation:\s*true/.test(mainSrc) &&
  /sandbox:\s*true/.test(mainSrc)

const result = {
  ok: missing.length === 0 && !loadsPublic && loadsLocalUi && secure,
  missing,
  loadsPublic,
  loadsLocalUi,
  secure,
  technology: 'electron',
  ui_origin: 'http://127.0.0.1:3848',
  rationale:
    'Electron + local Next server (:3848) for full War Room UI; core control on :3847; never warroomos.com.',
}

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
