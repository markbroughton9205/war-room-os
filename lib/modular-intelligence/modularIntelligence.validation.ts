import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { TOOL_REGISTRY } from '@/lib/tools/toolRegistry'
import { PROMOTION_STATES } from '@/lib/wrim1-training/promotion'
import { canTransitionPromotion } from '@/lib/wrim1-training/promotion'
import { buildCapabilityModuleRecord, supportedModuleTypes } from './capabilityRegistry'
import { composeRuntime, officialActiveCore, stripModule } from './composedRuntime'
import { FUTURE_CAPABILITY_CURRICULUM_PATH } from './curriculumPath'
import { toExperienceCapture } from './experienceHooks'
import { rejectFailedModule, transitionModule, canTransitionModule } from './lifecycle'
import { getUnifiedTool, listUnifiedTools, warRoomRegistryStillAuthoritative } from './toolCatalog'
import { parseToolIntent } from './toolIntent'
import { executeNormalizedRequest, formatModelObservation, routeToolIntent } from './toolRouter'
import { MODULE_STATE_TO_PROMOTION, WRIM0_CHECKPOINT_SHA, WRIM0_ID } from './types'

const EXPECTED = 24
const { check, finish } = createValidationHarness('Modular intelligence Phase 1 (TypeScript)', EXPECTED)
const repo = process.cwd()

check('1 War Room TOOL_REGISTRY remains authoritative', () => {
  assert.equal(TOOL_REGISTRY.length >= 7, true)
  assert.equal(warRoomRegistryStillAuthoritative('web'), true)
  assert.equal(getUnifiedTool('web')?.authority, 'war_room_tool_registry')
  assert.equal(getUnifiedTool('sha256')?.authority, 'agi_gym_bounded')
  assert.equal(listUnifiedTools().filter((t) => t.toolId === 'web').length, 1)
})

check('2 valid compact TOOL parse', () => {
  const parsed = parseToolIntent('TOOL=sha256\ntext=hello')
  assert.equal(parsed.parse_status, 'PARSED')
  assert.equal(parsed.decision, 'TOOL')
  assert.equal(parsed.tool_id, 'sha256')
  assert.deepEqual(parsed.arguments, { text: 'hello' })
  assert.equal(parsed.raw_intent.includes('TOOL=sha256'), true)
})

check('3 NO_TOOL parse (none and NO_TOOL)', () => {
  const a = parseToolIntent('TOOL=none')
  const b = parseToolIntent('TOOL=NO_TOOL')
  assert.equal(a.decision, 'NO_TOOL')
  assert.equal(a.tool_id, null)
  assert.equal(b.decision, 'NO_TOOL')
  assert.equal(a.parse_status, 'PARSED')
})

check('4 malformed intent rejection', () => {
  const missing = parseToolIntent('text=hello')
  const json = parseToolIntent('{"tool":"sha256","arguments":{"text":"hello"}}')
  const xml = parseToolIntent('<tool_call>{"tool":"sha256"}</tool_call>')
  const empty = parseToolIntent('TOOL=\ntext=hello')
  assert.equal(missing.parse_status, 'MALFORMED')
  assert.equal(json.parse_status, 'MALFORMED')
  assert.equal(xml.parse_status, 'MALFORMED')
  assert.equal(empty.parse_status, 'MALFORMED')
  assert.equal(empty.tool_id, null)
})

check('5 missing required argument rejection', () => {
  const routed = routeToolIntent('TOOL=sha256')
  assert.equal(routed.validation, 'MISSING_ARGUMENT')
  assert.equal(routed.executed, false)
  assert.equal(routed.normalized, null)
  assert.equal(routed.stageReached, 'validate')
})

check('6 invalid argument type rejection', () => {
  const routed = routeToolIntent('TOOL=echo_int\nn=not-a-number')
  assert.equal(routed.validation, 'INVALID_ARGUMENT')
  assert.equal(routed.executed, false)
})

check('7 unknown argument rejection', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=hello\nextra=nope')
  assert.equal(routed.validation, 'UNKNOWN_ARGUMENT')
  assert.equal(routed.executed, false)
})

check('8 invalid tool rejection', () => {
  const routed = routeToolIntent('TOOL=curl\nurl=https://example.invalid')
  assert.equal(routed.validation, 'INVALID_TOOL')
  assert.equal(routed.executed, false)
})

