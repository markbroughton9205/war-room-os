import { readFileSync, existsSync } from 'node:fs'
import { resolveLiveCouncilRoster } from '../lib/council/live-orchestration/rosterHealth.server.ts'
import { streamCouncilFamily } from '../lib/council/live-orchestration/streamProvider.ts'
import { classifyCouncilTurn } from '../lib/council/session-orchestration/turnIntent.ts'
import { decideMemoryCandidatePrompt } from '../lib/council/live-orchestration/memoryCandidateGate.ts'
import { compactFamilyRosterLine } from '../lib/council/live-orchestration/rosterHealth.ts'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadEnvLocal()

const roster = resolveLiveCouncilRoster()
const social = classifyCouncilTurn('Hi council')
const checkIn = classifyCouncilTurn('Council check in')
const world = classifyCouncilTurn("Council, what's going on with the world?")
const normal = classifyCouncilTurn('What is a hash table?')

async function sequentialSocial(prompt) {
  const order = roster.activeFloorFamilies
  const families = []
  const roundStarted = Date.now()
  for (const family of order) {
    const started = Date.now()
    let deltas = 0
    const result = await streamCouncilFamily({
      family,
      system: 'You are a War Room Council family. Reply in 1-2 short role-aware sentences. No research, no Decision Summary, no live-signal analysis.',
      prompt,
      maxTokens: 80,
      timeoutKind: 'social',
      onDelta: () => {
        deltas += 1
      },
    })
    families.push({
      family,
      ok: result.ok,
      streamed: deltas > 0 || result.firstDeltaAt != null,
      firstDeltaAt: result.firstDeltaAt ?? null,
      elapsedMs: Date.now() - started,
      httpStatus: result.httpStatus,
      failureLayer: result.failureLayer,
      textChars: result.text.trim().length,
    })
  }
  return { order, families, totalMs: Date.now() - roundStarted }
}

const hi = await sequentialSocial('Hi council')
const check = await sequentialSocial('Council check in')
const hash = await sequentialSocial('What is a hash table in one sentence?')

console.log(JSON.stringify({
  secretsPrinted: false,
  roster: {
    degradedByRoster: roster.degradedByRoster,
    degradedLabel: roster.degradedLabel,
    compact: compactFamilyRosterLine(roster),
    claude: roster.families.claude,
    grok: roster.families.grok,
    redTeam: roster.redTeam,
    activeFloorFamilies: roster.activeFloorFamilies,
  },
  intents: {
    hi: social.intent,
    checkIn: checkIn.intent,
    world: world.intent,
    worldResearch: world.shouldResearch,
    normal: normal.intent,
  },
  memory: {
    hi: decideMemoryCandidatePrompt({ commanderText: 'Hi council', anySuccess: true }).shouldPrompt,
    checkIn: decideMemoryCandidatePrompt({ commanderText: 'Council check in', anySuccess: true }).shouldPrompt,
  },
  live: { hi, check, hash },
}, null, 2))
