import type {
  CompensationInput,
  FinancialAnalysisResult,
  KnownCostsInput,
  MoneyEstimate,
  NumberEstimate,
  TimeCommitmentInput,
} from './types'

const HOURS_PER_WEEK_STANDARD = 40
const WEEKS_PER_MONTH = 52 / 12
const WEEKS_PER_YEAR = 52

/**
 * Enforces `basis: 'UNKNOWN' ⇒ value: null` at the single construction
 * choke point. Without this, a contaminated-but-still-numeric input (e.g. a
 * caller tagging timeCommitment.basis 'UNKNOWN' while still supplying a real
 * totalHoursEstimate) could produce a MoneyEstimate carrying a concrete
 * dollar figure under an 'UNKNOWN' label — misleading, since the UI only
 * suppresses the number when `value === null`.
 */
function money(value: number | null, currency: string, basis: MoneyEstimate['basis'], notes: string | null = null): MoneyEstimate {
  if (basis === 'UNKNOWN' && value !== null) {
    return { value: null, currency, basis: 'UNKNOWN', notes: 'Value suppressed because a required input is unknown.' }
  }
  return { value, currency, basis, notes }
}

function unknownMoney(currency: string, notes: string): MoneyEstimate {
  return money(null, currency, 'UNKNOWN', notes)
}

function num(value: number | null, basis: NumberEstimate['basis'], notes: string | null = null): NumberEstimate {
  if (basis === 'UNKNOWN' && value !== null) {
    return { value: null, basis: 'UNKNOWN', notes: 'Value suppressed because a required input is unknown.' }
  }
  return { value, basis, notes }
}

/** Rejects invalid numeric input (negative or non-finite) rather than
 * fabricating a corrected value. Zero is always valid where the field allows
 * it. Returns the original value when valid, or `{ value: null, reason }`
 * when it had to be treated as unknown. */
function sanitizeAmount(value: number | null, label: string): { value: number | null; reason: string | null } {
  if (value === null) return { value: null, reason: null }
  if (!Number.isFinite(value)) return { value: null, reason: `${label} is not a finite number; treated as unknown rather than fabricating a corrected value.` }
  if (value < 0) return { value: null, reason: `${label} was negative; treated as unknown rather than fabricating a corrected value.` }
  return { value, reason: null }
}

function sanitizeCompensation(input: CompensationInput): CompensationInput {
  // A caller can legally submit basis:'UNKNOWN' alongside a concrete amount
  // (nothing in the request validator rejects that combination — the two
  // fields are independently type-checked). Enforce the same invariant here,
  // at the source, that money()/num() enforce for everything DERIVED from
  // compensation: basis 'UNKNOWN' must never carry a displayable number. This
  // is what protects `card.compensation`/`card.compensationBasis` in
  // readinessEngine.ts, which echo this object directly rather than
  // constructing it through money().
  if (input.basis === 'UNKNOWN' && input.amount !== null) {
    return { ...input, amount: null, notes: 'Compensation basis is UNKNOWN, so the supplied amount was suppressed rather than shown as if it were meaningful.' }
  }
  const amount = sanitizeAmount(input.amount, 'Compensation amount')
  if (!amount.reason) return input
  return { ...input, amount: amount.value, notes: amount.reason }
}

function sanitizeTimeCommitment(input: TimeCommitmentInput): TimeCommitmentInput {
  const hoursPerWeek = sanitizeAmount(input.hoursPerWeek, 'Hours per week')
  const totalHoursEstimate = sanitizeAmount(input.totalHoursEstimate, 'Total hours estimate')
  if (!hoursPerWeek.reason && !totalHoursEstimate.reason) return input
  const notes = [hoursPerWeek.reason, totalHoursEstimate.reason].filter((n): n is string => n !== null).join(' ')
  return { ...input, hoursPerWeek: hoursPerWeek.value, totalHoursEstimate: totalHoursEstimate.value, notes }
}

function sanitizeKnownCosts(input: KnownCostsInput | null | undefined): KnownCostsInput | null | undefined {
  if (!input) return input
  const travelCost = sanitizeAmount(input.travelCost, 'Travel cost')
  const equipmentCost = sanitizeAmount(input.equipmentCost, 'Equipment cost')
  const fees = sanitizeAmount(input.fees, 'Fees')
  if (!travelCost.reason && !equipmentCost.reason && !fees.reason) return input
  const notes = [travelCost.reason, equipmentCost.reason, fees.reason].filter((n): n is string => n !== null).join(' ')
  return { ...input, travelCost: travelCost.value, equipmentCost: equipmentCost.value, fees: fees.value, notes }
}

