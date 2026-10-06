import { classifyCouncilPath } from './pathClassifier'
import { isGiEng01ShortPathEnabled } from './featureFlag'
import { isGiEng02ShortPathCompleteEnabled } from './shortPathCompleter'
import { GI_ENG_04_QUALITY_PROMPTS } from './gi.eng04.prompts'

export type GiEng04Case = {
  lane: 'UNIT'
  caseId: string
  description: string
  result: 'PASS' | 'FAIL'
  details: string
}

function check(caseId: string, description: string, ok: boolean, details: unknown = ''): GiEng04Case {
  return { lane: 'UNIT', caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) }
}

export function runGiEng04Unit(): GiEng04Case[] {
  const cases: GiEng04Case[] = []
  cases.push(check('FLAG-01', 'source process keeps GI_ENG_01 off', isGiEng01ShortPathEnabled() === false, process.env.GI_ENG_01_SHORT_PATH ?? 'unset'))
  cases.push(check('FLAG-02', 'source process keeps GI_ENG_02 off', isGiEng02ShortPathCompleteEnabled() === false, process.env.GI_ENG_02_SHORT_PATH_COMPLETE ?? 'unset'))
  cases.push(check('QSET-COUNT', 'quality set has at least 30 prompts', GI_ENG_04_QUALITY_PROMPTS.length >= 30, GI_ENG_04_QUALITY_PROMPTS.length))

  for (const row of GI_ENG_04_QUALITY_PROMPTS) {
    const classified = classifyCouncilPath({ text: row.prompt, prior_turns: row.prior ?? [] })
    cases.push(check(row.id, `${row.category}: ${row.prompt.slice(0, 64)} → ${row.expected_path}`, classified.path === row.expected_path, {
      path: classified.path,
      mission: classified.mission_class,
    }))
  }

  const sparse = classifyCouncilPath('What are sparse experts in mixture-of-experts AI models?')
  cases.push(check('SPARSE-ROUTE', 'sparse-expert conceptual question stays SHORT', sparse.path === 'SHORT_PATH', sparse))
  const research = classifyCouncilPath('Research current sparse expert inference techniques using primary sources.')
  cases.push(check('SPARSE-RESEARCH', 'sparse-expert primary-source research is AGENT', research.path === 'AGENT_PATH' && research.mission_class === 'DEEP_RESEARCH', research))
  const casualAfter = classifyCouncilPath({
    text: "That makes sense. So what's our smartest move next?",
    prior_turns: ['Research current sparse expert inference techniques using primary sources.'],
  })
  cases.push(check('POST-RESEARCH', 'post-research casual does not inherit DEEP_RESEARCH', casualAfter.path === 'SHORT_PATH' && casualAfter.mission_class !== 'DEEP_RESEARCH', casualAfter))
  return cases
}
