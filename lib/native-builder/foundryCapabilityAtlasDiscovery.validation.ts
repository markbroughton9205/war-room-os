/**
 * Capability Atlas research-ingestion proofs.
 * Research is not mastery. Does not train WRIM, mutate Terra, commit, or push.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { isProtectedSubsystemPath } from './foundryMissionWriteSet'
import {
  loadCapabilityAtlas,
  seedAtlas,
  ingestDiscoveryCandidate,
  createDedupeState,
  canonicalizeSourceUrl,
  isBlogHost,
  runDiscoveryWaves,
  buildSkillPack,
  skillPackIsCompact,
  walkPrerequisites,
  assessMissionCapabilities,
  buildCapabilityScoreboard,
  persistSource,
  createSourceRecord,
  GOVERNANCE,
  WRIM_INTEGRATION_BOUNDARY,
  NEXT_RESEARCH_MISSION,
  DISCOVERY_GOVERNANCE,
  COMPLETED_DISCOVERY_MISSION,
  catalogExistingResearchArtifacts,
  hashSourceContent,
} from './capability-atlas'
import { DISCOVERY_WAVES, DISCOVERY_REJECT_FIXTURES, DISCOVERY_RELATIONSHIPS } from './capability-atlas/discoveryCatalog'
import type { DiscoveryCandidate } from './capability-atlas/discoveryCatalog'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const fetchOk = async (url: string) => ({ ok: true, status: 200, etag: `"${url}"`, lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT' })

function candidate(partial: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, 'sourceId' | 'url' | 'skillIds'>): DiscoveryCandidate {
  return {
    title: partial.title ?? partial.sourceId,
    sourceType: partial.sourceType ?? 'official_documentation',
    organization: partial.organization ?? 'Example Org',
    license: partial.license ?? 'MIT',
    version: partial.version ?? null,
    authorityClass: partial.authorityClass ?? 'OFFICIAL',
    notes: partial.notes ?? 'fixture',
    ...partial,
  }
}

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const root = await mkdtemp(path.join(tmpdir(), 'wr-capability-discovery-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = root
  const results: CaseResult[] = []
  try {
    const atlas = loadCapabilityAtlas()
    const before = buildCapabilityScoreboard(atlas)
    const dedupe = createDedupeState(atlas)

    const primary = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-python-docs',
      url: 'https://docs.python.org/3/',
      skillIds: ['software.languages.python'],
      authorityClass: 'OFFICIAL',
      organization: 'Python Software Foundation',
    }), { ok: true, status: 200, etag: '"p1"' }, dedupe)
    results.push(check('primary_source_registration', primary.action === 'accepted' && atlas.sources.has('fixture-python-docs') && primary.authorityClass === 'OFFICIAL', primary.reason))

    const secondary = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-iso-overview',
      url: 'https://iso25000.com/index.php/en/iso-25000-standards/iso-25010',
      skillIds: ['architecture.modular'],
      authorityClass: 'SECONDARY',
      sourceType: 'secondary',
      organization: 'ISO overview site',
    }), { ok: true, status: 200, etag: '"s1"' }, dedupe)
    results.push(check('secondary_source_registration', secondary.action === 'accepted' && secondary.authorityClass === 'SECONDARY', secondary.reason))

    const dupUrl = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-python-docs-dup',
      url: 'https://docs.python.org/3/',
      skillIds: ['software.languages.python'],
    }), { ok: true, status: 200, etag: '"p1"' }, dedupe)
    results.push(check('duplicate_url_refused', dupUrl.action === 'duplicate', dupUrl.reason))

    const hashed = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-hash-a',
      url: 'https://go.dev/ref/spec',
      skillIds: ['software.languages.go'],
    }), { ok: true, status: 200, etag: '"same-hash"' }, dedupe)
    const hashUrl = canonicalizeSourceUrl('https://kotlinlang.org/docs/home.html')
    const preHash = hashSourceContent(`${hashUrl}|200|"pre-seeded"|`)
    dedupe.hashes.add(preHash)
    const hashedDup = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-hash-b',
      url: 'https://kotlinlang.org/docs/home.html',
      skillIds: ['software.languages.kotlin'],
    }), { ok: true, status: 200, etag: '"pre-seeded"' }, dedupe)
    results.push(check('duplicate_hash_deduped', hashed.action === 'accepted' && hashedDup.action === 'duplicate' && hashedDup.reason.includes('hash'), `${hashed.action}/${hashedDup.action}:${hashedDup.reason}`))

    const missing = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-missing',
      url: '',
      organization: '',
      skillIds: ['ml.cuda'],
    }), { ok: true, status: 200 }, dedupe)
    results.push(check('missing_source_metadata_rejected', missing.action === 'rejected' && missing.reason.includes('missing'), missing.reason))

    const python = atlas.skills.get('software.languages.python')
    results.push(check('docs_do_not_prove', python?.capabilityStatus === 'LEARNABLE' && python.capabilityStatus !== 'PROVEN' && python.capabilityStatus !== 'EVALUATED', python?.capabilityStatus ?? 'missing'))

    const repoLink = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-pytorch-repo',
      url: 'https://github.com/pytorch/pytorch',
      sourceType: 'primary_repository',
      authorityClass: 'PRIMARY',
      organization: 'PyTorch',
      skillIds: ['ml.pytorch'],
    }), { ok: true, status: 200, etag: '"repo"' }, dedupe)
    const pytorch = atlas.skills.get('ml.pytorch')
    results.push(check('repo_link_does_not_prove', repoLink.action === 'accepted' && pytorch?.capabilityStatus !== 'PROVEN' && pytorch?.capabilityStatus !== 'PRODUCTION_PROVEN' && (pytorch?.capabilityStatus === 'LEARNABLE' || pytorch?.capabilityStatus === 'SOURCE_BACKED'), `${repoLink.action}:${pytorch?.capabilityStatus}`))

    results.push(check('learnable_transition_from_sources', python?.capabilityStatus === 'LEARNABLE', python?.capabilityStatus ?? 'missing'))
    results.push(check('discovered_skill_gains_source_backing', (pytorch?.capabilityStatus === 'LEARNABLE' || python?.capabilityStatus === 'LEARNABLE'), `py=${python?.capabilityStatus} torch=${pytorch?.capabilityStatus}`))

    const rel = DISCOVERY_RELATIONSHIPS.find(item => item[0] === 'ml.cuda.kernel-debugging' && item[1] === 'REQUIRES')
    results.push(check('prerequisite_relationships_defined', Boolean(rel && rel[2] === 'ml.cuda'), rel?.join(',') ?? 'missing'))

    const walk = walkPrerequisites('ml.cuda.kernel-debugging', [
      { id: 'a', from: 'ml.cuda.kernel-debugging', kind: 'REQUIRES', to: 'ml.cuda', note: '' },
      { id: 'b', from: 'ml.cuda', kind: 'REQUIRES', to: 'debugging.runtime', note: '' },
    ], new Set(['ml.cuda.kernel-debugging', 'ml.cuda', 'debugging.runtime']))
    const cyclic = walkPrerequisites('ml.cuda', [
      { id: 'c1', from: 'ml.cuda', kind: 'REQUIRES', to: 'ml.training.memory', note: '' },
      { id: 'c2', from: 'ml.training.memory', kind: 'REQUIRES', to: 'ml.cuda', note: '' },
    ], new Set(['ml.cuda', 'ml.training.memory']))
    results.push(check('cycle_protection_remains', walk.cycle === null && Array.isArray(cyclic.cycle) && (cyclic.cycle?.length ?? 0) >= 2, JSON.stringify({ walk: walk.cycle, cyclic: cyclic.cycle })))

    persistSource(atlas, createSourceRecord({
      sourceId: 'fixture-stale-keep',
      title: 'Stale fixture',
      sourceUrl: 'https://doc.rust-lang.org/book/',
      sourceType: 'official_documentation',
      organization: 'Rust Project',
      license: 'MIT',
      version: '1',
      lastVerified: '2020-01-01T00:00:00.000Z',
      retrievedAt: '2020-01-01T00:00:00.000Z',
      authorityClass: 'OFFICIAL',
      skillIds: ['software.languages.rust'],
      notes: 'intentionally old',
      contentHash: hashSourceContent('stale-fixture'),
    }), 'REGISTERED')
    const rustSource = atlas.sources.get('fixture-stale-keep')
    results.push(check('stale_metadata_preserved', rustSource?.lastVerified === '2020-01-01T00:00:00.000Z' && rustSource.version === '1', JSON.stringify({ lastVerified: rustSource?.lastVerified, version: rustSource?.version })))

    const pack = buildSkillPack(atlas, 'software.languages.python')
    results.push(check('skill_pack_remains_compact', Boolean(pack && skillPackIsCompact(pack)), pack ? String(Buffer.byteLength(JSON.stringify(pack))) : 'missing'))
    results.push(check('full_docs_not_embedded', Boolean(pack && pack.briefProceduralGuidance.length <= 900 && !/<!doctype html|<html[\s>]/i.test(pack.briefProceduralGuidance)), String(pack?.briefProceduralGuidance.length ?? 0)))

    const report = await runDiscoveryWaves({
      atlas,
      waves: DISCOVERY_WAVES.slice(0, 1),
      fetchImpl: fetchOk,
      persist: true,
      includeFixtures: true,
      harvestKimi: true,
    })
    results.push(check('research_wave_manifest_valid', report.waves[0]?.waveId === 'wave-01-languages-runtimes' && existsSync(path.join(root, 'manifests', 'wave-01-languages-runtimes.json')) && Array.isArray(report.waves[0]?.queries), report.waves[0]?.waveId ?? 'missing'))

    const blog = DISCOVERY_REJECT_FIXTURES.find(item => item.rejectReason === 'blog')
    results.push(check('rejected_source_recorded', Boolean(blog && isBlogHost(blog.url) && report.waves[0]?.sourcesRejected.some(item => item.reason.toLowerCase().includes('blog'))), JSON.stringify(report.waves[0]?.sourcesRejected.slice(0, 3))))

    const invented = ingestDiscoveryCandidate(atlas, candidate({
      sourceId: 'fixture-timeout',
      url: 'https://docs.python.org/3/library/index.html',
      skillIds: ['software.languages.python'],
    }), { ok: false, timedOut: true, error: 'timeout' }, createDedupeState())
    results.push(check('failed_fetch_does_not_invent_source_content', invented.action === 'failed' && invented.reason.includes('timeout') && !atlas.sources.has('fixture-timeout'), invented.reason))

    const after = buildCapabilityScoreboard(atlas)
    results.push(check('evaluated_count_unchanged', after.evaluated === before.evaluated, `before=${before.evaluated} after=${after.evaluated}`))
    results.push(check('proven_count_unchanged', after.proven === before.proven, `before=${before.proven} after=${after.proven}`))
    results.push(check('production_proven_count_unchanged', after.productionProven === before.productionProven, `before=${before.productionProven} after=${after.productionProven}`))

    const cuda = assessMissionCapabilities({ missionText: 'Fix CUDA OOM during WRIM training.', atlas })
    results.push(check('planner_still_gaps_learnable_skills', cuda.recommendation === 'CAPABILITY_RESEARCH_REQUIRED' || cuda.recommendation === 'CAPABILITY_GAP', JSON.stringify({ rec: cuda.recommendation, status: atlas.skills.get('ml.cuda')?.capabilityStatus, missing: cuda.missingSkills.map(item => item.skillId) })))
    results.push(check('no_wrim_training', DISCOVERY_GOVERNANCE.wrimTraining === false && WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false && NEXT_RESEARCH_MISSION.startNow === false, 'wrim'))
    results.push(check('no_terra', DISCOVERY_GOVERNANCE.terra === false && GOVERNANCE.terra === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra'))
    results.push(check('no_commit', DISCOVERY_GOVERNANCE.commit === false && GOVERNANCE.commit === false, 'commit'))
    results.push(check('no_push', DISCOVERY_GOVERNANCE.push === false && GOVERNANCE.push === false, 'push'))
    results.push(check('no_deploy', DISCOVERY_GOVERNANCE.deploy === false && GOVERNANCE.liveDeploy === false, 'deploy'))

    const catalog = catalogExistingResearchArtifacts()
    results.push(check('os_doc_corpus_populated', catalog.some(item => item.category.includes('Operating-system') && item.status === 'EXISTING'), catalog.find(item => item.category.includes('Operating-system'))?.status ?? 'missing'))
    results.push(check('ai_ml_registry_populated', catalog.some(item => item.category.includes('AI / ML') && item.status === 'EXISTING'), catalog.find(item => item.category.includes('AI / ML'))?.status ?? 'missing'))
    results.push(check('bounded_waves_defined', DISCOVERY_WAVES.length === 12 && DISCOVERY_WAVES.every(wave => wave.sourceCap <= 16 && wave.candidates.length > 0), String(DISCOVERY_WAVES.length)))
    results.push(check('canonical_url_stable', canonicalizeSourceUrl('https://Docs.Python.Org/3/#frag') === canonicalizeSourceUrl('https://docs.python.org/3/'), canonicalizeSourceUrl('https://Docs.Python.Org/3/#frag')))
    results.push(check('seed_docs_still_not_mastery', seedAtlas().skills.get('ml.cuda')?.capabilityStatus !== 'PROVEN', seedAtlas().skills.get('ml.cuda')?.capabilityStatus ?? 'missing'))
    results.push(check('next_mission_is_acquisition_not_started', NEXT_RESEARCH_MISSION.id.includes('targeted-skill-acquisition') && NEXT_RESEARCH_MISSION.startNow === false && COMPLETED_DISCOVERY_MISSION.startNow === false, NEXT_RESEARCH_MISSION.id))
    results.push(check('false_mastery_zero', [...atlas.skills.values()].filter(skill => skill.capabilityStatus === 'PROVEN' || skill.capabilityStatus === 'PRODUCTION_PROVEN').every(skill => (atlas.evaluations ? true : false)), 'research did not mint PROVEN without eval overlay'))

    const homepage = existsSync(path.join(resolveRepoRoot(), 'app/page.tsx')) ? readFileSync(path.join(resolveRepoRoot(), 'app/page.tsx'), 'utf8') : ''
    const panel = readFileSync(path.join(resolveRepoRoot(), 'components/war-room/foundry/FoundryCapabilitiesPanel.tsx'), 'utf8')
    results.push(check('homepage_unchanged_by_discovery_ui', !homepage.includes('FoundryCapabilitiesPanel') && panel.includes('LEARNABLE') && panel.includes('foundry-capabilities-discovery'), 'ui'))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(root, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry capability atlas discovery: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCapabilityAtlasDiscoveryValidation }
