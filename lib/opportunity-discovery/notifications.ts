import type { DiscoveryOpportunity } from './types'

export function buildDiscoveryNotification(record: DiscoveryOpportunity): string {
  const compensation = record.compensation ? `Compensation: ${record.currency ?? 'currency unknown'} ${record.compensation.minimum ?? '?'}–${record.compensation.maximum ?? '?'}` : 'Compensation: not provided'
  return [
    'WAR ROOM — NEW TECHNICAL OPPORTUNITY', record.title,
    `Organization: ${record.organization ?? 'not provided'}`,
    `Source: ${record.attribution}`,
    `Location/remote: ${record.remoteStatus}${record.location ? ` — ${record.location}` : ''}`,
    compensation,
    `Deadline: ${record.deadline ?? 'not provided'}`,
    `Matched because: ${record.matchReasons.join(', ')}`,
    `Official source: ${record.officialUrl ?? 'not provided'}`,
    'DISCOVERY ONLY — NO APPLICATION OR SUBMISSION WAS PERFORMED.',
  ].join('\n')
}
