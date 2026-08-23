import { createHash } from 'node:crypto'
import { parseBenefit } from './benefits'
import { fetchReadOnly } from './corroborationFetch'
import type { SettlementAggregator, SettlementDiscovery } from './corroborationTypes'

const linkedUrls = (html: string, baseUrl: string) => [...new Set([
  ...(html.match(/https:\/\/[^\s"'<>]+/g) ?? []),
  ...[...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1]),
].map(value => {
  try { return new URL(value.replaceAll('&amp;', '&'), baseUrl).toString() } catch { return null }
}).filter((value): value is string => Boolean(value)))]
const plain = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"').replace(/\s+/g, ' ').trim()
const first = (text: string, pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null

export function parseAggregatorPage(provider: SettlementAggregator, url: string, html: string, provenance: SettlementDiscovery['provenance']): SettlementDiscovery {
  const text = plain(html)
  const title = first(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ?? first(text, /(?:^|Settlements? \/ )([^.!?]{8,140}(?:Settlement|Refund))/i) ?? first(html, /<title[^>]*>([^<]+)/i) ?? 'Untitled settlement'
  const deadline = first(text, /(?:claim deadline|deadline to file(?: a claim)?(?: is)?|closes?)[:\s]+([A-Z][a-z]+\s+\d{1,2},\s+20\d{2})/i)
  const proofRequirement = first(text, /(?:proof requirement(?: is currently marked as)?|proof of purchase is)[:\s]+(required|optional|not required|no proof needed)/i)
  const benefitText = first(text, /(?:Payout|Potential payment|Reported payment)[:\s]+(.{1,350}?)(?=\s(?:Proof|Claim deadline|Who may|Checked against|Closes)\b)/i) ?? first(text, /((?:up to|approximately|estimated)?\s*\$[\d,.]+[^.]{0,180})/i) ?? ''
  const classDefinition = first(text, /(?:You may be eligible if|Who qualifies:)\s*(.{20,500}?)(?=\s(?:Payout|Proof|Claim deadline|Official|Set at|Potential payment)\b)/i)
  const candidates = linkedUrls(html, url).filter(candidate => !new URL(candidate).hostname.endsWith(provider === 'settlesignal' ? 'settlesignal.com' : 'classaction.org')).slice(0, 25)
  const claimFormUrl = candidates.find(candidate => /(claim|forms?\.)/i.test(candidate)) ?? null
  const id = createHash('sha256').update(`${provider}:${url}`).digest('hex').slice(0, 20)
  return { id, provider, title, recordUrl: url, deadline, proofRequirement, benefit: parseBenefit(benefitText), classDefinition, claimFormUrl, officialSourceCandidates: candidates, provenance, rawText: text.slice(0, 20_000) }
}

export async function fetchAggregator(provider: SettlementAggregator, url: string, fetcher: typeof fetch = fetch) {
  const result = await fetchReadOnly(url, 'AGGREGATOR', fetcher)
  return { ...result, record: result.ok ? parseAggregatorPage(provider, url, result.text, result.provenance) : null }
}

export const fetchSettleSignal = (url: string, fetcher: typeof fetch = fetch) => fetchAggregator('settlesignal', url, fetcher)
export const fetchClassActionOrg = (url: string, fetcher: typeof fetch = fetch) => fetchAggregator('classaction_org', url, fetcher)
