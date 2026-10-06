/**
 * COUNCIL-SOURCE-LINKS-01 validation.
 * Does not create a second broker or replace EBC.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyCouncilSourceUrl, applyRelevantLocation } from './urlSafety'
import {
  councilSourceFromDeliberationRef,
  councilSourceFromEbc,
  councilSourcesFromSnapshot,
  mergeCouncilSources,
  navigableUrl,
} from './fromEvidence'
import { splitSafeCouncilText } from './safeText'
import type { EbcPublicSnapshot, EbcPublicSourceRow } from '@/lib/council/evidence-board/types'

type Check = { id: string; pass: boolean; detail: unknown }
const checks: Check[] = []
function check(id: string, pass: boolean, detail: unknown) {
  checks.push({ id, pass, detail })
  if (!pass) console.error('FAIL', id, detail)
}

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const httpsSource: EbcPublicSourceRow = {
  id: 'src-openai',
  url: 'https://openai.com/news',
  title: 'OpenAI Newsroom',
  source_type: 'primary_external',
  primary: true,
  authoritative: true,
  published_at: '2026-09-01T00:00:00.000Z',
  observed_at: '2026-09-24T00:00:00.000Z',
  relevance_decision: 'accepted',
  usable: true,
}
const staleSource: EbcPublicSourceRow = {
  ...httpsSource,
  id: 'src-stale',
  url: 'https://example.com/old',
  title: 'Example.com',
  relevance_decision: 'STALE',
  usable: false,
}
const noUrlSource: EbcPublicSourceRow = {
  id: 'src-log',
  url: '',
  title: 'runtime receipt',
  source_type: 'local_log',
  primary: false,
  authoritative: false,
  published_at: null,
  observed_at: null,
  relevance_decision: 'internal',
  usable: false,
}
const snapshot: EbcPublicSnapshot = {
  mission_id: 'ebc-mission-1',
  mission_class: 'DEEP_RESEARCH',
  selected_agents: ['PULSAR'],
  tasks: [],
  tool_calls: [],
  evidence_count: 2,
  claims_count: 1,
  lumen: [],
  phoenix_conflicts: [],
  aurora: {
    schema: 'ebc.aurora.v1',
    commander_brief: 'finding',
    completion_state: 'PARTIALLY_VERIFIED',
    verified_facts: [],
    partially_verified: [],
    unverified: [],
    conflicts: [],
    unknowns: [],
    tool_blocks: [],
    confidence: 0.4,
  } as never,
  completion_state: 'PARTIALLY_VERIFIED',
  confidence: 0.4,
  latency_ms: 12,
  suppressed_contributions: 0,
  peer_visibility_round1: 'FULL' as never,
  sources: [httpsSource, { ...httpsSource, id: 'src-sec', url: 'https://www.sec.gov/filing', title: 'SEC filing' }, staleSource, noUrlSource],
  evidence: [
    { id: 'EBC-E-222', source_id: 'src-openai', claim_ids: ['EBC-C-104'], support_type: 'supports', usable: true, verification_state: 'VERIFIED' },
    { id: 'EBC-E-223', source_id: 'src-sec', claim_ids: ['EBC-C-104'], support_type: 'supports', usable: true, verification_state: 'VERIFIED' },
  ],
}

const structured = councilSourceFromEbc(httpsSource, snapshot.evidence, snapshot.mission_id, 'sess-1')
const auroraRef = councilSourceFromDeliberationRef({
  evidence_reference_id: 'ev-aurora-1',
  label: 'OpenAI Newsroom',
  source_kind: 'web',
  url: 'https://openai.com/news',
}, snapshot.mission_id, 'sess-1', ['EBC-C-104'])
const merged = councilSourcesFromSnapshot(snapshot, 'sess-1')

check('SL01-01', structured.internal_open_supported && structured.url === 'https://openai.com/news', structured)
check('SL01-02', auroraRef.internal_open_supported && auroraRef.title.includes('OpenAI'), auroraRef)
check('SL01-03', merged.some(row => row.source_id === 'src-openai' && row.internal_open_supported), merged.map(row => row.source_id))
check('SL01-04', classifyCouncilSourceUrl('https://openai.com/news').ok === true, classifyCouncilSourceUrl('https://openai.com/news'))
check('SL01-05', classifyCouncilSourceUrl('http://example.com').ok === true, classifyCouncilSourceUrl('http://example.com'))
check('SL01-06', navigableUrl(structured) === 'https://openai.com/news', navigableUrl(structured))
check('SL01-07', classifyCouncilSourceUrl('javascript:alert(1)').ok === false && classifyCouncilSourceUrl('javascript:alert(1)').ok === false && (classifyCouncilSourceUrl('javascript:alert(1)') as { code: string }).code === 'UNSUPPORTED_PROTOCOL', classifyCouncilSourceUrl('javascript:alert(1)'))
check('SL01-08', (classifyCouncilSourceUrl('file:///etc/passwd') as { code?: string }).code === 'UNSUPPORTED_PROTOCOL', classifyCouncilSourceUrl('file:///etc/passwd'))
check('SL01-09', (classifyCouncilSourceUrl('data:text/html,hi') as { code?: string }).code === 'UNSUPPORTED_PROTOCOL', classifyCouncilSourceUrl('data:text/html,hi'))
check('SL01-10', classifyCouncilSourceUrl('not a url').ok === false, classifyCouncilSourceUrl('not a url'))
const noUrl = councilSourceFromEbc(noUrlSource, [], snapshot.mission_id)
check('SL01-11', noUrl.internal_open_supported === false && noUrl.external_open_supported === false && noUrl.copy_supported === false, noUrl)
check('SL01-12', structured.claim_ids.includes('EBC-C-104'), structured.claim_ids)
check('SL01-13', structured.evidence_ids.includes('EBC-E-222'), structured.evidence_ids)
check('SL01-14', structured.mission_id === 'ebc-mission-1', structured.mission_id)
const readout = read('components/council/EvidenceBoardReadout.tsx')
const nav = read('components/council/CouncilSourceNavigation.tsx')
check('SL01-15', /data-evidence-id/.test(readout) && /viewEvidence/.test(nav), 'view evidence focus')
check('SL01-16', merged.filter(row => row.claim_ids.includes('EBC-C-104')).length >= 2, merged.filter(row => row.claim_ids.includes('EBC-C-104')).map(row => row.source_id))
const pdf = applyRelevantLocation('https://example.com/doc.pdf', { page: 17 })
check('SL01-17', classifyCouncilSourceUrl('https://example.com/doc.pdf').ok === true, classifyCouncilSourceUrl('https://example.com/doc.pdf'))
check('SL01-18', pdf.includes('#page=17'), pdf)
const main = read('desktop/src/main.cjs')
const preload = read('desktop/src/preload.cjs')
check('SL01-19', /sovereign\.openExternalSafe/.test(main) && /shell\.openExternal/.test(main) && /https:/.test(main), 'safe ipc')
check('SL01-20', /u\.protocol !== 'https:' && u\.protocol !== 'http:'/.test(main) && /sovereign\.openExternalSafe/.test(preload), 'ipc reject')
const browser = read('components/war-room/browser/WarRoomBrowser.tsx')
check('SL01-21', /sourceContext/.test(browser) && /war-room-browser-source-context/.test(browser), 'internal context')
check('SL01-22', /war-room-browser-back-to-mission/.test(browser), 'back to mission')
const broker = read('lib/browser-broker/broker.ts')
check('SL01-23', !/grants_authority:\s*true/.test(read('lib/council/source-links/types.ts')) && /OPEN_INTERNAL/.test(read('lib/council/source-links/types.ts')), 'nav is not action authority')
check('SL01-24', /owner:\s*'council'/.test(read('lib/browser-broker/councilClient.ts')) && !/new BrowserBroker/.test(read('lib/council/source-links/fromEvidence.ts')), 'research broker preserved')
check('SL01-25', councilSourceFromEbc(staleSource).supporting === false && Boolean(councilSourceFromEbc(staleSource).rejection_reason?.includes('STALE')), councilSourceFromEbc(staleSource))
check('SL01-26', councilSourceFromEbc(staleSource).freshness_state === 'STALE', councilSourceFromEbc(staleSource).freshness_state)
const page = read('app/page.tsx')
check('SL01-27', /councilSourcesFromSnapshot\(msg\.evidenceBoardCouncil/.test(page), 'reload uses persisted ebc sources')
check('SL01-28', /familyDeliberationEvidenceReferences/.test(page) && /CouncilSourceList/.test(page), 'session switch keeps structured refs')
check('SL01-29', /evidenceBoardCouncil/.test(page) && /CouncilSourceList/.test(page), 'runtime restart uses persisted snapshot')
check('SL01-30', /if \(!links\.length\) return null/.test(read('components/council/CouncilSourceList.tsx')), 'no empty sources section')
check('SL01-31', splitSafeCouncilText('See https://example.com/a').some(part => part.kind === 'link'), splitSafeCouncilText('See https://example.com/a'))
check('SL01-32', splitSafeCouncilText('See javascript:alert(1) and /tmp/file.txt').every(part => part.kind === 'text'), splitSafeCouncilText('See javascript:alert(1) and /tmp/file.txt'))
check('SL01-33', structured.domain === 'openai.com' && /council-source-domain/.test(read('components/council/CouncilSourceLink.tsx')), structured.domain)
check('SL01-34', /war-room-browser-current-domain/.test(browser), 'redirect domain display')
check('SL01-35', !/class BrowserBroker2|new BrowserBroker\(/.test(read('lib/council/source-links/fromEvidence.ts') + read('components/council/CouncilSourceNavigation.tsx')), 'no second broker')
check('SL01-36', /Not a second evidence store/.test(read('lib/council/source-links/types.ts')) && /EbcPublicSourceRow/.test(read('lib/council/source-links/fromEvidence.ts')), 'ebc canonical')
check('SL01-37', !/commit|push|production_deploy/.test(read('lib/council/source-links/types.ts')), 'no authority expansion')
check('SL01-38', !/hidden.?reason|chain.of.thought|scratchpad/i.test(read('lib/council/source-links/types.ts') + read('components/war-room/browser/WarRoomBrowser.tsx')), 'no cot')
check('SL01-39', /getBrowserBroker/.test(broker), 'broker unit file intact')
check('SL01-40', /validate:browser-broker:live/.test(read('package.json')), 'live script remains')
check('SL01-WIRING-PROVIDER', /WarRoomBrowserProvider/.test(read('components/ClientProviders.tsx')) && /CouncilSourceNavigationProvider/.test(read('components/ClientProviders.tsx')), 'mounted')
check('SL01-WIRING-AURORA', /SafeCouncilText/.test(page) && /CouncilSourceList/.test(page), 'aurora wired')
check('SL01-WIRING-EBC', /CouncilSourceList/.test(readout), 'ebc wired')
check('SL01-WIRING-INSPECTOR', /CouncilSourceList/.test(read('components/council/CouncilIntelligenceInspector.tsx')), 'inspector wired')
check('SL01-NO-SILENT-BLANK', !/target="_blank"[\s\S]{0,80}ref\.url/.test(page), 'no silent external on evidence refs')
check('SL01-MERGE', mergeCouncilSources([[structured], [structured]]).length === 1, 'dedupe')

const failed = checks.filter(row => !row.pass)
console.log(JSON.stringify({ pass: failed.length === 0, total: checks.length, failed: failed.map(row => row.id) }, null, 2))
if (failed.length) process.exit(1)
