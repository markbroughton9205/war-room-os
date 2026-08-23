import { fetchTrustedPublicNewsFeeds, TRUSTED_RSS_FEEDS } from '../lib/research/publicRssFeeds.ts'
import { fetchActiveWeatherAlerts } from '../lib/research/nwsAlerts.ts'

const checks = []
function check(id, condition, detail) { checks.push({ id, pass: Boolean(condition), detail }) }

const feedResult = await fetchTrustedPublicNewsFeeds({ timeoutMs: 15_000, maxCombinedResults: 200 })

for (const feed of TRUSTED_RSS_FEEDS) {
  const outcome = feedResult.perFeed.find(f => f.name === feed.name)
  check(
    `public_rss_live_${feed.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
    Boolean(outcome?.ok) && (outcome?.count ?? 0) > 0,
    outcome ? `ok=${outcome.ok} count=${outcome.count}${outcome.error ? ` error=${outcome.error}` : ''}` : 'feed not queried',
  )
}

check('public_rss_live_combined_nonempty', feedResult.results.length > 0, `combined=${feedResult.results.length}`)

const nws = await fetchActiveWeatherAlerts({ areaState: 'FL', timeoutMs: 15_000 })
check('nws_alerts_live_fl', nws.ok, `ok=${nws.ok} count=${nws.results.length}${nws.error ? ` error=${nws.error}` : ''}`)

for (const result of checks) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}: ${result.detail}`)
const failed = checks.filter(result => !result.pass)
console.log(`Public RSS + NWS live validation: ${checks.length - failed.length}/${checks.length} PASS`)
if (failed.length) process.exitCode = 1
