/**
 * Renderer sandbox policy (pure — no Electron, no I/O).
 *
 * Secure by default: the Chromium renderer sandbox is ENABLED everywhere.
 * Only Linux honours an explicit operator opt-in to turn it off, for environments where
 * AT-SPI/accessibility compatibility requires an unsandboxed renderer. The opt-in is the exact
 * string '1' in WAR_ROOM_DISABLE_RENDERER_SANDBOX — no other value (empty, '0', 'false', 'true')
 * counts, and the variable is ignored on Windows and macOS.
 */
'use strict'

const RENDERER_SANDBOX_OVERRIDE_ENV = 'WAR_ROOM_DISABLE_RENDERER_SANDBOX'
const RENDERER_SANDBOX_OVERRIDE_VALUE = '1'

function isLinuxRendererSandboxDisabled(platform, env) {
  return platform === 'linux'
    && Boolean(env)
    && env[RENDERER_SANDBOX_OVERRIDE_ENV] === RENDERER_SANDBOX_OVERRIDE_VALUE
}

/** @returns {{ sandbox: boolean, disabledByOverride: boolean, state: string }} */
function resolveRendererSandbox(platform, env) {
  const disabledByOverride = isLinuxRendererSandboxDisabled(platform, env)
  return {
    sandbox: !disabledByOverride,
    disabledByOverride,
    state: disabledByOverride ? 'disabled-by-explicit-linux-override' : 'enabled',
  }
}

module.exports = {
  RENDERER_SANDBOX_OVERRIDE_ENV,
  RENDERER_SANDBOX_OVERRIDE_VALUE,
  isLinuxRendererSandboxDisabled,
  resolveRendererSandbox,
}
