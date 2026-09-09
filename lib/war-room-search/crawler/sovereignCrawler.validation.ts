import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { evaluateCrawlDestination, readDomainPolicy } from './policy'
import { evaluateRobotsForPath } from './robots'
import { extractHtml } from './extract'
import { hashEvidenceContent } from '@/lib/intelligence/contentHash'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { crawlApprovedUrl } from './crawlUrl'
import { SovereignCorpus } from './corpus'
import { startCrawlFixture } from './fixtureServer'
import { WAR_ROOM_BOT_USER_AGENT, type CrawlApproval } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const APPROVAL: CrawlApproval = { actor: 'trusted_internal_test', allowInternalHosts: true, note: 'stage3a fixture' }

export async function runSovereignCrawlerValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-sovereign-crawler-'))
  const corpus = new SovereignCorpus(tmp)
  const fixture = await startCrawlFixture()
  const approvalDenied: CrawlApproval = { actor: 'trusted_internal_test', allowInternalHosts: false }

  try {
    const privateDecision = await evaluateCrawlDestination({
      url: 'http://127.0.0.1/secret',
      approval: approvalDenied,
    })
    cases.push(check('ssrf_01_localhost_blocked', !privateDecision.allowed && privateDecision.category !== 'OK', JSON.stringify(privateDecision)))

    const rfc1918 = await evaluateCrawlDestination({ url: 'http://10.1.2.3/x', approval: approvalDenied })
    cases.push(check('ssrf_02_rfc1918_blocked', rfc1918.category === 'SSRF_PRIVATE', rfc1918.reason))

    const metadata = await evaluateCrawlDestination({ url: 'http://169.254.169.254/latest/meta-data', approval: approvalDenied })
    cases.push(check('ssrf_03_metadata_blocked', metadata.category === 'SSRF_METADATA', metadata.reason))

    const metadataHost = await evaluateCrawlDestination({ url: 'http://metadata.google.internal/', approval: approvalDenied })
    cases.push(check('ssrf_04_metadata_hostname', metadataHost.category === 'SSRF_METADATA', metadataHost.reason))

    const rebind = await evaluateCrawlDestination({
      url: 'https://evil.example/x',
      approval: approvalDenied,
      lookup: async () => ({ address: '127.0.0.1', family: 4 }),
    })
    cases.push(check('ssrf_05_dns_rebind_blocked', rebind.category === 'SSRF_PRIVATE', rebind.reason))

    const scheme = await evaluateCrawlDestination({ url: 'file:///etc/passwd', approval: APPROVAL })
    cases.push(check('ssrf_06_non_http_blocked', scheme.category === 'SCHEME', scheme.reason))

    const unapproved = await crawlApprovedUrl({
      url: `${fixture.baseUrl}/allowed`,
      approval: null,
      corpus,
    })
    cases.push(check('gov_01_unapproved_blocked', !unapproved.ok && unapproved.status === 'BLOCKED_POLICY', unapproved.error ?? 'none'))

    cases.push(check(
      'ua_01_minimal_identity',
      WAR_ROOM_BOT_USER_AGENT === 'WarRoomBot/1.0' && !/\(\s*\+https?:/i.test(WAR_ROOM_BOT_USER_AGENT),
      WAR_ROOM_BOT_USER_AGENT,
    ))

    const robots = evaluateRobotsForPath('User-agent: WarRoomBot\nDisallow: /blocked\nAllow: /\n', '/blocked')
    cases.push(check('robots_01_disallow_path', robots.status === 'ROBOTS_DISALLOWED', JSON.stringify(robots)))

    const allowed = await crawlApprovedUrl({ url: `${fixture.baseUrl}/allowed`, approval: APPROVAL, corpus, discoveredVia: 'SEARXNG' })
    cases.push(check('crawl_01_allowed', allowed.ok && allowed.status === 'INDEXED' && Boolean(allowed.document), `${allowed.status}/${allowed.error}`))
    cases.push(check(
      'extract_01_success',
      Boolean(allowed.document?.title?.includes('Chip export') && allowed.document.contentText.includes('semiconductor')),
      JSON.stringify({ title: allowed.document?.title, len: allowed.document?.contentText.length }),
    ))
    cases.push(check(
      'canonical_01_preserved',
      Boolean(allowed.document?.originalUrl.includes('/allowed') && allowed.document.canonicalUrl && canonicalizeUrl(allowed.document.finalUrl)),
      JSON.stringify({ original: allowed.document?.originalUrl, final: allowed.document?.finalUrl, canonical: allowed.document?.canonicalUrl }),
    ))
    const hashA = allowed.document?.contentHash ?? ''
    const hashB = hashEvidenceContent([allowed.document?.title, allowed.document?.description, allowed.document?.contentText].filter(Boolean).join('\n'))
    cases.push(check('hash_01_sha256_stable', Boolean(hashA && hashA === hashB && hashA.length === 64), hashA))
    cases.push(check(
      'prov_01_publisher_not_war_room',
      Boolean(allowed.document?.publisher.includes('127.0.0.1') && allowed.document.sourceOrigin === 'WAR_ROOM_CORPUS' && allowed.document.discoveredVia === 'SEARXNG'),
      JSON.stringify({ publisher: allowed.document?.publisher, origin: allowed.document?.sourceOrigin, discovered: allowed.document?.discoveredVia }),
    ))

    const recrawl = await crawlApprovedUrl({ url: `${fixture.baseUrl}/allowed`, approval: APPROVAL, corpus })
    cases.push(check('dup_01_same_url_update', recrawl.ok && recrawl.status === 'DUPLICATE_URL' && recrawl.document?.id === allowed.document?.id, recrawl.status))

    const blocked = await crawlApprovedUrl({ url: `${fixture.baseUrl}/blocked`, approval: APPROVAL, corpus })
    cases.push(check('robots_02_page_blocked', !blocked.ok && blocked.status === 'BLOCKED_ROBOTS' && blocked.robotsStatus === 'ROBOTS_DISALLOWED', `${blocked.status}/${blocked.robotsStatus}`))

    const failRobots = await crawlApprovedUrl({
      url: `${fixture.baseUrl}/allowed?robots=fail`,
      approval: APPROVAL,
      corpus,
      fetchImpl: async (url, init) => {
        if (String(url).includes('/robots.txt')) throw new Error('network down')
        return fetch(url, init)
      },
    })
    cases.push(check(
      'robots_03_fetch_error_conservative',
      !failRobots.ok && failRobots.robotsStatus === 'ROBOTS_FETCH_ERROR',
      `${failRobots.status}/${failRobots.robotsStatus}/${failRobots.error}`,
    ))

    const redirected = await crawlApprovedUrl({ url: `${fixture.baseUrl}/redirect`, approval: APPROVAL, corpus })
    cases.push(check(
      'redirect_01_followed',
      Boolean(redirected.ok && redirected.document?.originalUrl.includes('/redirect') && redirected.document.finalUrl.includes('/allowed')),
      JSON.stringify({ original: redirected.document?.originalUrl, final: redirected.document?.finalUrl, status: redirected.status }),
    ))

    const large = await crawlApprovedUrl({ url: `${fixture.baseUrl}/large`, approval: APPROVAL, corpus })
    cases.push(check('size_01_oversized_rejected', !large.ok && large.errorCategory === 'RESPONSE_TOO_LARGE', `${large.errorCategory}/${large.error}`))

    const unsupported = await crawlApprovedUrl({ url: `${fixture.baseUrl}/unsupported`, approval: APPROVAL, corpus })
    cases.push(check('type_01_pdf_rejected', !unsupported.ok && unsupported.errorCategory === 'UNSUPPORTED_CONTENT_TYPE', `${unsupported.errorCategory}/${unsupported.error}`))

    const malformed = await crawlApprovedUrl({ url: `${fixture.baseUrl}/malformed`, approval: APPROVAL, corpus })
    cases.push(check(
      'extract_02_malformed_resilient',
      Boolean(malformed.ok && malformed.document?.contentText.toLowerCase().includes('semiconductor')),
      `${malformed.status}/${malformed.document?.title}/${malformed.document?.contentText.slice(0, 80)}`,
    ))

    const dupA = await crawlApprovedUrl({ url: `${fixture.baseUrl}/duplicate-a`, approval: APPROVAL, corpus })
    const dupB = await crawlApprovedUrl({ url: `${fixture.baseUrl}/duplicate-b`, approval: APPROVAL, corpus })
    cases.push(check('dup_02_url_indexed', dupA.ok && dupA.status === 'INDEXED', dupA.status))
    cases.push(check(
      'dup_03_same_content_different_url',
      Boolean(dupB.ok && dupB.status === 'DUPLICATE_CONTENT' && dupB.document?.contentHash === dupA.document?.contentHash && dupB.document?.canonicalUrl !== dupA.document?.canonicalUrl),
      JSON.stringify({ a: dupA.document?.canonicalUrl, b: dupB.document?.canonicalUrl, hash: dupB.document?.contentHash, status: dupB.status }),
    ))

    const plain = await crawlApprovedUrl({ url: `${fixture.baseUrl}/plain`, approval: APPROVAL, corpus })
    cases.push(check('type_02_plain_allowed', Boolean(plain.ok && plain.document?.contentText.includes('freight brokerage')), `${plain.status}/${plain.document?.contentType}`))

    const html = extractHtml('<html lang="en"><head><title>Hello</title></head><body><p>World</p></body></html>')
    cases.push(check('extract_03_no_invented_author', html.author === null && html.publishedAt === null, JSON.stringify(html)))

    const denylist = await evaluateCrawlDestination({
      url: 'https://example.com/x',
      approval: { actor: 'commander' },
      policy: { ...readDomainPolicy({}), denylist: ['example.com'], allowlist: [], crawlDisabled: false },
    })
    cases.push(check('policy_01_denylist', denylist.category === 'DENYLIST', denylist.reason))
  } finally {
    corpus.close()
    await fixture.close()
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runSovereignCrawlerValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Sovereign crawler validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
