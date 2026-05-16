import { SUPABASE_SERVICE_ROLE_ENV } from '@/lib/security/sensitiveEnv'

export type ConfigurationStatus =
  | 'configured'
  | 'missing_provider'
  | 'missing_api_key'
  | 'degraded'
  | 'unavailable'
  | 'ready'
  | 'disabled_by_operator'

export type ConfigurationCategory = 'ai' | 'research_intel' | 'operations'

export type ConfigurationRequirement = 'required' | 'recommended' | 'optional' | 'future'

export type ProviderConfigDefinition = {
  id: string
  name: string
  category: ConfigurationCategory
  requiredEnvVars: string[]
  optionalEnvVars?: string[]
  alternativeEnvVarGroups?: string[][]
  required: ConfigurationRequirement
  powers: string[]
  affectedFeatures: string[]
  setupLocation: string
  lastCheckResult: string
  missingDependency?: string
  recommendedNextAction: string
  disabledByEnvVar?: string
  staticStatus?: ConfigurationStatus
}

export type TabConfigDefinition = {
  id:
    | 'command'
    | 'income'
    | 'agents'
    | 'approvals'
    | 'memory'
    | 'system'
    | 'diagnostics'
    | 'live_environment'
  name: string
  providerIds: string[]
  description: string
}

