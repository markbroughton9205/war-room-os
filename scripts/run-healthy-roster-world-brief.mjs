import { readFileSync, existsSync } from 'node:fs'
import { runLiveResearchRouter } from '../lib/research/researchRouter.ts'
import { streamCouncilFamily } from '../lib/council/live-orchestration/streamProvider.ts'
import { resolveLiveCouncilRoster } from '../lib/council/live-orchestration/rosterHealth.server.ts'

function loadEnvLocal() {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
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

const decree = "Council, what's going on with the world?"
const researchStarted = Date.now()
const research = await runLiveResearchRouter({ decreeText: decree, supabase: null, budgetMs: 28000 })
const researchMs = Date.now() - researchStarted
const rssCount = research.publicRss?.ok ? research.publicRss.results.length : 0
const tavilyCount = research.tavily?.ok ? research.tavily.results.length : 0
const sourceCount = rssCount + tavilyCount + (research.direct?.filter(d => d.ok).length ?? 0)
const evidence = [
  research.publicRss?.results?.slice(0, 6).map(item => `${item.title ?? ''} ${item.url ?? ''}`).join('\n'),
  research.tavily?.results?.slice(0, 4).map(item => `${item.title} ${item.url}`).join('\n'),
].filter(Boolean).join('\n').slice(0, 2500)

const roster = resolveLiveCouncilRoster()
const familyStarted = Date.now()
const families = []
for (const family of roster.activeFloorFamilies) {
  const started = Date.now()
  let deltas = 0
  const result = await streamCouncilFamily({
    family,
    system: 'Use only the evidence packet. Label non-current knowledge. Do not mention Panama unless evidence does.',
    prompt: `${decree}\n\nEVIDENCE PACKET:\n${evidence || '(no live sources)'}\nReply in 4-6 sentences.`,
    maxTokens: 220,
    timeoutKind: 'research',
    onDelta: () => {
      deltas += 1
    },
  })
  const text = result.text || ''
  families.push({
    family,
    ok: result.ok,
    streamed: deltas > 0 || result.firstDeltaAt != null,
    firstDeltaAt: result.firstDeltaAt ?? null,
    elapsedMs: Date.now() - started,
    panama: /panama/i.test(text),
    textChars: text.trim().length,
  })
}

console.log(JSON.stringify({
  secretsPrinted: false,
  researchMs,
  sourceCount,
  rssCount,
  tavilyCount,
  tavilyOk: Boolean(research.tavily?.ok),
  rssOk: Boolean(research.publicRss?.ok),
  grokResearchAttempted: Boolean(research.grok),
  grokResearchOk: Boolean(research.grok?.ok),
  evidenceChars: evidence.length,
  floorOrder: roster.activeFloorFamilies,
  redTeam: roster.redTeam,
  degradedByRoster: roster.degradedByRoster,
  familyMs: Date.now() - familyStarted,
  families,
  panamaAny: families.some(f => f.panama),
}, null, 2))
