/**
 * #22 Phase 11A — Canonical War Room UI audit (shared Next app, no desktop fork).
 */
export type UiDepClass =
  | 'LOCAL_READY'
  | 'NEEDS_LOCAL_ADAPTER'
  | 'REMOTE_ONLY'
  | 'EXTERNAL_PROVIDER_DEPENDENT'
  | 'BLOCKER'

export type UiAuditItem = {
  id: string
  surface: string
  evidence: string
  classification: UiDepClass
  notes: string
}

/** Routes that constitute the real War Room UI (canonical app/, not a fork). */
export const CANONICAL_WAR_ROOM_UI_ROUTES = Object.freeze([
  { path: '/', evidence: 'app/page.tsx', role: 'primary_shell' },
  { path: '/login', evidence: 'app/login/page.tsx', role: 'auth' },
  { path: '/terra', evidence: 'app/terra/page.tsx', role: 'terra' },
  { path: '/globe', evidence: 'app/globe/page.tsx', role: 'terra_globe' },
  { path: '/search', evidence: 'app/search/page.tsx', role: 'search' },
  { path: '/war-room', evidence: 'app/(dashboard)/war-room/page.tsx', role: 'legacy_dashboard' },
  { path: '/war-room/engineering', evidence: 'app/war-room/engineering/page.tsx', role: 'engineering' },
  { path: '/war-room/integrity', evidence: 'app/war-room/integrity/page.tsx', role: 'integrity' },
  { path: '/native-builder', evidence: 'app/native-builder/page.tsx', role: 'builder' },
  { path: '/sovereign-model-lab', evidence: 'app/sovereign-model-lab/page.tsx', role: 'model_lab' },
  { path: '/workspace', evidence: 'app/workspace/page.tsx', role: 'workspace' },
  { path: '/wr-corpus', evidence: 'app/wr-corpus/page.tsx', role: 'wr_corpus' },
] as const)

export const CANONICAL_UI_AUDIT: readonly UiAuditItem[] = Object.freeze([
  {
    id: 'app_router',
    surface: 'Next App Router',
    evidence: 'app/layout.tsx + app/**/page.tsx',
    classification: 'LOCAL_READY',
    notes: 'Canonical UI — desktop must reuse, not fork.',
  },
  {
    id: 'primary_shell',
    surface: 'Home / Command Center',
    evidence: 'app/page.tsx (client) — Council, conversations, tools',
    classification: 'LOCAL_READY',
    notes: 'API calls are relative /api/* — works on any local origin.',
  },
  {
    id: 'relative_apis',
    surface: 'Client fetch(/api/...)',
    evidence: 'app/page.tsx, TerraShell, etc.',
    classification: 'LOCAL_READY',
    notes: 'No warroomos.com hardcoding in primary client fetches.',
  },
  {
    id: 'next_server',
    surface: 'API routes + RSC + streaming',
    evidence: 'app/api/**, middleware.ts',
    classification: 'LOCAL_READY',
    notes: 'Requires Next server runtime — not static export.',
  },
  {
    id: 'cesium_assets',
    surface: 'Cesium static',
    evidence: 'public/cesium + scripts/copy-cesium-assets.mjs',
    classification: 'LOCAL_READY',
    notes: 'Copied into public/ at predev/prebuild — local assets.',
  },
  {
    id: 'supabase_auth',
    surface: 'Supabase session middleware',
    evidence: 'middleware.ts → lib/supabase/middleware.ts',
    classification: 'EXTERNAL_PROVIDER_DEPENDENT',
    notes: 'Privileged data needs auth. UI shell/login still local. Offline ownership NOT this phase.',
  },
  {
    id: 'council_streaming',
    surface: 'Council SSE/stream',
    evidence: 'council streaming routes + relative fetch',
    classification: 'LOCAL_READY',
    notes: 'Origin is page origin — localhost works; providers may need internet.',
  },
  {
    id: 'external_ai',
    surface: 'Cloud LLM providers',
    evidence: 'Council backends',
    classification: 'EXTERNAL_PROVIDER_DEPENDENT',
    notes: 'UI availability ≠ provider availability.',
  },
  {
    id: 'public_domain',
    surface: 'warroomos.com',
    evidence: 'OPTIONAL_REMOTE / invite URLs',
    classification: 'REMOTE_ONLY',
    notes: 'Must not be required for desktop UI boot.',
  },
  {
    id: 'desktop_fork',
    surface: 'Desktop-specific page copies',
    evidence: 'none (forbidden)',
    classification: 'LOCAL_READY',
    notes: 'Phase 11A invariant: no app-desktop-copy / desktop-council-copy.',
  },
] as const)

export const LOCAL_UI_ARCHITECTURE = Object.freeze({
  name: 'ELECTRON_TO_LOCAL_NEXT_SERVER',
  description:
    'Electron shell → discover/start local Next production runtime (next start) on loopback → load canonical War Room UI. Local core (:3847) remains lifecycle/control plane.',
  why_not_static_export:
    'Static export would break API routes, middleware/auth session refresh, streaming, Terra/Council server handlers.',
  shared_ui: true,
  desktop_ui_fork: false,
} as const)
