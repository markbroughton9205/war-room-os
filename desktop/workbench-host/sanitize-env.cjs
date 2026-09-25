/**
 * Strip secrets and model keys from the workbench Node child environment.
 * Desktop-trust secret is never inherited.
 */
'use strict'

const KEEP_EXACT = new Set([
  'HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE',
  'TZ', 'TERM', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
  'DBUS_SESSION_BUS_ADDRESS', 'GDK_BACKEND', 'GTK_MODULES', 'GNOME_ACCESSIBILITY',
  'ACCESSIBILITY_ENABLED', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'PWD',
])

const DROP = /(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY|SERVICE_ROLE|CREDENTIAL|CURSOR|OPENAI|ANTHROPIC|GEMINI|XAI|SUPABASE|MOONSHOT|KIMI|FIRECRAWL|TAVILY|BRAVE|YOUTUBE|WRIM|DESKTOP_TRUST)/i

function sanitizeWorkbenchEnv(source) {
  const env = {}
  const input = source && typeof source === 'object' ? source : process.env
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue
    if (KEEP_EXACT.has(key)) {
      env[key] = value
      continue
    }
    if (DROP.test(key)) continue
    if (key.startsWith('ELECTRON_') || key.startsWith('VSCODE_') || key.startsWith('FOUNDRY_')) continue
    if (key === 'NEXT_PUBLIC' || key.startsWith('NEXT_PUBLIC_')) continue
  }
  env.HOME = env.HOME || require('node:os').homedir()
  env.PATH = env.PATH || '/usr/bin:/bin'
  return env
}

module.exports = { sanitizeWorkbenchEnv }
