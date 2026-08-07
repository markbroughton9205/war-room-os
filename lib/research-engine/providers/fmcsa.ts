import 'server-only'

import type { ResearchDocument, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'fmcsa' as const
const BASE_URL = 'https://mobile.fmcsa.dot.gov/qc/services'
const MAX_RESPONSE_BYTES = 65_536

/**
 * FMCSA publishes no formal digit-length rule for USDOT numbers. 1-8 digits
 * is a War Room-imposed conservative safety bound, not an official contract
 * value, chosen to comfortably cover known real-world USDOT numbers while
 * keeping the input surface bounded. `\d` (no `u` flag) matches ASCII 0-9
 * only, so Unicode digit variants never match this syntax.
 */
const USDOT_QUERY_PATTERN = /^usdot\s+(\d{1,8})$/i

/**
 * War Room-imposed conservative safety bound on the USDOT numeric value
 * itself (10^8 - 1, matching the 8-digit input bound). Not an official
 * FMCSA-published limit. Applies to both the requested identifier and any
 * returned `dotNumber` — zero is explicitly excluded (a USDOT of 0 is never
 * a valid requested or returned identifier).
 */
const MAX_USDOT_VALUE = 99_999_999

/**
 * War Room-imposed conservative bound on `legalName` length — no official
 * FMCSA limit is documented. An oversized `legalName` is rejected
 * (`parse_error`), never silently truncated.
 */
const MAX_LEGAL_NAME_LENGTH = 256

/** Same conservative bound applied to every other optional carrier string field, so no single field can produce unbounded normalized output. */
const MAX_OPTIONAL_STRING_LENGTH = 256

/** The official FMCSA-published documentation example (see docs/RESEARCH_FMCSA_BUILD_REPORT.md), reused only for an explicit Commander-triggered health check — never for a normal lookup. */
const OFFICIAL_SAMPLE_USDOT = '44110'

type ParsedCarrier = {
  dotNumber: number
  legalName: string
  dbaName: string | null
  allowedToOperate: string | null
  statusCode: string | null
  oosDate: string | null
  phyCity: string | null
  phyState: string | null
  phyCountry: string | null
  safetyRating: string | null
  safetyRatingDate: string | null
  commonAuthorityStatus: string | null
  contractAuthorityStatus: string | null
  brokerAuthorityStatus: string | null
}

class FmcsaError extends Error {
  category: 'upstream_error' | 'parse_error' | 'rate_limited'
  httpStatus: number | null
  constructor(message: string, category: 'upstream_error' | 'parse_error' | 'rate_limited', httpStatus: number | null) {
    super(message)
    this.category = category
    this.httpStatus = httpStatus
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Bounded optional-string normalization: trims, requires non-empty, and
 * rejects (returns null, never truncates) anything over `maxLength`. An
 * oversized or empty/whitespace-only optional field is treated as absent —
 * never fabricated, never silently cut down to fit.
 */
function boundedStringOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

/** A USDOT numeric value (requested or returned) is valid only if it is a finite, safe, positive integer within the War Room safety bound. Zero is never valid. */
function isValidUsdotValue(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_USDOT_VALUE
}

/**
 * Canonicalizes the exact `usdot <digits>` input syntax to a stable decimal
 * identifier used for URL construction, cache-key construction, and the
 * returned-identity comparison. Leading zeros collapse (e.g. "007" and "7"
 * canonicalize identically, and therefore share cache identity); zero
 * itself, and anything outside the 1-99,999,999 safety bound, is rejected
 * before any network call.
 */
function canonicalizeRequestedUsdot(text: string): string | null {
  const match = USDOT_QUERY_PATTERN.exec(text.trim())
  if (!match) return null
  const value = Number(match[1])
  if (!isValidUsdotValue(value)) return null
  return String(value)
}

/**
 * Parses only the exact envelope proven by the two controlled structure-only
 * probes recorded in docs/RESEARCH_CONTROLLED_PROBE_LOG.md:
 * `{ content: { carrier: { dotNumber: number, legalName: string, ... } } }`.
 * No other envelope shape (bare carrier, array-wrapped, differently-keyed) is
 * accepted — an unproven shape is a parse_error, never a guess. Numeric
 * `dotNumber` validation here is strict (finite, safe integer, positive,
 * within the safety bound) but is intentionally NOT an identity check — the
 * requested-vs-returned identity comparison happens separately in
 * `lookupCarrier`, after this structural/type validation passes, so the two
 * failure modes (malformed number vs. wrong carrier) stay distinguishable in
 * code even though both surface as `parse_error`.
 */
function parseCarrierPayload(text: string): ParsedCarrier | null {
  const json = safeJsonParse<unknown>(text)
  if (!isRecord(json)) return null
  const content = json.content
  if (!isRecord(content)) return null
  const carrier = content.carrier
  if (!isRecord(carrier)) return null
  if (typeof carrier.dotNumber !== 'number' || !isValidUsdotValue(carrier.dotNumber)) return null
  const legalName = boundedStringOrNull(carrier.legalName, MAX_LEGAL_NAME_LENGTH)
  if (!legalName) return null

  return {
    dotNumber: carrier.dotNumber,
    legalName,
    dbaName: boundedStringOrNull(carrier.dbaName, MAX_OPTIONAL_STRING_LENGTH),
    allowedToOperate: boundedStringOrNull(carrier.allowedToOperate, MAX_OPTIONAL_STRING_LENGTH),
    statusCode: boundedStringOrNull(carrier.statusCode, MAX_OPTIONAL_STRING_LENGTH),
    oosDate: boundedStringOrNull(carrier.oosDate, MAX_OPTIONAL_STRING_LENGTH),
    phyCity: boundedStringOrNull(carrier.phyCity, MAX_OPTIONAL_STRING_LENGTH),
    phyState: boundedStringOrNull(carrier.phyState, MAX_OPTIONAL_STRING_LENGTH),
    phyCountry: boundedStringOrNull(carrier.phyCountry, MAX_OPTIONAL_STRING_LENGTH),
    safetyRating: boundedStringOrNull(carrier.safetyRating, MAX_OPTIONAL_STRING_LENGTH),
    safetyRatingDate: boundedStringOrNull(carrier.safetyRatingDate, MAX_OPTIONAL_STRING_LENGTH),
    commonAuthorityStatus: boundedStringOrNull(carrier.commonAuthorityStatus, MAX_OPTIONAL_STRING_LENGTH),
    contractAuthorityStatus: boundedStringOrNull(carrier.contractAuthorityStatus, MAX_OPTIONAL_STRING_LENGTH),
    brokerAuthorityStatus: boundedStringOrNull(carrier.brokerAuthorityStatus, MAX_OPTIONAL_STRING_LENGTH),
  }
}

/**
 * Builds a factual snippet from a small set of official carrier-level fields
 * only — no predictive, accusatory, or inferred-safety language. Fields with
 * an unproven or undocumented meaning (e.g. `retrievalDate`) are omitted
 * rather than guessed onto a document field they were never confirmed to
 * represent. Only called after the returned `dotNumber` has already been
 * confirmed to match the requested USDOT — this function never sees a
 * mismatched carrier record.
 */
function normalizeCarrier(carrier: ParsedCarrier, sanitizedUrl: string): ResearchDocument {
  const dotNumberStr = String(carrier.dotNumber)
  const geography = [carrier.phyCity, carrier.phyState, carrier.phyCountry].filter((part): part is string => Boolean(part)).join(', ') || null

  const snippetParts = [
    `USDOT ${dotNumberStr}`,
    carrier.dbaName ? `DBA ${carrier.dbaName}` : null,
    carrier.allowedToOperate ? `allowed to operate: ${carrier.allowedToOperate}` : null,
    carrier.statusCode ? `status code: ${carrier.statusCode}` : null,
    carrier.safetyRating ? `safety rating: ${carrier.safetyRating}` : null,
  ].filter((part): part is string => Boolean(part))
  const contentSnippet = snippetParts.length > 0 ? snippetParts.join(' — ') : null

  return makeDocument({
    id: `fmcsa:${dotNumberStr}`,
    provider: PROVIDER,
    providerRecordId: dotNumberStr,
    title: carrier.legalName,
    summary: contentSnippet,
    contentSnippet,
    canonicalUrl: sanitizedUrl,
    sourceUrl: sanitizedUrl,
    sourceName: 'FMCSA QCMobile',
    contentType: 'carrier_record',
    authors: [],
    organization: 'Federal Motor Carrier Safety Administration',
    publishedAt: null,
    updatedAt: null,
    geography,
    language: 'en',
    identifiers: {
      fmcsa_dot_number: dotNumberStr,
      ...(carrier.dbaName ? { fmcsa_dba_name: carrier.dbaName } : {}),
      ...(carrier.allowedToOperate ? { fmcsa_allowed_to_operate: carrier.allowedToOperate } : {}),
      ...(carrier.statusCode ? { fmcsa_status_code: carrier.statusCode } : {}),
      ...(carrier.oosDate ? { fmcsa_out_of_service_date: carrier.oosDate } : {}),
      ...(carrier.safetyRating ? { fmcsa_safety_rating: carrier.safetyRating } : {}),
      ...(carrier.safetyRatingDate ? { fmcsa_safety_rating_date: carrier.safetyRatingDate } : {}),
      ...(carrier.commonAuthorityStatus ? { fmcsa_common_authority_status: carrier.commonAuthorityStatus } : {}),
      ...(carrier.contractAuthorityStatus ? { fmcsa_contract_authority_status: carrier.contractAuthorityStatus } : {}),
      ...(carrier.brokerAuthorityStatus ? { fmcsa_broker_authority_status: carrier.brokerAuthorityStatus } : {}),
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })
}

async function lookupCarrier(requestedUsdot: string) {
  const started = Date.now()
  const cacheKey = `fmcsa:carrier:${requestedUsdot}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const webKey = process.env.FMCSA_WEB_KEY?.trim() ?? ''
  const sanitizedUrl = `${BASE_URL}/carriers/${requestedUsdot}`
  const url = new URL(sanitizedUrl)
  url.searchParams.set('webKey', webKey)

  // maxRetries: 0 — FMCSA is bounded to exactly one real upstream attempt
  // per uncached execution; no automatic retry on 429/502/503/504 or a
  // network/timeout failure (an FMCSA-only override — safeProviderFetch's
  // shared default of 2 retries is unchanged for every other provider).
  // maxRedirects: 0 — an FMCSA response is never expected to redirect; any
  // redirect (even same-host) is treated as an unexpected upstream condition
  // rather than silently followed, and — combined with maxRetries: 0 — costs
  // exactly one upstream fetch, never a second request to the redirect
  // target.
  const result = await safeProviderFetch(PROVIDER, url.toString(), {
    timeoutMs: 12_000,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxRedirects: 0,
    maxRetries: 0,
  })

  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  if (result.truncated) return { ok: false as const, kind: 'malformed' as const, message: 'FMCSA response exceeded the maximum accepted size.' }

  const carrier = parseCarrierPayload(result.text)
  if (!carrier) {
    return {
      ok: false as const,
      kind: 'malformed' as const,
      message: 'FMCSA response did not match the proven content.carrier envelope with a valid numeric dotNumber and a bounded, non-empty legalName.',
    }
  }

  // Identity gate: a structurally valid carrier record for a DIFFERENT USDOT
  // than the one requested (e.g. an upstream routing error, a stale/misrouted
  // cache on FMCSA's side, or any other mismatch) is never normalized, never
  // returned as a document, and never cached — under either the requested or
  // the returned identifier. This is deliberately checked after structural
  // parsing so a malformed-number failure and a wrong-carrier failure stay
  // distinguishable in code, even though both surface as `parse_error`.
  if (String(carrier.dotNumber) !== requestedUsdot) {
    return {
      ok: false as const,
      kind: 'malformed' as const,
      message: 'FMCSA response carrier identity did not match the requested USDOT number; rejected rather than normalized or cached.',
    }
  }

  const document = normalizeCarrier(carrier, sanitizedUrl)
  const response = okResponse(PROVIDER, { documents: [document], durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'FMCSA_WEB_KEY is not configured.')
  }

  const usdot = canonicalizeRequestedUsdot(query.text)
  if (!usdot) {
    return errorResponse(
      PROVIDER,
      {
        provider: PROVIDER,
        category: 'unknown',
        message: 'FMCSA requires an exact "usdot <digits>" query (1-8 digits, canonicalized to a positive integer no greater than 99,999,999). Zero, free text, multiple identifiers, and name/docket lookups are not supported in this build phase.',
        httpStatus: null,
      },
      0,
    )
  }

  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookupCarrier(usdot)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        const category = outcome.status === 429 ? ('rate_limited' as const) : ('upstream_error' as const)
        throw new FmcsaError(`FMCSA carrier lookup failed with HTTP ${outcome.status}`, category, outcome.status)
      }
      throw new FmcsaError(outcome.message, 'parse_error', null)
    })
  } catch (error) {
    if (error instanceof FmcsaError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: error.httpStatus }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'FMCSA_WEB_KEY missing', durationMs: null }
  }
  try {
    const webKey = process.env.FMCSA_WEB_KEY?.trim() ?? ''
    const url = new URL(`${BASE_URL}/carriers/${OFFICIAL_SAMPLE_USDOT}`)
    url.searchParams.set('webKey', webKey)
    // maxRetries: 0 for the same reason as lookupCarrier — a single manual
    // health probe should never silently amplify into multiple upstream
    // requests.
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 8_000, maxResponseBytes: MAX_RESPONSE_BYTES, maxRedirects: 0, maxRetries: 0 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'carrier lookup endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const fmcsaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
