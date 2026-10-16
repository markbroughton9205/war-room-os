/**
 * War Room knowledge-first answering. Priority ladder:
 *   1 installed state (probed) -> 2 project docs/config -> 3 mission/session records
 *   -> 4 local research/knowledge -> 5 external research (only when genuinely required).
 * A documented capability whose installed probe fails is reported as NOT VERIFIED INSTALLED;
 * documentation never outranks probed installed state.
 */
import type { KnowledgeClaim, KnowledgeStatus, TurnUnderstanding } from './types'

export type InstalledState = {
  stamp: null | { install_id: string; gitShort: string; builtAt: string; gitRef?: string; gitDirty?: boolean }
  /** probe path -> exists in the running install */
  probes: Record<string, boolean>
  /** Live council roster from the running code (identity, role, status). */
  roster: Array<{ id: string; name: string; role: string; status: string }>
  /** The model(s) that actually back the roster today. */
  sharedLocalModel: string | null
  /** Recent mission/session records (tier 3), when available. */
  missions?: Array<{ id: string; title: string; status: string }>
}

type CapabilityEntry = {
  id: string
  topic: 'war room' | 'divine rising council' | 'foundry' | 'terra' | 'higher vision studios' | 'sandbox'
  /** What the documentation says it is. */
  text: string
  docSource: string
  /** File that exists only if the capability is present in the install. */
  probe: string | null
  /** Roadmap items are never stated as installed. */
  planned?: boolean
}

export const CAPABILITIES: CapabilityEntry[] = [
  {
    id: 'war-room', topic: 'war room',
    text: 'War Room is a locally installed agentic orchestration platform (Next.js app packaged as a desktop app) that coordinates AI models as a Council, with Commander approval gates over consequential actions.',
    docSource: 'CLAUDE.md', probe: 'app/page.tsx',
  },
  {
    id: 'council', topic: 'divine rising council',
    text: 'The Divine Rising Council is the multi-member discussion layer: named members with distinct role contracts deliberate on a question, a coordinator chooses who participates, and each contribution is attributed to the model or process that produced it.',
    docSource: 'lib/council/nebula/identity.ts', probe: 'lib/council/nebula/identity.ts',
  },
  {
    id: 'foundry', topic: 'foundry',
    text: 'Foundry is the engineering side: it runs engineering missions in isolated workspaces, verifies the result with independent checks, integrates through a git branch, and can build a versioned runtime.',
    docSource: 'docs/phases/FOUNDRY_LOCAL_COMPLETION.md', probe: 'lib/agents/ops/engineering/missions/service.ts',
  },
  {
    id: 'sandbox', topic: 'sandbox',
    text: 'Foundry runs model-generated code (tests, servers, verifiers, type-checks) inside an operating-system sandbox on Linux so a mission cannot reach outside its workspace; it is the build/verification sandbox, separate from any browser workspace (the visible Council computer is a separate browser workspace).',
    docSource: 'lib/agents/ops/engineering/runtime/sandbox.ts', probe: 'lib/agents/ops/engineering/runtime/sandbox.ts',
  },
  {
    id: 'terra', topic: 'terra',
    text: 'Terra is the earth-intelligence section: a globe view with layered live geographic data (events, aircraft, vessels, cameras) whose selected objects can be handed to the Council as evidence.',
    docSource: 'lib/terra/councilHandoff.ts', probe: 'lib/terra/councilHandoff.ts',
  },
  {
    id: 'hvs', topic: 'higher vision studios',
    text: 'Higher Vision Studios (HVS) is the AI-native media-production section of War Room; its master directive defines it as separate from the radio media player and from Terra.',
    docSource: 'docs/HIGHER_VISION_STUDIOS_MASTER_DIRECTIVE.md', probe: 'app/higher-vision-studios/page.tsx',
  },
  {
    id: 'council-missions', topic: 'foundry',
    text: 'Council can propose a Foundry engineering mission from a discussion; nothing runs until the Commander approves it, and the mission status and result shown are only what Foundry\'s own mission record, verifier and receipt report, returned into the same conversation.',
    docSource: 'lib/council/missions/service.ts', probe: 'lib/council/missions/service.ts',
  },
  {
    id: 'council-subsystems', topic: 'terra',
    text: 'Council has read-only live connections to Terra, Terra World and Higher Vision Studios; each reports AVAILABLE, DEGRADED or UNAVAILABLE with the reason from a bounded live probe, and unavailable capabilities are stated as unavailable.',
    docSource: 'lib/council/subsystems/probe.ts', probe: 'lib/council/subsystems/probe.ts',
  },
  {
    id: 'council-computer', topic: 'war room',
    text: 'The Council computer is a visible browser work screen: Council browsing is shown live, control ownership (Council or Commander) is explicit, the Commander can take over, and secure sign-in is typed only by the Commander into the browser (the Council never sees the secret).',
    docSource: 'lib/council/computer/browse.server.ts', probe: 'lib/council/computer/browse.server.ts',
  },
]

