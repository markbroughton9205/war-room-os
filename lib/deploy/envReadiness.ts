import type { EnvReadinessGroupSummary, EnvVarPresence } from './types'
import { redactServerOnlyEnvName, SUPABASE_SERVICE_ROLE_ENV } from '@/lib/security/sensitiveEnv'

export type EnvVarGroupDef = {
  id: string
  label: string
  required: string[]
  optional: string[]
}

/**
 * Env names referenced across the repo (`process.env.*`). Values are never exposed.
 */
export const ENV_VAR_GROUPS: EnvVarGroupDef[] = [
  {
    id: 'supabase',
    label: 'Supabase',
    required: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_SERVICE_ROLE_ENV],
    optional: ['SUPABASE_FILES_BUCKET'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    required: [],
    optional: ['OPENAI_API_KEY'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    required: [],
    optional: ['ANTHROPIC_API_KEY'],
  },
  {
    id: 'tavily',
    label: 'Tavily',
    required: [],
    optional: ['TAVILY_API_KEY'],
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    required: [],
    optional: ['FIRECRAWL_API_KEY'],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    required: [],
    optional: ['GEMINI_API_KEY'],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    required: [],
    optional: ['XAI_API_KEY', 'XAI_MODEL'],
  },
  {
    id: 'local_agent',
    label: 'Local agent bridges',
    required: [],
    optional: [
      'LOCAL_AGENT_OPENHANDS_URL',
      'LOCAL_AGENT_AIDER_PATH',
      'LOCAL_AGENT_CONTINUE_PATH',
      'LOCAL_AGENT_GOOSE_PATH',
      'CURSOR_API_KEY',
      'LOCAL_AGENT_CURSOR_TOKEN',
    ],
  },
  {
    id: 'deploy_platform',
    label: 'Deploy / platform',
    required: [],
    optional: [
      'VERCEL',
      'VERCEL_URL',
      'VERCEL_DEPLOYMENT_ID',
      'NEXT_PUBLIC_SITE_URL',
      'NETLIFY',
      'CONTEXT',
      'DEPLOY_PRIME_URL',
      'URL',
      'VERCEL_ACCESS_TOKEN',
      'VERCEL_TOKEN',
      'VERCEL_OIDC_TOKEN',
      'VERCEL_API_TOKEN',
    ],
  },
  {
    id: 'repo',
    label: 'Repo tooling',
    required: [],
    optional: ['REPO_ROOT'],
  },
  {
    id: 'audit',
    label: 'Audit / workers',
    required: [],
    optional: ['WAR_ROOM_AUDIT_POST_SECRET', 'WAR_ROOM_MEMORY_PROPOSALS_ENABLED'],
  },
  {
    id: 'twilio',
    label: 'Twilio / SMS',
    required: [],
    optional: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RAEL_PHONE_NUMBER'],
  },
]

function presence(name: string): EnvVarPresence {
  return { name: redactServerOnlyEnvName(name), present: Boolean(process.env[name]?.trim()) }
}

export function scanEnvReadiness(): EnvVarPresence[] {
  const names = new Set<string>()
  for (const g of ENV_VAR_GROUPS) {
    for (const n of g.required) names.add(n)
    for (const n of g.optional) names.add(n)
  }
  return [...names].sort((a, b) => a.localeCompare(b)).map(presence)
}

export function summarizeEnvReadinessGroups(): EnvReadinessGroupSummary[] {
  return ENV_VAR_GROUPS.map(g => ({
    groupId: g.id,
    label: g.label,
    required: g.required.map(presence),
    optional: g.optional.map(presence),
  }))
}
