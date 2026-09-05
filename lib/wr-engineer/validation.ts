/**
 * WR-Engineer validation boundary.
 *
 * Pure delegation to lib/native-builder/validationRunner.ts — the repo's one and only
 * process-execution path, which only ever runs fixed, pre-registered argv arrays via execFile
 * (never a shell string; see that file's header). WR-Engineer does not introduce a second
 * process-execution mechanism and cannot run arbitrary commands: only the operation ids already
 * defined in lib/native-builder/types.ts's NativeValidationOperationId are reachable here
 * (typecheck, eslint_targeted, build, validation_script, git_diff_check).
 *
 * Covers mission brief items:
 *   3. Terminal execution (bounded command execution, stdout/stderr capture, exit status) — bounded
 *      to the same fixed, allow-listed operation set native-builder itself is bounded to.
 *   5. Validation (tests, lint, typecheck, build command abstraction)
 */
import { runValidationOperation } from '@/lib/native-builder/validationRunner'
import type { NativeValidationOperation, NativeValidationResult } from '@/lib/native-builder/types'

export type { NativeValidationOperation, NativeValidationResult }

export async function runTypecheck(): Promise<NativeValidationResult> {
  return runValidationOperation({ id: 'typecheck' })
}

export async function runEslintTargeted(targets: string[]): Promise<NativeValidationResult> {
  return runValidationOperation({ id: 'eslint_targeted', targets })
}

export async function runBuild(): Promise<NativeValidationResult> {
  return runValidationOperation({ id: 'build' })
}

/** `target` must be a pre-registered scripts/run-*.mjs path — validationRunner.ts rejects anything
 * else before it ever reaches execFile. This is War Room's existing test-script convention (no
 * Jest/Vitest in this repo — see CLAUDE.md). */
export async function runValidationScript(target: string): Promise<NativeValidationResult> {
  return runValidationOperation({ id: 'validation_script', targets: [target] })
}

export async function runGitDiffCheck(): Promise<NativeValidationResult> {
  return runValidationOperation({ id: 'git_diff_check' })
}

/** Generic escape hatch for a caller that already has a NativeValidationOperation in hand (e.g.
 * from a proposal's `validations` list) — still bounded to the same allow-listed operation set. */
export async function runValidation(operation: NativeValidationOperation): Promise<NativeValidationResult> {
  return runValidationOperation(operation)
}