export const ROADMAP: KnowledgeClaim[] = [
  { id: 'plan-stage2', text: 'Approved external AI consultation (asking another AI service on the Commander\'s approval) is not installed.', status: 'PLANNED', tier: 2, source: 'Commander directive, Council Stage 1' },
  { id: 'plan-stage3', text: 'The immersive Council (materializing text, planetary navigation, truthful progress stars, Matrix-style environment, VR) is planned for Stage 3 and is not installed.', status: 'PLANNED', tier: 2, source: 'Commander directive, Council Stage 1' },
]

const SELF_RE = /\b(purpose|role|job|who are you|what are you|what do you do|what can you do|your capabilit|what is (the )?(war room|council|divine rising council|foundry|terra|higher vision studios)|what('s| is) this|about (the )?(war room|council|foundry|terra|higher vision studios)|installed|what (is|are) (installed|available|running)|which (agents|tools|capabilities|members)|who is on|who'?s on|members|explain (the )?(war room|council|foundry|terra|higher vision studios))\b/

/** True when the turn is a question about War Room itself (never needs the internet). */
export function isSelfKnowledgeQuestion(u: TurnUnderstanding): boolean {
  if (u.recall) return false
  // The replacement itself must name a War Room subject; a topic merely inherited from the thread is not enough.
  const correctionAboutWarRoom = u.act === 'correction' && !u.executionRequested
    && /\b(war room|council|foundry|terra|higher vision studios|sandbox)\b/.test(u.correction?.replacement ?? '')
  if (u.act !== 'question' && u.act !== 'follow_up' && !correctionAboutWarRoom) return false
  const t = u.normalized
  const words = t.split(' ').filter(Boolean)
  // Single short clause only: compound or instruction-bearing turns go to the members.
  if (words.length > 22 || /[;]|\b(and then|then|also|and (install|build|run|deploy|fix|start|update|delete|create))\b/.test(t)) return false
  // An imperative verb that begins a clause is an instruction; the same word used as a noun modifier ("the build sandbox") is not.
  if (/(?:^|\b(?:and|then|please|to|you|can|could|just)\s+)(?:install|build|deploy|run|start|fix|delete|update|create|restart|launch|execute)\b.*\b(it|them|this|that|the|a|my)\b/.test(t) && !/\b(what|which|who)\b/.test(t.split(' ').slice(0, 2).join(' '))) return false
  // Live runtime state has its own path; never answer it from file probes.
  if (/\b(running|status|health|healthy|online|up|working|alive|right now|currently|available now)\b/.test(t)) return false
  const mentionsSelf = /\b(war room|council|foundry|terra|higher vision studios|you|your)\b/.test(t) || u.topics.length > 0
  if (!mentionsSelf) return false
  if (/\b(news|latest|price of|stock|weather|score|election|compare .* (vendors|products)|according to (the )?(web|internet))\b/.test(t)) return false
  return SELF_RE.test(t) || ((u.act === 'follow_up' || correctionAboutWarRoom) && u.topics.length > 0)
}

export type SelfKnowledgeAnswer = {
  text: string
  claims: KnowledgeClaim[]
  tiersConsulted: number[]
  externalResearch: false
  unknowns: string[]
}

function status(entry: CapabilityEntry, state: InstalledState): { status: KnowledgeStatus; tier: 1 | 2; note: string } {
  if (entry.planned) return { status: 'PLANNED', tier: 2, note: 'planned, not installed' }
  if (entry.probe && state.probes[entry.probe] === true) return { status: 'FACT', tier: 1, note: 'present in this install' }
  if (entry.probe) return { status: 'DOCUMENTED', tier: 2, note: 'documented, but NOT verified present in this install' }
  return { status: 'DOCUMENTED', tier: 2, note: 'documented' }
}

export function answerSelfKnowledge(u: TurnUnderstanding, state: InstalledState): SelfKnowledgeAnswer {
  const wanted = new Set<string>(u.topics)
  const asksPurpose = /\b(purpose|role|job|who are you|what are you|what do you do|what can you do)\b/.test(u.normalized)
  let entries = CAPABILITIES.filter(c => wanted.has(c.topic))
  // "what does foundry do in War Room" is about Foundry; the generic War Room description would bury the answer.
  if (entries.some(c => c.id !== 'war-room' && c.id !== 'council')) entries = entries.filter(c => c.id !== 'war-room')
  const chosen = asksPurpose || entries.length === 0
    ? CAPABILITIES.filter(c => c.id === 'war-room' || c.id === 'council')
    : entries

  const claims: KnowledgeClaim[] = []
  const lines: string[] = []
  const unknowns: string[] = []

  if (u.correction) {
    lines.push(u.correction.replacement
      ? `Understood — you meant: ${u.correction.replacement}. I am setting my earlier reading aside.`
      : 'Understood — I am setting my earlier reading aside.')
  }
  if (asksPurpose) {
    lines.push('My purpose inside War Room: I am the Divine Rising Council — the deliberation layer. I take your question, decide which members are actually needed, have them contribute from their own role, keep the disagreement visible, and tell you who produced what.')
  }
  for (const c of chosen) {
    const s = status(c, state)
    claims.push({ id: c.id, text: c.text, status: s.status === 'FACT' ? 'DOCUMENTED' : s.status, tier: s.tier, source: s.tier === 1 ? `docs: ${c.docSource}; install probe: ${c.probe} present` : c.docSource })
    lines.push(`${c.text} (${s.status === 'FACT' ? 'description from project docs; the matching module is present in this install' : s.note})`)
  }

  if (chosen.some(c => c.id === 'council') || asksPurpose || /member|who/.test(u.normalized)) {
    const live = state.roster.filter(r => r.status === 'active')
    const foundation = state.roster.filter(r => r.status !== 'active')
    if (live.length) {
      claims.push({ id: 'roster', text: `Registered active members: ${live.map(r => `${r.name} (${r.role})`).join('; ')}`, status: 'FACT', tier: 1, source: 'running code: nebula identity registry' })
      lines.push(`Registered as active in the Council identity registry: ${live.map(r => `${r.name} — ${r.role}`).join('; ')}. (This is registry state, not a live model health check.)`)
    }
    if (foundation.length) {
      lines.push(`Registered but not yet live: ${foundation.map(r => r.name).join(', ')}.`)
    }
    if (state.sharedLocalModel) {
      claims.push({ id: 'shared-model', text: `Members currently share one local model: ${state.sharedLocalModel}`, status: 'FACT', tier: 1, source: 'running code: nebula model profile' })
      lines.push(`Honest note: today the members are separate identities and role contracts running on one shared local model (${state.sharedLocalModel}), not separate models. Contributions are attributed to the model that actually produced them in the contribution record.`)
    }
  }

  if (state.stamp) {
    claims.push({ id: 'install', text: `Installed build ${state.stamp.install_id} (commit ${state.stamp.gitShort}, built ${state.stamp.builtAt})`, status: 'FACT', tier: 1, source: 'INSTALL_STAMP.json' })
    lines.push(`Install stamp found for this runtime: ${state.stamp.install_id} (commit ${state.stamp.gitShort}, built ${state.stamp.builtAt}${state.stamp.gitDirty ? ', built from a DIRTY tree' : ''}).`)
  } else {
    unknowns.push('install stamp not found; I cannot state which build is running')
  }

  if (/\b(plan|planned|roadmap|future|next|stage)\b/.test(u.normalized) || asksPurpose) {
    for (const r of ROADMAP) { claims.push(r); lines.push(`[PLANNED] ${r.text}`) }
  }
  if (state.missions && /\b(mission|running|completed|working on)\b/.test(u.normalized)) {
    if (state.missions.length) {
      for (const m of state.missions.slice(0, 5)) claims.push({ id: `mission-${m.id}`, text: `${m.title}: ${m.status}`, status: 'FACT', tier: 3, source: `mission record ${m.id}` })
      lines.push('Recent missions: ' + state.missions.slice(0, 5).map(m => `${m.title} (${m.status})`).join('; ') + '.')
    } else unknowns.push('no mission records were available to read')
  }
  const tiers = Array.from(new Set(claims.map(c => c.tier))).sort() as number[]
  if (unknowns.length) lines.push('Unknown: ' + unknowns.join('; ') + '.')
  lines.push('Source: local installed state and project documentation. No external research was run.')
  return { text: lines.join('\n\n'), claims, tiersConsulted: tiers, externalResearch: false, unknowns }
}

/** Collects installed state with injected fs so tests need no disk. */
export function collectInstalledState(io: {
  exists: (relPath: string) => boolean
  readStamp: () => string | null
  roster: InstalledState['roster']
  sharedLocalModel: string | null
  missions?: InstalledState['missions']
}): InstalledState {
  let stamp: InstalledState['stamp'] = null
  try {
    const raw = io.readStamp()
    if (raw) {
      const j = JSON.parse(raw) as Record<string, unknown>
      if (typeof j.install_id === 'string') {
        stamp = {
          install_id: j.install_id,
          gitShort: String(j.gitShort ?? ''),
          builtAt: String(j.builtAt ?? ''),
          gitRef: typeof j.gitRef === 'string' ? j.gitRef : undefined,
          gitDirty: typeof j.gitDirty === 'boolean' ? j.gitDirty : undefined,
        }
      }
    }
  } catch { stamp = null }
  const probes: Record<string, boolean> = {}
  for (const c of CAPABILITIES) if (c.probe) probes[c.probe] = io.exists(c.probe)
  return { stamp, probes, roster: io.roster, sharedLocalModel: io.sharedLocalModel, missions: io.missions }
}
