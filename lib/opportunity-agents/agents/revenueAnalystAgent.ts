import type { OpportunityRecord, RevenueAnalysis, RevenueFigure } from '../types'
import { appendAudit } from '../store'

function estimated(amount: number | null, notes: string): RevenueFigure {
  return { amount, currency: 'USD', basis: 'estimate', notes }
}

function multiply(amount: number | null, factor: number): number | null {
  return amount === null ? null : Math.round(amount * factor * 100) / 100
}

export function analyzeOpportunityRevenue(record: OpportunityRecord): RevenueAnalysis {
  const sourceAmount = record.opportunityValue?.amount ?? null
  const estimatedRevenue = record.opportunityValue
    ? { ...record.opportunityValue, basis: record.opportunityValue.basis }
    : estimated(sourceAmount, 'No source payout amount found; revenue remains an estimate pending sourced proof.')
  const costAmount = sourceAmount === null ? null : Math.max(0, Math.round(sourceAmount * 0.18 * 100) / 100)
  const estimatedCosts = estimated(costAmount, 'Estimated direct costs only; no spend is authorized by this package.')
  const estimatedProfit = estimated(
    sourceAmount === null || costAmount === null ? null : Math.round((sourceAmount - costAmount) * 100) / 100,
    'Estimated profit = estimated revenue minus estimated direct costs; not confirmed income.',
  )
  const upfrontCashRequired = estimated(
    record.category === 'transportation_delivery' ? multiply(sourceAmount, 0.08) : 0,
    'Estimated upfront cash requirement; no payment or purchase is authorized.',
  )
  const paymentTerms = record.paymentTerms ?? 'Payment terms not confirmed from source.'
  const timeToRevenue = record.timeToRevenue ?? 'Unknown until Commander approves pursuit and source confirms terms.'
  const facts = [
    `Source: ${record.source}`,
    `Evidence status: ${record.evidenceStatus}`,
    `Freshness status: ${record.freshnessStatus}`,
  ]
  if (record.opportunityValue) facts.push(`Source payout statement: ${record.opportunityValue.notes}`)
  const estimates = [
    'Estimated costs are planning estimates only.',
    'Estimated profit is not actual revenue.',
    'Actual revenue remains null until independent proof is recorded.',
  ]

  record.estimatedRevenue = estimatedRevenue
  record.estimatedCosts = estimatedCosts
  record.estimatedMargin = estimatedProfit
  record.upfrontCashRequired = upfrontCashRequired
  record.paymentTerms = paymentTerms
  record.timeToRevenue = timeToRevenue
  if (!record.assignedAgents.includes('revenue_analyst')) record.assignedAgents.push('revenue_analyst')
  appendAudit(record.id, {
    actor: 'revenue',
    fromStatus: record.status,
    toStatus: record.status,
    message: 'Revenue analysis completed with estimated and actual values kept separate.',
  })

  return {
    opportunityId: record.id,
    estimatedRevenue,
    estimatedCosts,
    estimatedProfit,
    upfrontCashRequired,
    paymentTerms,
    timeToRevenue,
    facts,
    estimates,
  }
}