check('9 normalized runtime request construction', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=hello')
  assert.equal(routed.validation, 'VALID')
  assert.deepEqual(routed.normalized, { tool: 'sha256', arguments: { text: 'hello' } })
  assert.equal(routed.stageReached, 'execution_boundary')
})

check('10 execution boundary remains separate', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=hello')
  assert.equal(routed.executed, false)
  assert.equal(routed.stageReached, 'execution_boundary')
})

check('11 dry-run ToolResult does not call War Room APIs', () => {
  const routed = routeToolIntent('TOOL=lookup_note\nnote_id=NOTE-L000')
  assert.ok(routed.normalized)
  const result = executeNormalizedRequest(routed.normalized, 'dry_run')
  assert.equal(result.status, 'dry_run')
  assert.equal(result.error, null)
  assert.equal(result.tool_id, 'lookup_note')
  assert.equal(typeof result.request_id, 'string')
  assert.equal(result.provenance.executed, 'false')
})

check('12 bounded sha256 ToolResult + WRIM observation format', () => {
  const routed = routeToolIntent('TOOL=sha256\ntext=hello')
  assert.ok(routed.normalized)
  const result = executeNormalizedRequest(routed.normalized, 'bounded_sha256')
  const expected = createHash('sha256').update('hello').digest('hex')
  assert.equal(result.status, 'ok')
  assert.equal((result.result as { digest: string }).digest, expected)
  const obs = formatModelObservation(result)
  assert.equal(obs.startsWith('TOOL_RESULT=sha256'), true)
  assert.equal(obs.includes('status=ok'), true)
  assert.equal(obs.includes(`value=`), true)
})

check('13 composed-runtime identity (not a merged checkpoint)', () => {
  const core = officialActiveCore()
  assert.equal(core.activeCoreId, WRIM0_ID)
  assert.equal(core.activeCoreCheckpointSha, WRIM0_CHECKPOINT_SHA)
  assert.deepEqual(core.activeModuleIds, [])
  const composed = composeRuntime(core, 'WR-Tool-Adapter-001')
  assert.equal(composed.kind, 'COMPOSED_RUNTIME')
  assert.equal(composed.activeCoreCheckpointSha, WRIM0_CHECKPOINT_SHA)
  assert.equal(composed.composedRuntimeId, 'composed:WRIM-0+[WR-Tool-Adapter-001]')
  const stripped = stripModule(composed, 'WR-Tool-Adapter-001')
  assert.deepEqual(stripped.activeModuleIds, [])
  assert.equal(stripped.kind, 'CORE')
})

check('14 module lifecycle states + illegal promotion skip', () => {
  let rec = buildCapabilityModuleRecord({
    capability_id: 'CAP-DUMMY',
    module_id: 'WR-DUMMY-CAP-001',
    module_type: 'CLASSIFIER_HEAD',
  })
  assert.equal(rec.status, 'DESIGN')
  rec = transitionModule(rec, 'SHADOW', 'silent eval')
  rec = transitionModule(rec, 'CANDIDATE', 'held-out passed design gate')
  assert.equal(rec.status, 'CANDIDATE')
  assert.equal(canTransitionModule('CANDIDATE', 'PROMOTED'), true)
  assert.equal(canTransitionModule('DESIGN', 'PROMOTED'), false)
  assert.equal(canTransitionPromotion('TRAINING_NOT_STARTED', 'PROMOTED'), false)
  assert.deepEqual(supportedModuleTypes().sort(), ['ADAPTER', 'CLASSIFIER_HEAD', 'LORA', 'ROUTER_HEAD'])
})

check('15 failed-module REJECTED preserves core and evidence', () => {
  const rec = buildCapabilityModuleRecord({
    capability_id: 'CAP-FAIL',
    module_id: 'WR-FAIL-001',
    module_type: 'LORA',
  })
  const { record, packet } = rejectFailedModule(transitionModule(rec, 'SHADOW', 'eval'), {
    summary: 'held-out tool accuracy 0',
    evalDeltas: { tool_eval_1: 0 },
    metrics: { collapse_probes: 4 },
  })
  assert.equal(record.status, 'REJECTED')
  assert.equal(packet.status, 'REJECTED')
  assert.equal(packet.active_core_untouched, true)
  assert.equal(packet.core_rollback_required, false)
  assert.equal(packet.forensic_work_item.auto_promotion, false)
  assert.equal(packet.eval_deltas_preserved, true)
  assert.equal(record.metrics.tool_eval_1, 0)
})