/** ESTIMATED is contagious: any input that is not CONFIRMED downgrades the result. */
function combineBasis(...bases: MoneyEstimate['basis'][]): MoneyEstimate['basis'] {
  if (bases.some(basis => basis === 'UNKNOWN')) return 'UNKNOWN'
  if (bases.some(basis => basis === 'ESTIMATED')) return 'ESTIMATED'
  return 'CONFIRMED'
}

function estimateTotalHours(timeCommitment: TimeCommitmentInput, compensation: CompensationInput): NumberEstimate {
  if (compensation.per === 'flat_total' || compensation.per === 'per_task') {
    if (timeCommitment.totalHoursEstimate !== null) {
      return num(timeCommitment.totalHoursEstimate, timeCommitment.basis, 'Total hours for a flat/per-task engagement.')
    }
    return num(null, 'UNKNOWN', 'Total hours were not supplied for this flat/per-task engagement.')
  }
  if (timeCommitment.hoursPerWeek !== null) {
    return num(timeCommitment.hoursPerWeek, timeCommitment.basis, 'Hours per week.')
  }
  return num(null, 'UNKNOWN', 'Weekly hours were not supplied.')
}

function hourlyFromCompensation(compensation: CompensationInput, timeCommitment: TimeCommitmentInput): MoneyEstimate {
  const { amount, currency, basis, per } = compensation
  if (amount === null || basis === 'UNKNOWN') return unknownMoney(currency, 'Compensation amount is unknown — no hourly figure was calculated.')

  if (per === 'hour') return money(amount, currency, basis)

  if (per === 'flat_total' || per === 'per_task') {
    if (timeCommitment.totalHoursEstimate === null || timeCommitment.totalHoursEstimate <= 0) {
      return unknownMoney(currency, 'Total hours were not supplied, so an hourly equivalent could not be calculated from this flat amount.')
    }
    return money(amount / timeCommitment.totalHoursEstimate, currency, combineBasis(basis, timeCommitment.basis))
  }

  if (per === 'day') {
    // Hourly equivalent from a day rate requires knowing hours-per-day, which is not
    // collected as a distinct field; leave unknown rather than assume an 8-hour day.
    return unknownMoney(currency, 'Day-rate compensation was supplied without hours-per-day, so an hourly equivalent was not assumed.')
  }

  if (per === 'week') {
    if (timeCommitment.hoursPerWeek === null || timeCommitment.hoursPerWeek <= 0) {
      return unknownMoney(currency, 'Weekly hours were not supplied, so an hourly equivalent could not be calculated from this weekly amount.')
    }
    return money(amount / timeCommitment.hoursPerWeek, currency, combineBasis(basis, timeCommitment.basis))
  }

  if (per === 'month' || per === 'year' || per === 'points') {
    return unknownMoney(currency, `Compensation is denominated per ${per === 'points' ? 'points/rewards' : per}; an hourly equivalent requires additional time-commitment detail not supplied.`)
  }

  return unknownMoney(currency, 'Unrecognized compensation unit.')
}

function scaleFromHourly(hourly: MoneyEstimate, hoursInPeriod: number | null, periodBasis: NumberEstimate['basis'], label: string): MoneyEstimate {
  if (hourly.value === null || hoursInPeriod === null) return unknownMoney(hourly.currency, `Insufficient data to calculate a ${label} equivalent.`)
  return money(hourly.value * hoursInPeriod, hourly.currency, combineBasis(hourly.basis, periodBasis))
}

function directPeriodValue(compensation: CompensationInput, per: CompensationInput['per']): MoneyEstimate | null {
  if (compensation.per !== per) return null
  if (compensation.amount === null || compensation.basis === 'UNKNOWN') return unknownMoney(compensation.currency, `Compensation amount is unknown.`)
  return money(compensation.amount, compensation.currency, compensation.basis)
}

