import assert from 'node:assert/strict'
import { extractClaimTexts } from './claimExtraction'

const claims = extractClaimTexts({
  id: 'doc-1', title: 'Fallback title long enough for extraction',
  summary: 'The first source-backed statement is independently testable. The second statement keeps its own provenance reference.',
  provider: 'test', providerRecordId: 'record-1', contentSnippet: null,
  canonicalUrl: 'https://example.test/source', sourceUrl: 'https://example.test/source',
  sourceName: 'Example', contentType: 'text/html', organization: null, language: 'en', license: null,
  retrievedAt: '2026-08-29T00:00:00.000Z',
  provenance: { sourceUrl: 'https://example.test/source', retrievedAt: '2026-08-29T00:00:00.000Z', isHistorical: false },
})
assert.equal(claims.length, 2)
assert.ok(claims.every(claim => claim.length >= 20))
console.log('Wave 3 claim extraction validation: 2/2 PASS')
