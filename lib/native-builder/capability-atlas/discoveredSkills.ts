import type { SkillRecord } from './types'
import { taxonomyLeaves } from './taxonomy'

export function discoveredSkillsFromTaxonomy(): SkillRecord[] {
  return taxonomyLeaves().map(node => {
    const parts = node.id.split('.')
    const search = [node.name, ...node.aliases, ...node.keywords].join(' ')
    return {
      skillId: node.id,
      name: node.name,
      domain: parts[0] ?? node.id,
      subdomain: parts.length > 1 ? parts.slice(0, 2).join('.') : null,
      description: `${node.name} (${search}) is registered in the Capability Atlas as a discoverable engineering skill. Presence in the Atlas is not mastery.`,
      capabilityClass: 'DISCOVERED_TAXONOMY',
      languages: [],
      frameworks: [],
      platforms: [],
      operatingSystems: [],
      tools: [],
      officialSources: [],
      openSourceSources: [],
      referenceImplementations: [],
      prerequisiteSkills: [],
      relatedSkills: [],
      requiredContext: node.keywords,
      supportedToolBrokerTools: [],
      validationMethods: [],
      knownFailureModes: [],
      securityConsiderations: [],
      governanceRequirements: ['Do not claim mastery without evaluation evidence.'],
      localModelCompatibility: 'unknown',
      frontierModelCompatibility: 'unknown',
      selfHostable: null,
      lastSourceVerified: null,
      lastCapabilityEvaluated: null,
      capabilityStatus: 'DISCOVERED',
      confidence: 'none',
      productionProofMissions: [],
      engineeringMemoryLinks: [],
      version: 1,
      lifecycle: 'CURRENT',
      modelRouting: ['FRONTIER_RECOMMENDED'],
      evidence: { implementationFiles: [], brokerTools: [], validators: [], proofFiles: [], notes: 'Taxonomy leaf. Not Foundry-proven.' },
      unsupportedReason: null,
    } satisfies SkillRecord
  })
}
