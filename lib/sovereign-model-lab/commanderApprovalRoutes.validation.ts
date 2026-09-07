import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Sovereign Model Lab authorization audit (Wave 1 reconciliation). Full method/route classification:
 * of the 24 route files under app/api/sovereign-model-lab/ (~30 exported methods), only three carry
 * any explicit approval/identity gate at all - two of which (dataset-approval, tokenizer-approval)
 * had NONE before this fix, despite docs/architecture/SOVEREIGN_MODEL_LAB_ARCHITECTURE_AND_
 * GOVERNANCE.md section 12 naming them "the two decisions that matter most." The third
 * (tokenizer-train) already had a real, extensively-tested, hash-bound execution gate
 * (assertTokenizerExecutionApproved, see tokenizerPipeline.validation.ts's gate_01-gate_14 cases)
 * that checks WHAT was approved, but never WHO approved it - any authenticated session, not just
 * the Commander, could mint a dataset or tokenizer-training approval.
 *
 * Per that same doc, section 12a explicitly documents that read-only operations (program status/
 * detail reads, hardware/source/document listing, dataset-candidate/corpus building,
 * tokenizer-environment probing, tokenizer-plan creation, dataset-preview, deterministic
 * validation) are INTENTIONALLY session-only, unaffected by any hardening - this audit does not
 * touch those, and does not blanket-apply Commander gating across all 24 files. Only the two
 * actual Commander-decision routes named in the doc are fixed here.
 *
 * Structural (source-text) check, not a live-session integration test: requireCommanderSession
 * needs a real Next.js request/cookie context this harness does not reproduce, matching the
 * pattern used elsewhere in this repo for route-level structural proofs (see
 * lib/council/live-orchestration/backends/councilLiveRouting.validation.ts).
 */

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL('../../' + relativePath, import.meta.url)), 'utf8')
}

export function runCommanderApprovalRoutesValidation(): CaseResult[] {
  const results: CaseResult[] = []

  const datasetApproval = readRepoFile('app/api/sovereign-model-lab/programs/[id]/dataset-approval/route.ts')
  results.push(check(
    'dataset_approval_route_requires_commander_session',
    /requireCommanderSession/.test(datasetApproval) && /if \(!commander\.ok\) return commander\.response/.test(datasetApproval),
    'dataset-approval/route.ts imports and calls requireCommanderSession, returning its response on failure before reaching decideDatasetApproval',
  ))

  const tokenizerApproval = readRepoFile('app/api/sovereign-model-lab/programs/[id]/tokenizer-approval/route.ts')
  results.push(check(
    'tokenizer_approval_route_requires_commander_session',
    /requireCommanderSession/.test(tokenizerApproval) && /if \(!commander\.ok\) return commander\.response/.test(tokenizerApproval),
    'tokenizer-approval/route.ts imports and calls requireCommanderSession, returning its response on failure before reaching approveTokenizerTraining',
  ))

  // The one route that ALREADY had a real gate (tokenizer-train) must still have it - this fix
  // must not have accidentally touched or weakened that existing, extensively-tested hardening.
  const tokenizerTrain = readRepoFile('app/api/sovereign-model-lab/programs/[id]/tokenizer-train/route.ts')
  results.push(check(
    'tokenizer_train_execution_gate_unchanged',
    /assertTokenizerExecutionApproved/.test(tokenizerTrain),
    'tokenizer-train/route.ts still calls assertTokenizerExecutionApproved - unmodified by this audit',
  ))

  // Explicitly documented read-only routes must remain untouched by this audit (no new gate
  // added where the architecture doc says none belongs) - spot-check a representative sample.
  const readOnlySamples = [
    'app/api/sovereign-model-lab/status/route.ts',
    'app/api/sovereign-model-lab/hardware/route.ts',
    'app/api/sovereign-model-lab/programs/[id]/corpus/route.ts',
    'app/api/sovereign-model-lab/programs/[id]/tokenizer-plan/route.ts',
  ]
  const readOnlyUntouched = readOnlySamples.every(path => !/requireCommanderSession/.test(readRepoFile(path)))
  results.push(check(
    'documented_read_only_routes_left_untouched',
    readOnlyUntouched,
    `checked ${readOnlySamples.length} routes the architecture doc names as intentionally session-only; none gained a new Commander gate`,
  ))

  return results
}
