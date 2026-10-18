/**
 * Convert a Commander outcome into product requirements and a recorded stack decision.
 * Commander specifies outcomes. Foundry decides implementation details when safe.
 */
import { looksLikeNewApplication, projectNameFromPrompt } from './foundryCommanderState'
import type {
  FoundryClaimKind,
  FoundryProductRequirements,
  FoundryProjectType,
  FoundryResearchRecord,
  FoundryStackDecision,
  FoundryUnknownBusinessFact,
} from './foundryApplicationBuilderTypes'

export function isApplicationBuilderRequest(text: string): boolean {
  const t = text.trim()
  if (/\b(do not change|don't change|read-only|where is|find where|locate where)\b/i.test(t) && !/\bbuild\b|\bcreate\b|\badd\b/i.test(t)) return false
  if (/\btest application\b|\bfixture\b|local-coder-label|engineering-depth|ops-write-conflict|pass 0\d{2}/i.test(t)) return false
  if (/\bwar room\b|\bterra\b|foundrymissioncontrollerpanel|engineering review detail|install production|activate install/i.test(t)
    && !/\bwebsite\b|\blanding page\b|\bcrm\b|\bweb app\b/i.test(t)) {
    return false
  }
  if (/\bopen the\b.+\b(and add|add |continue)\b/i.test(t)) return true
  if (/\b(landing page|website|web app|web application|crm|internal tool|inventory)\b/i.test(t) && /\b(build|create|make|research|show me)\b/i.test(t)) return true
  return looksLikeNewApplication(t)
}

export function isContinuationRequest(text: string): boolean {
  return /\b(open the|continue|add .+ to the existing|resume the)\b/i.test(text)
}

export function isCrmOutcome(text: string): boolean {
  return /\bcrm\b|leads and customers|lead and customer|follow-up date to leads/i.test(text)
}

export function isLocalDataOutcome(text: string): boolean {
  if (isCrmOutcome(text)) return false
  if (/landing page|website|\bsite\b/i.test(text) && !/inventory|manager|tracker|app that/i.test(text)) return false
  return /inventory|stock|quantit|categor|catalog|\bitems\b|persist|keep the data|after restart|sqlite|database|crud|internal tool|local (app|manager|tracker)/i.test(text)
}

export function isWebsiteOutcome(text: string): boolean {
  return /landing page|website|\bsite\b/i.test(text) && !isCrmOutcome(text) && !isLocalDataOutcome(text)
}

export function inferProjectType(text: string): FoundryProjectType {
  const t = text.toLowerCase()
  if (isCrmOutcome(t)) return 'internal_business_tool'
  if (isLocalDataOutcome(t)) return 'database_backed_app'
  if (/\bapi\b|backend only/.test(t)) return 'backend_api'
  if (/\bapp that tracks|web app\b/.test(t)) return 'full_stack_web_app'
  if (/\blanding page|website|site\b/.test(t)) return 'static_website'
  if (looksLikeNewApplication(text)) return 'database_backed_app'
  return 'static_website'
}

export function researchQueriesForOutcome(outcome: string, continuing = false): string[] {
  const topic = outcome.replace(/\s+/g, ' ').trim().slice(0, 160)
  if (isCrmOutcome(outcome)) {
    return continuing
      ? ['CRM lead follow-up date field small business pipeline current practice']
      : [
          'small business CRM lead fields first name last name company email phone status notes',
          'CRM lead pipeline statuses new contacted qualified customer lost',
          'small business CRM usability dashboard search filter list detail',
          'WCAG 2.2 accessible form labels required fields',
          'SQLite local persistence application database file Node.js sqlite',
          'lead conversion to customer CRM workflow qualified opportunity',
          'HTML form validation email input current practices',
        ]
  }
  if (isWebsiteOutcome(outcome)) {
    return continuing
      ? [`${topic} what customers currently expect`]
      : [
          `${topic} what customers expect`,
          'small business website service page structure',
          'WCAG 2.2 accessible navigation and form labels small business website',
          'HTML form label required field current practices',
          'schema.org LocalBusiness SEO small business website',
        ]
  }
  return continuing
    ? [`${topic} continuation local persistence filter`]
    : [
        `${topic} local application data model`,
        `${topic} search filter edit persist sqlite`,
        'WCAG 2.2 accessible form labels required fields',
        'SQLite local persistence application database file Node.js sqlite',
        'HTML form validation current practices',
      ]
}

export function deriveRequirements(input: {
  outcome: string
  research: FoundryResearchRecord[]
}): FoundryProductRequirements {
  const outcome = input.outcome.trim()
  const crm = isCrmOutcome(outcome)
  const localData = !crm && (isLocalDataOutcome(outcome) || inferProjectType(outcome) === 'database_backed_app' || inferProjectType(outcome) === 'full_stack_web_app')
  const website = !crm && !localData && /website|landing|site/i.test(outcome)
  const transport = /transport|truck|freight|logistics|carrier/i.test(outcome) && !crm && !localData
  const researchIds = input.research.filter(item => item.kind === 'RESEARCHED_FACT' && item.source.startsWith('http')).map(item => item.id)

  const unknownBusinessFacts: FoundryUnknownBusinessFact[] = crm
    ? [
        { field: 'workspace_label', reason: 'Operator display name for this CRM workspace was not supplied.', commanderPrompt: 'What workspace or business name should appear in the CRM header?' },
        { field: 'service_catalog', reason: 'The live service list is operator-specific and must not be invented as a closed catalog.', commanderPrompt: 'Which services should appear as suggested interests?' },
      ]
    : localData
      ? [
          { field: 'workspace_label', reason: 'Operator display name was not supplied.', commanderPrompt: 'What name should appear in the application header?' },
          { field: 'low_stock_threshold', reason: 'Low-stock cutoff is operator-specific.', commanderPrompt: 'What quantity should count as low stock? Default 5 if unspecified.' },
        ]
    : [
        { field: 'legal_business_name', reason: 'Commander did not supply the operating company name.', commanderPrompt: 'What is the legal business name to display?' },
        { field: 'years_in_business', reason: 'Business tenure is a company-specific fact.', commanderPrompt: 'How many years has the company operated? Leave blank if unknown.' },
        { field: 'locations', reason: 'Terminals and coverage areas were not provided.', commanderPrompt: 'Which cities, terminals, or lanes should be listed?' },
        { field: 'licenses', reason: 'Authority, MC/DOT, or insurance numbers were not provided.', commanderPrompt: 'Any public license or authority numbers that should appear?' },
        { field: 'testimonials', reason: 'Customer quotes cannot be invented.', commanderPrompt: 'Provide real testimonials if they should appear.' },
        { field: 'partners', reason: 'Partner logos/names cannot be invented.', commanderPrompt: 'Name any partners that may be listed.' },
        { field: 'phone_email', reason: 'Contact channels were not provided.', commanderPrompt: 'What phone, email, or address should the contact form use?' },
        { field: 'fleet_size', reason: 'Truck count is a company-specific fact.', commanderPrompt: 'If a fleet count should appear, provide it. Otherwise leave unpublished.' },
        { field: 'rates', reason: 'Published rates were not provided and must not be invented.', commanderPrompt: 'Should any rate card or minimums appear?' },
      ]

  const functional = website
    ? [
        'Home page introducing the service without invented company statistics',
        'Services page describing typical offerings for the industry',
        'About page explaining purpose and values without fake history',
        'Contact/quote form capturing origin, destination, and freight details locally',
        'Responsive layout usable on desktop and mobile',
        'Primary navigation across all pages',
      ]
    : crm
      ? [
          'Create a lead with name, company, email, phone, and service interest',
          'Persist leads in a local project database that survives process restart',
          'List, search, and filter leads by pipeline status',
          'Open and edit a lead; retain notes as an append-only history',
          'Change status through an explicit pipeline (new, contacted, qualified, customer, lost)',
          'Convert a qualified lead to a customer with an explicit UI action',
          'Show dashboard counts derived from stored records',
        ]
      : localData
        ? [
            'Create an item with name, quantity, category, and notes',
            'Persist items in a local project database that survives process restart',
            'List, search, and filter items by category',
            'Open and edit an existing item without losing other records',
            'Keep quantities as non-negative integers',
            'Provide a local loopback preview of the working application',
          ]
      : ['Implement the Commander-stated outcome', 'Provide a local preview', 'Cover the primary user workflow']

  const acceptance = website
    ? [
        'Home, Services, About, and Contact routes render original content',
        'Quote/contact form validates required fields without sending production email',
        'Desktop and mobile viewports remain usable',
        'No invented years-in-business, customer counts, licenses, or testimonials',
        'Local server serves the site on loopback',
        'Automated tests cover routes and content safety',
      ]
    : crm
      ? [
          'Lead create, read, update, search, and status filter persist in SQLite',
          'Invalid records are rejected (required fields, status, email shape, length bounds)',
          'Qualified-to-customer conversion requires an explicit action and persists',
          'Dashboard counts match database aggregates',
          'Desktop and mobile viewports remain usable',
          'Local loopback preview; no live deploy',
        ]
      : localData
        ? [
            'Item create, read, update, search, and category filter persist in SQLite',
            'Invalid records are rejected (required name, non-negative integer quantity)',
            'Data remains after process restart',
            'Desktop and mobile viewports remain usable',
            'Local loopback preview; no live deploy',
          ]
      : ['Requested workflow is implemented', 'Tests pass', 'Local preview runs']

  const ui = [
    'Professional visual hierarchy with readable type',
    'Clear primary call to action',
    'Keyboard-accessible navigation and form controls',
    'Visible focus states',
    'No pixel-perfect screenshot matching required',
  ]

  return {
    goal: outcome,
    userType: transport ? ['shipper', 'operations coordinator', 'prospective customer'] : crm ? ['owner-operator', 'salesperson'] : localData ? ['operator', 'stock keeper'] : ['end user'],
    coreWorkflows: website
      ? ['Learn what the company offers', 'Request a quote', 'Read about the company', 'Contact the company']
      : crm
        ? [
            'Create lead',
            'View lead list',
            'Search lead list',
            'Filter lead list',
            'Open lead detail',
            'Edit lead',
            'Add notes',
            'Change lead status',
            'Convert qualified lead to customer',
            'Review dashboard counts',
            'Restart and confirm persisted records',
          ]
        : localData
          ? [
              'Add item',
              'Search items',
              'Filter by category',
              'Edit item',
              'Keep data after restart',
            ]
        : ['Complete the Commander-stated workflow'],
    functionalRequirements: functional,
    nonfunctionalRequirements: [
      'Runs locally without paid services',
      'No hardcoded secrets',
      'Original copy — do not copy competitor text',
      'Build and tests must recover from ordinary engineering failures',
    ],
    dataRequirements: website
      ? ['Quote request fields stored only in the local page session unless a local JSON fixture is used']
      : crm
        ? [
            'Lead records stored in a local SQLite file under the project data directory',
            'Stable ids, created_at, updated_at',
            'Status constrained to the pipeline vocabulary',
            'Notes stored as related rows, not a silently overwritten blob',
          ]
        : localData
          ? [
              'Item records stored in a local SQLite file under the project data directory',
              'Stable ids, created_at, updated_at',
              'Quantity stored as a non-negative integer',
            ]
        : ['Application data stays inside the project workspace'],
    integrations: ['None enabled. External billing, email, or domain purchase requires Commander authorization.'],
    uiRequirements: ui,
    securityRequirements: [
      'No secret disclosure',
      'Loopback-only local server',
      crm || localData ? 'Parameterized SQL only; bounded JSON payloads; no production database connections' : 'Quote form does not POST to third parties',
      'Production deploy remains unauthorized',
    ],
    acceptanceCriteria: acceptance,
    unknownBusinessFacts,
    researchTrace: functional.map(requirement => ({
      requirement,
      researchIds: researchIds.slice(0, 4),
    })),
  }
}

export function selectStack(input: {
  projectType: FoundryProjectType
  outcome: string
}): FoundryStackDecision {
  if (isCrmOutcome(input.outcome)) {
    return {
      stack: 'Node ESM + node:http JSON API + node:sqlite file database + vanilla HTML/CSS/JS (node:test)',
      alternativesConsidered: [
        'Next.js + React + better-sqlite3',
        'Python FastAPI + SQLite',
        'JSON file store (lowdb) with no SQL',
        'In-memory array (rejected: not persistent)',
      ],
      reason: [
        'This outcome is a local business CRM with relational records, search/filter, status transitions, and restart persistence — not a marketing site.',
        'Node 24 node:sqlite is a maintained stdlib driver, so the project stays dependency-free, uses parameterized SQL, and keeps the database file inside the project data directory.',
        'Next.js or FastAPI would add install/runtime surface without improving the Commander-local outcome.',
        'A JSON blob store would weaken query/filter integrity; an in-memory array would fail the persistence proof.',
      ].join(' '),
      decidedAt: new Date().toISOString(),
    }
  }
  if (input.projectType === 'database_backed_app' || input.projectType === 'full_stack_web_app' || input.projectType === 'internal_business_tool' || isLocalDataOutcome(input.outcome)) {
    return {
      stack: 'Node ESM + node:http JSON API + node:sqlite file database + vanilla HTML/CSS/JS (node:test)',
      alternativesConsidered: [
        'Next.js + React + better-sqlite3',
        'Python FastAPI + SQLite',
        'JSON file store with no SQL',
        'In-memory array (rejected: not persistent)',
      ],
      reason: [
        'This outcome is a local data application that must add, search, edit, and keep records after restart.',
        'Node stdlib HTTP plus node:sqlite keeps the project dependency-free and auditable, with the database file inside the project data directory.',
        'A hosted framework or in-memory store would add install surface or fail persistence.',
      ].join(' '),
      decidedAt: new Date().toISOString(),
    }
  }
  const website = input.projectType === 'static_website' || /website|landing page/i.test(input.outcome)
  if (website) {
    return {
      stack: 'Multi-page HTML/CSS/JS with Node stdlib static server (node:http, node:test, localStorage quotes)',
      alternativesConsidered: [
        'Vite + vanilla TypeScript',
        'Next.js + React',
        'Astro static site',
        'Paid hosted landing-page builder',
      ],
      reason: [
        'This outcome is a public marketing site with crawlable service pages, a local quote form, and no authenticated app or database.',
        'HTML pages keep SEO metadata and routes inspectable without a bundler, and Node stdlib keeps dependency install empty and auditable.',
        'Vite/Next/Astro remain available if later continuation adds an authenticated portal.',
        'A third-party host would imply live deploy, which is not authorized.',
      ].join(' '),
      decidedAt: new Date().toISOString(),
    }
  }
  return {
    stack: 'Node ESM + node:test local app',
    alternativesConsidered: ['Next.js', 'Python/FastAPI'],
    reason: 'Default autonomous stack for a local business tool without a Commander framework preference.',
    decidedAt: new Date().toISOString(),
  }
}

export function suggestedProjectName(outcome: string): string {
  if (isCrmOutcome(outcome)) return 'small-business-crm'
  if (/inventory/i.test(outcome)) return 'local-inventory-manager'
  const fromPrompt = projectNameFromPrompt(outcome)
  if (fromPrompt && fromPrompt !== 'foundry-project') return fromPrompt
  if (/box truck/i.test(outcome)) return 'box-truck-transport'
  if (isWebsiteOutcome(outcome) && /transport/i.test(outcome)) return 'box-truck-transport'
  return 'foundry-app'
}

export function factVersusDesignNotes(research: FoundryResearchRecord[], outcome = ''): Array<{ kind: FoundryClaimKind; text: string }> {
  const facts = research.filter(item => item.kind === 'RESEARCHED_FACT' && item.source.startsWith('http')).slice(0, 8).map(item => ({
    kind: 'RESEARCHED_FACT' as const,
    text: `FACT: ${item.claim.slice(0, 220)} (source: ${item.source})`,
  }))
  const observations = research.filter(item => item.kind === 'OBSERVATION' && item.source.startsWith('http')).slice(0, 6).map(item => ({
    kind: 'OBSERVATION' as const,
    text: `OBSERVATION: ${item.claim.slice(0, 220)} (source: ${item.source})`,
  }))
  const designs = isCrmOutcome(outcome)
    ? [
        { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: One lifecycle entity (leads) with status customer rather than a second customers table — conversion is an explicit status + converted_at, keeping search/filter on a single record.' },
        { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: Notes are append-only related rows so later updates do not erase prior conversation context.' },
        { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: Pipeline labels New / Contacted / Qualified / Customer / Lost; convert-to-customer is allowed only from Qualified via a dedicated action.' },
        { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: Node stdlib HTTP + node:sqlite file under data/ — no npm native addons, no production database, loopback only.' },
      ]
    : isLocalDataOutcome(outcome)
      ? [
          { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: One items table with name, quantity, category, and notes — search and category filter stay on a single record set.' },
          { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: node:sqlite file under data/ so records survive process restart without a hosted database.' },
          { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: Loopback Node HTTP JSON API plus vanilla UI; no live deploy.' },
        ]
    : [
        { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: Place Get a Quote in primary navigation because industry sites expose quote requests prominently (observation, not a copied layout).' },
        { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: Use a working brand title with unpublished legal/authority fields instead of inventing DOT, MC, or fleet counts.' },
        { kind: 'FOUNDRY_DESIGN_DECISION' as const, text: 'DESIGN: Multi-page HTML with a loopback Node server and localStorage quotes — no outbound email.' },
      ]
  return [...facts, ...observations, ...designs]
}
