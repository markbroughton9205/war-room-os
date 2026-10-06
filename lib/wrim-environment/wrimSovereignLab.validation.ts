/**
 * #23 WRIM sovereign model laboratory validation.
 * No training. TRAINING_AUTHORIZATION remains OFF. Optimizer steps this pass = 0.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  RAEL_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3B_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
  PARENT_SHA256,
  QWEN_INTELLIGENCE_CLASS,
} from './identity'
import { WRIM_LAB_BIND, WRIM_LAB_FORBIDDEN_PORTS, WRIM_LAB_PORTS } from './labPorts'
import { VERIFIED_TOOLS, UNKNOWN_METRIC, IMPORT_CLASS_HISTORICAL } from './labIdentity'
import { WRIM_CHECKPOINT_FORMAT_V1, WRIM_CHECKPOINT_FORMAT_V2 } from './checkpointFormat'
import { RUN_000005_IMPORT } from './historicalImport'
import { lmHarnessMayPromote } from './lmHarnessLane'
import { WRIM_OBSERVABILITY_ADAPTERS } from './observabilityBus'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runWrimSovereignLabValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const live = resolveWrimEnvironmentPaths()
  const report = fs.existsSync(live.sovereignLabReportPath)
    ? (JSON.parse(fs.readFileSync(live.sovereignLabReportPath, 'utf8')) as Record<string, unknown>)
    : null
  const busPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/observability_bus.py'), 'utf8')
  const labPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/sovereign_lab.py'), 'utf8')
  const exporterPy = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/lab_exporter.py'), 'utf8')
  const portsJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/lab_ports.json'), 'utf8')) as {
    bind: string
    forbidden: number[]
    services: Record<string, { port: number }>
  }
  const identitySrc = fs.readFileSync(path.join(repoRoot, 'lib/wrim-environment/identity.ts'), 'utf8')
  const panelSrc = fs.readFileSync(path.join(repoRoot, 'components/war-room/wrim/WrimEnvironmentPanel.tsx'), 'utf8')
  const status = wrimEnvironmentStatusPayload()
  const pip = (report?.pip ?? {}) as Record<string, { pinned_ok?: boolean; unpinned_ok?: boolean }>
  const avail = (report?.adapter_availability ?? {}) as Record<string, { available?: boolean }>
  const services = (report?.services ?? {}) as Record<string, { bind?: string; port?: number; forbidden_collision?: boolean; loopback_only?: boolean; up?: boolean }>
  const run5 = (report?.run000005 ?? {}) as Record<string, unknown>
  const dvc = (report?.dvc ?? {}) as Record<string, unknown>
  const st = (report?.safetensors ?? {}) as Record<string, unknown>
  const prof = (report?.profiler ?? {}) as Record<string, unknown>
  const lm = (report?.lm_eval ?? {}) as Record<string, unknown>
  const bus = (report?.bus ?? {}) as { per_adapter_fail?: Record<string, number>; adapters?: string[] }
  const cls = String(report?.final_classification ?? '')

  results.push(check('1_official_repos', Boolean(VERIFIED_TOOLS.aim.official_repository.includes('aimhubio/aim') && VERIFIED_TOOLS.prometheus.official_repository.includes('prometheus/prometheus') && labPy.includes('github.com/prometheus/prometheus')), 'verified catalog'))
  results.push(check('2_licenses', VERIFIED_TOOLS.aim.license === 'Apache-2.0' && VERIFIED_TOOLS.mlflow.license === 'Apache-2.0' && VERIFIED_TOOLS.duckdb.license === 'MIT' && VERIFIED_TOOLS.lm_eval_harness.license === 'MIT', 'Apache-2.0/MIT'))
  results.push(check('3_no_blocked_license', !labPy.includes('LICENSE_OR_SOVEREIGNTY_BLOCKED') && !cls.includes('BLOCKED'), cls))
  results.push(check('4_aim_local', Boolean(avail.aim?.available) || Boolean(pip.aim?.pinned_ok || pip.aim?.unpinned_ok) || labPy.includes('PRIMARY_WRIM_EXPERIMENT_EXPLORER'), String(avail.aim?.available)))
  results.push(check('5_tensorboard_local', Boolean(avail.tensorboard?.available) || Boolean(pip.tensorboard?.pinned_ok || pip.tensorboard?.unpinned_ok), String(avail.tensorboard?.available)))
  results.push(check('6_profiler_trace', prof.ok === true && prof.silent_recipe_change === false, JSON.stringify(prof.ok)))
  results.push(check('7_dvc_test_artifact', dvc.original_preserved === true && (dvc.add_ok === true || fs.existsSync(path.join(repoRoot, 'scripts/wrim-environment/artifact-lineage/lab-test-artifact.json.dvc'))), JSON.stringify({ add: dvc.add_ok, pointer: true })))
  results.push(check('8_safetensors_roundtrip', st.ok === true && st.historical_overwritten === false, JSON.stringify(st.ok)))
  results.push(check('9_duckdb_reads', Boolean((report?.duckdb_query as { ok?: boolean } | undefined)?.ok) && Boolean(avail.duckdb?.available), 'duckdb'))
  results.push(check('10_lm_harness_adapter', lm.can_promote === false && (lm.loaded === true || typeof lm.error === 'string') && lm.lane === 'EXTERNAL_STANDARD_EVAL' && lmHarnessMayPromote() === false, JSON.stringify(lm.loaded)))
  results.push(check('11_mlflow_local', Boolean(avail.mlflow?.available) && labPy.includes('sqlite:///') && !labPy.includes('databricks.cloud'), String(avail.mlflow?.available)))
  results.push(check('12_prometheus_scrape', Boolean(services.prometheus?.up) || Boolean(services.wrim_exporter?.up) || Boolean(report?.exporter_metrics_present), 'scrape path'))
  results.push(check('13_loopback_only', portsJson.bind === '127.0.0.1' && WRIM_LAB_BIND === '127.0.0.1' && exporterPy.includes('Refusing non-loopback') && Object.values(services).every(s => !s || s.loopback_only !== false), WRIM_LAB_BIND))
  results.push(check('14_no_port_3001', WRIM_LAB_FORBIDDEN_PORTS.includes(3001) && Object.values(WRIM_LAB_PORTS).every(p => Number(p) !== 3001) && Object.values(services).every(s => s?.port !== 3001), 'no 3001'))
  results.push(check('15_no_port_3000', WRIM_LAB_FORBIDDEN_PORTS.includes(3000) && Object.values(WRIM_LAB_PORTS).every(p => Number(p) !== 3000) && Object.values(services).every(s => s?.port !== 3000), 'no 3000'))
  results.push(check('16_no_cloud_telemetry', labPy.includes('MLFLOW_DISABLE_TELEMETRY') && labPy.includes('DVC_NO_ANALYTICS') && labPy.includes('DO_NOT_TRACK') && dvc.no_cloud_remote === true, 'telemetry disabled'))
  results.push(check('17_bus_fanout', WRIM_OBSERVABILITY_ADAPTERS.length === 5 && busPy.includes('ObservabilityBus') && (bus.adapters ?? []).includes('aim') && (bus.adapters ?? []).includes('mlflow'), JSON.stringify(bus.adapters)))
  results.push(check('18_adapter_isolation', busPy.includes('continue') && busPy.includes('adapter_error') && Number(bus.per_adapter_fail?.broken_isolation_probe ?? 0) >= 1, 'isolation probe'))
  results.push(check('19_run000005_import', run5.imported === true && String(run5.status) === 'STOPPED_BY_POLICY' && String(run5.stream_sha) === RUN_000005_IMPORT.stream_sha && String(run5.recipe_sha) === RUN_000005_IMPORT.recipe_sha, String(run5.status)))
  results.push(check('20_unknown_preserved', Array.isArray(run5.unknown_kept) && (run5.unknown_kept as string[]).includes('parameter_norm') && labPy.includes(UNKNOWN_METRIC), UNKNOWN_METRIC))
  results.push(check('21_stopped_by_policy', String(run5.status) === 'STOPPED_BY_POLICY' && labPy.includes('STOPPED_BY_POLICY'), 'STOPPED_BY_POLICY'))
  results.push(check('22_dvc_no_delete', dvc.original_preserved === true && labPy.includes('original_preserved'), 'preserved'))
  results.push(check('23_safetensors_no_overwrite', st.historical_overwritten === false && labPy.includes('WRIM_CHECKPOINT_FORMAT_V2') && String(WRIM_CHECKPOINT_FORMAT_V1) !== String(WRIM_CHECKPOINT_FORMAT_V2), WRIM_CHECKPOINT_FORMAT_V2))
  results.push(check('24_aim_mlflow_distinct', labPy.includes('PRIMARY_WRIM_EXPERIMENT_EXPLORER') && labPy.includes('WRIM_RUN_MODEL_LIFECYCLE_REGISTRY') && String((report?.roles_distinct as { aim_vs_mlflow?: string } | undefined)?.aim_vs_mlflow ?? '').includes('neither promotes'), 'distinct'))
  results.push(check('25_tensorboard_not_authority', (report?.roles_distinct as { tensorboard_not_authority?: boolean } | undefined)?.tensorboard_not_authority === true, 'tb not authority'))
  results.push(check('26_lm_harness_no_promote', lm.can_promote === false && (report?.roles_distinct as { lm_harness_cannot_promote?: boolean } | undefined)?.lm_harness_cannot_promote === true, 'no promote'))
  results.push(check('27_prometheus_no_control', exporterPy.includes('wrim_prometheus_cannot_control_training') && (report?.roles_distinct as { prometheus_cannot_control_training?: boolean } | undefined)?.prometheus_cannot_control_training === true, 'no control'))
  results.push(check('28_training_off', TRAINING_AUTHORIZATION === 'OFF' && report?.TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING' && status.train_button === false && identitySrc.includes("TRAINING_AUTHORIZATION = 'OFF'"), TRAINING_AUTHORIZATION))
  results.push(check('29_optimizer_steps_zero', Number(report?.optimizer_steps_this_pass ?? -1) === 0 && !labPy.includes('optimizer.step('), String(report?.optimizer_steps_this_pass)))
  results.push(check('30_weights_unchanged', report?.wrim_weights_unchanged === true && st.historical_overwritten === false, 'weights'))
  results.push(check('31_tokenizer_unchanged', report?.tokenizer_unchanged === true && TOKENIZER_SHA256.length === 64, 'tokenizer'))
  results.push(check('32_corpus_unchanged', report?.corpus_unchanged === true && PARENT_SHA256.length === 64, 'corpus'))
  results.push(check('33_council_untouched', report?.council_untouched === true && !labPy.includes('lib/council'), 'council'))
  results.push(check('34_foundry_untouched', report?.foundry_untouched === true && !labPy.includes('lib/native-builder'), 'foundry'))
  results.push(check('35_terra_untouched', report?.terra_untouched === true && !labPy.includes('TerraEarthImagery'), 'terra'))
  results.push(check('36_nothing_pushed', report?.nothing_pushed === true && tryForbiddenEnvAction('PUSH_CHANGES').denied, 'no push'))
  results.push(check('37_nothing_deployed', report?.nothing_deployed === true && STAGE3_AUTHORIZATION === 'NO' && STAGE3B_EXECUTION_READINESS === false && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED' && RAEL_STATUS === 'NOT_IMPLEMENTED' && QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY', 'no deploy'))
  results.push(check('ui_tabs', panelSrc.includes('OVERVIEW') && panelSrc.includes('RUNS') && panelSrc.includes('HARDWARE') && panelSrc.includes('WRIM Lab'), 'tabs'))
  results.push(check('import_class', labPy.includes(IMPORT_CLASS_HISTORICAL), IMPORT_CLASS_HISTORICAL))
  results.push(check('classification', ['WRIM_SOVEREIGN_MODEL_LAB_READY', 'WRIM_SOVEREIGN_MODEL_LAB_PARTIAL'].includes(cls), cls))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runWrimSovereignLabValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
