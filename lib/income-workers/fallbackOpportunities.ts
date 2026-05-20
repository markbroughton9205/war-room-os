import type { OpportunityPacket } from '@/lib/opportunities/schema'
import type { IncomeWorkerCandidate } from './types'

const FALLBACK_CONFIDENCE = 0.42

const TEMPLATES: OpportunityPacket[] = [
  {
    opportunityTitle: 'Local AI automation services for SMB back-office',
    startupCost: '$200–$800 (tooling + landing page)',
    estimatedRevenue: '$1,500–$4,500/mo per 3–5 clients',
    timeToLaunch: '2–4 weeks',
    toolsRequired: ['Zapier or Make', 'OpenAI API', 'Google Workspace', 'Stripe invoicing'],
    targetCustomer: 'Local SMBs with repetitive admin (scheduling, intake forms, follow-ups)',
    executionDifficulty: 'medium',
    confidence: FALLBACK_CONFIDENCE,
    risks: ['Scope creep', 'Client expects full custom dev', 'Support load without SOPs'],
    whyNow: 'Historical pattern: operators bundle 2–3 automations per SMB before upselling retainers.',
  },
  {
    opportunityTitle: 'B2B lead generation setup packages (niche lists + outreach)',
    startupCost: '$100–$400',
    estimatedRevenue: '$800–$3,000 per setup + optional monthly refresh',
    timeToLaunch: '1–3 weeks',
    toolsRequired: ['Apollo or similar list tool', 'Instantly or Lemlist', 'CRM spreadsheet', 'domain + inbox warmup'],
    targetCustomer: 'Contractors, agencies, and solo operators who need booked calls not more software',
    executionDifficulty: 'medium',
    confidence: FALLBACK_CONFIDENCE,
    risks: ['List quality complaints', 'Compliance on cold email', 'Deliverability issues'],
    whyNow: 'Historical pattern: “done-for-you lead gen setup” sells faster than ongoing ads for local trades.',
  },
  {
    opportunityTitle: 'Contractor missed-call text-back automation',
    startupCost: '$50–$250',
    estimatedRevenue: '$400–$1,200/mo per contractor vertical',
    timeToLaunch: '1–2 weeks',
    toolsRequired: ['Twilio or OpenPhone', 'Zapier', 'simple web form', 'calendar link'],
    targetCustomer: 'HVAC, plumbing, roofing contractors losing jobs to voicemail',
    executionDifficulty: 'low',
    confidence: FALLBACK_CONFIDENCE,
    risks: ['SMS compliance', 'Wrong on-call routing', 'False urgency messaging'],
    whyNow: 'Historical pattern: missed-call recovery is a high-ROI wedge before full CRM builds.',
  },
  {
    opportunityTitle: 'AI appointment booking assistant for service businesses',
    startupCost: '$150–$600',
    estimatedRevenue: '$600–$2,500/mo per location',
    timeToLaunch: '2–3 weeks',
    toolsRequired: ['Cal.com or Calendly', 'voice/SMS agent template', 'CRM handoff', 'FAQ knowledge base'],
    targetCustomer: 'Clinics, salons, and home services with phone-heavy scheduling',
    executionDifficulty: 'medium',
    confidence: FALLBACK_CONFIDENCE,
    risks: ['Double-booking', 'HIPAA/privacy if mishandled', 'Handoff failures to human staff'],
    whyNow: 'Historical pattern: appointment automation retainers compound after a successful pilot week.',
  },
  {
    opportunityTitle: 'AI FAQ and website chat systems for local operators',
    startupCost: '$80–$350',
    estimatedRevenue: '$300–$1,400/mo per site',
    timeToLaunch: '1–2 weeks',
    toolsRequired: ['hosted chat widget', 'RAG doc upload', 'escalation to email/SMS', 'monthly FAQ refresh'],
    targetCustomer: 'Operators with repetitive inbound questions (pricing, hours, service area)',
    executionDifficulty: 'low',
    confidence: FALLBACK_CONFIDENCE,
    risks: ['Hallucinated answers', 'Brand tone mismatch', 'No human escalation path'],
    whyNow: 'Historical pattern: FAQ bots reduce support load and are easy to demo on a live site.',
  },
]

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
}

export function buildHistoricalFallbackCandidates(): IncomeWorkerCandidate[] {
  return TEMPLATES.map((packet, index) => {
    const slugId = slug(packet.opportunityTitle)
    return {
      title: packet.opportunityTitle,
      url: `warroom://income-workers/fallback/${slugId || index}`,
      source: 'historical_pattern',
      country: 'USA',
      type: 'automation_service',
      payout: packet.estimatedRevenue,
      currency: 'USD',
      expiration: null,
      riskLevel: 'medium',
      verificationStatus: 'candidate' as const,
      reason: `${packet.whyNow} Degraded-mode template — commander review required before action.`,
      provider: 'historical_pattern',
      score: Math.round(FALLBACK_CONFIDENCE * 100),
      eligibleWorkers: ['automation_service', 'affiliate_lead_gen', 'contract_opportunity', 'revenue_tracker'],
      evidenceLabel: 'HISTORICAL_PATTERN_BASED' as const,
    }
  })
}

export function buildHistoricalFallbackPackets(): OpportunityPacket[] {
  return TEMPLATES.map(packet => ({ ...packet }))
}

export const MIN_FALLBACK_OPPORTUNITIES = 3
