import { ENGINEERING_AGENT_REGISTRY } from '@/lib/engineering/engineeringAgentRegistry'
import { getFamilyCapabilityProfile } from '@/lib/council/adaptive-assembly/registry'
import type { PromptIntent, TargetAgentProfile } from './types'

/**
 * Claude Code and Codex are build-executor agents, resolved from the engineering registry.
 * GIVE_KIMI_RESEARCH_PROMPT is a historical research-prompt packager id. It does not mean a Kimi
 * model/provider is installed. The composed prompt targets the NOVA Council strategy seat
 * (local Ollama). Kimi/Moonshot is not a War Room capability.
 */
export function resolveTargetAgentProfile(intent: PromptIntent, genericTargetLabel?: string): TargetAgentProfile {
  if (intent === 'GIVE_CLAUDE_NEXT_PROMPT') {
    const entry = ENGINEERING_AGENT_REGISTRY.find(a => a.id === 'claude_code')
    if (entry) {
      return {
        agentId: entry.id,
        displayName: entry.name,
        source: 'engineering_agent_registry',
        role: entry.role,
        availability: entry.availability,
        notes: entry.notes,
      }
    }
  }

  if (intent === 'GIVE_CODEX_BUILD_PROMPT') {
    const entry = ENGINEERING_AGENT_REGISTRY.find(a => a.id === 'codex')
    if (entry) {
      return {
        agentId: entry.id,
        displayName: entry.name,
        source: 'engineering_agent_registry',
        role: entry.role,
        availability: entry.availability,
        notes: entry.notes,
      }
    }
  }

  if (intent === 'GIVE_KIMI_RESEARCH_PROMPT') {
    const profile = getFamilyCapabilityProfile('nova')
    if (profile) {
      return {
        agentId: 'nova',
        displayName: profile.displayName,
        source: 'council_capability_registry',
        role: profile.researchEligible ? 'research_eligible_council_member' : 'council_member',
        availability: profile.availability,
        notes: `Historical research-prompt packager. Kimi/Moonshot is not installed. Composed against NOVA Council profile v${profile.profileVersion} (${profile.profileStatus}).`,
      }
    }
  }

  return {
    agentId: genericTargetLabel?.trim() || 'unspecified_agent',
    displayName: genericTargetLabel?.trim() || 'Unspecified agent',
    source: 'generic',
    role: 'unregistered',
    availability: 'unknown',
    notes: 'No registry entry — free-form target for GENERIC_AGENT_MISSION_PROMPT.',
  }
}