export function analyzeFinancials(
  compensationRaw: CompensationInput,
  timeCommitmentRaw: TimeCommitmentInput,
  knownCostsRaw?: KnownCostsInput | null,
): FinancialAnalysisResult {
  // Reject invalid numeric input (negative/non-finite) up front rather than
  // letting it silently propagate as a "CONFIRMED" negative dollar figure —
  // every downstream calculation already treats a null field as unknown, so
  // sanitizing here is sufficient without touching the arithmetic below.
  const compensation = sanitizeCompensation(compensationRaw)
  const timeCommitment = sanitizeTimeCommitment(timeCommitmentRaw)
  const knownCosts = sanitizeKnownCosts(knownCostsRaw)

  const hourlyEquivalent = hourlyFromCompensation(compensation, timeCommitment)

  const dailyDirect = directPeriodValue(compensation, 'day')
  const dailyEquivalent = dailyDirect ?? unknownMoney(compensation.currency, 'A daily equivalent requires an hourly rate and hours-per-day, which were not supplied.')

  const weeklyDirect = directPeriodValue(compensation, 'week')
  const weeklyEquivalent = weeklyDirect
    ?? scaleFromHourly(hourlyEquivalent, timeCommitment.hoursPerWeek, timeCommitment.basis, 'weekly')

  const monthlyDirect = directPeriodValue(compensation, 'month')
  const monthlyFromWeekly = weeklyEquivalent.value !== null
    ? money(weeklyEquivalent.value * WEEKS_PER_MONTH, weeklyEquivalent.currency, weeklyEquivalent.basis)
    : unknownMoney(compensation.currency, 'A monthly equivalent requires a confirmed or estimated weekly value.')
  const monthlyEquivalent = monthlyDirect ?? monthlyFromWeekly

  const annualDirect = directPeriodValue(compensation, 'year')
  const annualFromWeekly = weeklyEquivalent.value !== null
    ? money(weeklyEquivalent.value * WEEKS_PER_YEAR, weeklyEquivalent.currency, weeklyEquivalent.basis)
    : unknownMoney(compensation.currency, 'An annualized equivalent requires a confirmed or estimated weekly value.')
  const annualizedEquivalent = annualDirect ?? annualFromWeekly

  const estimatedTotalTimeCommitmentHours = estimateTotalHours(timeCommitment, compensation)

  let grossOpportunityValue: MoneyEstimate
  if (compensation.per === 'flat_total' || compensation.per === 'per_task') {
    grossOpportunityValue = compensation.amount !== null && compensation.basis !== 'UNKNOWN'
      ? money(compensation.amount, compensation.currency, compensation.basis)
      : unknownMoney(compensation.currency, 'Flat compensation amount is unknown.')
  } else if (hourlyEquivalent.value !== null && estimatedTotalTimeCommitmentHours.value !== null) {
    grossOpportunityValue = money(
      hourlyEquivalent.value * estimatedTotalTimeCommitmentHours.value,
      hourlyEquivalent.currency,
      combineBasis(hourlyEquivalent.basis, estimatedTotalTimeCommitmentHours.basis),
      'Gross value estimated from hourly equivalent × supplied total hours.',
    )
  } else {
    grossOpportunityValue = unknownMoney(compensation.currency, 'Not enough information to compute a gross opportunity value.')
  }

  let knownCostsTotal: MoneyEstimate
  if (!knownCosts) {
    knownCostsTotal = money(0, compensation.currency, 'CONFIRMED', 'No costs were supplied.')
  } else {
    const parts = [knownCosts.travelCost, knownCosts.equipmentCost, knownCosts.fees]
    if (parts.every(part => part === null)) {
      knownCostsTotal = money(0, knownCosts.currency, 'CONFIRMED', 'No costs were supplied.')
    } else {
      const total = parts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
      knownCostsTotal = money(total, knownCosts.currency, knownCosts.basis)
    }
  }

  const expectedNetValue = grossOpportunityValue.value !== null
    ? money(
      grossOpportunityValue.value - (knownCostsTotal.value ?? 0),
      grossOpportunityValue.currency,
      combineBasis(grossOpportunityValue.basis, knownCostsTotal.basis),
    )
    : unknownMoney(compensation.currency, 'Net value requires a known gross opportunity value.')

  const effectiveHourlyReturn = expectedNetValue.value !== null && estimatedTotalTimeCommitmentHours.value !== null && estimatedTotalTimeCommitmentHours.value > 0
    ? money(
      expectedNetValue.value / estimatedTotalTimeCommitmentHours.value,
      expectedNetValue.currency,
      combineBasis(expectedNetValue.basis, estimatedTotalTimeCommitmentHours.basis),
    )
    : unknownMoney(compensation.currency, 'Effective hourly return requires both a net value and a known time commitment.')

  return {
    compensation,
    hourlyEquivalent,
    dailyEquivalent,
    weeklyEquivalent,
    monthlyEquivalent,
    annualizedEquivalent,
    grossOpportunityValue,
    knownCosts: knownCostsTotal,
    expectedNetValue,
    estimatedTotalTimeCommitmentHours,
    effectiveHourlyReturn,
  }
}

export const __constants = { HOURS_PER_WEEK_STANDARD, WEEKS_PER_MONTH, WEEKS_PER_YEAR }
