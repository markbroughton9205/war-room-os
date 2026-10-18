/**
 * Run-level failure classification (evidence-derived from the workflow result and the independent verifier's own output; never inferred from narrative).
 * Primary metric of the Foundry coding benchmark is WORKFLOW_COMPLETED (the workflow itself finished and validated); VERIFIER_PASS (12/12 on the workspace left behind) is tracked separately.
 */
export type RunFailureClass =
  | 'NONE'                 // workflow completed
  | 'EDIT_STAGE_REJECTION' // the model could not produce an acceptable edit for a file (collision, bad import, unusable reply) within the bounded retries
  | 'TEST_AUTHORING'       // the model-written test blocked a step and could not be repaired or quarantined
  | 'SERVER_START'         // the verifier could not start the server
  | 'IMPLEMENTATION_DEFECT'// the server runs but acceptance checks fail and bounded repairs did not fix them
  | 'PLANNER'              // the plan was unusable (no files / no steps)
  | 'CONTEXT'              // a model call failed on context size
  | 'RUNTIME'              // model call failure, crash, engine error, budget stop
  | 'STOPPED'              // cancelled / paused / blocked by a boundary (not a model fault)

export function classifyRun(i: { status: string; reason: string; verifierSummary: string }): RunFailureClass {
  if (i.status === 'COMPLETED') return 'NONE'
  if (['CANCELLED', 'PAUSED', 'BLOCKED'].includes(i.status)) return 'STOPPED'
  const r = i.reason
  if (/context|num_ctx|too long|token limit/i.test(r)) return 'CONTEXT'
  if (/no (files|steps)|plan (is )?empty|unusable plan/i.test(r)) return 'PLANNER'
  if (/model call failed|workflow error|CRASHED|budget|timed out|timeout/i.test(r) || i.status === 'CRASHED') return 'RUNTIME'
  if (/repeatedly produced|incompatible rewrite|unusable reply|rejections/i.test(r)) return 'EDIT_STAGE_REJECTION'
  if (/^test\/|\(test\/|test suite/i.test(r)) return 'TEST_AUTHORING'
  if (/server did not start|server exited|could not complete/i.test(i.verifierSummary)) return 'SERVER_START'
  if (/UNDETERMINED|verification/i.test(r)) return 'IMPLEMENTATION_DEFECT'
  return 'RUNTIME'
}
