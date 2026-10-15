import assert from 'node:assert/strict'
import { decideCouncilModelTurn, deferralNotice, gpuPolicyFromEnv, type ActiveFoundryMission } from './gpuArbitration'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const mission: ActiveFoundryMission = { id: 'msn-20261015T150000-aaaa1111', title: 'Fix add()', state: 'RUNNING', stateReason: 'building' }

{
  const d = decideCouncilModelTurn({ policy: 'DEFER', activeMission: null })
  assert.equal(d.run, true); assert.equal(d.holder, null)
  ok('1: with no live Foundry mission a Council model turn runs')
}
{
  const d = decideCouncilModelTurn({ policy: 'DEFER', activeMission: mission })
  assert.equal(d.run, false)
  if (d.run) throw new Error('unreachable')
  assert.equal(d.holder.id, mission.id); assert.match(d.reason, /holds the local GPU/)
  const notice = deferralNotice(d)
  assert.match(notice, /no member was called and nothing was run/); assert.match(notice, /msn-20261015T150000-aaaa1111/)
  assert.match(notice, /still work/)
  ok('2: while a live mission holds the GPU the turn is deferred with an honest notice naming the mission and what still works')
}
{
  const d = decideCouncilModelTurn({ policy: 'ALLOW', activeMission: mission })
  assert.equal(d.run, true); assert.match(d.reason, /policy ALLOW/)
  assert.equal(gpuPolicyFromEnv({ WAR_ROOM_COUNCIL_GPU_POLICY: 'allow' } as never), 'ALLOW')
  assert.equal(gpuPolicyFromEnv({} as never), 'DEFER'); assert.equal(gpuPolicyFromEnv({ WAR_ROOM_COUNCIL_GPU_POLICY: 'nonsense' } as never), 'DEFER')
  ok('3: ALLOW is an explicit operator policy; anything else, including garbage, means DEFER')
}
console.log(`\n${passed}/3 council GPU arbitration validations passed`)
assert.equal(passed, 3)
