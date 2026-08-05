import type { DraftMaterial, OpportunityRecord, OpportunityWorkPacket } from '../types'
import { appendAudit } from '../store'

function material(kind: DraftMaterial['kind'], title: string, body: string, createdAt: string): DraftMaterial {
  return { kind, title, body, status: 'draft', createdBy: 'proposal_agent', createdAt }
}

export function prepareDraftMaterials(record: OpportunityRecord, packet: OpportunityWorkPacket): DraftMaterial[] {
  const now = new Date().toISOString()
  const materials = [
    material('proposal', `Draft proposal for ${record.title}`, `DRAFT ONLY\n\nOpportunity: ${record.title}\nFit: ${packet.whyItFits.join('; ') || 'Fit needs Commander review.'}\nNext step: ${packet.exactNextSteps[0] ?? 'Review packet.'}\n\nCommander approval required before this is sent.`, now),
    material('outreach_email', `Draft outreach for ${record.title}`, `DRAFT ONLY\n\nHello,\n\nI am reviewing this opportunity and would like to confirm eligibility, deadline, scope, payment terms, and submission requirements.\n\nNo message should be sent until Commander approval is recorded.`, now),
    material('document_checklist', `Document checklist for ${record.title}`, packet.requiredDocuments.map(item => `- ${item}`).join('\n'), now),
  ]
  if (!record.assignedAgents.includes('proposal_agent')) record.assignedAgents.push('proposal_agent')
  appendAudit(record.id, {
    actor: 'planner',
    fromStatus: record.status,
    toStatus: record.status,
    message: 'Draft materials prepared in draft-only state; no external message sent.',
  })
  return materials
}
