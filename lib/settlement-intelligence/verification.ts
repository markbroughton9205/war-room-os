import { classifyOfficialAuthority, fetchReadOnly } from './corroborationFetch'
import { parseBenefit } from './benefits'
import type { CorroboratedSettlement, FieldVerification, SettlementDiscovery, VerificationField } from './corroborationTypes'

const fields: VerificationField[] = ['deadline', 'proofRequirement', 'benefit', 'classDefinition', 'claimFormUrl']
const emptyFields = (): CorroboratedSettlement['fields'] => Object.fromEntries(fields.map(field => [field, { field, status: 'UNVERIFIED', value: null, source: null, verifiedBy: null, note: 'Aggregator evidence cannot verify an official field.' }])) as CorroboratedSettlement['fields']
const key = (title: string) => title.toLowerCase().replace(/\b(class action|settlement|refund|lawsuit)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function corroborate(discoveries: SettlementDiscovery[]): CorroboratedSettlement[] {
  const groups = new Map<string, SettlementDiscovery[]>()
  for (const item of discoveries) { const k = key(item.title); groups.set(k, [...(groups.get(k) ?? []), item]) }
  return [...groups].map(([k, values]) => ({ key: k, discoveries: values, corroboration: new Set(values.map(x => x.provider)).size > 1 ? 'DUAL_AGGREGATOR_CORROBORATED' : 'SINGLE_SOURCE', officialSourceVerified: false, fields: emptyFields() }))
}

function extractOfficial(text: string): Partial<Record<VerificationField, string>> {
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  return {
    deadline: clean.match(/(?:claim deadline|claims? must be (?:submitted|postmarked)(?: by)?)[\s:]+([A-Z][a-z]+\s+\d{1,2},\s+20\d{2})/i)?.[1],
    proofRequirement: clean.match(/((?:supporting )?documentation (?:is )?(?:required|not required)|no (?:documentation|proof) (?:is )?required)/i)?.[1],
    benefit: clean.match(/((?:up to|approximately|estimated)?\s*\$[\d,.]+.{0,220}?)(?=\.| Claim| Deadline)/i)?.[1],
    classDefinition: clean.match(/(?:Settlement Class|Class Members?)(?: means| includes|:)[\s]+(.{20,700}?)(?=\s(?:Excluded|Benefits|Claims?|Deadline)\b)/i)?.[1],
    claimFormUrl: text.match(/https:\/\/[^\s"'<>]*(?:claim|form)[^\s"'<>]*/i)?.[0],
  }
}

export async function verifyOfficialSource(url: string, fetcher: typeof fetch = fetch): Promise<{ fields: Partial<Record<VerificationField, FieldVerification>>; error: string | null }> {
  const authority = classifyOfficialAuthority(url)
  if (!authority) return { fields: {}, error: 'Host is not classified as an administrator, court, or government authority.' }
  const fetched = await fetchReadOnly(url, authority, fetcher)
  if (!fetched.ok) return { fields: {}, error: fetched.error }
  const values = extractOfficial(fetched.text)
  const verified = Object.fromEntries(fields.filter(field => values[field]).map(field => [field, { field, status: 'VERIFIED', value: values[field]!, source: fetched.provenance, verifiedBy: authority, note: null }])) as Partial<Record<VerificationField, FieldVerification>>
  return { fields: verified, error: null }
}

export function applyOfficialVerification(record: CorroboratedSettlement, verified: Partial<Record<VerificationField, FieldVerification>>): CorroboratedSettlement {
  const next = { ...record.fields, ...verified }
  return { ...record, fields: next, officialSourceVerified: fields.every(field => next[field].status === 'VERIFIED') }
}

export function compareAggregatorClaims(record: CorroboratedSettlement): CorroboratedSettlement {
  if (record.discoveries.length < 2) return record
  const next = { ...record.fields }
  for (const field of fields) {
    const values = record.discoveries.map(item => field === 'benefit' ? item.benefit.text : item[field]).filter(Boolean).map(String)
    if (new Set(values).size > 1 && next[field].status !== 'VERIFIED') next[field] = { ...next[field], status: 'CONFLICT', note: 'Aggregator values conflict; official resolution required.' }
  }
  return { ...record, fields: next, officialSourceVerified: false }
}

export { parseBenefit }
