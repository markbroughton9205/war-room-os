import assert from 'node:assert/strict'
import {criterionEvidenced} from './foundrySelfReview'
const check=(text:string)=>criterionEvidenced('the UI function forwards status',[{file:'frontend/board.py',text,role:'source'}],['frontend/board.py'])
assert.ok(check('def show_board(rows, status=None):\n    rows = list_projects(rows, status=status)\n    return rows').evidenced)
assert.ok(!check('def show_board(rows, status=None):\n    rows = list_projects(rows)\n    return rows').evidenced)
assert.ok(!check('def show_board(rows, status=None):\n    # list_projects(rows, status=status)\n    return rows').evidenced)
assert.ok(!check('def show_board(rows, status=None):\n    rows = list_projects(rows, status="open")\n    return rows').evidenced)
console.log('FORWARDING_EVIDENCE_VALIDATION PASS 4/4')
