/**
 * Applies a proposal's structured patches, one file at a time, only after patchPolicy re-checks
 * pass here too (never trust the caller alone). Every write is preceded by a rollback snapshot,
 * and the whole proposal is applied transactionally: if any file in the batch fails, everything
 * already written in this run is reverted before returning.
 */
import { access, writeFile } from 'node:fs/promises'
import { constants as FsConstants } from 'node:fs'
import { createHash } from 'node:crypto'
import type { NativeRepairProposal, StructuredPatch } from './types'
import { validatePatchPolicy } from './patchPolicy'
import { assertCanonicalRepoPath, resolveRepoRelativePath, readRepoFile } from './repositoryInspector'
import { rollbackRepair, snapshotFileBeforePatch } from './rollback'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath, FsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export type PatchApplyFileOutcome = {
  file: string
  ok: boolean
  detail: string
}

export type PatchApplyResult = {
  ok: boolean
  outcomes: PatchApplyFileOutcome[]
  rolledBack: boolean
}

async function applyOnePatch(repairId: string, patch: StructuredPatch): Promise<PatchApplyFileOutcome> {
  const abs = resolveRepoRelativePath(patch.file)
  await assertCanonicalRepoPath(abs, patch.operation === 'create_file')

  if (patch.operation === 'create_file') {
    if (await fileExists(abs)) {
      return { file: patch.file, ok: false, detail: 'create_file refused: file already exists.' }
    }
    await snapshotFileBeforePatch(repairId, patch.file, null, false)
    await writeFile(abs, patch.newFileContent ?? '', 'utf8')
    return { file: patch.file, ok: true, detail: 'File created.' }
  }

  const current = await readRepoFile(patch.file)
  if (!current.ok) {
    return { file: patch.file, ok: false, detail: `Cannot read current file: ${current.error}` }
  }

  const currentHash = sha256(current.content)
  if (currentHash !== patch.expectedOriginalHash) {
    return {
      file: patch.file,
      ok: false,
      detail: 'Stale-file rejection: file content changed since the proposal was generated (hash mismatch). Re-plan against the current file.',
    }
  }

  const matchText = patch.matchText ?? ''
  const occurrences = current.content.split(matchText).length - 1
  if (occurrences !== 1) {
    return {
      file: patch.file,
      ok: false,
      detail: `Anchor text must appear exactly once; found ${occurrences}. Refusing an ambiguous or missing match.`,
    }
  }

  let nextContent: string
  if (patch.operation === 'replace_range') {
    nextContent = current.content.replace(matchText, patch.replacementText ?? '')
  } else if (patch.operation === 'insert_after') {
    nextContent = current.content.replace(matchText, `${matchText}${patch.replacementText ?? ''}`)
  } else {
    nextContent = current.content.replace(matchText, `${patch.replacementText ?? ''}${matchText}`)
  }

  await snapshotFileBeforePatch(repairId, patch.file, current.content, true)
  await writeFile(abs, nextContent, 'utf8')
  return { file: patch.file, ok: true, detail: `${patch.operation} applied.` }
}

/**
 * Applies every planned change in a proposal. Returns ok:false (with rolledBack:true) if any file
 * fails — nothing is left half-applied. Callers must already hold Commander approval; this
 * function does not itself gate on approval (the API route layer does, via
 * lib/permissions/policy.ts assertAutoOrApproval with actionKind 'file_modification').
 */
export async function applyProposal(repairId: string, proposal: NativeRepairProposal): Promise<PatchApplyResult> {
  const policy = validatePatchPolicy(proposal)
  if (!policy.ok) {
    return {
      ok: false,
      outcomes: policy.violations.map(v => ({ file: v.file ?? '(proposal)', ok: false, detail: `Policy violation [${v.rule}]: ${v.detail}` })),
      rolledBack: false,
    }
  }

  const outcomes: PatchApplyFileOutcome[] = []
  for (const change of proposal.plannedChanges) {
    const outcome = await applyOnePatch(repairId, change.patch)
    outcomes.push(outcome)
    if (!outcome.ok) {
      const rollback = await rollbackRepair(repairId)
      return {
        ok: false,
        outcomes,
        rolledBack: rollback.errors.length === 0,
      }
    }
  }

  return { ok: true, outcomes, rolledBack: false }
}
