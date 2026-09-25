/**
 * Advisory capability gate proofs.
 * Atlas informs planning; it does not become an authority layer.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import { isProtectedSubsystemPath } from './foundryMissionWriteSet'
import { interpretCommanderRequest } from './foundryMissionPlanner'
import { startMissionInput } from './foundryMissionController'
import {
  loadCapabilityAtlas,
  persistSkill,
  persistSource,
  registerSkill,
  recordSkillEvaluation,
  applyWatchtowerStaleHint,
  loadMissionSkillPacks,
  assessMissionCapabilities,
  persistableCapabilityAssessment,
  PLANNER_CAPABILITY_GATE,
  CAPABILITY_GATE_AUTHORITY,
  GOVERNANCE,
  WRIM_INTEGRATION_BOUNDARY,
  NEXT_RESEARCH_MISSION,
  ENGINEERING_MEMORY_BOUNDARY,
  type CapabilityAtlas,
  type SkillRecord,
} from './capability-atlas'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function prove(atlas: CapabilityAtlas, skillId: string, level: 'CODE_EVAL' | 'INTEGRATION_EVAL' | 'PRODUCTION_EVAL', outcome: 'PASS' | 'FAIL' | 'PARTIAL' = 'PASS', missionId?: string) {
  recordSkillEvaluation(atlas, {
    evaluationId: `gate-${skillId}-${level}-${outcome}`,
    skillId,
    level,
    title: 'planner-gate fixture',
    requiredSteps: ['fixture evidence'],
    evidencePaths: ['lib/native-builder/foundryCapabilityPlannerGate.validation.ts'],
    outcome,
    production: level === 'PRODUCTION_EVAL',
    missionId: missionId ?? null,
  })
}

function cloneAs(atlas: CapabilityAtlas, fromId: string, toId: string, patch: Partial<SkillRecord>): SkillRecord {
  const base = atlas.skills.get(fromId)
  if (!base) throw new Error(`missing ${fromId}`)
  return {
    ...base,
    ...patch,
    skillId: toId,
    lastCapabilityEvaluated: null,
    productionProofMissions: [],
    unsupportedReason: patch.unsupportedReason ?? null,
  }
}

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const root = await mkdtemp(path.join(tmpdir(), 'wr-capability-planner-gate-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = root
  const results: CaseResult[] = []
  try {
    const atlas = loadCapabilityAtlas()
    const repo = resolveRepoRoot()
    const homepage = existsSync(path.join(repo, 'app/page.tsx')) ? readFileSync(path.join(repo, 'app/page.tsx'), 'utf8') : ''
    const planner = readFileSync(path.join(repo, 'lib/native-builder/foundryMissionPlanner.ts'), 'utf8')
    const controller = readFileSync(path.join(repo, 'lib/native-builder/foundryMissionController.ts'), 'utf8')

    prove(atlas, 'foundry.bounded-edit', 'INTEGRATION_EVAL')
    prove(atlas, 'foundry.tool-broker-governance', 'INTEGRATION_EVAL')
    const ready = assessMissionCapabilities({
      missionText: 'Exercise Foundry write-set governance.',
      missionKind: 'fixture',
      requestedSkillIds: ['foundry.bounded-edit', 'foundry.tool-broker-governance'],
      atlas,
    })
    results.push(check('proven_required_is_ready', ready.recommendation === 'CAPABILITY_READY' && ready.requiredSkills.includes('foundry.bounded-edit') && ready.missingSkills.length === 0, JSON.stringify({ rec: ready.recommendation, missing: ready.missingSkills.map(item => item.skillId), required: ready.requiredSkills })))

    prove(atlas, 'foundry.binding-protection', 'CODE_EVAL', 'PARTIAL')
    prove(atlas, 'software.languages.typescript', 'CODE_EVAL', 'PARTIAL')
    const evaluated = assessMissionCapabilities({
      missionText: 'Change this exact Foundry UI text safely.',
      missionKind: 'fixture',
      atlas,
    })
    results.push(check('evaluated_is_ready_with_validation', evaluated.recommendation === 'CAPABILITY_READY_WITH_VALIDATION' && evaluated.evaluatedSkills.includes('foundry.binding-protection') && evaluated.evaluatedSkills.includes('software.languages.typescript') && !evaluated.productionProofRequired, JSON.stringify({ rec: evaluated.recommendation, evaluated: evaluated.evaluatedSkills, proven: evaluated.provenSkills })))

    const learnable = assessMissionCapabilities({
      missionText: 'Write an in-tree Linux kernel device driver in Rust.',
      requestedSkillIds: ['software.languages.rust'],
      atlas,
    })
    results.push(check('learnable_required_is_gap', learnable.missingSkills.some(item => item.kind === 'SKILL_GAP' && item.skillId === 'software.languages.rust') && (learnable.recommendation === 'CAPABILITY_RESEARCH_REQUIRED' || learnable.recommendation === 'CAPABILITY_GAP'), JSON.stringify({ rec: learnable.recommendation, missing: learnable.missingSkills.map(item => `${item.skillId}:${item.currentStatus}`) })))

    const discovered = assessMissionCapabilities({
      missionText: 'Fix CUDA OOM during WRIM training.',
      atlas,
    })
    results.push(check('discovered_or_learnable_cuda_gap', discovered.missingSkills.some(item => item.skillId === 'ml.cuda' && item.kind === 'SKILL_GAP') && discovered.recommendation !== 'CAPABILITY_READY', JSON.stringify({ rec: discovered.recommendation, missing: discovered.missingSkills.map(item => item.skillId) })))

    prove(atlas, 'desktop.electron', 'CODE_EVAL', 'FAIL')
    const failed = assessMissionCapabilities({
      missionText: 'Repair the Electron desktop shell.',
      requestedSkillIds: ['desktop.electron'],
      atlas,
    })
    results.push(check('failed_required_is_gap', failed.recommendation === 'CAPABILITY_GAP' && failed.missingSkills.some(item => item.skillId === 'desktop.electron' && item.currentStatus === 'FAILED'), JSON.stringify({ rec: failed.recommendation, missing: failed.missingSkills })))

    applyWatchtowerStaleHint(atlas, { sourceId: 'rust-book', reason: 'planner-gate stale fixture', detectedAt: new Date().toISOString() })
    const stale = assessMissionCapabilities({
      missionText: 'Write an in-tree Linux kernel device driver in Rust.',
      requestedSkillIds: ['software.languages.rust'],
      atlas,
    })
    results.push(check('stale_required_is_gap', stale.recommendation === 'CAPABILITY_GAP' && stale.missingSkills.some(item => item.skillId === 'software.languages.rust' && item.currentStatus === 'STALE'), JSON.stringify({ rec: stale.recommendation, status: atlas.skills.get('software.languages.rust')?.capabilityStatus, missing: stale.missingSkills.map(item => `${item.skillId}:${item.currentStatus}`) })))

    const unsupported = cloneAs(atlas, 'ml.jax', 'fixture.unsupported.skill', {
      name: 'Unsupported Fixture',
      description: 'fixture unsupported skill',
      unsupportedReason: 'fixture: not supported',
      officialSources: [],
      evidence: { implementationFiles: [], brokerTools: [], validators: [], proofFiles: [], notes: 'unsupported fixture' },
    })
    registerSkill(atlas, unsupported)
    persistSkill(atlas, { ...atlas.skills.get('fixture.unsupported.skill')!, unsupportedReason: 'fixture: not supported' })
    const unsupportedGate = assessMissionCapabilities({
      missionText: 'Use the unsupported fixture skill.',
      requestedSkillIds: ['fixture.unsupported.skill'],
      atlas,
    })
    results.push(check('unsupported_required', unsupportedGate.recommendation === 'CAPABILITY_UNSUPPORTED' && atlas.skills.get('fixture.unsupported.skill')?.capabilityStatus === 'UNSUPPORTED', JSON.stringify({ rec: unsupportedGate.recommendation, status: atlas.skills.get('fixture.unsupported.skill')?.capabilityStatus })))

    const optionalSkill = cloneAs(atlas, 'frontend.accessibility', 'fixture.optional.gap', {
      name: 'Exact Change Background',
      description: 'optional exact change background mention',
      officialSources: [],
      evidence: { implementationFiles: [], brokerTools: [], validators: [], proofFiles: [], notes: 'optional discovered fixture' },
      unsupportedReason: null,
    })
    registerSkill(atlas, optionalSkill)
    const optionalGate = assessMissionCapabilities({
      missionText: 'Change this exact Foundry UI text safely.',
      missionKind: 'fixture',
      requestedSkillIds: ['foundry.bounded-edit', 'foundry.tool-broker-governance'],
      atlas,
    })
    results.push(check('optional_missing_does_not_block', optionalGate.recommendation !== 'CAPABILITY_GAP' && optionalGate.recommendation !== 'CAPABILITY_UNSUPPORTED' && optionalGate.recommendation !== 'CAPABILITY_RESEARCH_REQUIRED' && !optionalGate.missingSkills.some(item => item.skillId === 'fixture.optional.gap'), JSON.stringify({ rec: optionalGate.recommendation, missing: optionalGate.missingSkills.map(item => item.skillId), optional: optionalGate.optionalSkills })))
    results.push(check('missing_optional_not_hard_gap', !optionalGate.missingSkills.some(item => optionalGate.optionalSkills.includes(item.skillId)), JSON.stringify({ missing: optionalGate.missingSkills.map(item => item.skillId), optional: optionalGate.optionalSkills })))

    const secondarySkill = cloneAs(atlas, 'testing.targeted', 'fixture.secondary.gap', {
      name: 'Exact Text Safely Helper',
      description: 'exact text safely helper without claiming bounded edit mastery',
      officialSources: ['ts-handbook'],
      evidence: { implementationFiles: [], brokerTools: [], validators: [], proofFiles: [], notes: 'learnable secondary fixture' },
    })
    registerSkill(atlas, secondarySkill)
    persistSource(atlas, { ...atlas.sources.get('ts-handbook')!, skillIds: [...atlas.sources.get('ts-handbook')!.skillIds, 'fixture.secondary.gap'] }, 'UPDATED')
    const secondaryGate = assessMissionCapabilities({
      missionText: 'Change this exact Foundry UI text safely.',
      missionKind: 'fixture',
      requestedSkillIds: ['foundry.bounded-edit', 'foundry.tool-broker-governance'],
      atlas,
    })
    const secondaryHard = secondaryGate.secondarySkills.includes('fixture.secondary.gap')
    results.push(check('secondary_missing_lowers_confidence', !secondaryHard || secondaryGate.confidence === 'low' || secondaryGate.recommendation === 'CAPABILITY_READY_WITH_VALIDATION' || secondaryGate.resolverConfidence !== secondaryGate.confidence, JSON.stringify({ secondary: secondaryGate.secondarySkills, confidence: secondaryGate.confidence, resolver: secondaryGate.resolverConfidence, rec: secondaryGate.recommendation })))

    prove(atlas, 'release.production-activation', 'INTEGRATION_EVAL')
    prove(atlas, 'foundry.production-lease', 'INTEGRATION_EVAL')
    const production = assessMissionCapabilities({
      missionText: 'Install and activate this build in production.',
      missionKind: 'application',
      requiredVerification: ['install', 'identity', 'computer'],
      atlas,
    })
    results.push(check('production_without_production_proven_surfaces_gap', production.productionProofRequired && production.missingSkills.some(item => /PRODUCTION_PROOF_REQUIRED/.test(item.why)) && production.recommendation === 'CAPABILITY_GAP', JSON.stringify({ rec: production.recommendation, missing: production.productionProofMissing, why: production.missingSkills.map(item => item.why) })))
    results.push(check('proven_is_not_production_proven', atlas.skills.get('release.production-activation')?.capabilityStatus === 'PROVEN' && production.productionProofMissing.includes('release.production-activation'), atlas.skills.get('release.production-activation')?.capabilityStatus ?? 'missing'))
    results.push(check('evaluated_is_not_proven', atlas.skills.get('foundry.binding-protection')?.capabilityStatus === 'EVALUATED' && !evaluated.provenSkills.includes('foundry.binding-protection'), `${atlas.skills.get('foundry.binding-protection')?.capabilityStatus} proven=${evaluated.provenSkills.join(',')}`))

    const docsOnly = assessMissionCapabilities({
      missionText: 'Use official CUDA documentation to fix training memory.',
      requestedSkillIds: ['ml.cuda'],
      atlas,
    })
    results.push(check('docs_alone_do_not_satisfy_gate', docsOnly.recommendation !== 'CAPABILITY_READY' && docsOnly.missingSkills.some(item => item.skillId === 'ml.cuda'), JSON.stringify({ rec: docsOnly.recommendation, status: atlas.skills.get('ml.cuda')?.capabilityStatus })))

    const implOnly = assessMissionCapabilities({
      missionText: 'Use Foundry engineering memory on this repo.',
      requestedSkillIds: ['foundry.engineering-memory'],
      atlas,
    })
    results.push(check('implementation_file_alone_does_not_satisfy_gate', implOnly.recommendation !== 'CAPABILITY_READY' && atlas.skills.get('foundry.engineering-memory')?.capabilityStatus !== 'PROVEN', JSON.stringify({ rec: implOnly.recommendation, status: atlas.skills.get('foundry.engineering-memory')?.capabilityStatus })))

    const reactAssumed = assessMissionCapabilities({
      missionText: 'Change this exact Foundry UI text safely with React components.',
      missionKind: 'fixture',
      requestedSkillIds: ['foundry.bounded-edit', 'frontend.react'],
      repoTruth: 'this repo uses vanilla HTML, not React',
      atlas,
    })
    results.push(check('repo_truth_wins_over_atlas', reactAssumed.repoTruthNotes.some(note => note.includes('REPO_TRUTH_WINS')) && !reactAssumed.requiredSkills.includes('frontend.react') && ENGINEERING_MEMORY_BOUNDARY.conflictPolicy === 'REPO_TRUTH_WINS', JSON.stringify({ required: reactAssumed.requiredSkills, notes: reactAssumed.repoTruthNotes })))

    const packs = loadMissionSkillPacks(atlas, evaluated.selectedPackSkillIds)
    results.push(check('compact_packs_only_for_selected', packs.length <= 12 && evaluated.selectedPackSkillIds.length <= 12 && packs.every(pack => pack.compact === true), JSON.stringify({ loaded: packs.length, selected: evaluated.selectedPackSkillIds })))
    results.push(check('no_full_atlas_prompt_injection', evaluated.selectedPackSkillIds.length < atlas.skills.size && persistableCapabilityAssessment(evaluated).selectedPackSkillIds.length <= 12 && JSON.stringify(evaluated).length < 20_000, JSON.stringify({ selected: evaluated.selectedPackSkillIds.length, registered: atlas.skills.size, bytes: JSON.stringify(evaluated).length })))

    results.push(check('no_global_research_auto_start', PLANNER_CAPABILITY_GATE.globalResearch === false && NEXT_RESEARCH_MISSION.startNow === false && evaluated.globalResearchStarted === false, JSON.stringify({ gate: PLANNER_CAPABILITY_GATE.globalResearch, startNow: NEXT_RESEARCH_MISSION.startNow })))
    results.push(check('no_wrim_training', evaluated.wrimTraining === false && WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false && PLANNER_CAPABILITY_GATE.wrimTraining === false, 'wrim'))
    results.push(check('no_authority_escalation', evaluated.grantsAuthority === false && CAPABILITY_GATE_AUTHORITY.isAuthorityLayer === false && Object.values(CAPABILITY_GATE_AUTHORITY).every(value => value === false), JSON.stringify(CAPABILITY_GATE_AUTHORITY)))
    results.push(check('no_tool_broker_bypass', CAPABILITY_GATE_AUTHORITY.bypassesToolBroker === false && FOUNDRY_MODEL_TOOL_CATALOG.some(item => item.name === 'file.write' && item.mutating === true), 'broker'))
    const mission = startMissionInput('Change this exact Foundry UI text safely.')
    results.push(check('no_commander_approval_bypass', CAPABILITY_GATE_AUTHORITY.canBypassCommanderAuthorization === false && mission.authorization === null && mission.permissions.commit === false && mission.permissions.liveDeploy === false, JSON.stringify({ auth: mission.authorization, commit: mission.permissions.commit, deploy: mission.permissions.liveDeploy })))

    results.push(check('capability_assessment_persists_boundedly', Boolean(mission.capabilityAssessment) && mission.capabilityAssessment!.selectedPackSkillIds.length <= 12 && !('skills' in (mission.capabilityAssessment as object)), JSON.stringify({ rec: mission.capabilityAssessment?.recommendation, packs: mission.capabilityAssessment?.selectedPackSkillIds.length })))
    results.push(check('resolver_confidence_preserved', typeof evaluated.resolverConfidence === 'string' && typeof evaluated.confidence === 'string', `${evaluated.resolverConfidence}->${evaluated.confidence}`))
    results.push(check('skill_gap_payload_preserved', discovered.missingSkills.every(item => item.kind === 'SKILL_GAP' && item.skillId && item.why), JSON.stringify(discovered.missingSkills.slice(0, 3))))

    const cuda = assessMissionCapabilities({ missionText: 'Fix CUDA OOM during WRIM training.', atlas })
    results.push(check('cuda_example_returns_gaps', ['ml.cuda', 'ml.training.memory', 'performance.gpu-memory', 'debugging.runtime'].every(id => cuda.requiredSkills.includes(id) || cuda.missingSkills.some(item => item.skillId === id)) && cuda.missingSkills.length > 0 && cuda.recommendation !== 'CAPABILITY_READY', JSON.stringify({ rec: cuda.recommendation, required: cuda.requiredSkills, missing: cuda.missingSkills.map(item => item.skillId) })))

    const bounded = assessMissionCapabilities({ missionText: 'Change this exact Foundry UI text safely.', missionKind: 'fixture', atlas })
    results.push(check('bounded_edit_example_ready_or_validation', bounded.recommendation === 'CAPABILITY_READY' || bounded.recommendation === 'CAPABILITY_READY_WITH_VALIDATION', JSON.stringify({ rec: bounded.recommendation, proven: bounded.provenSkills, evaluated: bounded.evaluatedSkills })))

    const activate = interpretCommanderRequest('Install and activate this build in production.')
    results.push(check('production_activation_example_requires_production_proof', activate.kind === 'application' && Boolean(activate.capabilityAssessment?.productionProofRequired) && (activate.capabilityAssessment?.missingSkills.some(item => /PRODUCTION_PROOF_REQUIRED/.test(item.why)) ?? false), JSON.stringify({ kind: activate.kind, rec: activate.capabilityAssessment?.recommendation, proof: activate.capabilityAssessment?.productionProofRequired })))

    results.push(check('planner_invokes_resolver', /assessMissionCapabilities/.test(planner) && /capabilityAssessment/.test(controller), 'planner+controller wired'))
    results.push(check('auto_trust_research_false', learnable.acquisitionPlans.every(plan => plan.autoTrustResearch === false) && PLANNER_CAPABILITY_GATE.autoTrustResearch === false, JSON.stringify(learnable.acquisitionPlans.map(plan => plan.autoTrustResearch))))
    results.push(check('no_terra', GOVERNANCE.terra === false && evaluated.terraMutation === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra'))
    results.push(check('homepage_unchanged', !homepage.includes('FoundryCapabilitiesPanel'), 'homepage'))
    results.push(check('acquisition_does_not_auto_run_global_research', !learnable.acquisitionPlans.some(plan => /global software knowledge discovery/i.test(plan.steps.join(' '))), JSON.stringify(learnable.acquisitionPlans[0]?.steps.slice(0, 4))))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(root, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry capability planner gate: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}
