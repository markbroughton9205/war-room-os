/** Commander priorities injected into council research prompts (plain language). */
export const MARK_PRIORITY_KEYWORDS = [
  'cashflow',
  'Higher Vision Inc',
  'Broughton Transports',
  'War Room build',
  'Akron',
  'local Akron',
  'AI automation services',
  'family stability',
  'debt freedom',
] as const

export function buildPersonalizationBlock(): string {
  return [
    '### Commander priorities (filter findings through these lenses)',
    '- Personal and business cashflow — protect runway and payment timing.',
    '- Higher Vision Inc — revenue, contracts, and strategic positioning.',
    '- Broughton Transports — freight, logistics, fleet, and operational risk.',
    '- War Room build — engineering progress, reliability, and operator leverage.',
    '- Akron / Summit County local — weather, civic, business, and community signals when relevant.',
    '- AI automation services — sellable offers, delivery risk, and client pipeline.',
    '- Family stability and debt-freedom mission — life impact alongside money impact.',
    '- Do not force every answer onto these themes; use them when the evidence connects.',
  ].join('\n')
}
