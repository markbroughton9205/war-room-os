import type { Benefit, BenefitType } from './corroborationTypes'

function amountFrom(text: string): number | null {
  const match = text.match(/\$\s*([\d,.]+)\s*(million|billion|m|b)?/i)
  if (!match) return null
  const base = Number(match[1].replaceAll(',', ''))
  if (!Number.isFinite(base)) return null
  const suffix = match[2]?.toLowerCase()
  return base * (suffix === 'million' || suffix === 'm' ? 1_000_000 : suffix === 'billion' || suffix === 'b' ? 1_000_000_000 : 1)
}

export function parseBenefit(text: string | null | undefined): Benefit {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim()
  const lower = normalized.toLowerCase()
  let type: BenefitType = 'UNKNOWN'
  if (/tier|alternative cash|different (?:payment|benefit)|\bor\s+\$/.test(lower)) type = 'TIERED'
  else if (/reimburse|documented loss|out-of-pocket/.test(lower)) type = 'REIMBURSEMENT'
  else if (/pro[ -]?rata|share of (?:the )?(?:net )?(?:settlement )?fund/.test(lower)) type = 'PRO_RATA'
  else if (/up to|maximum|capped at/.test(lower)) type = 'UP_TO'
  else if (/\$\s*[\d,.]+/.test(normalized)) type = 'FIXED'
  return {
    type,
    amount: type === 'PRO_RATA' || type === 'UNKNOWN' || type === 'TIERED' ? null : amountFrom(normalized),
    currency: /\$/.test(normalized) ? 'USD' : null,
    text: normalized || 'Benefit not stated.',
    proRata: type === 'PRO_RATA' ? { numerator: null, denominator: null, netFundAmount: null } : null,
    tiers: type === 'TIERED' ? [] : null,
  }
}
