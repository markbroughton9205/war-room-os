import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { acceptanceBasis } from './foundryAcceptanceBasis'
import { parseVerificationProbe, VERIFICATION_PROBE_SCRIPT, verificationProbeFinding } from './foundryVerificationProbe'
const criterion = 'Round shipping fees up to the next whole euro'
const basis = acceptanceBasis({request: criterion, acceptance: [criterion], contracts: []})
const source = {file: 'rates.py', text: 'def fee(weight):\n    return int(2.5 + 1.2 * weight)\n', role: 'source' as const}
const p = {file: 'rates.py', function:'fee', args:[1.5], expected:5, criterion}
const parse = (x: unknown) => parseVerificationProbe('NOT_READY PROBE_JSON ' + JSON.stringify(x), basis, [source])
assert.deepEqual(parse(p), p)
for (const invalid of [{...p,file:'../rates.py'},{...p,file:'.env.py'},{...p,file:'/rates.py'},{...p,function:'__import__'},{...p,function:'fee()'},{...p,criterion:'unrequested behavior'},{...p,args:'code'}]) assert.equal(parse(invalid),null)
const root = mkdtempSync(path.join(tmpdir(),'foundry-verification-probe-'))
writeFileSync(path.join(root,'rates.py'),source.text)
function run() { const r=spawnSync('python3',['-c',VERIFICATION_PROBE_SCRIPT,JSON.stringify(p)],{cwd:root,encoding:'utf8',timeout:3000});return {code:r.status,stdout:r.stdout,stderr:r.stderr} }
const broken=verificationProbeFinding(p,run());assert.equal(broken?.confidenceClass,'DIRECTLY_PROVEN');assert.equal(broken?.actionability,'REPAIR')
writeFileSync(path.join(root,'rates.py'),'import math\ndef fee(weight):\n    return math.ceil(2.5 + 1.2 * weight)\n')
assert.equal(verificationProbeFinding(p,run()),null)
assert.equal(verificationProbeFinding(p,{code:null,stdout:'',stderr:'timeout'})?.confidenceClass,'PLAUSIBLE_NEEDS_PROBE')
console.log('VERIFICATION_PROBE_VALIDATION PASS 12/12')
