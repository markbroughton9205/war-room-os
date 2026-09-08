import type { FrozenSeatReport, IsolationAudit, CouncilSwarmPhase } from './types'

export type { IsolationAudit }

type NebulaDraftProbeLocal = {
  agentId: string
  text: string
}

export type IsolationCheckInput = {
  phase: CouncilSwarmPhase
  prompt: string
  ownerAgentId: string
  otherDrafts: NebulaDraftProbeLocal[]
  otherFrozenReports?: FrozenSeatReport[]
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function distinctiveSnippet(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length < 48) return cleaned.length >= 24 ? cleaned : null
  return cleaned.slice(0, 80)
}

/**
 * FAIL CLOSED: another seat's current-round draft/report must not appear in a discovery prompt.
 * Frozen reports are also forbidden during INDEPENDENT_DISCOVERY.
 */
export function assertDiscoveryIsolation(input: IsolationCheckInput): IsolationAudit {
  const leaks: string[] = []
  const prompt = normalize(input.prompt)
  const checkedSeats = input.otherDrafts.map(item => item.agentId as IsolationAudit['checkedSeats'][number])

  if (input.phase === 'INDEPENDENT_DISCOVERY') {
    for (const draft of input.otherDrafts) {
      if (draft.agentId === input.ownerAgentId) continue
      const snippet = distinctiveSnippet(draft.text)
      if (!snippet) continue
      if (prompt.includes(normalize(snippet))) {
        leaks.push(`${input.ownerAgentId}_prompt_contains_${draft.agentId}_draft`)
      }
    }
    for (const report of input.otherFrozenReports ?? []) {
      if (report.agentId === input.ownerAgentId) continue
      const snippet = distinctiveSnippet(report.conclusion)
      if (!snippet) continue
      if (prompt.includes(normalize(snippet))) {
        leaks.push(`${input.ownerAgentId}_prompt_contains_${report.agentId}_frozen_report`)
      }
    }
    if (/\bprior family (briefs|messages) already completed\b/i.test(input.prompt)) {
      leaks.push(`${input.ownerAgentId}_prompt_contains_prior_family_briefs_block`)
    }
    if (/\bshared round findings\b/i.test(input.prompt)) {
      leaks.push(`${input.ownerAgentId}_prompt_contains_blackboard_findings`)
    }
  }

  return {
    pass: leaks.length === 0,
    phase: input.phase,
    leaks,
    checkedSeats,
  }
}

export function isolationMustFailClosed(audit: IsolationAudit): boolean {
  return audit.pass || audit.leaks.length > 0
}

export function discoveryPromptMayIncludeCommanderAndOwnAssignment(prompt: string, decree: string, assignment: string): boolean {
  return prompt.includes(decree) && (!assignment || prompt.includes(assignment))
}
