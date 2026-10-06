import assert from 'node:assert/strict'
import { keyFailureLine } from './foundryLargeProject'
const output = `ERROR: test_helper (unittest.loader._FailedTest.test_helper)
ImportError: Failed to import test module: test_helper
Traceback (most recent call last):
  File "receipts.py", line 1, in <module>
    from contract import ACCEPTANCE_RECEIPT, receipt_id
ImportError: cannot import name 'receipt_id' from 'contract' (contract.py)`
assert.equal(keyFailureLine(output), "ImportError: cannot import name 'receipt_id' from 'contract' (contract.py)")
assert.equal(keyFailureLine('ImportError: Failed to import test module: test_helper'), 'ImportError: Failed to import test module: test_helper')
assert.equal(keyFailureLine('ModuleNotFoundError: No module named xyz'), 'ModuleNotFoundError: No module named xyz')
assert.equal(keyFailureLine('AssertionError: 4 != 5'), 'AssertionError: 4 != 5')
console.log('FAILURE_EVIDENCE_VALIDATION PASS 4/4')

const { emptyEngineeringCampaign } = await import('./foundryEngineeringCampaign')
const { specialistRequestFromCampaign, promptFor } = await import('./foundryEngineeringSpecialist')
const campaign = emptyEngineeringCampaign('Add receipt_id and preserve helper')
campaign.reworkOrigin = 'TEST'
campaign.knowledge.failures = ["integration defect ImportError: cannot import name 'receipt_id' from 'contract'"]
campaign.repairFinding = 'HYPOTHESIS: a missing name needs an import'
const request = specialistRequestFromCampaign({campaign, taskId:'backend', role:'BACKEND',purpose:'repair',acceptance:campaign.request,workingSet:['receipts.py'],excerpts:[],needsEdit:true,attempt:1,generalMode:true})
assert.match(request.failureEvidence[0], /cannot import name/)
assert.match(promptFor(request), /Remove an import only when FAILURE proves it invalid/)
campaign.reworkOrigin = 'REVIEW'
const reviewed = specialistRequestFromCampaign({campaign, taskId:'backend', role:'BACKEND',purpose:'repair',acceptance:campaign.request,workingSet:['receipts.py'],excerpts:[],needsEdit:true,attempt:1,generalMode:true})
assert.ok(!reviewed.failureEvidence.some(item => item.startsWith('integration defect')), 'A later review must not inherit an old test failure')
console.log('FAILURE_EVIDENCE_HANDOFF_VALIDATION PASS 3/3')

assert.equal(keyFailureLine('ImportError: Failed to import test module: test_ui\n  File "/tmp/project/frontend/board.py", line 5\n    return rows, status=status\nSyntaxError: invalid syntax'), 'SyntaxError: invalid syntax at frontend/board.py:5: return rows, status=status')
console.log('SYNTAX_FAILURE_LOCATION_VALIDATION PASS 1/1')
