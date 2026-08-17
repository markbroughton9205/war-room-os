import { clinicalTrialsGovAdapter, discoverLiveIncomeSource } from '../lib/income-loot/liveSources.ts'

const { result, opportunities } = await discoverLiveIncomeSource('live-validation', clinicalTrialsGovAdapter)
console.log(JSON.stringify({
  provider: clinicalTrialsGovAdapter.source.providerName,
  sourceId: result.sourceId,
  endpointClass: 'public documented REST API',
  credentialRequired: clinicalTrialsGovAdapter.source.credentialRequirement,
  credentialPresent: false,
  status: result.status,
  retrievedAt: result.retrievedAt,
  realRecordsReturned: result.recordsReturned,
  realRecordsNormalized: opportunities.length,
  evidenceLabels: [...new Set(opportunities.map(item => item.evidenceLabel))],
  provenanceComplete: opportunities.every(item => item.provenance.length === 1 && item.provenance[0].sourceType === 'provider_api'),
  failure: result.failure,
}, null, 2))

if (result.status !== 'LIVE_VERIFIED') process.exitCode = 1
