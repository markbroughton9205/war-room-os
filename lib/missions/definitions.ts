import type { Mission, MissionId, MissionStatus } from './types'

const NOW_SEED = '2026-01-01T00:00:00.000Z'

export const PERSISTENT_MISSION_IDS: readonly MissionId[] = [
  'phase-0-cashflow-base',
  'content-automation',
  'automation-services',
  'real-estate-monitor',
  'debt-freedom-trigger',
] as const

export const PERSISTENT_MISSIONS: readonly Mission[] = [
  {
    id: 'phase-0-cashflow-base',
    title: 'Phase 0 Cashflow Base',
    description: 'Stabilize cashflow with source-backed opportunities and approval-gated action.',
    status: 'ACTIVE',
    current_stage: 'source-backed opportunity review',
    priority_score: 92,
    momentum_score: 45,
    blocker_score: 30,
    compounding_score: 60,
    revenue_score: 95,
    linked_packets: [],
    linked_signals: [],
    linked_outcomes: [],
    linked_repairs: [],
    approval_state: 'none_required',
    updated_at: NOW_SEED,
  },
  {
    id: 'content-automation',
    title: 'Content Automation',
    description: 'Build repeatable content systems without claiming output before evidence exists.',
    status: 'ACTIVE',
    current_stage: 'workflow design',
    priority_score: 70,
    momentum_score: 35,
    blocker_score: 20,
    compounding_score: 82,
    revenue_score: 62,
    linked_packets: [],
    linked_signals: [],
    linked_outcomes: [],
    linked_repairs: [],
    approval_state: 'none_required',
    updated_at: NOW_SEED,
  },
  {
    id: 'automation-services',
    title: 'Automation Services',
    description: 'Package SMB and operator automations into human-approved service offers.',
    status: 'ACTIVE',
    current_stage: 'offer validation',
    priority_score: 82,
    momentum_score: 40,
    blocker_score: 25,
    compounding_score: 78,
    revenue_score: 86,
    linked_packets: [],
    linked_signals: [],
    linked_outcomes: [],
    linked_repairs: [],
    approval_state: 'none_required',
    updated_at: NOW_SEED,
  },
  {
    id: 'real-estate-monitor',
    title: 'Real Estate Monitor',
    description: 'Watch real estate signals and debt freedom paths without speculative claims.',
    status: 'PAUSED',
    current_stage: 'signal watch',
    priority_score: 54,
    momentum_score: 20,
    blocker_score: 15,
    compounding_score: 65,
    revenue_score: 42,
    linked_packets: [],
    linked_signals: [],
    linked_outcomes: [],
    linked_repairs: [],
    approval_state: 'none_required',
    updated_at: NOW_SEED,
  },
  {
    id: 'debt-freedom-trigger',
    title: 'Debt Freedom Trigger',
    description: 'Track verified progress toward debt freedom and reinvestment thresholds.',
    status: 'AT_TRIGGER',
    current_stage: 'source-backed financial telemetry required',
    priority_score: 88,
    momentum_score: 25,
    blocker_score: 55,
    compounding_score: 72,
    revenue_score: 90,
    linked_packets: [],
    linked_signals: [],
    linked_outcomes: [],
    linked_repairs: [],
    approval_state: 'none_required',
    updated_at: NOW_SEED,
  },
] as const

export function isMissionStatus(value: string): value is MissionStatus {
  return ['ACTIVE', 'PAUSED', 'BLOCKED', 'AT_TRIGGER', 'COMPLETE'].includes(value)
}

export function clonePersistentMissions(now = new Date().toISOString()): Mission[] {
  return PERSISTENT_MISSIONS.map(mission => ({ ...mission, updated_at: now }))
}
