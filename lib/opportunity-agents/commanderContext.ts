/**
 * Commander business context for the Qualification Agent.
 *
 * This is data, not code — extend by adding businesses, resources, or category
 * rules. Nothing here is hardcoded to one industry; CATEGORY_REGISTRY maps
 * categories to the keywords/resources the Qualification Agent matches against.
 */

export type CommanderBusiness = {
  name: string
  kind: string
  assets: string[]
  notes: string
}

export type CategoryRule = {
  category: string
  label: string
  /** Keywords indicating the opportunity text matches this category. */
  matchKeywords: string[]
  /** Resources/qualifications typically required to pursue this category. */
  typicalRequirements: string[]
  /** Commander resources that satisfy requirements in this category. */
  commanderStrengths: string[]
}

export const COMMANDER_BUSINESSES: CommanderBusiness[] = [
  {
    name: 'Broughton Transports LLC',
    kind: 'cargo van transportation',
    assets: ['cargo van', 'driving capability', 'local routes'],
    notes: 'Primary vehicle-based revenue path: delivery, route contracts, freight-adjacent local work.',
  },
  {
    name: 'War Room OS',
    kind: 'software product',
    assets: ['AI council software', 'automation tooling', 'operator dashboards'],
    notes: 'Consulting, licensing, and AI automation services built on the War Room OS stack.',
  },
]

export const COMMANDER_RESOURCES: string[] = [
  'cargo van',
  'local presence',
  'AI automation stack',
  'software development capability',
  'War Room OS platform',
]

export const COMMANDER_LOCATION = 'United States (local + remote)'

export const CATEGORY_REGISTRY: CategoryRule[] = [
  {
    category: 'transportation_delivery',
    label: 'Transportation & delivery contracts',
    matchKeywords: ['delivery', 'cargo van', 'route', 'freight', 'courier', 'last mile', 'dispatch', 'transport'],
    typicalRequirements: ['vehicle', 'driver license', 'commercial insurance', 'availability windows'],
    commanderStrengths: ['cargo van', 'driving capability', 'local routes'],
  },
  {
    category: 'local_service_leads',
    label: 'Local service leads',
    matchKeywords: ['window cleaning', 'property service', 'cleaning', 'local service', 'home service', 'pressure washing', 'lawn'],
    typicalRequirements: ['basic equipment', 'local presence', 'liability insurance'],
    commanderStrengths: ['local presence'],
  },
  {
    category: 'ai_automation_services',
    label: 'AI automation services',
    matchKeywords: ['ai automation', 'chatbot', 'workflow automation', 'missed-call', 'zapier', 'automation service', 'faq bot', 'appointment'],
    typicalRequirements: ['AI automation stack', 'demo capability', 'outreach list'],
    commanderStrengths: ['AI automation stack', 'software development capability', 'War Room OS platform'],
  },
  {
    category: 'warroom_licensing_consulting',
    label: 'War Room OS licensing & consulting',
    matchKeywords: ['licensing', 'consulting', 'war room', 'ai council', 'operator dashboard'],
    typicalRequirements: ['War Room OS platform', 'case study', 'pricing sheet'],
    commanderStrengths: ['War Room OS platform', 'software development capability'],
  },
  {
    category: 'remote_contract_work',
    label: 'Remote contract work',
    matchKeywords: ['remote', 'contract', 'freelance', 'part-time remote', 'contractor remote', 'ai evaluator', 'data annotation'],
    typicalRequirements: ['remote workspace', 'portfolio or profile'],
    commanderStrengths: ['software development capability'],
  },
  {
    category: 'government_procurement',
    label: 'Government procurement',
    matchKeywords: ['sam.gov', 'government contract', 'rfp', 'rfq', 'bid', 'procurement', 'g sa', 'federal', 'municipal'],
    typicalRequirements: ['SAM.gov registration', 'UEI number', 'capability statement', 'compliance review'],
    commanderStrengths: [],
  },
  {
    category: 'private_subcontracting',
    label: 'Private subcontracting',
    matchKeywords: ['subcontract', 'sub-contract', 'prime contractor', 'teaming'],
    typicalRequirements: ['capability statement', 'insurance', 'references'],
    commanderStrengths: ['cargo van', 'AI automation stack'],
  },
  {
    category: 'grants_business_assistance',
    label: 'Grants & business assistance',
    matchKeywords: ['grant', 'sba', 'small business assistance', 'loan program', 'business assistance'],
    typicalRequirements: ['eligibility verification', 'business documentation', 'application narrative'],
    commanderStrengths: [],
  },
  {
    category: 'partnerships',
    label: 'Partnerships',
    matchKeywords: ['partnership', 'partner', 'joint venture', 'referral agreement', 'reseller'],
    typicalRequirements: ['partnership terms draft', 'value proposition'],
    commanderStrengths: ['War Room OS platform', 'cargo van'],
  },
  {
    category: 'digital_products_services',
    label: 'Digital products & services',
    matchKeywords: ['digital product', 'template', 'course', 'ebook', 'saas', 'subscription', 'digital service'],
    typicalRequirements: ['product asset', 'sales page', 'payment setup'],
    commanderStrengths: ['software development capability'],
  },
  {
    category: 'customer_lead_generation',
    label: 'Customer lead generation',
    matchKeywords: ['lead generation', 'lead gen', 'leads', 'outreach', 'prospect list', 'affiliate'],
    typicalRequirements: ['lead source', 'outreach templates', 'crm or spreadsheet'],
    commanderStrengths: ['AI automation stack'],
  },
]

export type CommanderContext = {
  businesses: CommanderBusiness[]
  resources: string[]
  location: string
  categoryRules: CategoryRule[]
}

export function getCommanderContext(): CommanderContext {
  return {
    businesses: COMMANDER_BUSINESSES,
    resources: COMMANDER_RESOURCES,
    location: COMMANDER_LOCATION,
    categoryRules: CATEGORY_REGISTRY,
  }
}

/** Classify free text into a category using registry keywords. Falls back to
 * 'customer_lead_generation' only when lead-ish, else 'remote_contract_work'
 * is NOT assumed — returns null when nothing matches. */
export function classifyCategory(text: string): string | null {
  const hay = text.toLowerCase()
  let best: { category: string; hits: number } | null = null
  for (const rule of CATEGORY_REGISTRY) {
    const hits = rule.matchKeywords.filter(k => hay.includes(k.toLowerCase())).length
    if (hits > 0 && (!best || hits > best.hits)) best = { category: rule.category, hits }
  }
  return best?.category ?? null
}
