import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { classifyCodeOperatorLifecycles, materializeVerifiedCodeOperatorRepair, verifySegmentedAudit } from './engine'
import type { AuditEvent } from './types'

const { check, finish } = createValidationHarness('Wave 4.1 deterministic validation', 7)
const make = (previousHash: string, message: string, repairId = 'r1'): AuditEvent => { const base = { at: '2026-08-30T00:00:00.000Z', actor: 'system', category: 'repo', message, metadata: { repairId }, previousHash }; return { ...base, hash: createHash('sha256').update(JSON.stringify(base)).digest('hex') } }
const first = make('GENESIS', 'native-builder: repair opened, collecting evidence')
const second = make(first.hash, 'native-builder: running validations')
const fork = make(first.hash, 'native-builder: commander accepted, marked resolved')

check('intact chain', () => { const result = verifySegmentedAudit([first, second]); assert.equal(result.corruptEvents, 0); assert.equal(result.legitimateSegmentBoundaries, 0) })
check('legitimate concurrent boundary', () => { const result = verifySegmentedAudit([first, second, fork]); assert.equal(result.legitimateSegmentBoundaries, 1); assert.equal(result.missingPredecessors, 0) })
check('true corruption', () => { const result = verifySegmentedAudit([{ ...first, message: 'tampered' }]); assert.equal(result.corruptEvents, 1) })
check('missing predecessor', () => { const result = verifySegmentedAudit([make('f'.repeat(64), 'x')]); assert.equal(result.missingPredecessors, 1) })
check('exclusive lifecycle priority', () => { const rows = classifyCodeOperatorLifecycles([first, second, fork]); assert.equal(rows.length, 1); assert.equal(rows[0].class, 'commander_resolved') })
check('narrative-only lifecycle excluded', () => { assert.equal(materializeVerifiedCodeOperatorRepair({ id: 'r1', issueId: 'i1', state: 'resolved', history: [], proposals: [], validationResults: [], autoRepairEligible: false, autoRepairMode: false, createdAt: first.at, updatedAt: first.at }, classifyCodeOperatorLifecycles([first, fork])[0], 'a'.repeat(64)), null) })
check('objective resolved lifecycle materializes', () => { const record = materializeVerifiedCodeOperatorRepair({ id: 'r1', issueId: 'i1', state: 'resolved', history: [], proposals: [], validationResults: [{ operation: { id: 'typecheck' }, ok: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, ranAt: first.at }], verification: { status: 'resolved', fingerprintRecurred: false, evidence: ['typecheck passed'], checkedAt: first.at }, diffEvidence: { diff: 'redacted', truncated: false, changedFiles: ['lib/a.ts'], diffHash: 'b'.repeat(64) }, autoRepairEligible: false, autoRepairMode: false, createdAt: first.at, updatedAt: first.at }, classifyCodeOperatorLifecycles([first, fork])[0], 'a'.repeat(64)); assert.ok(record); assert.equal(record.datasetRecord.wave3Eligible, true) })
finish()

