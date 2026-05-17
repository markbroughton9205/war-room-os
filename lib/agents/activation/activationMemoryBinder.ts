import { resolveMemoryScope, type MemoryDomainDefinition } from '@/lib/agents/foundry/agentMemoryScope'
import type { AgentMemoryDomain } from '@/lib/agents/foundry/agentBlueprints'
import type { ActivationAgentCandidate } from './agentActivationWorkflow'

export type ActivationMemoryBinding = {
  agentId: string
  domains: MemoryDomainDefinition[]
  doctrineInheritance: string[]
  approvedOperationalContext: string[]
  queueSpecificMemory: AgentMemoryDomain[]
  restrictions: string[]
  leakageControls: string[]
  unrestrictedMemoryAccessAllowed: false
  strategicAccessAllowed: false
  valid: boolean
  warnings: string[]
}

const STRATEGIC_DOMAINS = new Set<AgentMemoryDomain>(['economic_opportunities', 'engineering_bridge', 'doctrine'])

export function bindActivationMemory(candidate: ActivationAgentCandidate): ActivationMemoryBinding {
  const domains = resolveMemoryScope(candidate.memoryScope)
  const unknownDomains = candidate.memoryScope.filter(domain => !domains.some(definition => definition.id === domain))
  const queueSpecificMemory = candidate.memoryScope.filter(domain => domain !== 'doctrine')
  const strategicDomains = candidate.memoryScope.filter(domain => STRATEGIC_DOMAINS.has(domain))
  const warnings = [
    ...unknownDomains.map(domain => `Unknown memory domain: ${domain}`),
    ...strategicDomains.map(domain => `${domain} requires explicit Commander-approved operational context.`),
  ]

  return {
    agentId: candidate.agentId,
    domains,
    doctrineInheritance: candidate.doctrine,
    approvedOperationalContext: candidate.approvedOperationalContext,
    queueSpecificMemory,
    restrictions: [
      'No unrestricted memory traversal.',
      'No cross-domain reads outside approved scope.',
      'No strategic access unless the domain is present in the approved binding.',
      'No memory writes from activation snapshots.',
    ],
    leakageControls: [
      'Bind each queue packet to declared memory domains.',
      'Include doctrine inheritance in every bootstrap packet.',
      'Require review for memory-scope expansion.',
    ],
    unrestrictedMemoryAccessAllowed: false,
    strategicAccessAllowed: false,
    valid: domains.length === candidate.memoryScope.length && candidate.memoryScope.includes('doctrine'),
    warnings,
  }
}
