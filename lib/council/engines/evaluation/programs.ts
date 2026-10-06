/**
 * ENGINE-05 evaluation programs persist via Engine-04 checkpoint/resume.
 */
import { createLongHorizonMission, pauseMission, cancelMission, completeMission } from '../long-horizon/engine'
import { createCheckpoint, resumeMission } from '../checkpoint/engine'
import { loadMission } from '../long-horizon/store'
import { saveProgram, loadProgram } from './store'
import type { EvaluationProgram, EvaluationProgramState } from './types'
import { EVALUATION_PROGRAM_SCHEMA } from './types'

function nowIso(): string {
  return new Date().toISOString()
}

export async function createEvaluationProgram(input: {
  program_id: string
  kind: EvaluationProgram['kind']
  candidate_id?: string | null
  suite_id?: string | null
}): Promise<EvaluationProgram> {
  const created = await createLongHorizonMission({
    mission_id: `eval-${input.program_id}`,
    objective: `ENGINE-05 ${input.kind} evaluation program`,
    mission_type: 'EVALUATION',
  })
  const program: EvaluationProgram = {
    schema: EVALUATION_PROGRAM_SCHEMA,
    program_id: input.program_id,
    mission_id: created.mission.mission_id,
    kind: input.kind,
    state: 'CREATED',
    candidate_id: input.candidate_id ?? null,
    suite_id: input.suite_id ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
    paused_at: null,
  }
  await saveProgram(program)
  return program
}

export async function setProgramState(program: EvaluationProgram, state: EvaluationProgramState): Promise<EvaluationProgram> {
  const loaded = await loadMission(program.mission_id)
  if (loaded) {
    if (state === 'PAUSED') await pauseMission(loaded)
    else if (state === 'CANCELLED') await cancelMission(loaded)
    else if (state === 'COMPLETED') await completeMission(loaded, 'COMPLETED', 'evaluation complete')
    else if (state === 'RUNNING' && loaded.mission_state === 'PAUSED') {
      await resumeMission({ mission_id: loaded.mission_id })
    }
    const latest = await loadMission(program.mission_id)
    if (latest && (state === 'PAUSED' || state === 'RUNNING' || state === 'CREATED')) {
      await createCheckpoint(latest, `evaluation ${state}`)
    }
  }
  const next: EvaluationProgram = {
    ...program,
    state,
    updated_at: nowIso(),
    paused_at: state === 'PAUSED' ? nowIso() : program.paused_at,
  }
  await saveProgram(next)
  return next
}

export async function restoreEvaluationProgram(programId: string): Promise<EvaluationProgram | null> {
  return loadProgram(programId)
}
