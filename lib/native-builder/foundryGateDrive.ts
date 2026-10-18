/**
 * When a model asks to COMPLETE while the engineering gate table still requires a TOOL, the controller refuses and records guidance. A model that ignores
 * that guidance would otherwise stall the mission. For the read-only evidence tools that need no model-authored arguments, the controller runs the required
 * step itself after repeated refusals. It never drives edits, writes, builds or anything that changes state: those always come from the model.
 */
import type { FoundryModelDecision } from './foundryModelTypes'
import type { EngineerToolName } from './engineerTools'

export const DRIVABLE_GATE_TOOLS = ['code.impact', 'code.owners', 'engineering.baseline'] as const
export const DRIVE_AFTER_COMPLETE_REFUSALS = 2

export function gateDrivenToolDecision(input: {
  table: { nextRequiredAction: string; recommendedToolClass: string | null }
  refusals: number
  goal: string
}): FoundryModelDecision | null {
  if (input.table.nextRequiredAction !== 'TOOL' || input.refusals < DRIVE_AFTER_COMPLETE_REFUSALS) return null
  const tool = input.table.recommendedToolClass
  if (!tool || !(DRIVABLE_GATE_TOOLS as readonly string[]).includes(tool)) return null
  return {
    decision: 'TOOL',
    reasoningSummary: `The controller ran the required ${tool} because the model asked to COMPLETE ${input.refusals} times while it was still required.`,
    tool: { name: tool as EngineerToolName, args: tool === 'code.owners' ? { query: input.goal } : {} },
  }
}

export const COMPLETE_AFTER_SATISFIED_REPLANS = 2

/**
 * A model that keeps answering REPLAN, with no justification, after every gate is satisfied (tests passed, regression evidence in, nothing missing) has nothing left to plan.
 * The first such REPLAN is refused with a pointer to COMPLETE; from the second on the controller completes the mission through the same sovereign gate a COMPLETE decision uses.
 * A REPLAN with a real justification (a failing check, a new finding) is never touched.
 */
export function satisfiedGateReplanAction(input: {
  gateComplete: boolean
  nextRequiredAction: string
  justification: string | null
  refusals: number
}): 'REFUSE' | 'COMPLETE' | null {
  if (!input.gateComplete || input.nextRequiredAction !== 'COMPLETE' || input.justification) return null
  return input.refusals + 1 >= COMPLETE_AFTER_SATISFIED_REPLANS ? 'COMPLETE' : 'REFUSE'
}
