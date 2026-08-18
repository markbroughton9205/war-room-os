import type { NormalizedOpportunityInput, ProviderQuestion } from './types'
import { normalizeCategory } from './requirementMatcher'

/** Generates questions to ask the provider/employer wherever the normalized
 * opportunity data leaves a field missing or ambiguous. Never invents a
 * provider answer — only surfaces what to ask. */
export function buildProviderQuestions(opportunity: NormalizedOpportunityInput): ProviderQuestion[] {
  const questions: ProviderQuestion[] = []
  const add = (fieldMissing: string, question: string) => questions.push({ id: `pq-${questions.length + 1}`, question, fieldMissing })

  if (opportunity.compensation.basis === 'UNKNOWN' || opportunity.compensation.amount === null) {
    add('compensation', 'What is the confirmed starting pay or reward amount?')
  }
  if (opportunity.trainingPaid === undefined || opportunity.trainingPaid === 'unknown') {
    add('trainingPaid', 'Is training paid?')
  }
  if (opportunity.scheduleFixed === undefined || opportunity.scheduleFixed === 'unknown') {
    add('scheduleFixed', 'Is the listed schedule fixed, or is there flexibility?')
  }
  if (opportunity.equipmentProvided === undefined || opportunity.equipmentProvided === 'unknown') {
    add('equipmentProvided', 'Is required equipment provided, or must it be supplied by the worker?')
  }
  if (!opportunity.knownCosts || opportunity.knownCosts.travelCost === null) {
    add('travelReimbursement', 'Is travel reimbursed?')
  }
  if (!opportunity.paymentMethodKnown) {
    add('paymentMethod', 'How is payment issued, and when is payment expected?')
  }
  if (opportunity.requirements.some(requirement => {
    const category = normalizeCategory(requirement.category)
    return category === 'certification' || category === 'license'
  })) {
    add('credentialTiming', 'Is certification/licensing required before hire, or is it provided/trained after hire?')
  }
  if (!opportunity.employmentClassification || opportunity.employmentClassification === 'unknown') {
    add('employmentClassification', 'Is this W-2, 1099, stipend, reward, or points-based compensation?')
  }
  if (!opportunity.deadline) {
    add('deadline', 'Is there an application deadline or participation window?')
  }

  return questions
}
