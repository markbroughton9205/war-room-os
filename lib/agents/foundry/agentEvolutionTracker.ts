import type { FoundryAgent } from './agentBlueprints'
import { buildAgentScorecard } from './agentPerformanceTracker'

export type AgentEvolutionRecommendation = {
  agentId: string
  agentName: string
  recommendation: 'hold' | 'watch' | 'degrade' | 'retire' | 'request_commander_review'
  reason: string
  autonomousExpansionAllowed: false
}

export function evaluateAgentEvolution(agent: FoundryAgent): AgentEvolutionRecommendation {
  const scorecard = buildAgentScorecard(agent)
  if (agent.state === 'retired') {
    return {
      agentId: agent.id,
      agentName: agent.name,
      recommendation: 'hold',
      reason: 'Agent is retired; no evolution is permitted without a new proposal.',
      autonomousExpansionAllowed: false,
    }
  }
  if (scorecard.warning === 'degrade') {
    return {
      agentId: agent.id,
      agentName: agent.name,
      recommendation: 'degrade',
      reason: 'Reliability score or hallucination indicators require degraded handling.',
      autonomousExpansionAllowed: false,
    }
  }
  if (agent.activityHistory.length === 0) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      recommendation: 'watch',
      reason: 'Agent has no operational history yet.',
      autonomousExpansionAllowed: false,
    }
  }
  return {
    agentId: agent.id,
    agentName: agent.name,
    recommendation: 'request_commander_review',
    reason: 'Any capability or scope change must be explicitly approved.',
    autonomousExpansionAllowed: false,
  }
}

export function evaluateAgentPopulationEvolution(agents: FoundryAgent[]): AgentEvolutionRecommendation[] {
  return agents.map(evaluateAgentEvolution)
}
