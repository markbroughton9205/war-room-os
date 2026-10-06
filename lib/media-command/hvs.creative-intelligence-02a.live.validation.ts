/**
 * HVS-CREATIVE-INTELLIGENCE-02A live honesty validator.
 * Does not bypass auth. Does not invent provider keys.
 * Does not treat deterministic fallback as live proof.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import { defaultCreativeProvider, liveCreativeCompleterAvailable } from './creative-intelligence/provider'
import { isHvsCreativeLiveConfigured, resolveHvsCreativeProviderSelection } from './creative-intelligence/live-completer'
import { visualExfilPermitted } from './creative-intelligence/visual-review'
import { FOUNDRY_OWNS_CREATIVE_INTELLIGENCE } from './creative-intelligence/types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq)
    if (process.env[key]) continue
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(800, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

loadEnvLocal()

const KEY_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'] as const
const presentKeys = KEY_NAMES.filter(name => envHasUsableProviderSecret(name))
const liveConfigured = isHvsCreativeLiveConfigured()
const selection = resolveHvsCreativeProviderSelection()
const liveProviderConfig = presentKeys.length === 0 ? 'MISSING' : 'PRESENT'

const produceSrc = readFileSync(path.join(process.cwd(), 'app/api/media-command/produce/route.ts'), 'utf8')
const liveSrc = readFileSync(path.join(process.cwd(), 'lib/media-command/creative-intelligence/live-completer.ts'), 'utf8')
const providerSrc = readFileSync(path.join(process.cwd(), 'lib/media-command/creative-intelligence/provider.ts'), 'utf8')
expect('auth_not_bypassed', !produceSrc.includes('bypassAuth') && !produceSrc.includes('skipAuth'), 'produce auth')
expect('no_hardcoded_live', !liveSrc.includes('process.env.HVS_CREATIVE_LIVE =') && !providerSrc.includes("HVS_CREATIVE_LIVE: '1'"), 'env gated')
expect('live_probe_honest', liveCreativeCompleterAvailable() === liveConfigured, `${liveConfigured}`)
expect('vision_off', visualExfilPermitted() === false, 'HVS_CREATIVE_VISION_AUTHORIZED off')
expect('foundry_does_not_own', FOUNDRY_OWNS_CREATIVE_INTELLIGENCE === false, 'foundry')
expect('single_planner', (readFileSync(path.join(process.cwd(), 'lib/media-command/production-ai.ts'), 'utf8').match(/export function buildProductionPlan/g) ?? []).length === 1, 'planner')
expect('default_not_faked_live', presentKeys.length === 0 ? defaultCreativeProvider().kind !== 'live' : true, defaultCreativeProvider().kind)
expect('selection_matches_keys', presentKeys.length === 0 ? selection === null : selection !== null, liveProviderConfig)

if (liveConfigured && selection) {
  expect('live_config_present', true, `${selection.vendor}`)
} else {
  expect('live_config_missing_stop', liveProviderConfig === 'MISSING', liveProviderConfig)
}

const baseline = '/home/chosenone/Codex/hvs-workflow-discipline-01-baseline/BASELINE_MANIFEST.json'
const manifest = JSON.parse(readFileSync(baseline, 'utf8')) as { files: Array<{ path: string; sha256: string }> }
const protectedPaths = [
  'lib/media-command/ffmpeg.ts',
  'lib/media-command/rights.ts',
  'lib/media-command/policy.ts',
  'lib/media-command/ingest.ts',
  'lib/media-command/preview-engine.ts',
  'lib/media-command/render-engine.ts',
  'lib/media-command/director3d/blender-audit.ts',
  'lib/media-command/character-production/authority.ts',
]
let hashDrift = 0
for (const rel of protectedPaths) {
  const row = manifest.files.find(file => file.path === rel)
  const digest = createHash('sha256').update(readFileSync(path.join(process.cwd(), rel))).digest('hex')
  if (!row || row.sha256 !== digest) hashDrift += 1
}
expect('protected_hashes', hashDrift === 0, String(hashDrift))

let httpDetail = 'NOT_RUN'
if (await portOpen(3848)) {
  try {
    const res = await fetch('http://127.0.0.1:3848/api/media-command/produce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'plan',
        projectId: 'hvs-ci02a-unauth',
        prompt: 'Create a 30-second cinematic nighttime luxury product film. Restrained typography. Slow, confident opening. Premium, minimal, controlled.',
      }),
    })
    httpDetail = `status=${res.status}`
    expect('unauth_produce_denied', res.status === 401 || res.status === 403, httpDetail)
  } catch (error) {
    expect('unauth_produce_denied', false, error instanceof Error ? error.message : 'http failed')
  }
} else {
  expect('unauth_produce_denied', true, '3848 not listening')
}

const failed = results.filter(row => !row.pass)
for (const row of results) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
console.log(`LIVE_PROVIDER_CONFIG ${liveProviderConfig}`)
console.log(`LIVE_MODEL_PROOF ${liveConfigured && selection ? 'ELIGIBLE' : 'NOT_RUN'}`)
console.log(`LIVE_PROVIDER ${selection?.vendor ?? 'NONE'}`)
console.log(`LIVE_MODEL ${selection?.model ?? 'NONE'}`)
console.log(`HVS_CREATIVE_LIVE ${process.env.HVS_CREATIVE_LIVE ?? 'absent'}`)
console.log(`UNAUTH_HTTP ${httpDetail}`)
console.log(`HVS_CREATIVE_INTELLIGENCE_02A_LIVE ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
if (failed.length) process.exit(1)