export const PROVIDER_CONFIG_REGISTRY: ProviderConfigDefinition[] = [
  {
    id: 'openai',
    name: 'OpenAI / ChatGPT',
    category: 'ai',
    requiredEnvVars: ['OPENAI_API_KEY'],
    required: 'recommended',
    powers: ['ChatGPT family', 'Codex fallback placeholder', 'Baby AI private chat when enabled'],
    affectedFeatures: ['Command Center', 'Agents', 'Diagnostics'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; live probe remains in engine diagnostics.',
    recommendedNextAction: 'Set OPENAI_API_KEY, then refresh the engine matrix.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic / Claude',
    category: 'ai',
    requiredEnvVars: ['ANTHROPIC_API_KEY'],
    required: 'recommended',
    powers: ['Claude family', 'Red Team runtime fallback'],
    affectedFeatures: ['Command Center', 'Agents', 'Diagnostics'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; live probe remains in engine diagnostics.',
    recommendedNextAction: 'Set ANTHROPIC_API_KEY, then refresh provider summary.',
  },
  {
    id: 'xai',
    name: 'xAI / Grok',
    category: 'ai',
    requiredEnvVars: ['XAI_API_KEY'],
    optionalEnvVars: ['XAI_MODEL'],
    required: 'recommended',
    powers: ['Grok family', 'income scouting', 'weak signal research'],
    affectedFeatures: ['Command Center', 'Income Operations', 'Live Environment'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; live probe remains in engine diagnostics.',
    recommendedNextAction: 'Set XAI_API_KEY for Grok-backed scouting and local signal enrichment.',
  },
  {
    id: 'google_gemini',
    name: 'Google / Gemini',
    category: 'ai',
    requiredEnvVars: ['GEMINI_API_KEY'],
    required: 'recommended',
    powers: ['Gemini family', 'cross-reference checks', 'internet status validation'],
    affectedFeatures: ['Command Center', 'System Health', 'Diagnostics'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; live probe remains in engine diagnostics.',
    recommendedNextAction: 'Set GEMINI_API_KEY and use engine diagnostics for the safe model probe.',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    category: 'research_intel',
    requiredEnvVars: ['TAVILY_API_KEY'],
    required: 'recommended',
    powers: ['web search', 'opportunity scout', 'persistent source discovery'],
    affectedFeatures: ['Income Operations', 'Diagnostics', 'Live Environment'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; research routes invoke it on demand.',
    recommendedNextAction: 'Set TAVILY_API_KEY for web search and income scouting.',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    category: 'research_intel',
    requiredEnvVars: ['FIRECRAWL_API_KEY'],
    required: 'recommended',
    powers: ['page extraction', 'candidate enrichment', 'source-backed research details'],
    affectedFeatures: ['Income Operations', 'Diagnostics', 'Live Environment'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; enrichment runs only when requested.',
    recommendedNextAction: 'Set FIRECRAWL_API_KEY for full research stack enrichment.',
  },
  {
    id: 'persistent_source_network',
    name: 'Persistent Source Network',
    category: 'research_intel',
    requiredEnvVars: ['TAVILY_API_KEY'],
    optionalEnvVars: ['XAI_API_KEY'],
    required: 'recommended',
    powers: ['source-backed context', 'weak signal memory', 'local intelligence history'],
    affectedFeatures: ['Command Center', 'Live Environment', 'Memory'],
    setupLocation: 'Project env plus source registry configuration',
    lastCheckResult: 'Registry wiring present; quality depends on Tavily and optional xAI keys.',
    recommendedNextAction: 'Configure TAVILY_API_KEY and curate durable local sources.',
  },
  {
    id: 'local_hyperlocal_sources',
    name: 'Local / Hyperlocal Sources',
    category: 'research_intel',
    requiredEnvVars: [],
    required: 'optional',
    powers: ['local awareness', 'neighborhood signal cards', 'source-backed context'],
    affectedFeatures: ['Live Environment', 'Command Center'],
    setupLocation: 'Source registry files and future operator-maintained feeds',
    lastCheckResult: 'Static registry exists, but no operator-maintained local source feed is connected.',
    missingDependency: 'Curated local source list',
    recommendedNextAction: 'Add trusted local source feeds or enable Tavily-backed local queries.',
    staticStatus: 'missing_provider',
  },
  {
    id: 'rss_news_sources',
    name: 'RSS / News Sources',
    category: 'research_intel',
    requiredEnvVars: [],
    required: 'recommended',
    powers: ['news cards', 'background source monitoring', 'current local context'],
    affectedFeatures: ['Live Environment', 'Diagnostics'],
    setupLocation: 'Source registry and future RSS adapter configuration',
    lastCheckResult: 'No RSS/news feed adapter configured in the sweep registry.',
    missingDependency: 'RSS/news adapter or feed list',
    recommendedNextAction: 'Choose RSS/news providers and register feed URLs before Phase 9.',
    staticStatus: 'missing_provider',
  },
  {
    id: 'weather_provider',
    name: 'Weather Provider',
    category: 'research_intel',
    requiredEnvVars: [],
    alternativeEnvVarGroups: [['WEATHER_API_KEY'], ['OPENWEATHER_API_KEY'], ['WEATHERAPI_KEY']],
    required: 'recommended',
    powers: ['weather widget', 'local environment context', 'weather risk alerts'],
    affectedFeatures: ['Live Environment', 'Income Operations'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'No weather network call performed; env presence only.',
    recommendedNextAction: 'Set WEATHER_API_KEY or a chosen provider key and wire the weather adapter.',
  },
  {
    id: 'horoscope_provider',
    name: 'Horoscope / Astrology Provider',
    category: 'research_intel',
    requiredEnvVars: [],
    alternativeEnvVarGroups: [['ASTROLOGY_API_KEY'], ['HOROSCOPE_API_KEY']],
    required: 'optional',
    powers: ['optional astrology widget', 'moon/planetary detail display'],
    affectedFeatures: ['Live Environment'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'No astrology adapter connected; current widget is symbolic fallback only.',
    recommendedNextAction: 'Choose an astrology provider and set ASTROLOGY_API_KEY or HOROSCOPE_API_KEY.',
  },
  {
    id: 'finance_market_data',
    name: 'Finance / Market Data Provider',
    category: 'research_intel',
    requiredEnvVars: ['FINANCE_API_KEY'],
    required: 'optional',
    powers: ['market data', 'finance monitoring', 'income opportunity validation'],
    affectedFeatures: ['Income Operations', 'System Health'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; no market data call performed.',
    recommendedNextAction: 'Set FINANCE_API_KEY after selecting the market data provider.',
  },
  {
    id: 'government_public_data',
    name: 'Government / Public Data Provider',
    category: 'research_intel',
    requiredEnvVars: [],
    required: 'optional',
    powers: ['official records', 'public policy context', 'verified structured data'],
    affectedFeatures: ['Income Operations', 'Live Environment', 'Diagnostics'],
    setupLocation: 'Source registry and selected public data adapters',
    lastCheckResult: 'No public data adapter configured.',
    missingDependency: 'Selected public data API/feed list',
    recommendedNextAction: 'Select public datasets and add adapter configuration.',
    staticStatus: 'missing_provider',
  },
  {
    id: 'logistics_data',
    name: 'Logistics Data Provider',
    category: 'research_intel',
    requiredEnvVars: ['LOGISTICS_API_KEY'],
    required: 'optional',
    powers: ['route status', 'supply chain context', 'transport opportunity checks'],
    affectedFeatures: ['Income Operations', 'Live Environment'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Credential presence only; no logistics call performed.',
    recommendedNextAction: 'Set LOGISTICS_API_KEY after selecting a logistics data provider.',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'operations',
    requiredEnvVars: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_SERVICE_ROLE_ENV],
    optionalEnvVars: ['SUPABASE_FILES_BUCKET'],
    required: 'required',
    powers: ['persistence', 'memory archive', 'files vault', 'workflow queues'],
    affectedFeatures: ['Memory', 'Approvals', 'System Health', 'Diagnostics'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Env presence only; table checks remain in existing health routes.',
    recommendedNextAction: 'Set Supabase URL, anon key, and service role key for durable War Room state.',
  },
  {
    id: 'vercel_runtime',
    name: 'Vercel Runtime',
    category: 'operations',
    requiredEnvVars: [],
    optionalEnvVars: ['VERCEL', 'VERCEL_URL', 'VERCEL_DEPLOYMENT_ID', 'VERCEL_TOKEN', 'VERCEL_ACCESS_TOKEN', 'VERCEL_OIDC_TOKEN', 'VERCEL_API_TOKEN'],
    required: 'optional',
    powers: ['deployment awareness', 'runtime URL hints', 'production status display'],
    affectedFeatures: ['System Health', 'Diagnostics'],
    setupLocation: 'Vercel project environment',
    lastCheckResult: 'Runtime env presence only; deployment panel performs existing safe status collection.',
    recommendedNextAction: 'Configure Vercel env/token vars only if deployment controls are needed.',
  },
  {
    id: 'event_bus',
    name: 'Event Bus',
    category: 'operations',
    requiredEnvVars: [],
    required: 'required',
    powers: ['kernel events', 'audit trail', 'system ledger fallback'],
    affectedFeatures: ['Command Center', 'System Health', 'Diagnostics'],
    setupLocation: 'Built-in War Room runtime with Supabase persistence when configured',
    lastCheckResult: 'In-process event bus available; durable persistence depends on Supabase.',
    recommendedNextAction: 'Keep event schema intact; configure Supabase for durable event replay.',
    staticStatus: 'ready',
  },
  {
    id: 'memory_archive',
    name: 'Memory Archive',
    category: 'operations',
    requiredEnvVars: ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_SERVICE_ROLE_ENV],
    required: 'required',
    powers: ['memory recall', 'session summaries', 'strategic continuity'],
    affectedFeatures: ['Memory', 'Command Center'],
    setupLocation: 'Supabase environment variables and memory tables',
    lastCheckResult: 'Env presence only; archive routes verify tables on request.',
    recommendedNextAction: 'Configure Supabase service role and apply memory archive schema.',
  },
  {
    id: 'strategic_memory',
    name: 'Strategic Memory',
    category: 'operations',
    requiredEnvVars: ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_SERVICE_ROLE_ENV],
    required: 'recommended',
    powers: ['long-term operator context', 'economic ops recall', 'council continuity'],
    affectedFeatures: ['Memory', 'Command Center', 'Income Operations'],
    setupLocation: 'Supabase environment variables and memory policy tables',
    lastCheckResult: 'Env presence only; strategic memory uses existing memory routes.',
    recommendedNextAction: 'Configure Supabase persistence and verify strategic memory tables.',
  },
  {
    id: 'opportunity_scout',
    name: 'Opportunity Scout',
    category: 'operations',
    requiredEnvVars: ['TAVILY_API_KEY'],
    optionalEnvVars: ['FIRECRAWL_API_KEY', 'XAI_API_KEY'],
    required: 'recommended',
    powers: ['income opportunity discovery', 'candidate enrichment', 'worker assignment inputs'],
    affectedFeatures: ['Income Operations', 'Command Center'],
    setupLocation: 'Project or Vercel environment variables',
    lastCheckResult: 'Env presence only; scout route runs only by operator request.',
    recommendedNextAction: 'Set TAVILY_API_KEY and FIRECRAWL_API_KEY for full scout coverage.',
  },
  {
    id: 'workflow_queue',
    name: 'Workflow Queue',
    category: 'operations',
    requiredEnvVars: ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_SERVICE_ROLE_ENV],
    required: 'required',
    powers: ['queued actions', 'build requests', 'worker state'],
    affectedFeatures: ['Approvals', 'Agents', 'System Health'],
    setupLocation: 'Supabase environment variables and queue tables',
    lastCheckResult: 'Env presence only; queue routes verify tables on request.',
    recommendedNextAction: 'Configure Supabase and ensure workflow/action queue tables are migrated.',
  },
  {
    id: 'approvals',
    name: 'Approvals',
    category: 'operations',
    requiredEnvVars: ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_SERVICE_ROLE_ENV],
    required: 'required',
    powers: ['operator approvals', 'standing permission persistence', 'write gates'],
    affectedFeatures: ['Approvals', 'Command Center', 'Diagnostics'],
    setupLocation: 'Supabase environment variables and action queue tables',
    lastCheckResult: 'Env presence only; approval banner checks the queue route.',
    recommendedNextAction: 'Configure Supabase persistence for durable approvals.',
  },
  {
    id: 'red_sentinel',
    name: 'Red Sentinel',
    category: 'operations',
    requiredEnvVars: [],
    required: 'recommended',
    powers: ['risk detection', 'runtime holds', 'repair diagnostics'],
    affectedFeatures: ['Diagnostics', 'Command Center'],
    setupLocation: 'Built-in Red Team/Sentinel panels; cloud depth depends on Anthropic/OpenAI keys',
    lastCheckResult: 'Panel wiring present; deeper checks depend on AI providers.',
    missingDependency: 'AI provider depth when no Anthropic/OpenAI key is set',
    recommendedNextAction: 'Configure ANTHROPIC_API_KEY or OPENAI_API_KEY for stronger Red Sentinel review.',
    staticStatus: 'ready',
  },
  {
    id: 'local_agent_bridge',
    name: 'Local Agent Bridge',
    category: 'operations',
    requiredEnvVars: [],
    optionalEnvVars: ['LOCAL_AGENT_OPENHANDS_URL', 'LOCAL_AGENT_AIDER_PATH', 'LOCAL_AGENT_CONTINUE_PATH', 'LOCAL_AGENT_GOOSE_PATH', 'CURSOR_API_KEY', 'LOCAL_AGENT_CURSOR_TOKEN'],
    required: 'optional',
    powers: ['local engineering agents', 'bridge architect status', 'future safe execution handoffs'],
    affectedFeatures: ['Agents', 'Diagnostics'],
    setupLocation: 'Local environment variables and local model services',
    lastCheckResult: 'Env presence only; local-agent panels perform existing safe local status checks.',
    recommendedNextAction: 'Set local bridge env vars or start supported local model services, then refresh Agents.',
  },
  {
    id: 'cursor_codex_future_layer',
    name: 'Cursor / Codex Future Engineering Layer',
    category: 'operations',
    requiredEnvVars: [],
    optionalEnvVars: ['CURSOR_API_KEY', 'LOCAL_AGENT_CURSOR_TOKEN', 'OPENAI_API_KEY'],
    required: 'future',
    powers: ['future engineering automation placeholders', 'Codex/Cursor bridge planning'],
    affectedFeatures: ['Agents', 'Diagnostics'],
    setupLocation: 'Future engineering layer configuration',
    lastCheckResult: 'Placeholder only; no autonomous external action is wired.',
    missingDependency: 'Future engineering layer implementation',
    recommendedNextAction: 'Keep as unavailable until explicit Phase 9 engineering bridge scope is approved.',
    staticStatus: 'unavailable',
  },
]

export const TAB_CONFIG_REGISTRY: TabConfigDefinition[] = [
  {
    id: 'command',
    name: 'Command Center',
    providerIds: ['openai', 'anthropic', 'xai', 'google_gemini', 'event_bus', 'memory_archive', 'persistent_source_network', 'approvals'],
    description: 'Council command flow, provider readiness, context, approvals, and live memory continuity.',
  },
  {
    id: 'income',
    name: 'Income Operations',
    providerIds: ['xai', 'tavily', 'firecrawl', 'opportunity_scout', 'finance_market_data', 'government_public_data', 'logistics_data', 'strategic_memory'],
    description: 'Revenue radar, opportunity scout, finance/logistics/public data inputs, and worker assignment context.',
  },
  {
    id: 'agents',
    name: 'Agents',
    providerIds: ['local_agent_bridge', 'cursor_codex_future_layer', 'workflow_queue', 'openai', 'anthropic', 'google_gemini'],
    description: 'Local family agents, bridge architect, capability routing, and future engineering placeholders.',
  },
  {
    id: 'approvals',
    name: 'Approvals',
    providerIds: ['approvals', 'workflow_queue', 'supabase', 'event_bus'],
    description: 'Operator approval gates, standing permissions, action queue, and durable write controls.',
  },
  {
    id: 'memory',
    name: 'Memory',
    providerIds: ['memory_archive', 'strategic_memory', 'supabase', 'event_bus'],
    description: 'Memory recall, archive persistence, files vault, and strategic continuity panels.',
  },
  {
    id: 'system',
    name: 'System Health',
    providerIds: ['supabase', 'vercel_runtime', 'event_bus', 'workflow_queue', 'memory_archive', 'local_agent_bridge', 'red_sentinel'],
    description: 'Operational readiness summary, resources, worker health, deployment awareness, and blockers.',
  },
  {
    id: 'diagnostics',
    name: 'Diagnostics',
    providerIds: ['openai', 'anthropic', 'xai', 'google_gemini', 'tavily', 'firecrawl', 'supabase', 'vercel_runtime', 'local_agent_bridge', 'red_sentinel', 'cursor_codex_future_layer'],
    description: 'Configuration sweep, engine matrix, runtime integrity, repo awareness, and deployment diagnostics.',
  },
  {
    id: 'live_environment',
    name: 'Live Environment',
    providerIds: ['weather_provider', 'horoscope_provider', 'rss_news_sources', 'local_hyperlocal_sources', 'persistent_source_network', 'tavily', 'firecrawl'],
    description: 'Weather, location, alerts, horoscope, news cards, weak signals, and source-backed context.',
  },
]

export function getProviderConfigDefinition(id: string): ProviderConfigDefinition | undefined {
  return PROVIDER_CONFIG_REGISTRY.find(provider => provider.id === id)
}
