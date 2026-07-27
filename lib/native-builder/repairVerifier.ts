/**
 * War Room must never mark an issue resolved because a patch was applied. Resolution requires
 * real evidence that (a) planned validations passed and (b) the original issue's fingerprint text
 * does not recur in that validation output. Anything short of that returns
 * 'partially_verified' or 'verification_blocked' — never 'resolved'.
 */
import type { NativeIssueRecord, NativeValidationResult, NativeVerificationResult } from './types'

function normalizeForRecurrenceCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,40}\b/g, '<hash>')
    .replace(/:\d+:\d+/g, ':<line>:<col>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A short, distinctive slice of the original issue text — long enough to be meaningful, short
 * enough to survive minor formatting drift between the original report and a re-run. */
function distinctiveFragment(issue: NativeIssueRecord): string {
  const normalized = normalizeForRecurrenceCheck(issue.rawEvidenceText)
  return normalized.slice(0, Math.min(120, normalized.length))
}

export function verifyIssueResolved(
  issue: NativeIssueRecord,
  validationResults: NativeValidationResult[],
): NativeVerificationResult {
  const checkedAt = new Date().toISOString()
  const evidence: string[] = []

  if (validationResults.length === 0) {
    return {
      status: 'verification_blocked',
      fingerprintRecurred: false,
      evidence: ['No validations were run — nothing to verify against.'],
      checkedAt,
    }
  }

  const allPassed = validationResults.every(r => r.ok)
  evidence.push(
    ...validationResults.map(
      r => `${r.operation.id}${r.operation.targets?.length ? ` (${r.operation.targets.join(', ')})` : ''}: ${r.ok ? 'PASS' : `FAIL (exit ${r.exitCode})`}`,
    ),
  )

  if (!allPassed) {
    return {
      status: 'verification_blocked',
      fingerprintRecurred: true,
      evidence: [...evidence, 'One or more planned validations failed — cannot claim resolution.'],
      checkedAt,
    }
  }

  const fragment = distinctiveFragment(issue)
  const combinedOutput = normalizeForRecurrenceCheck(
    validationResults.map(r => `${r.stdout}\n${r.stderr}`).join('\n'),
  )
  const recurred = fragment.length > 0 && combinedOutput.includes(fragment)

  if (recurred) {
    return {
      status: 'verification_blocked',
      fingerprintRecurred: true,
      evidence: [...evidence, 'Original issue fingerprint text still appears in post-patch validation output.'],
      checkedAt,
    }
  }

  // All planned validations passed and the original issue text is gone from their output — but if
  // no validation targeted the issue's own subsystem/source directly, be honest that this is
  // corroborating rather than a direct re-check of the original failure.
  const directRecheckRan = validationResults.some(r => isDirectRecheckFor(issue, r))

  return {
    status: directRecheckRan ? 'resolved' : 'partially_verified',
    fingerprintRecurred: false,
    evidence: [
      ...evidence,
      directRecheckRan
        ? 'A validation directly targeting this issue class ran clean and the original text did not recur.'
        : 'All validations passed and the original text did not recur, but no validation directly re-ran the exact original check — treat as partially verified.',
    ],
    checkedAt,
  }
}

/** A validation_script run is always a direct recheck — it's dedicated, pre-registered, targeted
 * verification, the strongest evidence type available, regardless of how the issue was
 * originally sourced (commander_report, system_health, etc. can all be proven by one). The
 * generic checks (typecheck/eslint/build) only count as direct for issues of their own class. */
function isDirectRecheckFor(issue: NativeIssueRecord, result: NativeValidationResult): boolean {
  if (result.operation.id === 'validation_script') return true
  switch (issue.source) {
    case 'typescript':
      return result.operation.id === 'typecheck'
    case 'eslint':
      return result.operation.id === 'eslint_targeted'
    case 'build':
      return result.operation.id === 'build'
    default:
      return false
  }
}
