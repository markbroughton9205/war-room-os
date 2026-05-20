import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import {
  buildIntegrityExpectationForPrompt,
  detectPromptIntent,
  isRelaxedPromptIntent,
} from '@/lib/council/promptIntent'
import {
  detectGreetingOnlyResponse,
  validateProviderResponseIntegrity,
} from '@/lib/providers/responseIntegrity'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`prompt intent assertion failed: ${message}`)
}

export function assertPromptIntentFixtures(): void {
  assert(detectPromptIntent('hey family') === 'GREETING', 'hey family is GREETING')
  assert(detectPromptIntent('hello') === 'GREETING', 'hello is GREETING')
  assert(detectPromptIntent("what's up") === 'GREETING', "what's up is GREETING")
  assert(detectPromptIntent('good morning') === 'GREETING', 'good morning is GREETING')
  assert(isRelaxedPromptIntent('GREETING'), 'GREETING is relaxed')
  assert(detectPromptIntent('gemini what do you think') === 'ANALYSIS', 'gemini what do you think is ANALYSIS')
  assert(
    detectPromptIntent('scout AI opportunities under $500') === 'OPPORTUNITY',
    'scout opportunities is OPPORTUNITY',
  )
  assert(
    detectPromptIntent("what's going on in the USA") === 'RESEARCH',
    'USA current-events prompt is RESEARCH',
  )

  const casualReply = 'Hey Ra\'el — good to see you. The council family is here and ready when you need us.'
  const greetingIntent = detectPromptIntent('hey family')
  const casualIntegrity = validateProviderResponseIntegrity(
    casualReply,
    buildIntegrityExpectationForPrompt(greetingIntent, { councilMode: true }),
  )
  assert(casualIntegrity.integrity_status === 'COMPLETE', 'warm casual reply passes for hey family')
  assert(!detectGreetingOnlyResponse(casualReply) || isRelaxedPromptIntent(greetingIntent), 'casual decree relaxes greeting-only')

  const gate = applyCouncilRenderGate('gemini', casualReply, { decreeText: 'hey family' })
  assert(gate.renderable, 'hey family gemini reply is renderable')
  assert(!gate.degraded, 'hey family gemini reply is not degraded')
  assert(gate.displayText === casualReply, 'hey family keeps provider text')

  const shortNoPeriod = "Hey Ra'el — council is here and ready"
  const shortIntegrity = validateProviderResponseIntegrity(
    shortNoPeriod,
    buildIntegrityExpectationForPrompt('GREETING', { councilMode: true }),
  )
  assert(
    shortIntegrity.integrity_status !== 'TRUNCATED',
    'short greeting reply without terminal period is not TRUNCATED',
  )
  const shortGate = applyCouncilRenderGate('gemini', shortNoPeriod, { decreeText: 'hello' })
  assert(shortGate.renderable, 'short hello gemini reply is renderable')
  assert(shortGate.displayText === shortNoPeriod, 'short hello keeps provider text')

  const analysisIntent = detectPromptIntent('gemini what do you think')
  assert(analysisIntent === 'ANALYSIS', 'directed what-do-you-think is analysis intent')
  const solidAnalysis =
    'Because provider timeouts are still noisy, I think the council should tighten retry caps before deploy. Evidence from last night shows partial packets; the recommended action is a staged rollout.'
  const analysisIntegrity = validateProviderResponseIntegrity(
    solidAnalysis,
    buildIntegrityExpectationForPrompt(analysisIntent, { councilMode: true }),
  )
  assert(analysisIntegrity.integrity_status === 'COMPLETE', 'substantive analysis reply passes strict integrity')
  assert(!detectGreetingOnlyResponse(solidAnalysis), 'analysis reply is not greeting-only')

  const opportunityIntent = detectPromptIntent('scout AI opportunities under $500')
  const vagueOpp = 'There are many opportunities in AI you could explore.'
  const oppIntegrity = validateProviderResponseIntegrity(
    vagueOpp,
    buildIntegrityExpectationForPrompt(opportunityIntent, { councilMode: true }),
  )
  assert(
    oppIntegrity.integrity_status === 'DEGRADED_RESPONSE_QUALITY',
    'vague opportunity reply fails opportunity structure',
  )
}
