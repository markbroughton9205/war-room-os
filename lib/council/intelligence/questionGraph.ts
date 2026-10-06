/**
 * Question graph — Council tracks what it does not know.
 * Blocking questions are prioritized. Prevents random research.
 */

import type { MissionContractV1 } from './types'
import type { CognitiveStrategy, QuestionGraph, QuestionNode, QuestionType } from './orchestrationTypes'

export function buildQuestionGraph(input: {
  contract: MissionContractV1
  strategy: CognitiveStrategy
  text: string
}): QuestionGraph {
  const questions: QuestionNode[] = []
  const push = (partial: Omit<QuestionNode, 'question_id'> & { question_id?: string }) => {
    questions.push({
      question_id: partial.question_id ?? `q${questions.length + 1}`,
      ...partial,
    })
  }

  if (input.strategy.id === 'DIAGNOSE' || input.strategy.id === 'INCIDENT_RESPONSE') {
    push({
      type: 'CAUSAL',
      text: 'What is the most discriminating failing condition?',
      parent_task: 's1',
      priority: 'BLOCKING',
      blocking: true,
      answer_state: 'OPEN',
      required_evidence: ['tool_result', 'live_telemetry'],
      assigned_role: 'ORION',
    })
    if (/\bscreenshot/i.test(input.text)) {
      push({
        type: 'FACTUAL',
        text: 'Is Chromium launching?',
        parent_task: 's1',
        priority: 'BLOCKING',
        blocking: true,
        answer_state: 'OPEN',
        required_evidence: ['live_telemetry'],
        assigned_role: 'ORION',
      })
      push({
        type: 'FACTUAL',
        text: 'Is /tmp writable / is Playwright tmp off quota-limited /tmp?',
        parent_task: 's1',
        priority: 'HIGH',
        blocking: false,
        answer_state: 'OPEN',
        required_evidence: ['tool_result'],
        assigned_role: 'ORION',
      })
      push({
        type: 'CAUSAL',
        text: 'Is profile state corrupt?',
        parent_task: 's1',
        priority: 'HIGH',
        blocking: false,
        answer_state: 'OPEN',
        required_evidence: ['tool_result'],
        assigned_role: 'ORION',
      })
      push({
        type: 'CAUSAL',
        text: 'Is screenshot failing only on giant DOM?',
        parent_task: 's1',
        priority: 'HIGH',
        blocking: false,
        answer_state: 'OPEN',
        required_evidence: ['tool_result'],
        assigned_role: 'ORION',
      })
    } else {
      push({
        type: 'FACTUAL',
        text: 'Which recent change correlates with the failure?',
        parent_task: 's1',
        priority: 'HIGH',
        blocking: false,
        answer_state: 'OPEN',
        required_evidence: ['logs'],
        assigned_role: 'ORION',
      })
    }
  }
  if (input.strategy.id === 'COMPARE' || input.strategy.id === 'DESIGN' || input.strategy.scenario_requirement) {
    push({
      type: 'COMPARATIVE',
      text: 'Which option is reversible and within Commander authority?',
      parent_task: 'atlas',
      priority: 'BLOCKING',
      blocking: true,
      answer_state: 'OPEN',
      required_evidence: [],
      assigned_role: 'EXECUTIVE',
    })
  }
  if (input.strategy.id === 'RESEARCH') {
    push({
      type: 'FACTUAL',
      text: 'What current primary sources answer the Commander question?',
      parent_task: 's1',
      priority: 'BLOCKING',
      blocking: true,
      answer_state: 'OPEN',
      required_evidence: ['primary_external'],
      assigned_role: 'PULSAR',
    })
  }
  if (input.strategy.id === 'PLAN') {
    push({
      type: 'IMPLEMENTATION',
      text: 'What dependencies and performance questions block a later Foundry handoff?',
      parent_task: 's1',
      priority: 'HIGH',
      blocking: false,
      answer_state: 'OPEN',
      required_evidence: [],
      assigned_role: 'ORION',
    })
  }
  if (input.strategy.id === 'REVIEW') {
    push({
      type: 'RISK',
      text: 'What irreversible or authority-violating effects exist?',
      parent_task: 'sentinel',
      priority: 'BLOCKING',
      blocking: true,
      answer_state: 'OPEN',
      required_evidence: [],
      assigned_role: 'LUMEN',
    })
    push({
      type: 'AUTHORITY',
      text: 'Does Commander authorization exist for automatic deploy?',
      parent_task: 'sentinel',
      priority: 'BLOCKING',
      blocking: true,
      answer_state: 'OPEN',
      required_evidence: [],
      assigned_role: 'EXECUTIVE',
    })
  }
  if (input.strategy.runtime_knowledge) {
    push({
      type: 'TEMPORAL',
      text: 'What is the current install and 3847/3848 ownership?',
      parent_task: 'awareness',
      priority: 'HIGH',
      blocking: false,
      answer_state: 'OPEN',
      required_evidence: ['install_id', '3847_pid', '3848_pid'],
      assigned_role: 'ORION',
    })
  }
  if (input.contract.unknowns.length) {
    for (const unknown of input.contract.unknowns.slice(0, 4)) {
      push({
        type: 'UNKNOWN_UNKNOWN',
        text: unknown,
        parent_task: null,
        priority: 'MED',
        blocking: false,
        answer_state: 'OPEN',
        required_evidence: [],
        assigned_role: 'ORION',
      })
    }
  }
  if (!questions.length && input.strategy.id !== 'DIRECT') {
    push({
      type: 'FACTUAL',
      text: 'What evidence would actually resolve the Commander objective?',
      parent_task: null,
      priority: 'MED',
      blocking: false,
      answer_state: 'OPEN',
      required_evidence: input.contract.required_evidence,
      assigned_role: 'ORION',
    })
  }
  return Object.freeze({ mission_id: input.contract.mission_id, questions })
}

export function prioritizeBlocking(graph: QuestionGraph): QuestionNode[] {
  return [...graph.questions].sort((a, b) => Number(b.blocking) - Number(a.blocking) || rank(b.priority) - rank(a.priority))
}

function rank(priority: QuestionNode['priority']): number {
  return { BLOCKING: 4, HIGH: 3, MED: 2, LOW: 1 }[priority]
}

export function questionTypes(): readonly QuestionType[] {
  return ['FACTUAL', 'CAUSAL', 'COMPARATIVE', 'IMPLEMENTATION', 'RISK', 'TEMPORAL', 'AUTHORITY', 'DEPENDENCY', 'UNKNOWN_UNKNOWN']
}
