/**
 * Deterministic validation for the renderer sandbox gate (rendererSandbox.cjs + main.cjs wiring).
 * Pure-function cases plus static checks of main.cjs; no Electron launch.
 *
 * Run: node desktop/src/rendererSandbox.validation.cjs
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { resolveRendererSandbox, RENDERER_SANDBOX_OVERRIDE_ENV } = require('./rendererSandbox.cjs')

const results = []
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail === undefined ? '' : String(detail) })
}
const ENV = RENDERER_SANDBOX_OVERRIDE_ENV

check('env_name_is_exact', ENV === 'WAR_ROOM_DISABLE_RENDERER_SANDBOX', ENV)
check('A_linux_absent_enabled', resolveRendererSandbox('linux', {}).sandbox === true)
check('A2_linux_no_env_object_enabled', resolveRendererSandbox('linux', undefined).sandbox === true)
check('B_linux_empty_enabled', resolveRendererSandbox('linux', { [ENV]: '' }).sandbox === true)
check('C_linux_zero_enabled', resolveRendererSandbox('linux', { [ENV]: '0' }).sandbox === true)
check('D_linux_false_enabled', resolveRendererSandbox('linux', { [ENV]: 'false' }).sandbox === true)
for (const loose of ['true', 'TRUE', 'yes', 'on', ' 1', '1 ', '01', '11', 'enabled']) {
  check(`no_loose_truthiness_${JSON.stringify(loose)}`, resolveRendererSandbox('linux', { [ENV]: loose }).sandbox === true)
}
const on = resolveRendererSandbox('linux', { [ENV]: '1' })
check('E_linux_one_disabled', on.sandbox === false && on.disabledByOverride === true && on.state === 'disabled-by-explicit-linux-override', on.state)
check('default_state_label', resolveRendererSandbox('linux', {}).state === 'enabled')
for (const platform of ['win32', 'darwin', 'freebsd']) {
  const r = resolveRendererSandbox(platform, { [ENV]: '1' })
  check(`F_${platform}_one_ignored`, r.sandbox === true && r.disabledByOverride === false && r.state === 'enabled', r.state)
}
check('state_never_leaks_env', !JSON.stringify(on).includes('WAR_ROOM'), JSON.stringify(on))

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8')
const prefs = (main.match(/webPreferences:\s*\{[\s\S]*?\n {4}\},/) || [''])[0]
check('G_node_integration_off', /nodeIntegration:\s*false/.test(prefs))
check('G_context_isolation_on', /contextIsolation:\s*true/.test(prefs))
check('G_preload_unchanged', /preload:\s*path\.join\(__dirname,\s*'preload\.cjs'\)/.test(prefs))
check('G_blink_feature_unchanged', /enableBlinkFeatures:\s*'AccessibilityObjectModel'/.test(prefs))
check('G_sandbox_wired_to_gate', /sandbox:\s*!linuxRendererSandboxDisabled/.test(prefs))
check('G_no_literal_sandbox_false', !/sandbox:\s*false/.test(main))
check('G_gate_uses_policy_helper', /linuxRendererSandboxDisabled\s*=\s*resolveRendererSandbox\(process\.platform,\s*process\.env\)\.disabledByOverride/.test(main))
check('G_diagnostic_prints_state_only', /rendererSandbox = \$\{linuxRendererSandboxDisabled \? 'disabled-by-explicit-linux-override' : 'enabled'\}/.test(main))
check('G_second_window_setting_absent', (main.match(/sandbox:/g) || []).length === 1, String((main.match(/sandbox:/g) || []).length))

const env = { ...process.env }
delete env[ENV]
const h = spawnSync(process.execPath, [path.join(root, 'scripts/build-check.cjs')], { env, encoding: 'utf8' })
let parsed = null
try { parsed = JSON.parse(h.stdout) } catch { /* reported below */ }
check('H_build_check_default_passes', h.status === 0 && parsed && parsed.ok === true && parsed.secure === true && parsed.RENDERER_SANDBOX_DEFAULT === 'ENABLED' && parsed.rendererSandbox === 'enabled', h.status)
const o = spawnSync(process.execPath, [path.join(root, 'scripts/build-check.cjs')], { env: { ...env, [ENV]: '1' }, encoding: 'utf8' })
let po = null
try { po = JSON.parse(o.stdout) } catch { /* reported below */ }
const overrideExpected = process.platform === 'linux' ? 'disabled-by-explicit-linux-override' : 'enabled'
check('H_build_check_recognises_override', po && po.RENDERER_SANDBOX_DEFAULT === 'ENABLED' && po.rendererSandbox === overrideExpected && (process.platform !== 'linux' || Array.isArray(po.warnings)), po && po.rendererSandbox)

const failed = results.filter(r => !r.pass)
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed, results }, null, 2))
if (failed.length) process.exitCode = 1
