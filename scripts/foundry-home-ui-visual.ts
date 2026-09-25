import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import { foundryDataHierarchy } from '@/lib/native-builder/foundryPaths'

const UI = 'http://127.0.0.1:3848'
const dest = `${foundryDataHierarchy().screenshots}/foundry-home-ui-visual-${Date.now()}.png`

function chromiumPath(): string | undefined {
  const homeCache = path.join(os.homedir(), '.cache', 'ms-playwright')
  const candidates = [
    path.join(homeCache, 'chromium-1243', 'chrome-linux64', 'chrome'),
    path.join(homeCache, 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
  ]
  return candidates.find(p => existsSync(p))
}

const store = getLocalOwnershipStore()
const identity = store.getCommanderPublic()
if (!identity) {
  console.error('FAIL no local commander identity')
  process.exit(1)
}
const auth = store.issueSession(identity.id, identity.installation_id)

const cookie = { cookie: `wr_local_session=${auth.token}` }
const statusRes = await fetch(`${UI}/api/mission-runtime/engineering/status`, { headers: cookie })
const statusJson = await statusRes.json() as { status?: { foundryModelStatus?: Record<string, unknown>; overall?: string } }
const localModel = (statusJson.status?.foundryModelStatus as { localModel?: { state?: string; label?: string; model?: string } } | undefined)?.localModel
const commanderWsRes = await fetch(`${UI}/api/mission-runtime/engineering/workspaces?view=commander`, { headers: cookie })
const commanderWsJson = await commanderWsRes.json() as { workspaces?: Array<{ id: string; label?: string; displayTitle?: string; root: string }> }
const systemWsRes = await fetch(`${UI}/api/mission-runtime/engineering/workspaces?view=system`, { headers: cookie })
const systemWsJson = await systemWsRes.json() as { workspaces?: Array<{ id: string; label?: string; root: string }> }
const commanderWorkspaces = commanderWsJson.workspaces ?? []
const systemWorkspaces = systemWsJson.workspaces ?? []
const commanderLabels = commanderWorkspaces.map(item => item.displayTitle || item.label || item.id)
const canonicalWs = commanderWorkspaces.find(item => item.id === 'war-room-self')
const brain = (statusJson.status?.foundryModelStatus as { brain?: Record<string, unknown> } | undefined)?.brain

const playwright = await import('@playwright/test')
const context = await playwright.chromium.launchPersistentContext(`${foundryDataHierarchy().browserProfile}-visual-tmp`, {
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  executablePath: chromiumPath(),
})
await context.addCookies([{
  name: 'wr_local_session',
  value: auth.token,
  url: UI,
  httpOnly: true,
  sameSite: 'Lax',
}])
const page = context.pages()[0] ?? await context.newPage()
const consoleErrors: string[] = []
page.on('pageerror', error => consoleErrors.push(error.message))
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
await page.goto(`${UI}/war-room/engineering?workspace=war-room-self`, { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForTimeout(2_500)
const body = await page.locator('body').innerText()
await page.screenshot({ path: dest, fullPage: true })
const pageUrl = page.url()
const ops = page.getByTestId('foundry-operations-toggle')
if (await ops.count()) await ops.click()
await page.waitForTimeout(1_000)
const opsShot = dest.replace('.png', '-operations.png')
await page.screenshot({ path: opsShot, fullPage: true })
await context.close()

const checks = [
  ['http_status_api', statusRes.ok, String(statusRes.status)],
  ['brain_ready', Boolean(brain && brain.ready === true), JSON.stringify(brain ?? null)],
  ['no_local_coder_unavailable', !body.includes('LOCAL CODER UNAVAILABLE') && !body.includes('Local coder UNAVAILABLE'), 'ok'],
  ['no_p005', !body.includes('FOUNDRY-P005'), 'ok'],
  ['no_p004', !body.includes('FOUNDRY-P004'), 'ok'],
  ['no_p006', !body.includes('FOUNDRY-P006'), 'ok'],
  ['has_foundry_identity', body.includes('THE FOUNDRY') || body.includes('The Foundry'), 'ok'],
  ['no_giant_ops_on_home', !body.includes('Active ·') && !body.includes('Waiting Authorization'), 'ok'],
  ['no_autonomous_panel_on_home', !body.includes('FOUNDRY AUTONOMOUS MISSION') && !body.includes('Foundry Autonomous Mission'), 'ok'],
  ['landing_or_session', body.includes('FOUNDRY READY') || body.includes('New Coding Session') || body.includes('Tell Foundry the result you want'), 'ok'],
  ['has_war_room_os_project', body.includes('WAR ROOM OS'), 'ok'],
  ['no_escape_box', !body.includes('escape-box'), 'ok'],
  ['no_cancel_box', !body.includes('cancel-box'), 'ok'],
  ['no_repair_fixture', !body.includes('repair-fixture'), 'ok'],
  ['has_local_model_status', body.includes('LOCAL MODEL'), 'ok'],
  ['local_model_ready_api', localModel?.state === 'READY', JSON.stringify(localModel ?? null)],
  ['no_obsolete_local_coder_unavailable', !body.includes('LOCAL CODER UNAVAILABLE'), 'ok'],
  ['commander_ws_http', commanderWsRes.ok, String(commanderWsRes.status)],
  ['commander_only_war_room_os', commanderWorkspaces.length === 1 && canonicalWs?.id === 'war-room-self' && commanderLabels.every(label => /war room os/i.test(label)), commanderLabels.join(',')],
  ['canonical_root_is_git_source', Boolean(canonicalWs?.root && /\/Codex\/war-room-os$/i.test(canonicalWs.root.replace(/\\/g, '/')) && !canonicalWs.root.includes('/.local/opt/')), canonicalWs?.root ?? 'missing'],
  ['no_fixture_in_commander_api', !commanderLabels.some(label => /escape-box|cancel-box|repair-fixture|foundry-ui-verify/i.test(label)), commanderLabels.join(',')],
]

console.log(JSON.stringify({
  url: pageUrl,
  screenshot: dest,
  operationsScreenshot: opsShot,
  overall: statusJson.status?.overall,
  codingModel: (statusJson.status?.foundryModelStatus as { codingModel?: string } | undefined)?.codingModel,
  localModel,
  brain,
  bodyHits: {
    foundryReady: body.includes('FOUNDRY READY'),
    autonomousMission: body.includes('FOUNDRY AUTONOMOUS MISSION') || body.includes('Foundry Autonomous Mission'),
    localCoder: body.includes('LOCAL CODER') || body.includes('Local coder'),
    p005: body.includes('FOUNDRY-P005'),
    newSession: body.includes('New Coding Session') || body.includes('New Session'),
    prompt: body.includes('Tell Foundry the result you want'),
    operations: body.includes('ADVANCED') || body.includes('Operations'),
  },
  commanderWorkspaces: commanderWorkspaces.map(item => ({ id: item.id, label: item.displayTitle || item.label, root: item.root })),
  systemWorkspaceCount: systemWorkspaces.length,
  consoleErrors: consoleErrors.slice(0, 12),
  checks: checks.map(([name, pass, detail]) => ({ name, pass, detail })),
}, null, 2))

if (checks.some(([, pass]) => !pass)) process.exit(1)
