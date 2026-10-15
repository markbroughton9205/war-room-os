/**
 * Council subsystem connections: capabilities are only AVAILABLE when a probe just proved them; failures, timeouts and missing tools
 * are reported as DEGRADED/UNAVAILABLE with the reason; the answer text states what is NOT exposed. No writes anywhere.
 */
import assert from 'node:assert/strict'
import { probeSubsystems, renderSubsystemAnswer, subsystemQuestion, type SubsystemProbeDeps } from './probe'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const healthy: SubsystemProbeDeps = {
  now: () => '2026-10-15T15:00:00.000Z',
  terraCoverage: async () => ({ activeSources: 12, freshSources: 9, languages: 6, layers: 5 }),
  terraGeocodeReachable: async () => ({ ok: true, detail: 'HTTP 200' }),
  terraWorldImagery: async () => ({ configured: true, baseUrl: 'https://gibs.example/wmts/', reachable: true, detail: 'HTTP 200' }),
  terraWorldTime: async () => ({ ok: true, sample: 'UTC 15:00' }),
  hvsTools: async () => ({ ffmpeg: '/opt/ffmpeg', ffprobe: '/opt/ffprobe', encoder: 'NVENC' }),
  hvsProjects: async () => ({ count: 3 }),
}
const byId = (states: Awaited<ReturnType<typeof probeSubsystems>>) => Object.fromEntries(states.map(s => [s.id, s]))

// 1. all healthy -> all AVAILABLE, with facts from the probe
{
  const s = byId(await probeSubsystems(healthy))
  assert.equal(s.terra.status, 'AVAILABLE'); assert.equal(s.terra_world.status, 'AVAILABLE'); assert.equal(s.hvs.status, 'AVAILABLE')
  assert.equal(s.terra.capabilities[0].facts.activeSources, 12)
  assert.equal(s.hvs.capabilities.find(c => c.id === 'hvs.projects')!.facts.projects, 3)
  assert.ok(s.hvs.capabilities.every(c => c.access === 'READ_ONLY'))
  ok('1: healthy interfaces are AVAILABLE and carry the probed facts; every capability is read-only')
}

// 2. an unreachable external service is DEGRADED with the reason, never AVAILABLE
{
  const s = byId(await probeSubsystems({ ...healthy, terraGeocodeReachable: async () => ({ ok: false, detail: 'getaddrinfo ENOTFOUND' }), terraWorldImagery: async () => ({ configured: true, baseUrl: 'x', reachable: false, detail: 'timeout' }) }))
  const geo = s.terra.capabilities.find(c => c.id === 'terra.resolve_location')!
  assert.equal(geo.status, 'DEGRADED'); assert.match(geo.reason, /ENOTFOUND/); assert.equal(s.terra.status, 'DEGRADED')
  assert.equal(s.terra_world.capabilities.find(c => c.id === 'terra_world.imagery')!.status, 'DEGRADED')
  ok('2: unreachable geocoding/imagery are DEGRADED with the error, and the subsystem rolls up DEGRADED')
}

// 3. a probe that throws or hangs is UNAVAILABLE (bounded), others unaffected
{
  const t0 = Date.now()
  const s = byId(await probeSubsystems({
    ...healthy,
    terraCoverage: async () => { throw new Error('source fabric offline') },
    hvsTools: () => new Promise(() => { /* never resolves */ }),
  }))
  assert.ok(Date.now() - t0 < 6500, 'the hung probe is bounded')
  assert.equal(s.terra.capabilities[0].status, 'UNAVAILABLE'); assert.match(s.terra.capabilities[0].reason, /offline/)
  const tools = s.hvs.capabilities.find(c => c.id === 'hvs.media_tools')!
  assert.equal(tools.status, 'UNAVAILABLE'); assert.match(tools.reason, /timed out/)
  assert.equal(s.hvs.capabilities.find(c => c.id === 'hvs.projects')!.status, 'AVAILABLE')
  ok('3: a throwing or hanging interface is UNAVAILABLE within the time bound; independent capabilities stay AVAILABLE')
}

// 4. missing media tools
{
  const s = byId(await probeSubsystems({ ...healthy, hvsTools: async () => ({ ffmpeg: '/opt/ffmpeg', ffprobe: null, encoder: null }) }))
  const tools = s.hvs.capabilities.find(c => c.id === 'hvs.media_tools')!
  assert.equal(tools.status, 'DEGRADED'); assert.match(tools.reason, /ffprobe/)
  ok('4: a partly installed toolchain is DEGRADED and names what is missing')
}

// 5. question detection and honest rendering
{
  assert.deepEqual(subsystemQuestion('what is the status of terra', ['terra']), ['terra'])
  assert.deepEqual(subsystemQuestion('is higher vision studios connected', ['higher vision studios']), ['hvs'])
  assert.ok(subsystemQuestion('can you access terra world imagery', [])!.includes('terra_world'))
  assert.equal(subsystemQuestion('what is terra', ['terra']), null, 'a plain "what is" is a knowledge question, not a probe request')
  assert.equal(subsystemQuestion('design the persistence boundary', []), null)
  const text = renderSubsystemAnswer(await probeSubsystems({ ...healthy, terraGeocodeReachable: async () => ({ ok: false, detail: 'offline' }) }), ['terra', 'hvs'])
  assert.match(text, /Terra: DEGRADED/); assert.match(text, /\[DEGRADED\].*offline/); assert.match(text, /Not exposed to Council: .*mayPublish is false/)
  assert.match(text, /Read-only; nothing was changed/)
  ok('5: state questions are detected narrowly; the answer names status, reason, interface and what is not exposed')
}

console.log(`\n${passed}/5 council subsystem validations passed`)
assert.equal(passed, 5)
