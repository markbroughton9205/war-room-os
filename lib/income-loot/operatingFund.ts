export type SelfFundingReadiness = 'NO_REVENUE' | 'REVENUE_RECEIVED' | 'OPERATING_FUNDS_AVAILABLE' | 'COMMANDER_APPROVAL_REQUIRED'

export type OperatingFundState = {
  cashReceivedByCurrency: Record<string, number>
  operatingFundAllocationPercent: number
  operatingFundAvailableByCurrency: Record<string, number>
  selfFundingReadiness: SelfFundingReadiness
}

export const OPERATING_FUND_DEFAULT_ALLOCATION_PERCENT = 0

export function clampOperatingFundAllocationPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value === Number.POSITIVE_INFINITY) return 100
  if (value === Number.NEGATIVE_INFINITY) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

// Only CASH_RECEIVED funds the treasury; ESTIMATED and CONFIRMED-but-unreceived
// amounts never reach this function, so they cannot inflate operatingFundAvailableByCurrency.
// COMMANDER_APPROVAL_REQUIRED is reserved for a future spend-authorization phase and is
// never produced here: this phase is a non-spending readiness view only.
export function computeOperatingFundState(cashReceivedByCurrency: Record<string, number>, allocationPercentInput: number = OPERATING_FUND_DEFAULT_ALLOCATION_PERCENT): OperatingFundState {
  const operatingFundAllocationPercent = clampOperatingFundAllocationPercent(allocationPercentInput)
  const hasRevenue = Object.values(cashReceivedByCurrency).some(amount => Number.isFinite(amount) && amount > 0)
  const operatingFundAvailableByCurrency: Record<string, number> = {}
  for (const [currency, cashReceived] of Object.entries(cashReceivedByCurrency)) {
    if (!Number.isFinite(cashReceived) || cashReceived <= 0) continue
    const computed = Math.round(cashReceived * operatingFundAllocationPercent) / 100
    operatingFundAvailableByCurrency[currency] = Math.min(computed, cashReceived)
  }
  const hasAvailableFunds = Object.values(operatingFundAvailableByCurrency).some(amount => amount > 0)
  const selfFundingReadiness: SelfFundingReadiness = !hasRevenue ? 'NO_REVENUE' : hasAvailableFunds ? 'OPERATING_FUNDS_AVAILABLE' : 'REVENUE_RECEIVED'
  return { cashReceivedByCurrency, operatingFundAllocationPercent, operatingFundAvailableByCurrency, selfFundingReadiness }
}
