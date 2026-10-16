/**
 * Council subsystem connections: capabilities are only AVAILABLE when a probe just proved them; failures, timeouts and missing tools
 * are reported as DEGRADED/UNAVAILABLE with the reason; the answer text states what is NOT exposed. No writes anywhere.
 */
import assert from 'node:assert/strict'
import { probeSubsystems, renderSubsystemAnswer, subsystemQuestion, type SubsystemProbeDeps } from './probe'
import { isPrivateHostLiteral } from '@/lib/browser-broker/hostPolicy'
import { browseMessageText, browseRequestUrl } from '@/lib/council/computer/browse.server'
import { resolveBrokerChromium } from '@/lib/browser-broker/chromiumExecutable'

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

// 6. explicit browse requests: only an open/visit-style request with an http(s) URL; text is honest about what was read
{
  assert.equal(browseRequestUrl('please open https://example.com/docs and tell me what it says.'), 'https://example.com/docs')
  assert.equal(browseRequestUrl('visit http://127.0.0.1:4777/ now'), 'http://127.0.0.1:4777/')
  assert.equal(browseRequestUrl('what is https://example.com'), null, 'a URL without an open/visit request is not a browse request')
  assert.equal(browseRequestUrl('open the pod bay doors'), null)
  assert.equal(browseRequestUrl('we should check https://example.com against the spec before we decide'), null, 'a URL inside a longer discussion is never fetched')
  assert.equal(browseRequestUrl('please read https://example.com'), null)
  for (const h of ['localhost', 'LOCALHOST.', 'foo.localhost', '127.0.0.2', '[::1]', '::1', '0.0.0.0', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.169.254', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', 'router.internal']) assert.equal(isPrivateHostLiteral(h), true, h)
  for (const h of ['example.com', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateHostLiteral(h), false, h)
  assert.equal(browseRequestUrl('open javascript:alert(1)'), null)
  const text = browseMessageText({ ok: true, sessionId: 's', title: 'Example Domain', url: 'https://example.com/', status: 200, excerpt: 'This domain is for use in examples.', citationId: null })
  assert.match(text, /opened https:\/\/example\.com\//); assert.match(text, /HTTP 200/); assert.match(text, /What it read \(untrusted page text[^\n]*"This domain/)
  const chromium = resolveBrokerChromium()
  assert.ok(['PLAYWRIGHT_CACHE', 'EXPLICIT_ENV', 'SYSTEM_CHROME', 'NONE'].includes(chromium.source))
  assert.equal(Boolean(chromium.path), chromium.source !== 'NONE', 'the reported source always matches whether a browser was found')
  ok('6: browse requests are detected narrowly; the message states what was opened and read; the browser source is reported truthfully')
}

console.log(`\n${passed}/6 council subsystem validations passed`)
assert.equal(passed, 6)
