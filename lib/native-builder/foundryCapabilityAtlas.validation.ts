/**
 * Foundry Coding Capability Atlas foundation proofs.
 * Does not train WRIM, mutate Terra, commit, or push.
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import { ENGINEER_TOOL_NAMES } from './engineerTools'
import { isProtectedSubsystemPath } from './foundryMissionWriteSet'
import {
  loadTaxonomy,
  seedAtlas,
  loadCapabilityAtlas,
  registerSkill,
  SkillRegistryError,
  walkPrerequisites,
  addSkillRelationship,
  assertCanAssignStatus,
  CapabilityStatusError,
  applyWatchtowerStaleHint,
  recordSkillEvaluation,
  buildSkillPack,
  skillPackIsCompact,
  resolveMissionSkills,
  detectSkillGaps,
  planSkillAcquisition,
  buildCapabilityScoreboard,
  catalogExistingResearchArtifacts,
  assertMemoryNotCopiedIntoAtlas,
  skillPackOmitsRepoFacts,
  ENGINEERING_MEMORY_BOUNDARY,
  WRIM_INTEGRATION_BOUNDARY,
  WATCHTOWER_INTEGRATION_BOUNDARY,
  LEGION_INTEGRATION_BOUNDARY,
  GOVERNANCE,
  NEXT_RESEARCH_MISSION,
  capabilityAtlasLayout,
  persistSource,
  selfKnowledgeBundle,
  classifyValidatorOutput,
} from './capability-atlas'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const root = await mkdtemp(path.join(tmpdir(), 'wr-capability-atlas-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = root
  const results: CaseResult[] = []
  try {
    const taxonomy = loadTaxonomy()
    results.push(check('taxonomy_loads', taxonomy.length >= 80 && taxonomy.some(node => node.id === 'software.languages.typescript') && taxonomy.some(node => node.id === 'kernel.device-drivers') && taxonomy.some(node => node.id === 'ml.cuda'), String(taxonomy.length)))

    const atlas = loadCapabilityAtlas()
    results.push(check('skills_register', atlas.skills.size >= 80 && atlas.skills.has('software.languages.typescript') && atlas.skills.has('foundry.tool-broker-governance'), String(atlas.skills.size)))

    let duplicateRefused = false
    try {
      registerSkill(atlas, atlas.skills.get('software.languages.typescript')!)
    } catch (error) {
      duplicateRefused = error instanceof SkillRegistryError
    }
    results.push(check('duplicate_skill_ids_refused', duplicateRefused, 'duplicate register'))

    const source = atlas.sources.get('ts-handbook')
    results.push(check('source_registry_works', Boolean(source && source.authorityClass === 'OFFICIAL' && source.sourceUrl.includes('typescriptlang.org')), source?.sourceId ?? 'missing'))

    persistSource(atlas, source!, 'UPDATED')
    persistSource(atlas, { ...source!, version: 'handbook-2026' }, 'UPDATED')
    const history = await readFile(path.join(capabilityAtlasLayout().sourceHistory, 'history.jsonl'), 'utf8')
    results.push(check('source_provenance_preserved', history.split('\n').filter(Boolean).length >= 2 && history.includes('UPDATED'), String(history.split('\n').filter(Boolean).length)))

    const rels = atlas.relationships.filter(item => item.from === 'kernel.device-drivers' && item.kind === 'REQUIRES')
    results.push(check('relationships_resolve', rels.length >= 3 && rels.some(item => item.to === 'systems.memory'), rels.map(item => item.to).join(',')))

    const graph = walkPrerequisites('release.production-activation', atlas.relationships, new Set(atlas.skills.keys()))
    results.push(check('prerequisite_graph_works', graph.order.includes('release.packaging') && graph.order.includes('foundry.production-lease') && !graph.cycle, graph.order.join('>')))

    addSkillRelationship(atlas, 'fixture.cycle.a', 'REQUIRES', 'fixture.cycle.b', 'test')
    addSkillRelationship(atlas, 'fixture.cycle.b', 'REQUIRES', 'fixture.cycle.a', 'test')
    const cycleWalk = walkPrerequisites('fixture.cycle.a', atlas.relationships, new Set(['fixture.cycle.a', 'fixture.cycle.b']))
    results.push(check('cycles_handled_safely', Boolean(cycleWalk.cycle && cycleWalk.cycle.length >= 2), JSON.stringify(cycleWalk.cycle)))

    const allowed = ['DISCOVERED', 'SOURCE_BACKED', 'LEARNABLE', 'AVAILABLE', 'EVALUATION_PENDING', 'EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN', 'STALE', 'FAILED', 'UNSUPPORTED']
    results.push(check('capability_states_validated', [...atlas.skills.values()].every(skill => allowed.includes(skill.capabilityStatus)), [...new Set([...atlas.skills.values()].map(s => s.capabilityStatus))].join(',')))

    const untested = [...atlas.skills.values()].filter(skill => skill.capabilityStatus === 'PROVEN' || skill.capabilityStatus === 'PRODUCTION_PROVEN')
    results.push(check('untested_skill_not_marked_proven', untested.length === 0, untested.map(item => item.skillId).join(',')))

    let provenBlocked = false
    try {
      assertCanAssignStatus('PROVEN', { evaluations: [], productionProofMissions: [] })
    } catch (error) {
      provenBlocked = error instanceof CapabilityStatusError
    }
    results.push(check('evaluation_evidence_required_for_proven', provenBlocked, 'assert PROVEN'))

    let productionBlocked = false
    try {
      assertCanAssignStatus('PRODUCTION_PROVEN', { evaluations: [], productionProofMissions: [] })
    } catch (error) {
      productionBlocked = error instanceof CapabilityStatusError
    }
    results.push(check('production_mission_evidence_required', productionBlocked, 'assert PRODUCTION_PROVEN'))

    const rust = atlas.skills.get('software.languages.rust')
    applyWatchtowerStaleHint(atlas, { sourceId: 'rust-book', reason: 'validator stale-source proof', detectedAt: new Date().toISOString() })
    const rustAfter = atlas.skills.get('software.languages.rust')
    results.push(check('stale_source_marks_skill_stale', Boolean(rust && rustAfter?.capabilityStatus === 'STALE'), `${rust?.capabilityStatus} -> ${rustAfter?.capabilityStatus}`))

    const memoryViolations = assertMemoryNotCopiedIntoAtlas(atlas)
    const pack = buildSkillPack(atlas, 'desktop.electron')
    results.push(check('repo_memory_remains_separate', memoryViolations.length === 0 && ENGINEERING_MEMORY_BOUNDARY.conflictPolicy === 'REPO_TRUTH_WINS' && Boolean(pack && skillPackOmitsRepoFacts(pack)), ENGINEERING_MEMORY_BOUNDARY.atlasOwns))

    const cuda = resolveMissionSkills(atlas, 'Fix CUDA OOM during WRIM training.')
    const cudaIds = [...cuda.primarySkills, ...cuda.secondarySkills, ...cuda.optionalSkills, ...cuda.missingSkills.map(item => item.skillId)]
    results.push(check('skill_resolver_maps_mission', cudaIds.includes('ml.cuda') && cudaIds.includes('ml.training.memory') && (cudaIds.includes('performance.gpu-memory') || cudaIds.includes('debugging.runtime')), cudaIds.slice(0, 12).join(',')))

    const rustMission = 'Write an in-tree Linux kernel device driver in Rust.'
    const rustGaps = detectSkillGaps(atlas, rustMission)
    results.push(check('missing_skill_becomes_skill_gap', rustGaps.some(item => item.kind === 'SKILL_GAP' && (item.skillId.includes('rust') || item.skillId.includes('kernel') || item.skillId.includes('device-drivers'))), rustGaps.map(item => item.skillId).slice(0, 8).join(',')))

    results.push(check('skill_pack_remains_compact', Boolean(pack && skillPackIsCompact(pack) && pack.briefProceduralGuidance.length <= 900), pack ? String(Buffer.byteLength(JSON.stringify(pack))) : 'missing'))

    const tsPack = buildSkillPack(atlas, 'software.languages.typescript')
    results.push(check('source_references_retrievable', Boolean(tsPack && tsPack.officialSources.some(item => item.url.includes('typescriptlang.org'))), tsPack?.officialSources.map(item => item.sourceId).join(',') ?? 'missing'))

    const available = [...atlas.skills.values()].filter(skill => skill.capabilityStatus === 'AVAILABLE')
    const evidenceOk = available.every(skill => skill.evidence.implementationFiles.every(file => existsSync(path.join(resolveRepoRoot(), file))))
    results.push(check('bootstrap_only_with_evidence', available.length >= 8 && evidenceOk && available.some(skill => skill.skillId === 'foundry.tool-broker-governance'), available.map(item => item.skillId).join(',')))

    results.push(check('no_fake_mastery', [...atlas.skills.values()].every(skill => skill.capabilityStatus !== 'PROVEN' && skill.capabilityStatus !== 'PRODUCTION_PROVEN'), 'seed has no PROVEN'))
    results.push(check('no_wrim_training', WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false && WRIM_INTEGRATION_BOUNDARY.implemented === false && NEXT_RESEARCH_MISSION.startNow === false, 'wrim'))
    results.push(check('no_terra_mutation', GOVERNANCE.terra === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra protected'))
    results.push(check('no_direct_model_fs_mutation', GOVERNANCE.directModelFilesystemMutation === false && capabilityAtlasLayout().root.startsWith(root), capabilityAtlasLayout().root))
    results.push(check('no_commit', GOVERNANCE.commit === false, 'commit'))
    results.push(check('no_push', GOVERNANCE.push === false, 'push'))

    const layout = capabilityAtlasLayout()
    results.push(check('storage_layout', ['domains', 'skills', 'sources', 'evaluations', 'relationships', 'status', 'manifests'].every(name => existsSync(path.join(layout.root, name))) && existsSync(layout.index), layout.root))

    const catalog = catalogExistingResearchArtifacts()
    results.push(check('existing_research_cataloged', catalog.some(item => item.category.includes('Earth Knowledge') && item.status === 'EXISTING') && catalog.some(item => item.category.includes('Operating-system') && item.status === 'EXISTING') && catalog.some(item => item.category.includes('AI / ML') && item.status === 'EXISTING'), catalog.map(item => `${item.category}:${item.status}`).join(' | ')))

    const toolsPresent = ['capability.scoreboard', 'capability.resolve', 'capability.pack', 'capability.gap', 'capability.self_knowledge'].every(name =>
      (ENGINEER_TOOL_NAMES as readonly string[]).includes(name) && FOUNDRY_MODEL_TOOL_CATALOG.some(entry => entry.name === name && entry.mutating === false),
    )
    results.push(check('broker_tools_read_only', toolsPresent, 'capability.*'))

    const shell = readFileSync(path.join(resolveRepoRoot(), 'components/war-room/foundry/FoundryShell.tsx'), 'utf8')
    const homepage = existsSync(path.join(resolveRepoRoot(), 'app/page.tsx')) ? readFileSync(path.join(resolveRepoRoot(), 'app/page.tsx'), 'utf8') : ''
    results.push(check('ui_gated_advanced', shell.includes('foundry-capabilities-toggle') && shell.includes('Advanced / Capabilities') && !homepage.includes('FoundryCapabilitiesPanel'), 'advanced capabilities'))

    recordSkillEvaluation(atlas, {
      evaluationId: 'fixture-code-eval-ts',
      skillId: 'software.languages.typescript',
      level: 'CODE_EVAL',
      title: 'Fixture evaluation to prove CODE_EVAL path',
      requiredSteps: ['typecheck', 'inspect owners'],
      evidencePaths: ['lib/native-builder/foundryEngineeringDepth.validation.ts'],
      outcome: 'PASS',
      notes: 'Validator-only fixture. CODE_EVAL is not mastery of TypeScript.',
    })
    results.push(check('passing_code_eval_is_evaluated', atlas.skills.get('software.languages.typescript')?.capabilityStatus === 'EVALUATED', atlas.skills.get('software.languages.typescript')?.capabilityStatus ?? 'missing'))

    recordSkillEvaluation(atlas, {
      evaluationId: 'fixture-integration-eval-broker',
      skillId: 'foundry.tool-broker-governance',
      level: 'INTEGRATION_EVAL',
      title: 'Fixture INTEGRATION_EVAL for PROVEN path',
      requiredSteps: ['run write-set validator'],
      evidencePaths: ['lib/native-builder/foundryPass014.writeSet.validation.ts'],
      outcome: 'PASS',
      notes: 'Fixture only.',
    })
    results.push(check('proven_requires_integration_eval', atlas.skills.get('foundry.tool-broker-governance')?.capabilityStatus === 'PROVEN', atlas.skills.get('foundry.tool-broker-governance')?.capabilityStatus ?? 'missing'))

    recordSkillEvaluation(atlas, {
      evaluationId: 'fixture-knowledge-eval-react',
      skillId: 'frontend.react',
      level: 'KNOWLEDGE_EVAL',
      title: 'Docs-only knowledge eval',
      requiredSteps: ['read react.dev'],
      evidencePaths: ['https://react.dev/learn'],
      outcome: 'PASS',
      notes: 'Documentation cannot prove React.',
    })
    results.push(check('knowledge_eval_records_evaluated_not_proven', atlas.skills.get('frontend.react')?.capabilityStatus === 'EVALUATED', atlas.skills.get('frontend.react')?.capabilityStatus ?? 'missing'))

    recordSkillEvaluation(atlas, {
      evaluationId: 'fixture-fail-electron',
      skillId: 'desktop.electron',
      level: 'CODE_EVAL',
      title: 'Failing eval does not promote',
      requiredSteps: ['run validator'],
      evidencePaths: ['lib/sovereign-runtime/local-ownership/trustedDesktop.validation.ts'],
      outcome: 'FAIL',
      notes: 'Controlled fixture FAIL.',
    })
    results.push(check('failing_eval_does_not_advance', atlas.skills.get('desktop.electron')?.capabilityStatus === 'FAILED', atlas.skills.get('desktop.electron')?.capabilityStatus ?? 'missing'))

    recordSkillEvaluation(atlas, {
      evaluationId: 'fixture-partial-next',
      skillId: 'frontend.nextjs',
      level: 'CODE_EVAL',
      title: 'Partial credit',
      requiredSteps: ['run foundry validator'],
      evidencePaths: ['lib/native-builder/foundry.validation.ts'],
      outcome: 'PARTIAL',
      notes: 'PARTIAL must not become PROVEN.',
    })
    results.push(check('partial_does_not_over_promote', atlas.skills.get('frontend.nextjs')?.capabilityStatus === 'EVALUATED', atlas.skills.get('frontend.nextjs')?.capabilityStatus ?? 'missing'))

    const availableAfter = [...atlas.skills.values()].filter(skill => skill.capabilityStatus === 'AVAILABLE')
    results.push(check('available_without_eval_stays_unproven', availableAfter.some(skill => skill.skillId === 'backend.rest') && availableAfter.every(skill => skill.capabilityStatus !== 'PROVEN'), availableAfter.map(item => item.skillId).slice(0, 12).join(',')))

    let productionEvalBlocked = false
    try {
      recordSkillEvaluation(atlas, {
        evaluationId: 'fixture-production-without-mission',
        skillId: 'foundry.production-lease',
        level: 'PRODUCTION_EVAL',
        title: 'Production without mission',
        requiredSteps: ['watchdog'],
        evidencePaths: ['lib/native-builder/foundryProductionLeaseWatchdog.validation.ts'],
        outcome: 'PASS',
        production: true,
        notes: 'Missing mission must not assign PRODUCTION_PROVEN.',
      })
    } catch (error) {
      productionEvalBlocked = error instanceof CapabilityStatusError
    }
    results.push(check('production_proven_requires_production_eval_and_mission', productionEvalBlocked && atlas.skills.get('foundry.production-lease')?.capabilityStatus !== 'PRODUCTION_PROVEN', atlas.skills.get('foundry.production-lease')?.capabilityStatus ?? 'missing'))

    recordSkillEvaluation(atlas, {
      evaluationId: 'fixture-production-with-mission',
      skillId: 'foundry.production-lease',
      level: 'PRODUCTION_EVAL',
      title: 'Production with named mission',
      requiredSteps: ['watchdog', 'named mission'],
      evidencePaths: ['lib/native-builder/foundryProductionLeaseWatchdog.validation.ts'],
      outcome: 'PASS',
      production: true,
      missionId: 'fixture-production-proof-mission',
      notes: 'Named production proof mission recorded.',
    })
    results.push(check('production_proof_mission_recorded', atlas.skills.get('foundry.production-lease')?.capabilityStatus === 'PRODUCTION_PROVEN' && (atlas.skills.get('foundry.production-lease')?.productionProofMissions.includes('fixture-production-proof-mission') ?? false), JSON.stringify(atlas.skills.get('foundry.production-lease')?.productionProofMissions)))

    let passWithoutPathBlocked = false
    try {
      recordSkillEvaluation(atlas, {
        evaluationId: 'fixture-pass-no-path',
        skillId: 'systems.processes',
        level: 'CODE_EVAL',
        title: 'Pass without evidence path',
        requiredSteps: ['inspect'],
        evidencePaths: [],
        outcome: 'PASS',
      })
    } catch (error) {
      passWithoutPathBlocked = error instanceof CapabilityStatusError
    }
    results.push(check('evidence_path_required_for_pass', passWithoutPathBlocked, 'PASS without path'))

    const docsOnly = seedAtlas()
    results.push(check('docs_alone_cannot_prove', docsOnly.skills.get('software.languages.typescript')?.capabilityStatus !== 'PROVEN' && docsOnly.skills.get('software.languages.typescript')?.capabilityStatus !== 'PRODUCTION_PROVEN', docsOnly.skills.get('software.languages.typescript')?.capabilityStatus ?? 'missing'))
    results.push(check('implementation_file_alone_cannot_prove', docsOnly.skills.get('foundry.engineering-memory')?.capabilityStatus === 'AVAILABLE', docsOnly.skills.get('foundry.engineering-memory')?.capabilityStatus ?? 'missing'))

    const afterBoard = buildCapabilityScoreboard(atlas)
    results.push(check('scoreboard_updates_from_recorded_evidence', afterBoard.evaluated >= 1 && afterBoard.proven >= 1 && afterBoard.failed >= 1, JSON.stringify({ evaluated: afterBoard.evaluated, proven: afterBoard.proven, failed: afterBoard.failed, productionProven: afterBoard.productionProven })))

    const knowledge = selfKnowledgeBundle(atlas)
    results.push(check('self_knowledge_reflects_status', knowledge.evaluated.skills.some(item => item.skillId === 'software.languages.typescript') && knowledge.proven.skills.some(item => item.skillId === 'foundry.tool-broker-governance') && knowledge.failed.skills.some(item => item.skillId === 'desktop.electron') && knowledge.productionProven.skills.some(item => item.skillId === 'foundry.production-lease'), `eval=${knowledge.evaluated.skills.length} proven=${knowledge.proven.skills.length}`))

    results.push(check('stale_proof_not_accepted_for_proven', atlas.skills.get('software.languages.rust')?.capabilityStatus === 'STALE', atlas.skills.get('software.languages.rust')?.capabilityStatus ?? 'missing'))

    let knowledgeProvenBlocked = false
    try {
      assertCanAssignStatus('PROVEN', {
        evaluations: [{ evaluationId: 'k', skillId: 'x', level: 'KNOWLEDGE_EVAL', title: 'docs', requiredSteps: ['read'], evidencePaths: ['docs'], missionId: null, outcome: 'PASS', evaluatedAt: new Date().toISOString(), notes: '', production: false }],
        productionProofMissions: [],
      })
    } catch (error) {
      knowledgeProvenBlocked = error instanceof CapabilityStatusError
    }
    results.push(check('knowledge_eval_is_not_proven', knowledgeProvenBlocked, 'KNOWLEDGE_EVAL'))
    results.push(check('timeout_is_not_validator_fail', classifyValidatorOutput({ timedOut: true, exitCode: 124, output: 'ASYNC CASE END foundry-research PASS' }) === 'NOT_RUN', 'timeout'))
    results.push(check('mixed_pass_ratio_is_partial', classifyValidatorOutput({ timedOut: false, exitCode: 1, output: 'qualityTools validation: 10/12 PASS' }) === 'PARTIAL', '10/12'))

    results.push(check('watchtower_legion_boundaries', WATCHTOWER_INTEGRATION_BOUNDARY.implemented === false && LEGION_INTEGRATION_BOUNDARY.implemented === false, 'future contracts only'))
    results.push(check('acquisition_does_not_auto_trust', planSkillAcquisition(rustGaps[0] ?? { kind: 'SKILL_GAP', skillId: 'software.languages.rust', requiredForMission: rustMission, currentStatus: 'LEARNABLE', availableSources: [], researchRequired: true, evaluationRequired: true, why: 'x' }).autoTrustResearch === false, 'acquisition'))

    const scoreboard = buildCapabilityScoreboard(atlas)
    results.push(check('scoreboard_factual', scoreboard.skillsRegistered === atlas.skills.size && typeof scoreboard.lastUpdated === 'string', JSON.stringify(scoreboard)))

    const isolated = seedAtlas()
    results.push(check('seed_does_not_require_runtime_overlay', isolated.taxonomy.length === taxonomy.length && isolated.skills.has('foundry.engineering-memory'), String(isolated.skills.size)))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(root, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry capability atlas: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCapabilityAtlasValidation }
