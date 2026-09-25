/**
 * Focused validation for warRoomCdp.cjs port probes.
 * The probes run `process.execPath -e <script>`; in the packaged app process.execPath is the Electron
 * binary, so they MUST run with ELECTRON_RUN_AS_NODE=1 or each probe starts a full desktop instance
 * (main.cjs -> claimWarRoomCdpEndpoint() -> probe -> ...: recursive startup).
 *
 * Run: node desktop/src/warRoomCdp.validation.cjs
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')
const childProcess = require('node:child_process')

const results = []
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail === undefined ? '' : String(detail) })
}
const modulePath = require.resolve('./warRoomCdp.cjs')
function loadFresh() {
  delete require.cache[modulePath]
  return require(modulePath)
}

// ---- mocked spawnSync: assert the exact options the probes pass
process.env.WR_CDP_VALIDATION_MARKER = 'preserved'
delete process.env.ELECTRON_RUN_AS_NODE
const realSpawnSync = childProcess.spawnSync
const calls = []
let mockMode = 'free'
childProcess.spawnSync = (file, args, options) => {
  calls.push({ file, args, options })
  const script = String((args || [])[1] || '')
  if (mockMode === 'ephemeral-only') return { stdout: script.includes('port:0') ? '54321' : '1', status: 0 }
  return { stdout: '0', status: 0 }
}
let cdp
try {
  cdp = loadFresh()
  // A. loopbackPortInUse
  mockMode = 'free'
  const free = cdp.loopbackPortInUse(9240)
  const a = calls[0]
  check('A_loopback_probe_runs_as_node', a && a.options && a.options.env && a.options.env.ELECTRON_RUN_AS_NODE === '1', a && a.options && a.options.env && a.options.env.ELECTRON_RUN_AS_NODE)
  check('A_loopback_probe_options_preserved', a && a.options.encoding === 'utf8' && a.options.timeout === 1200 && a.file === process.execPath && a.args[0] === '-e', a && JSON.stringify({ e: a.options.encoding, t: a.options.timeout }))
  check('A_free_result_unchanged', free === false, free)
  // B. bindEphemeralLoopback (reached through claimWarRoomCdpEndpoint when every candidate port reads "in use")
  calls.length = 0
  mockMode = 'ephemeral-only'
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-cdp-validation-'))
  const claimed = cdp.claimWarRoomCdpEndpoint({ runtimeDirOverride: tmp })
  const eph = calls.filter(c => String(c.args[1]).includes('port:0'))
  check('B_ephemeral_probe_reached', eph.length === 1, eph.length)
  check('B_ephemeral_probe_runs_as_node', eph[0] && eph[0].options.env && eph[0].options.env.ELECTRON_RUN_AS_NODE === '1')
  check('B_ephemeral_probe_options_preserved', eph[0] && eph[0].options && eph[0].options.encoding === 'utf8' && eph[0].options.timeout === 1500 && eph[0].file === process.execPath && eph[0].args[0] === '-e')
  check('B_ephemeral_result_unchanged', claimed && claimed.cdpPort === 54321 && claimed.allocation === 'ephemeral', claimed && `${claimed.cdpPort}/${claimed.allocation}`)
  fs.rmSync(tmp, { recursive: true, force: true })
  // C. env preserved on every probe
  check('C_process_env_preserved', calls.length > 0 && calls.every(c => c.options.env && c.options.env.WR_CDP_VALIDATION_MARKER === 'preserved' && c.options.env.PATH === process.env.PATH), calls.length)
  check('C_parent_env_not_mutated', process.env.ELECTRON_RUN_AS_NODE === undefined)
  // D + F. only Node-style `-e` probes; no bypass flags, no app entry, no --type
  const flat = JSON.stringify(calls.map(c => [c.file, c.args, Object.keys(c.options)]))
  check('D_no_sandbox_bypass_flags', !/no-sandbox|disable-setuid|disable-gpu-sandbox|disable-web-security/.test(flat))
  check('F_every_probe_is_node_eval_only', calls.every(c => c.file === process.execPath && c.args.length === 2 && c.args[0] === '-e' && c.options.env && c.options.env.ELECTRON_RUN_AS_NODE === '1' && !c.args.some(x => /main\.cjs|--type|\.asar|app-path/.test(String(x)))))
} finally {
  childProcess.spawnSync = realSpawnSync
}

// ---- static recursion check on the source
const src = fs.readFileSync(modulePath, 'utf8')
const spawnSites = [...src.matchAll(/spawnSync\(process\.execPath[\s\S]*?\}\)/g)].map(m => m[0])
check('static_two_execpath_spawn_sites', spawnSites.length === 2, spawnSites.length)
const unnoded = spawnSites.filter(s => !/ELECTRON_RUN_AS_NODE:\s*'1'/.test(s)).length
check('UNNODED_ELECTRON_SELF_SPAWN_COUNT_is_0', unnoded === 0, unnoded)
check('static_no_other_process_spawn_apis', !/\b(execFile|execFileSync|exec|execSync|fork|spawn)\s*\(/.test(src.replace(/spawnSync\(/g, '')), '')
check('static_no_bypass_flags_in_source', !/no-sandbox|disable-setuid-sandbox|disable-gpu-sandbox/.test(src))

// ---- real behaviour (plain Node stands in for the Electron binary; the env var is harmless there)
async function real() {
  const real = loadFresh()
  const server = net.createServer()
  await new Promise(r => server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, r))
  const occupied = server.address().port
  check('E_occupied_port_reported_in_use', real.loopbackPortInUse(occupied) === true, occupied)
  const probe = net.createServer()
  await new Promise(r => probe.listen({ host: '127.0.0.1', port: 0, exclusive: true }, r))
  const freePort = probe.address().port
  await new Promise(r => probe.close(r))
  check('E_free_port_reported_free', real.loopbackPortInUse(freePort) === false, freePort)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-cdp-real-'))
  const claim = real.claimWarRoomCdpEndpoint({ runtimeDirOverride: tmp })
  check('E_real_claim_returns_free_loopback_port', claim && Number.isInteger(claim.cdpPort) && claim.cdpPort > 0 && claim.bind === '127.0.0.1', claim && claim.cdpPort)
  fs.rmSync(tmp, { recursive: true, force: true })
  await new Promise(r => server.close(r))
  const failed = results.filter(r => !r.pass)
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed, results }, null, 2))
  if (failed.length) process.exitCode = 1
}
real().catch(err => { console.error(err); process.exitCode = 1 })
