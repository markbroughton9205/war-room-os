import type { DraftMaterial, LeadRecord, OpportunityRecord } from '../types'
import { appendAudit, listRecords } from '../store'

function newLeadId(): string {
  return `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function hasSimilarLead(record: OpportunityRecord): boolean {
  const normalized = record.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return listRecords().some(other => other.id !== record.id && other.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normalized)
}

export function createLeadRecord(record: OpportunityRecord, materials: DraftMaterial[]): LeadRecord | null {
  const outreach = materials.find(item => item.kind === 'outreach_email') ?? null
  const lead: LeadRecord = {
    id: newLeadId(),
    name: record.title,
    contactSource: record.sourceUrl ?? record.source,
    relevance: `${record.category} opportunity requiring Commander approval before contact.`,
    status: 'queued_for_approval',
    outreachDraftId: outreach ? `${record.id}:${outreach.kind}` : null,
    createdAt: new Date().toISOString(),
  }
  if (!record.assignedAgents.includes('lead_outreach')) record.assignedAgents.push('lead_outreach')
  appendAudit(record.id, {
    actor: 'planner',
    fromStatus: record.status,
    toStatus: record.status,
    message: 'Lead outreach queued for approval; no outreach sent.',
  })
  return lead
}
