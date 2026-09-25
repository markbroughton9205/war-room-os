import { pathToFileURL } from 'node:url'
import { classifyFoundryMission, isArchivedSystemMission, isCommanderVisibleMission, isResumeEligible, isTestMissionClass } from './foundryMissionVisibility'
import { startMissionInput } from './foundryMissionController'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function stub(overrides: Partial<FoundryMissionRecord> & { userRequest: string; title?: string }): FoundryMissionRecord {
  const base = startMissionInput(overrides.userRequest, overrides.title)
  return { ...base, ...overrides }
}

async function run() {
  const p006 = classifyFoundryMission(stub({
    userRequest: 'Add a harmless Foundry-only visible acceptance marker FOUNDRY-P006 next to the Foundry navigation identity.',
    title: 'Add a harmless Foundry-only visible acceptance marker FOUNDRY-P006',
  }))
  const writeConflict = classifyFoundryMission(stub({
    userRequest: 'Change the ops-write-conflict fixture label from ALPHA to BRAVO and make sure it works.',
  }))
  const contract = classifyFoundryMission(stub({
    userRequest: 'Contract fixture: search for ALPHA and demonstrate bounded repeated-action handling.',
  }))
  const recovery = classifyFoundryMission(stub({
    userRequest: 'Find where Foundry resource locks are stored.',
  }))
  const commander = classifyFoundryMission(stub({
    userRequest: 'Build a calculator app with add and subtract.',
    title: 'Calculator',
  }))
  const ownership = classifyFoundryMission(stub({
    userRequest: 'Find the full ownership path for the Foundry project list, including the UI, API, workspace registry, visibility classification, and targeted validations. Do not change files.',
  }))
  const implBug = classifyFoundryMission(stub({
    userRequest: 'Fix the engineering-depth impl-bug fixture. Expected visible text SYSTEM READY. Implementation currently outputs SYSTEM RDY. The TEST is correct. This is a test application fixture, not a production install.',
  }))
  const archived = stub({
    userRequest: 'Find where compact model context is built.',
    archived: true,
    visibility: 'system',
    testArtifact: true,
  })
  const classifiedOnly = stub({
    userRequest: 'Find where compact model context is built.',
    classification: 'SYSTEM_TEST',
    testArtifact: true,
    visibility: 'system',
  })
  const superseded = stub({
    userRequest: 'Change the PASS 006 ops-write-conflict fixture label from ALPHA to BETA, test it, and verify it.',
    archived: true,
    visibility: 'system',
    testArtifact: true,
    superseded: true,
    resumeEligible: false,
    classification: 'SYSTEM_TEST',
  })
  const p011 = classifyFoundryMission(stub({
    userRequest: 'PASS 011 click_and_wait installed Computer Use reliability for The Foundry session lifecycle.',
    title: 'PASS 011 Semantic Stability',
  }))
  const commanderBuild = classifyFoundryMission(stub({
    userRequest: 'Build me a professional website for my box truck business.',
    title: 'Box truck website',
  }))
  const results = [
    check('class_acceptance_p006', p006.classification === 'ACCEPTANCE_FIXTURE' && p006.evidence.length > 0, JSON.stringify(p006)),
    check('class_system_write_conflict', writeConflict.classification === 'SYSTEM_TEST', JSON.stringify(writeConflict)),
    check('class_contract', contract.classification === 'CONTRACT_TEST', JSON.stringify(contract)),
    check('class_recovery', recovery.classification === 'RECOVERY_TEST', JSON.stringify(recovery)),
    check('class_commander_real', commander.classification === 'COMMANDER_REAL' && !isTestMissionClass(commander.classification), JSON.stringify(commander)),
    check('class_pass007_ownership_system', ownership.classification === 'SYSTEM_TEST', JSON.stringify(ownership)),
    check('class_pass007_impl_bug_fixture', implBug.classification === 'ACCEPTANCE_FIXTURE' || implBug.classification === 'SYSTEM_TEST', JSON.stringify(implBug)),
    check('commander_hidden_when_archived', isArchivedSystemMission(archived) && !isCommanderVisibleMission(archived), 'ok'),
    check('commander_hidden_when_classified_test', isArchivedSystemMission(classifiedOnly) && !isCommanderVisibleMission(classifiedOnly), 'ok'),
    check('commander_visible_real', isCommanderVisibleMission(stub({ userRequest: 'Fix the login button copy.' })), 'ok'),
    check('resume_ineligible_superseded', isResumeEligible(superseded) === false && isCommanderVisibleMission(superseded) === false, 'ok'),
    check('class_pass011_semantic_hidden', p011.classification === 'ACCEPTANCE_FIXTURE' && isTestMissionClass(p011.classification) && !isCommanderVisibleMission(stub({
      userRequest: 'PASS 011 click_and_wait installed Computer Use reliability for The Foundry session lifecycle.',
      title: 'PASS 011 Semantic Stability',
    })), JSON.stringify(p011)),
    check('class_commander_website_visible', commanderBuild.classification === 'COMMANDER_REAL' && isCommanderVisibleMission(stub({
      userRequest: 'Build me a professional website for my box truck business.',
      title: 'Box truck website',
    })), JSON.stringify(commanderBuild)),
  ]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry mission visibility: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryMissionVisibilityValidation }
