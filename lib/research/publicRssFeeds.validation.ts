import { parsePublicNewsRss, TRUSTED_RSS_FEEDS } from './publicRssFeeds'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// Fixture 1 — standard RSS 2.0, mirrors the exact shape live-observed from BBC/ABC/Al
// Jazeera/etc: <rss><channel><item><title/><link/><pubDate/><description/></item></channel></rss>
const STANDARD_RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Fixture Feed</title>
<item>
  <title>Standard RSS item title</title>
  <link>https://example.com/articles/standard-item</link>
  <pubDate>Sun, 23 Aug 2026 10:55:38 GMT</pubDate>
  <description><![CDATA[A plain RSS 2.0 description body.]]></description>
</item>
</channel></rss>`

// Fixture 2 — genuine RSS 1.0 / RDF, mirrors the exact shape live-fetched from
// rss.dw.com/rdf/rss-en-all on 2026-08-23: root is <rdf:RDF>, real content lives in
// <item rdf:about="..."> blocks (structurally the same <item>...</item> tag as plain RSS — only
// the index <items><rdf:Seq><rdf:li rdf:resource="..."/></rdf:Seq></items> block differs, and
// never matches the item-content regex since <rdf:li> has no closing </item>), and the date field
// is <dc:date> (ISO 8601) rather than <pubDate>.
const RDF_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
 <channel rdf:about="https://example.dw.com/feed">
  <title>Fixture DW Feed</title>
  <items>
   <rdf:Seq>
    <rdf:li rdf:resource="https://example.com/en/rdf-item/a-1"/>
   </rdf:Seq>
  </items>
 </channel>
 <item rdf:about="https://example.com/en/rdf-item/a-1">
  <title>RDF item title</title>
  <link>https://example.com/en/rdf-item/a-1</link>
  <description>An RDF (RSS 1.0) description body.</description>
  <dc:date>2026-08-23T14:49:00Z</dc:date>
 </item>
</rdf:RDF>`

const standardParsed = parsePublicNewsRss(STANDARD_RSS_FIXTURE, 'Fixture Standard')
const rdfParsed = parsePublicNewsRss(RDF_FIXTURE, 'Fixture RDF')

// Registry shape checks.
const feedNames = TRUSTED_RSS_FEEDS.map(f => f.name)
const expectedFeedNames = [
  'BBC World News', 'NASA Breaking News', 'Bloomberg Markets', 'TechCrunch', 'ABC News',
  'AllAfrica', 'Al Jazeera', 'Le Monde', 'The Hindu', 'South China Morning Post',
  'Deutsche Welle', 'Sydney Morning Herald',
]
const bloombergFeed = TRUSTED_RSS_FEEDS.find(f => f.name === 'Bloomberg Markets')
const dwFeed = TRUSTED_RSS_FEEDS.find(f => f.name === 'Deutsche Welle')
const marketsOnly = TRUSTED_RSS_FEEDS.filter(f => f.categories.includes('markets')).map(f => f.name)
const weatherOnly = TRUSTED_RSS_FEEDS.filter(f => f.categories.includes('weather'))

export function runPublicRssFeedsValidation(): CaseResult[] {
  return [
    check(
      'public_rss_01_registry_has_exactly_twelve_trusted_feeds',
      TRUSTED_RSS_FEEDS.length === 12 && expectedFeedNames.every(name => feedNames.includes(name)),
      JSON.stringify(feedNames),
    ),
    check(
      'public_rss_02_bloomberg_flagged_thin_content_density',
      bloombergFeed?.contentDensity === 'thin',
      JSON.stringify(bloombergFeed),
    ),
    check(
      'public_rss_03_dw_registered_as_rdf_format',
      dwFeed?.format === 'rdf',
      JSON.stringify(dwFeed),
    ),
    check(
      'public_rss_04_no_feed_claims_weather_category',
      weatherOnly.length === 0,
      'weather is served exclusively by nwsAlerts.ts, not the RSS/RDF list — ' + JSON.stringify(weatherOnly),
    ),
    check(
      'public_rss_05_markets_category_resolves_to_bloomberg',
      marketsOnly.length === 1 && marketsOnly[0] === 'Bloomberg Markets',
      JSON.stringify(marketsOnly),
    ),
    check(
      'public_rss_06_standard_rss_item_parsed',
      standardParsed.length === 1
      && standardParsed[0]?.title === 'Standard RSS item title'
      && standardParsed[0]?.url === 'https://example.com/articles/standard-item'
      && standardParsed[0]?.publishedAt === '2026-08-23T10:55:38.000Z',
      JSON.stringify(standardParsed),
    ),
    check(
      'public_rss_07_rdf_item_parsed_via_dc_date_fallback',
      rdfParsed.length === 1
      && rdfParsed[0]?.title === 'RDF item title'
      && rdfParsed[0]?.url === 'https://example.com/en/rdf-item/a-1'
      && rdfParsed[0]?.publishedAt === '2026-08-23T14:49:00.000Z',
      JSON.stringify(rdfParsed),
    ),
    check(
      'public_rss_08_rdf_seq_index_entries_never_parsed_as_items',
      rdfParsed.length === 1,
      'rdf:li index refs (no closing </item>) must not be mistaken for content items',
    ),
    check(
      'public_rss_09_parsed_items_carry_fallback_provenance',
      standardParsed[0]?.isFallback === true
      && standardParsed[0]?.sourceType === 'RSS_FALLBACK'
      && Array.isArray(standardParsed[0]?.categories)
      && typeof standardParsed[0]?.retrievedAt === 'string',
      JSON.stringify(standardParsed[0]),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runPublicRssFeedsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Public RSS feeds validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