check('16 ACTIVE core vs ACTIVE modules default', () => {
  const active = officialActiveCore()
  assert.equal(active.kind, 'CORE')
  assert.equal(active.activeCoreId, 'WRIM-0')
  assert.deepEqual(active.activeModuleIds, [])
})

check('17 experience hook reuses CaptureExperienceInput', () => {
  const hook = toExperienceCapture({
    conversationId: 'c1',
    messageId: 'm1',
    contextSnapshotId: null,
    promptArtifactId: null,
    turnKind: 'assistant_response',
    outcomeSignal: 'none',
    composedRuntimeId: 'composed:WRIM-0+[]',
    experience: {
      request: 'TOOL=sha256\ntext=hello',
      decision: 'TOOL',
      selected_tool: 'sha256',
      arguments: { text: 'hello' },
      tool_result: { digest: 'abc' },
      success: true,
      correction: null,
      provenance: { source: 'phase1' },
      capability_family: 'tool_use',
    },
  })
  assert.equal(hook.conversationId, 'c1')
  assert.equal(hook.turnKind, 'assistant_response')
  assert.equal((hook.modelTarget as { capabilityFamily: string }).capabilityFamily, 'tool_use')
  assert.equal(hook.toolExperience?.selected_tool, 'sha256')
})

check('18 future curriculum path is design-only ordered', () => {
  assert.equal(FUTURE_CAPABILITY_CURRICULUM_PATH[0], 'runtime_experience')
  assert.equal(FUTURE_CAPABILITY_CURRICULUM_PATH.at(-1), 'commander_promotion_decision')
  assert.equal(FUTURE_CAPABILITY_CURRICULUM_PATH.includes('shadow_adapter_training'), true)
})

check('19 shared compact-intent fixtures', () => {
  const path = join(repo, 'model-lab/manifests/modular-intelligence/tool-intent-fixtures.json')
  assert.equal(existsSync(path), true)
  const fixtures = JSON.parse(readFileSync(path, 'utf8')) as {
    cases: Array<{ id: string; raw: string; expect_parse: string; expect_decision?: string; expect_tool_id?: string | null; expect_arguments?: Record<string, string> }>
  }
  for (const c of fixtures.cases) {
    const got = parseToolIntent(c.raw)
    assert.equal(got.parse_status, c.expect_parse, c.id)
    if (c.expect_parse === 'PARSED') {
      assert.equal(got.decision, c.expect_decision, c.id)
      if (c.expect_tool_id !== undefined) assert.equal(got.tool_id, c.expect_tool_id, c.id)
      if (c.expect_arguments) assert.deepEqual(got.arguments, c.expect_arguments, c.id)
    }
  }
})

check('20 module-state mapping does not rewrite core promotion machine', () => {
  assert.equal(MODULE_STATE_TO_PROMOTION.PROMOTED, 'PROMOTED')
  assert.equal(MODULE_STATE_TO_PROMOTION.REJECTED, 'PROMOTION_REJECTED')
  assert.equal(PROMOTION_STATES.includes('PROMOTED'), true)
  assert.equal(canTransitionPromotion('PROMOTED', 'TRAINING'), false)
})

check('21 UNAVAILABLE when tool disabled', () => {
  const def = getUnifiedTool('disabled_probe')
  assert.equal(def?.enabled, false)
  const routed = routeToolIntent('TOOL=disabled_probe\ntext=hello')
  assert.equal(routed.validation, 'UNAVAILABLE')
  assert.equal(routed.executed, false)
})

check('22 NO_TOOL does not construct a runtime tool request', () => {
  const routed = routeToolIntent('TOOL=none')
  assert.equal(routed.validation, 'VALID')
  assert.equal(routed.normalized, null)
  assert.equal(routed.executed, false)
})

check('23 production path is not a write target in this module', () => {
  const src = readFileSync(join(repo, 'lib/modular-intelligence/toolRouter.ts'), 'utf8')
  assert.equal(src.includes('WarRoomNode01'), false)
  assert.equal(src.includes('/api/tools/'), false)
})

check('24 WRIM-0 identity constants match Commander SHA', () => {
  assert.equal(WRIM0_ID, 'WRIM-0')
  assert.equal(WRIM0_CHECKPOINT_SHA, 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015')
})

finish()
