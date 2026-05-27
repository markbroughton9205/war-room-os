/**
 * First income move — static local playbook (no providers, no network).
 */

export type RevenueStarterPlaybook = {
  offerTitle: string
  whoToTarget: string
  whatToSay: string
  setupCost: string
  pricing: string
  firstManualStep: string
  summary: string
}

export const FIRST_INCOME_MOVE_PLAYBOOK: RevenueStarterPlaybook = {
  offerTitle: 'AI missed-call recovery for local service businesses',
  whoToTarget:
    'Owner-operated trades and services (HVAC, plumbing, landscaping, cleaning) who miss calls during jobs and lose booked estimates.',
  whatToSay:
    '“When you miss a call, I set up a simple text-back within one minute that asks what they need and offers two times to book. You only pay if people actually reply and book.”',
  setupCost: 'About $0–$50 if you already have a business phone and a free form tool; no paid ads required for the first test.',
  pricing: 'Start at $199 setup plus $99/month, or $49/week pilot for two weeks with one location.',
  firstManualStep:
    'Pick one local business you already know. Call them, ask how many calls they miss per week, and offer to draft three text replies they can paste manually after a missed call.',
  summary:
    'Local proof before automation: one friendly business, three text templates, track replies in a spreadsheet for one week.',
}

export function formatRevenueStarterCard(playbook: RevenueStarterPlaybook = FIRST_INCOME_MOVE_PLAYBOOK): string {
  return [
    playbook.offerTitle,
    '',
    `Who to target: ${playbook.whoToTarget}`,
    '',
    `What to say: ${playbook.whatToSay}`,
    '',
    `Setup cost: ${playbook.setupCost}`,
    '',
    `Pricing: ${playbook.pricing}`,
    '',
    `First manual step: ${playbook.firstManualStep}`,
  ].join('\n')
}
