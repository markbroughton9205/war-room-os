/** Literal source round-trip tests for the real patch engine; not application acceptance. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { runWithWorkspaceRoot } from '../repo/workspaceContext'
import { applyProposal } from './patchApplier'
import type { NativeRepairProposal, StructuredPatch } from './types'

for (const operation of ['replace_range', 'insert_before', 'insert_after'] as const) {
  test(`${operation} preserves JavaScript replacement metacharacters literally`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'foundry-literal-patch-'))
    try {
      await runWithWorkspaceRoot(root, async () => {
        const content = 'before\n// anchor\nafter\n'
        const replacement = JSON.stringify(["$&", "$`", "$'", '$$'])
        await writeFile(path.join(root, 'source.mjs'), content)
        const patch: StructuredPatch = { operation, file: 'source.mjs', expectedOriginalHash: createHash('sha256').update(content).digest('hex'), matchText: '// anchor', replacementText: replacement }
        const proposal: NativeRepairProposal = { issueId: 'literal-source', sourceKind: 'deterministic', proposerId: 'literal-source', diagnosis: 'Preserve exact source bytes.', confidence: 'high', relevantFiles: ['source.mjs'], plannedChanges: [{ file: 'source.mjs', reason: 'Literal source', operation, patch }], validations: [], risks: [], rollbackPlan: 'Snapshot restore', generatedAt: new Date().toISOString() }
        const result = await applyProposal(randomUUID(), proposal)
        assert.equal(result.ok, true, JSON.stringify(result))
        const expectedMiddle = operation === 'replace_range' ? replacement : operation === 'insert_before' ? replacement + '// anchor' : '// anchor' + replacement
        assert.equal(await readFile(path.join(root, 'source.mjs'), 'utf8'), 'before\n' + expectedMiddle + '\nafter\n')
      })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
