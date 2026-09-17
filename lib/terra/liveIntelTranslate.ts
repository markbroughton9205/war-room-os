/**
 * On-demand Live Intel translation — presentation enrichment only.
 *
 * Does not create a second intelligence engine. Does not mutate original evidence.
 * Failure stays TRANSLATION_FAILED; original source text remains.
 */
import 'server-only'

import { CACHE_TTL, cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import type { TerraLiveIntelTranslationRecord } from './liveIntelLanguage'
import { detectLiveIntelLanguage, languageIsEnglish } from './liveIntelLanguage'

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get'
const MAX_SOURCE_CHARS = 500
export const LIVE_INTEL_TRANSLATION_MODEL = 'mymemory'

export type LiveIntelTranslateResult =
  | { ok: true; translation: TerraLiveIntelTranslationRecord }
  | { ok: false; reason: string }

function cacheKey(sourceLanguage: string, text: string): string {
  return `terra-live-intel:translate:${sourceLanguage}:${text}`
}

export async function translateLiveIntelText(input: {
  sourceText: string
  sourceLanguage?: string | null
  nowIso?: string
  fetchImpl?: typeof fetch
}): Promise<LiveIntelTranslateResult> {
  const sourceText = input.sourceText.trim()
  if (!sourceText) return { ok: false, reason: 'No source text to translate.' }
  if (sourceText.length > MAX_SOURCE_CHARS) {
    return { ok: false, reason: `Source text exceeds ${MAX_SOURCE_CHARS} characters — not silently truncated.` }
  }
  const detected = detectLiveIntelLanguage(sourceText)
  const sourceLanguage = input.sourceLanguage?.trim() || (detected.language === 'und' ? null : detected.language)
  if (!sourceLanguage) return { ok: false, reason: 'Source language unknown — English is not invented.' }
  if (languageIsEnglish(sourceLanguage)) return { ok: false, reason: 'Source is already English.' }

  const hit = input.fetchImpl ? null : cacheGet<TerraLiveIntelTranslationRecord>(cacheKey(sourceLanguage, sourceText))
  if (hit) return { ok: true, translation: hit }

  const url = new URL(MYMEMORY_URL)
  url.searchParams.set('q', sourceText)
  url.searchParams.set('langpair', `${sourceLanguage}|en`)

  try {
    const fetchImpl = input.fetchImpl ?? fetch
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return { ok: false, reason: `Translation provider HTTP ${response.status}.` }
    const payload = await response.json() as { responseData?: { translatedText?: string }; responseStatus?: number }
    const translationText = payload.responseData?.translatedText?.trim() || ''
    if (!translationText || payload.responseStatus !== 200) {
      return { ok: false, reason: 'Translation provider returned no English text.' }
    }
    if (translationText.normalize('NFKC') === sourceText.normalize('NFKC')) {
      return { ok: false, reason: 'Translation matched source text — original preserved, English not invented.' }
    }
    const translation: TerraLiveIntelTranslationRecord = {
      sourceText,
      sourceLanguage,
      translationText,
      translationModel: LIVE_INTEL_TRANSLATION_MODEL,
      translatedAt: input.nowIso ?? new Date().toISOString(),
    }
    if (!input.fetchImpl) cacheSet(cacheKey(sourceLanguage, sourceText), translation, CACHE_TTL.webSearch)
    return { ok: true, translation }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
