/**
 * Desktop foundation build check — Phase 11A loads full local UI (:3848).
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const required = [
  'src/main.cjs',
  'src/preload.cjs',
  'src/desktopTrust.cjs',
  'src/rendererSandbox.cjs',
  'renderer/index.html',
  'renderer/app.js',
  'renderer/styles.css',
  'package.json',
]

const missing = required.filter(f => !fs.existsSync(path.join(root, f)))
const mainSrc = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8')
const loadsPublic = /loadURL\(\s*['"]https:\/\/warroomos\.com/i.test(mainSrc)
const loadsLocalUi = /3848|LOCAL_UI_ORIGIN|127\.0\.0\.1:3848/.test(mainSrc)
// Renderer sandbox is secure-by-default: the shipped policy (empty env, any platform) must keep it
// ON, main.cjs must derive it from the policy helper (never a literal `sandbox: false`), and only the
// explicit Linux opt-in WAR_ROOM_DISABLE_RENDERER_SANDBOX=1 may turn it off.
const sandboxPolicy = fs.existsSync(path.join(root, 'src/rendererSandbox.cjs'))
  ? require(path.join(root, 'src/rendererSandbox.cjs'))
  : null
const rendererSandboxDefaultEnabled = Boolean(sandboxPolicy) &&
  ['linux', 'win32', 'darwin'].every(platform => sandboxPolicy.resolveRendererSandbox(platform, {}).sandbox === true)
const rendererSandboxWiredToPolicy =
  /sandbox:\s*!linuxRendererSandboxDisabled/.test(mainSrc) && !/sandbox:\s*false/.test(mainSrc)
const rendererSandboxActive = sandboxPolicy
  ? sandboxPolicy.resolveRendererSandbox(process.platform, process.env)
  : { sandbox: true, disabledByOverride: false, state: 'enabled' }
const secure =
  /nodeIntegration:\s*false/.test(mainSrc) &&
  /contextIsolation:\s*true/.test(mainSrc) &&
  rendererSandboxDefaultEnabled &&
  rendererSandboxWiredToPolicy

const result = {
  ok: missing.length === 0 && !loadsPublic && loadsLocalUi && secure,
  missing,
  loadsPublic,
  loadsLocalUi,
  secure,
  RENDERER_SANDBOX_DEFAULT: rendererSandboxDefaultEnabled ? 'ENABLED' : 'DISABLED',
  rendererSandbox: rendererSandboxActive.state,
  ...(rendererSandboxActive.disabledByOverride
    ? { warnings: ['WAR_ROOM_DISABLE_RENDERER_SANDBOX=1 is set: Linux renderer sandbox is intentionally disabled (explicit operator override, not the default).'] }
    : {}),
  technology: 'electron',
  ui_origin: 'http://127.0.0.1:3848',
  rationale:
    'Electron + local Next server (:3848) for full War Room UI; core control on :3847; never warroomos.com.',
}

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
