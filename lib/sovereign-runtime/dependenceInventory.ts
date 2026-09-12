/**
 * #22 Phase 10 — Website / remote dependence inventory (audit, not guesswork).
 * Classifications: LOCAL_REQUIRED | WEB_ONLY | OPTIONAL_REMOTE | EXTERNAL_PROVIDER_REQUIRED | NEEDS_REFACTOR
 */
export type DependenceClass =
  | 'LOCAL_REQUIRED'
  | 'WEB_ONLY'
  | 'OPTIONAL_REMOTE'
  | 'EXTERNAL_PROVIDER_REQUIRED'
  | 'NEEDS_REFACTOR'

export type DependenceItem = {
  id: string
  surface: string
  evidence: string
  classification: DependenceClass
  notes: string
}

export const WEBSITE_DEPENDENCE_INVENTORY: readonly DependenceItem[] = Object.freeze([
  {
    id: 'public_domain_warroomos',
    surface: 'warroomos.com',
    evidence: 'docs + production supervisor / invite URL defaults; sample corpus strings in wrim1-dataset',
    classification: 'OPTIONAL_REMOTE',
    notes: 'Public entry optional. Not required for local core/desktop foundation.',
  },
  {
    id: 'cloudflare_tunnel',
    surface: 'cloudflared',
    evidence: 'ops/production-supervisor; Operations Agent CLOUDFLARED_STATUS diagnostic',
    classification: 'OPTIONAL_REMOTE',
    notes: 'Remote transport only. Local desktop must function if cloudflared stopped.',
  },
  {
    id: 'public_dns',
    surface: 'DNS for warroomos.com',
    evidence: 'implied by public HTTPS access path',
    classification: 'OPTIONAL_REMOTE',
    notes: 'Not required for 127.0.0.1 local core.',
  },
  {
    id: 'vercel',
    surface: 'VERCEL_URL / Vercel env hints',
    evidence: 'lib/signup-invitations/token.ts readBaseUrl fallback; provider setup copy',
    classification: 'OPTIONAL_REMOTE',
    notes: 'Not the primary production path on Nebula; must not be required locally.',
  },
  {
    id: 'next_server',
    surface: 'Next.js App Router + API routes',
    evidence: 'app/**, pnpm start / next start on :3000 prod / :3001 dev',
    classification: 'LOCAL_REQUIRED',
    notes: 'War Room Core logic lives in this process today. Local-core port 3847 is the sovereign adapter; full UI may still be Next when served locally.',
  },
  {
    id: 'browser_cookies_supabase',
    surface: 'Supabase auth cookies / browser session',
    evidence: 'lib/security/commanderSession.ts → createSupabaseServerClient().auth.getUser()',
    classification: 'NEEDS_REFACTOR',
    notes: 'Full Commander ownership currently assumes authenticated Supabase session. Offline ownership cannot be faked; local desktop session is bounded + separate.',
  },
  {
    id: 'browser_origin_cors',
    surface: 'Browser origin / CORS',
    evidence: 'Next API routes consumed by browser UI',
    classification: 'WEB_ONLY',
    notes: 'Desktop loads loopback origin; public CORS not required for local use.',
  },
  {
    id: 'https_only_public',
    surface: 'HTTPS public site',
    evidence: 'warroomos.com via Cloudflare',
    classification: 'OPTIONAL_REMOTE',
    notes: 'Local core uses HTTP on loopback only (foundation).',
  },
  {
    id: 'next_public_site_url',
    surface: 'NEXT_PUBLIC_SITE_URL',
    evidence: 'lib/deploy/status.ts, signup invitations, Operations env presence',
    classification: 'OPTIONAL_REMOTE',
    notes: 'Canonical public site for invites/probes — not for local core identity.',
  },
  {
    id: 'supabase_remote',
    surface: 'Supabase URL + auth/storage',
    evidence: 'NEXT_PUBLIC_SUPABASE_URL; conversations; Commander session',
    classification: 'EXTERNAL_PROVIDER_REQUIRED',
    notes: 'Conversations/ownership HYBRID: remote DB. Local core health works without it; privileged conversation APIs remain UNAVAILABLE_OFFLINE without session.',
  },
  {
    id: 'ollama_local',
    surface: 'Ollama 127.0.0.1:11434',
    evidence: 'lib/native-builder/ollamaClient.ts; council localBackend',
    classification: 'LOCAL_REQUIRED',
    notes: 'Local model bridge — no public domain required.',
  },
  {
    id: 'external_ai_keys',
    surface: 'OpenAI/Anthropic/xAI/Gemini keys',
    evidence: 'Council cloud backends',
    classification: 'EXTERNAL_PROVIDER_REQUIRED',
    notes: 'Provider unavailable ≠ War Room Core down.',
  },
  {
    id: 'websocket_sse',
    surface: 'Council streaming / SSE',
    evidence: 'council streaming runtime routes',
    classification: 'LOCAL_REQUIRED',
    notes: 'Works against local Next origin; must not hard-require public hostname.',
  },
  {
    id: 'absolute_public_urls',
    surface: 'Absolute warroomos.com URLs in samples',
    evidence: 'lib/wrim1-dataset/* sample strings',
    classification: 'WEB_ONLY',
    notes: 'Corpus samples only — not runtime launch dependency.',
  },
  {
    id: 'service_workers',
    surface: 'PWA / service worker',
    evidence: 'docs/runtime-roadmap Phase A mentions PWA',
    classification: 'WEB_ONLY',
    notes: 'Not required for desktop foundation.',
  },
  {
    id: 'desktop_app_pre_phase10',
    surface: 'Windows desktop shell',
    evidence: 'docs/runtime-roadmap Phase B; ops README lists Desktop/Tauri as out of #18 scope',
    classification: 'NEEDS_REFACTOR',
    notes: 'Pre-Phase-10 truth: DESKTOP APP NOT IMPLEMENTED. Phase 10 implements foundation.',
  },
] as const)

export function inventoryByClass(classification: DependenceClass): DependenceItem[] {
  return WEBSITE_DEPENDENCE_INVENTORY.filter(i => i.classification === classification)
}
