/**
 * QUALIFICATION AGENT
 *
 * Compares an opportunity against the Commander's businesses, skills,
 * resources, and location. Produces a fit classification, the resources the
 * opportunity requires, and the requirements the Commander is missing.
 * It never upgrades an expired, duplicate, or evidence-less opportunity to a
 * positive fit.
 */
import type { OpportunityRecord, QualificationStatus } from '../types'
import { getCommanderContext, CATEGORY_REGISTRY } from '../commanderContext'
import { appendAudit } from '../store'

export type QualificationResult = {
  qualificationStatus: QualificationStatus
  requiredResources: string[]
  missingRequirements: string[]
  eligibility: string[]
  whyItFits: string[]
  whyItMayNotFit: string[]
}

export function qualifyRecord(record: OpportunityRecord): QualificationResult {
  const context = getCommanderContext()
  const rule = CATEGORY_REGISTRY.find(r => r.category === record.category) ?? null

  const whyItFits: string[] = []
  const whyItMayNotFit: string[] = []
  const requiredResources = rule ? [...rule.typicalRequirements] : []
  const missingRequirements: string[] = []
  const eligibility: string[] = []

  if (record.freshnessStatus === 'EXPIRED') {
    return {
      qualificationStatus: 'EXPIRED',
      requiredResources,
      missingRequirements: ['Deadline has passed — opportunity is expired'],
      eligibility,
      whyItFits,
      whyItMayNotFit: [`Deadline ${record.deadline ?? 'unknown'} has already passed.`],
    }
  }
  if (record.qualificationStatus === 'DUPLICATE') {
    return {
      qualificationStatus: 'DUPLICATE',
      requiredResources,
      missingRequirements: ['Duplicate of an existing opportunity record'],
      eligibility,
      whyItFits,
      whyItMayNotFit: ['Already tracked under another record.'],
    }
  }
  if (record.evidenceStatus === 'UNKNOWN') {
    return {
      qualificationStatus: 'NEEDS_MORE_EVIDENCE',
      requiredResources,
      missingRequirements: ['No usable source reference — evidence status UNKNOWN'],
      eligibility,
      whyItFits,
      whyItMayNotFit: ['No verifiable source URL or identifier.'],
    }
  }

  // Fit scoring against Commander resources.
  const commanderAssets = new Set([
    ...context.resources.map(r => r.toLowerCase()),
    ...context.businesses.flatMap(b => b.assets.map(a => a.toLowerCase())),
  ])

  let strengths = 0
  if (rule) {
    for (const strength of rule.commanderStrengths) {
      if (commanderAssets.has(strength.toLowerCase())) {
        strengths += 1
        whyItFits.push(`Commander already has: ${strength}`)
      } else {
        whyItMayNotFit.push(`Commander strength not confirmed: ${strength}`)
      }
    }
    for (const req of rule.typicalRequirements) {
      const covered = [...commanderAssets].some(asset => req.toLowerCase().includes(asset) || asset.includes(req.toLowerCase()))
      if (!covered) missingRequirements.push(req)
    }
  } else {
    whyItMayNotFit.push('No category rule matched — fit cannot be established automatically.')
  }

  if (record.freshnessStatus === 'UNCERTAIN') {
    missingRequirements.push('Deadline or currency of listing unconfirmed')
  }
  if (record.evidenceStatus === 'HISTORICAL') {
    whyItMayNotFit.push('Historical pattern — not a live, dated listing.')
    missingRequirements.push('Live source verification required before pursuit')
  }

  eligibility.push(...missingRequirements)

  let qualificationStatus: QualificationStatus
  if (rule && strengths >= 2 && missingRequirements.length === 0 && record.evidenceStatus === 'LIVE_VERIFIED') {
    qualificationStatus = 'HIGH_FIT'
  } else if (rule && strengths >= 1 && missingRequirements.length <= 2) {
    qualificationStatus = 'POSSIBLE_FIT'
  } else if (!rule || strengths === 0) {
    qualificationStatus = 'LOW_FIT'
  } else {
    qualificationStatus = 'NEEDS_MORE_EVIDENCE'
  }

  return { qualificationStatus, requiredResources, missingRequirements, eligibility, whyItFits, whyItMayNotFit }
}

/** Apply qualification to the stored record (mutates via audit trail). */
export function qualifyStoredRecord(record: OpportunityRecord): QualificationResult {
  const result = qualifyRecord(record)
  record.qualificationStatus = result.qualificationStatus
  record.requiredResources = result.requiredResources
  record.missingRequirements = result.missingRequirements
  record.eligibility = result.eligibility
  if (!record.assignedAgents.includes('qualification')) record.assignedAgents.push('qualification')
  if (record.status === 'DISCOVERED' || record.status === 'RESEARCHING') {
    record.status = result.qualificationStatus === 'EXPIRED' ? 'DISCOVERED' : 'QUALIFIED'
  }
  appendAudit(record.id, {
    actor: 'qualification',
    fromStatus: record.status,
    toStatus: record.status,
    message: `Qualified as ${result.qualificationStatus}. Missing: ${result.missingRequirements.length ? result.missingRequirements.join('; ') : 'none'}.`,
  })
  return result
}
