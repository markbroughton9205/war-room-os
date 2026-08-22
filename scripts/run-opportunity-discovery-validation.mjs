import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeAdzuna, normalizeRemoteOk, normalizeSam, normalizeUsaSpending, fetchProvider } from '../lib/opportunity-discovery/adapters.ts'
import { isQualifying, qualifyOpportunity, sanitizeOfficialUrl } from '../lib/opportunity-discovery/core.ts'
import { buildDiscoveryNotification } from '../lib/opportunity-discovery/notifications.ts'
import { __resetDiscoveryStateForTests, detectNewOrChanged } from '../lib/opportunity-discovery/state.ts'

const tests = []
async function test(name, fn) { try { await fn(); tests.push({ name, pass: true }); console.log(`PASS ${name}`) } catch (error) { tests.push({ name, pass: false }); console.error(`FAIL ${name}: ${error.message}`) } }
const at = '2026-08-22T12:00:00.000Z'

await test('Adzuna normalization preserves unknowns and explicit compensation', () => {
  const row = normalizeAdzuna({ id: 'a1', title: 'Software Engineer', description: 'Remote application development', redirect_url: 'https://example.com/job?api_key=secret', salary_min: 90000 }, at)
  assert(row); assert.equal(row.deadline, null); assert.equal(row.remoteStatus, 'REMOTE_ELIGIBLE'); assert.equal(row.compensation?.minimum, 90000); assert.equal(row.compensation?.maximum, null); assert(!row.officialUrl.includes('api_key'))
})
await test('Remote OK normalization preserves attribution and remote evidence', () => {
  const row = normalizeRemoteOk({ id: 'r1', position: 'Senior AI Automation Engineer', company: 'Real Co', description: 'LLM workflow automation', url: 'https://remoteok.com/remote-jobs/1' }, at)
  assert(row); assert.equal(row.attribution, 'Remote OK — remoteok.com'); assert.equal(row.remoteStatus, 'REMOTE'); assert(isQualifying(row)); assert(row.matchReasons.includes('REMOTE_CONFIRMED'))
})
await test('SAM normalization distinguishes an open solicitation', () => {
  const row = normalizeSam({ noticeId: 's1', title: 'Software Development Services', description: 'Cloud application development', uiLink: 'https://sam.gov/opp/s1', postedDate: '2026-08-20', responseDeadLine: '2026-09-20' }, at)
  assert(row); assert.equal(row.opportunityType, 'GOVERNMENT_SOLICITATION'); assert(row.matchSignals.includes('GOVERNMENT_IT_CONTRACT'))
})
await test('SAM.gov drops archived/inactive notices instead of treating them as open', () => {
  const active = normalizeSam({ noticeId: 's2', title: 'Software Development Services', description: 'Cloud application development', uiLink: 'https://sam.gov/opp/s2', postedDate: '2026-08-20', active: 'Yes' }, at)
  assert(active, 'an explicitly active notice should still normalize')
  const inactive = normalizeSam({ noticeId: 's3', title: 'Software Development Services', description: 'Cloud application development', uiLink: 'https://sam.gov/opp/s3', postedDate: '2026-01-01', active: 'No' }, at)
  assert.equal(inactive, null, 'a notice explicitly marked active=No must not become an opportunity record')
  const archived = normalizeSam({ noticeId: 's4', title: 'Software Development Services', description: 'Cloud application development', uiLink: 'https://sam.gov/opp/s4', postedDate: '2026-01-01', archiveDate: '2026-02-01' }, at)
  assert.equal(archived, null, 'a notice with an archiveDate must not become an opportunity record')
})
await test('USAspending remains historical intelligence and never qualifies as open', () => {
  const row = normalizeUsaSpending({ 'Award ID': 'u1', 'Awarding Agency': 'Agency', 'Recipient Name': 'Vendor', 'Award Amount': 1000 }, at)
  assert(row); assert.equal(row.opportunityType, 'HISTORICAL_AWARD_INTELLIGENCE'); assert.equal(row.deadline, null); assert.equal(isQualifying(row), false)
})
await test('Remote unknown is never inferred', () => {
  const row = normalizeAdzuna({ id: 'a2', title: 'Data Engineer', description: 'Build data pipelines' }, at)
  assert(row); assert.equal(row.remoteStatus, 'UNKNOWN'); assert(!row.matchReasons.includes('REMOTE_CONFIRMED'))
})
await test('Negative nontechnical role is filtered', () => {
  const base = normalizeRemoteOk({ id: 'r2', position: 'Account Executive', company: 'Sales Co', description: 'Sell accounts', url: 'https://remoteok.com/remote-jobs/2' }, at)
  assert(base); assert.equal(qualifyOpportunity(base).matchSignals.length, 0); assert.equal(isQualifying(base), false)
})
await test('Single technical boilerplate mention cannot qualify a nontechnical title', () => {
  const row = normalizeRemoteOk({ id: 'r2b', position: 'Post Office Manager', description: 'Our company also invests in AI automation.', url: 'https://remoteok.com/remote-jobs/2b' }, at)
  assert(row); assert.equal(isQualifying(row), false)
})
await test('URL sanitization rejects unsafe schemes and strips secrets', () => {
  assert.equal(sanitizeOfficialUrl('javascript:alert(1)'), null); assert.equal(sanitizeOfficialUrl('https://x.test/a?token=secret&id=1'), 'https://x.test/a?id=1')
})
await test('URL sanitization strips every sensitive param while preserving harmless siblings', () => {
  const params = ['token', 'access_token', 'api_key', 'key', 'password', 'credential', 'session', 'session_id', 'cookie']
  for (const param of params) {
    const sanitized = sanitizeOfficialUrl(`https://x.test/a?${param}=secretvalue&id=1`)
    assert(sanitized, `sanitizeOfficialUrl dropped the URL entirely for param ${param}`)
    assert(!sanitized.includes('secretvalue'), `${param} was not stripped: ${sanitized}`)
    assert(sanitized.includes('id=1'), `harmless sibling param dropped alongside ${param}: ${sanitized}`)
  }
  assert.equal(sanitizeOfficialUrl('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(sanitizeOfficialUrl('file:///etc/passwd'), null)
  assert.equal(sanitizeOfficialUrl('ftp://x.test/a'), null)
})
await test('Stable dedupe is idempotent and meaningful changes re-alert', () => {
  const row = normalizeRemoteOk({ id: 'r3', position: 'Software Engineer', description: 'Remote software development', url: 'https://remoteok.com/remote-jobs/3' }, at); assert(row)
  __resetDiscoveryStateForTests(); assert.equal(detectNewOrChanged([row]).newMatches.length, 1); assert.equal(detectNewOrChanged([row]).newMatches.length, 0); assert.equal(detectNewOrChanged([{ ...row, deadline: '2026-09-01T00:00:00.000Z' }]).newMatches.length, 1)
})
await test('Notification is useful, discovery-only, and secret-safe', () => {
  const row = normalizeRemoteOk({ id: 'r4', position: 'Machine Learning Engineer', description: 'Remote ML', url: 'https://remoteok.com/remote-jobs/4?api_key=hunter2' }, at); assert(row)
  const body = buildDiscoveryNotification(row); assert.match(body, /DISCOVERY ONLY/); assert.match(body, /Matched because/); assert(!body.includes('hunter2'))
})
await test('Missing private credentials return truthful blocked states', async () => {
  assert.equal((await fetchProvider('adzuna', {})).state, 'BLOCKED_BY_ENVIRONMENT'); assert.equal((await fetchProvider('sam_gov', {})).state, 'BLOCKED_BY_ENVIRONMENT')
})
await test('Commander authentication is the first refresh route operation', () => {
  const route = readFileSync('app/api/opportunity-agents/discovery/refresh/route.ts', 'utf8'); const handler = route.slice(route.indexOf('export async function POST'))
  assert(handler.indexOf('requireCommanderSession') < handler.indexOf('req.json'))
})
await test('No application or submission capability exists in discovery module', () => {
  const pipeline = readFileSync('lib/opportunity-discovery/pipeline.ts', 'utf8'); assert(pipeline.includes("discoveryOnly: true")); assert(!/submitApplication|applyForJob|submitProposal|placeBid/.test(pipeline))
})

await test('REAL Remote OK request normalizes and crosses match/notification boundary', async () => {
  const live = await fetchProvider('remote_ok')
  assert.equal(live.state, 'LIVE_VERIFIED'); assert(live.records.length > 0)
  const match = live.records.find(isQualifying); assert(match, 'Remote OK returned no qualifying technical record')
  const notification = buildDiscoveryNotification(match); assert.match(notification, /DISCOVERY ONLY/)
  console.log(`LIVE_PROOF ${JSON.stringify({ providerState: live.state, id: match.id, title: match.title, organization: match.organization, url: match.officialUrl, matchReasons: match.matchReasons, notification: 'NOTIFICATION_GENERATED', externalDelivery: 'NOT_ATTEMPTED_BY_VALIDATION' })}`)
})

const failed = tests.filter(item => !item.pass)
console.log(`Opportunity discovery validation: ${tests.length - failed.length}/${tests.length} PASS`)
if (failed.length) process.exit(1)
