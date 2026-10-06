import assert from 'node:assert/strict'
import { emptyEngineeringCampaign } from './foundryEngineeringCampaign'
import { promptFor, specialistRequestFromCampaign } from './foundryEngineeringSpecialist'

const campaign = emptyEngineeringCampaign('Round shipping fees up to the next whole euro')
campaign.knowledge.tests = ['verify pass', 'review pass']
campaign.knowledge.architecture = ['implementer says everything is complete']
const request = specialistRequestFromCampaign({
  campaign, taskId: 'verify', role: 'VERIFIER', purpose: 'Verify shipping fees',
  acceptance: 'Round shipping fees up to the next whole euro', workingSet: ['shipping/rates.py'],
  excerpts: [{ file: 'shipping/rates.py', text: 'def fee(weight):\n    return int(2.5 + 1.2 * weight)\n' }],
  needsEdit: false, attempt: 0, contractText: 'ACCEPTANCE_ROUND = "round upwards"',
})
assert.ok(request.missionContract.includes(campaign.request), 'A raw contract file must never replace the Commander goal')
assert.deepEqual(request.projectFacts, [], 'Verifier must not inherit implementer conclusions or summarized pass verdicts')
const prompt = promptFor(request)
assert.ok(prompt.includes('return int(2.5 + 1.2 * weight)'), 'Verifier must see the actual source')
assert.ok(prompt.includes('Round shipping fees'), 'Verifier must see the actual goal')
assert.ok(!prompt.includes('The tests passed.'), 'Green tests must not prescribe the verdict')
assert.ok(prompt.includes('NOT_READY') && prompt.includes('PROJECT_READY'), 'Verifier must be allowed to disagree from evidence')
console.log('VERIFIER_INDEPENDENCE_VALIDATION PASS 6/6')

const {parseSpecialistPayload} = await import('./foundryEngineeringSpecialist')
const probe = {file:'shipping/rates.py',function:'fee',args:[1.5],expected:5,criterion:campaign.request}
const full = 'NOT_READY ' + 'Review evidence. '.repeat(45) + 'PROBE_JSON ' + JSON.stringify(probe)
const parsed = parseSpecialistPayload({role:'VERIFIER',needsEdit:false,sources:new Map(),summary:full.slice(0,500),raw:JSON.stringify({decision:'REPLAN',reasoningSummary:full})})
assert.ok(parsed.result.summary.endsWith(JSON.stringify(probe)), 'Verifier evidence must survive beyond the short display summary')
console.log('VERIFIER_PROBE_HANDOFF_VALIDATION PASS 1/1')
