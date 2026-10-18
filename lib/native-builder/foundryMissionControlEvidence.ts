import type { McInput, McView } from './foundryMissionControlTypes';

export function describeEvidence(evidence: McInput['evidence']): McView['evidence'] {
  const grouped = evidence.reduce((acc, record) => {
    if (!acc[record.criterion]) {
      acc[record.criterion] = [];
    }
    acc[record.criterion].push(record);
    return acc;
  }, {} as Record<string, (typeof evidence)[number][]>);

  const result: McView['evidence'] = [];

  for (const [criterion, records] of Object.entries(grouped)) {
    const currentRecord = records.find((record: { status: string }) => record.status === 'CURRENT');
     const staleRecords = records.filter((record: { status: string }) => record.status === 'STALE');

    if (currentRecord) {
      let status: McView['evidence'][0]['status'] = 'CURRENT';
      let label: McView['evidence'][0]['label'] = 'Accepted - current';
      let tone: McView['evidence'][0]['tone'] = 'ok';

      if (staleRecords.length > 0) {
        status = 'REVERIFIED';
        label = 'Re-verified after a change';
        tone = 'ok';
      }

      result.push({
        criterion,
        proof: currentRecord.source,
        status,
        label,
        tone,
      });
    } else if (staleRecords.length > 0) {
      const firstStaleBecause = staleRecords[0].staleBecause[0];
      let fileSource = 'a source file';

      if (firstStaleBecause) {
        const lastPathSegment = firstStaleBecause.split('/').pop();
        fileSource = lastPathSegment || 'a source file';
      }

      result.push({
        criterion,
        proof: staleRecords[0].source,
        status: 'STALE',
        label: `Stale - ${fileSource} changed; needs re-verification`,
        tone: 'bad',
      });
    }
  }

  return result.sort((a, b) => a.criterion.localeCompare(b.criterion));
}
