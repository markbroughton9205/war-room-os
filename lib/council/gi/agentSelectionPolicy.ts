import type { EbcAgentId, EbcMissionClass } from '@/lib/council/evidence-board/types'

export type AgentSelectionSignals = {
  mission_class: EbcMissionClass
  text: string
  evidence_need?: 'NONE' | 'LAST_VERIFIED' | 'CURRENT_LIVE'
  verification_need?: boolean
  structured_data?: boolean
  conflict_probability?: 'low' | 'med' | 'high'
  source_freshness?: 'none' | 'stale_ok' | 'live'
  budget?: 'FAST' | 'STANDARD' | 'DEEP'
  risk?: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL'
}

export type AgentSelectionDecision = {
  selected_agents: EbcAgentId[]
  phoenix_required: boolean
  aurora_required: boolean
  reason: string
}

function unique(agents: EbcAgentId[]): EbcAgentId[] {
  return [...new Set(agents)]
}

export function selectAgentsForMission(signals: AgentSelectionSignals): AgentSelectionDecision {
  const text = signals.text.toLowerCase()
  const wantsInventory = /\b(inventory|normalize|tabulate|schema|ports dump|spreadsheet|csv|decision matrix)\b/.test(text)
  const wantsExternal = /\b(browser|web|external|internet|terra live|news|today|primary sources)\b/.test(text)
  const wantsChallenge = signals.conflict_probability === 'high' || signals.budget === 'DEEP' || /\b(double-check|challenge|review|adversarial)\b/.test(text)
  const structured = signals.structured_data || wantsInventory

  if (signals.mission_class === 'SOCIAL_CHECKIN') {
    return { selected_agents: ['AURORA'], phoenix_required: false, aurora_required: false, reason: 'Presence only.' }
  }

  if (signals.mission_class === 'SYSTEM_STATUS') {
    const selected: EbcAgentId[] = ['ORION', 'LUMEN', 'PHOENIX', 'AURORA']
    if (wantsInventory) selected.splice(2, 0, 'NOVA')
    if (wantsExternal) selected.splice(1, 0, 'PULSAR')
    return { selected_agents: unique(selected), phoenix_required: true, aurora_required: true, reason: 'Proven status assembly.' }
  }

  if (signals.mission_class === 'INCIDENT_RESPONSE') {
    const selected: EbcAgentId[] = ['ORION', 'LUMEN', 'PHOENIX', 'AURORA']
    if (wantsExternal) selected.splice(1, 0, 'PULSAR')
    return { selected_agents: unique(selected), phoenix_required: true, aurora_required: true, reason: 'Incident needs investigation, verification, and challenge.' }
  }

  if (signals.mission_class === 'CURRENT_INTEL') {
    const selected: EbcAgentId[] = ['PULSAR', 'LUMEN', 'AURORA']
    if (structured) selected.splice(2, 0, 'NOVA')
    if (wantsChallenge) selected.splice(selected.indexOf('AURORA'), 0, 'PHOENIX')
    return {
      selected_agents: unique(selected),
      phoenix_required: wantsChallenge,
      aurora_required: true,
      reason: 'Current intel is Pulsar-led. Phoenix only when challenge is warranted.',
    }
  }

  if (signals.mission_class === 'DEEP_RESEARCH') {
    const selected: EbcAgentId[] = ['ORION', 'PULSAR', 'LUMEN', 'AURORA']
    if (wantsChallenge || signals.budget !== 'FAST') selected.splice(3, 0, 'PHOENIX')
    if (structured) selected.splice(3, 0, 'NOVA')
    return {
      selected_agents: unique(selected).slice(0, 5),
      phoenix_required: wantsChallenge || signals.budget !== 'FAST',
      aurora_required: true,
      reason: 'Deep research uses specialists, not a default six.',
    }
  }

  if (signals.mission_class === 'ARCHITECTURE_REVIEW') {
    const selected: EbcAgentId[] = ['ORION', 'AURORA']
    if (structured || /\b(schema|interface|data model)\b/.test(text)) selected.splice(1, 0, 'NOVA')
    if (wantsChallenge) selected.splice(selected.length - 1, 0, 'PHOENIX')
    return {
      selected_agents: unique(selected),
      phoenix_required: wantsChallenge,
      aurora_required: true,
      reason: 'Simple architecture: Orion + Aurora, Nova if structure, Phoenix only if review/challenge.',
    }
  }

  if (signals.mission_class === 'DOCUMENT_ANALYSIS') {
    return {
      selected_agents: unique(['NOVA', 'LUMEN', 'AURORA', ...(wantsChallenge ? ['PHOENIX' as const] : [])]),
      phoenix_required: wantsChallenge,
      aurora_required: true,
      reason: 'Spreadsheet/schema work is Nova-led.',
    }
  }

  if (signals.mission_class === 'ENGINEERING') {
    const selected: EbcAgentId[] = ['ORION', 'NOVA', 'AURORA']
    if (wantsChallenge) selected.splice(2, 0, 'PHOENIX')
    return {
      selected_agents: unique(selected),
      phoenix_required: wantsChallenge,
      aurora_required: true,
      reason: 'Engineering analysis only. Foundry remains owner of mutation.',
    }
  }

  return {
    selected_agents: ['ORION', 'AURORA'],
    phoenix_required: false,
    aurora_required: true,
    reason: 'Minimal agent set.',
  }
}

export function neverDefaultSix(decision: AgentSelectionDecision): boolean {
  return decision.selected_agents.length < 6
}
