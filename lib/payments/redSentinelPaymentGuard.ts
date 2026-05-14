import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { DepositRecord, PaymentGuardFinding } from './types'

function finding(
  id: string,
  severity: PaymentGuardFinding['severity'],
  kind: string,
  message: string,
  blocksConfirmation: boolean,
  depositId?: string,
): PaymentGuardFinding {
  return { id, severity, kind, message, blocksConfirmation, depositId }
}

export function scanDepositRecords(deposits: DepositRecord[]): PaymentGuardFinding[] {
  const findings: PaymentGuardFinding[] = []
  const seen = new Map<string, string>()

  for (const deposit of deposits) {
    const duplicateKey = `${deposit.opportunityId ?? 'none'}:${deposit.platformProvider}:${deposit.expectedAmount ?? 'unknown'}:${deposit.currency}`
    const first = seen.get(duplicateKey)
    if (first) {
      findings.push(finding(
        `duplicate-${deposit.depositId}`,
        'error',
        'duplicate_deposit_record',
        'Possible duplicate deposit record for the same opportunity, provider, amount, and currency.',
        true,
        deposit.depositId,
      ))
    } else {
      seen.set(duplicateKey, deposit.depositId)
    }

    if (deposit.proofRequired && deposit.proofStatus === 'required') {
      findings.push(finding(
        `missing-proof-${deposit.depositId}`,
        'warn',
        'missing_proof',
        'Proof is required before this deposit can be confirmed.',
        false,
        deposit.depositId,
      ))
    }

    if (
      deposit.depositStatus === 'confirmed'
      && deposit.proofRequired
      && deposit.proofStatus !== 'submitted'
      && deposit.proofStatus !== 'verified'
    ) {
      findings.push(finding(
        `confirmed-without-proof-${deposit.depositId}`,
        'critical',
        'confirmed_without_proof',
        'Confirmed deposit is missing verified proof or manual confirmation.',
        true,
        deposit.depositId,
      ))
    }

    if (/destination|external|unknown account/i.test(deposit.payerPlatformName)) {
      findings.push(finding(
        `destination-label-${deposit.depositId}`,
        'error',
        'unexpected_destination_label',
        'Deposit record contains an unexpected payout destination label.',
        true,
        deposit.depositId,
      ))
    }
  }

  return findings
}

async function walkApiRoutes(root: string, files: string[]) {
  let entries: string[] = []
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry)
    const st = await stat(full).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) {
      await walkApiRoutes(full, files)
    } else if (/route\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(full)
    }
  }
}

export async function scanPaymentCodePaths(cwd: string): Promise<PaymentGuardFinding[]> {
  const files: string[] = []
  await walkApiRoutes(path.join(cwd, 'app', 'api'), files)
  const findings: PaymentGuardFinding[] = []
  const forbidden = [
    { pattern: /\bwithdraw(al)?\b/i, kind: 'withdrawal_code_path' },
    { pattern: /\bsend[-_\s]?money\b/i, kind: 'send_money_code_path' },
    { pattern: /\boutbound[-_\s]?transfer\b/i, kind: 'outbound_transfer_code_path' },
  ]

  for (const file of files) {
    const content = await readFile(file, 'utf8').catch(() => '')
    for (const item of forbidden) {
      if (!item.pattern.test(content)) continue
      findings.push(finding(
        `${item.kind}-${path.relative(cwd, file).replace(/[^a-z0-9]+/gi, '-')}`,
        'critical',
        item.kind,
        `Forbidden payment movement wording found in API route ${path.relative(cwd, file)}.`,
        true,
      ))
    }
  }

  return findings
}

export async function runPaymentGuard(deposits: DepositRecord[], cwd = process.cwd()) {
  const recordFindings = scanDepositRecords(deposits)
  const codeFindings = await scanPaymentCodePaths(cwd)
  const findings = [...recordFindings, ...codeFindings]
  return {
    status: findings.some(item => item.severity === 'critical') ? 'blocked' : findings.length ? 'review' : 'clear',
    findings,
    blocksConfirmation: findings.some(item => item.blocksConfirmation && item.severity === 'critical'),
  }
}
