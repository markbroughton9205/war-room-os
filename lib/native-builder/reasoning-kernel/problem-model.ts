/**
 * Problem model. Known, inferred, assumed, and unknown stay in separate fields.
 */
import type { FoundryAssumption, FoundryProblemModel } from './types'
import { clipText } from './text'

export type ProblemModelInput = {
  goal: string
  subgoals?: string[]
  constraints?: string[]
  mustPreserve?: string[]
  mustNotDo?: string[]
  acceptanceConditions?: string[]
  knownFacts?: string[]
  inferences?: Array<{ statement: string; uncertainty?: 'LIKELY' | 'POSSIBLE'; derivedFrom?: string[] }>
  assumptions?: FoundryAssumption[]
  unknowns?: string[]
  risks?: string[]
  dependencies?: string[]
}

export function buildProblemModel(input: ProblemModelInput): FoundryProblemModel {
  return {
    goal: clipText(input.goal),
    subgoals: (input.subgoals ?? []).map(clipText),
    constraints: (input.constraints ?? []).map(clipText),
    mustPreserve: (input.mustPreserve ?? []).map(clipText),
    mustNotDo: (input.mustNotDo ?? []).map(clipText),
    acceptanceConditions: (input.acceptanceConditions ?? []).map(clipText),
    knownFacts: (input.knownFacts ?? []).map(statement => ({ statement: clipText(statement), uncertainty: 'KNOWN' as const })),
    inferences: (input.inferences ?? []).map(item => ({
      statement: clipText(item.statement),
      uncertainty: item.uncertainty ?? 'POSSIBLE',
      derivedFrom: item.derivedFrom ?? [],
    })),
    assumptions: input.assumptions ?? [],
    unknowns: (input.unknowns ?? []).map(statement => ({ statement: clipText(statement), uncertainty: 'UNKNOWN' as const })),
    risks: (input.risks ?? []).map(clipText),
    dependencies: (input.dependencies ?? []).map(clipText),
  }
}

export function factBuckets(model: FoundryProblemModel): {
  known: string[]
  inferred: string[]
  assumed: string[]
  unknown: string[]
} {
  return {
    known: model.knownFacts.map(item => item.statement),
    inferred: model.inferences.map(item => item.statement),
    assumed: model.assumptions.map(item => item.statement),
    unknown: model.unknowns.map(item => item.statement),
  }
}
