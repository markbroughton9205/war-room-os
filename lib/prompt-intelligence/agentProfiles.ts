import { ENGINEERING_AGENT_REGISTRY } from '@/lib/engineering/engineeringAgentRegistry'
import { getFamilyCapabilityProfile } from '@/lib/council/adaptive-assembly/registry'
import type { PromptIntent, TargetAgentProfile } from './types'

/**
 * Claude Code and Codex are build-executor agents, resolved from the engineering registry.
 * Kimi has no engineering-registry entry (it is a Council LLM member, not a wired coding
 * executor) — its profile comes from the Council capability registry instead. This routing must
 * never be reversed: Kimi is never looked up in the engineering registry, and Claude Code/Codex
 * are never looked up in the Council registry.
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
    const profile = getFamilyCapabilityProfile('kimi')
    if (profile) {
      return {
        agentId: 'kimi',
        displayName: profile.displayName,
        source: 'council_capability_registry',
        role: profile.researchEligible ? 'research_eligible_council_member' : 'council_member',
        availability: profile.availability,
        notes: `Council capability profile v${profile.profileVersion} (${profile.profileStatus}).`,
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
