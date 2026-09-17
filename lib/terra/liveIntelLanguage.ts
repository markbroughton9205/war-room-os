/**
 * Live Intel language truth — a presentation/enrichment layer over existing Live Intel items.
 *
 * Original source text is never replaced. English is optional, separately stored, and never
 * promoted to Terra-verified truth. This is not a second intelligence engine.
 */
import { detectDocumentLanguage } from '@/lib/planetary-intelligence/languageTruth'

export const TERRA_LIVE_INTEL_TRANSLATION_STATES = [
  'ORIGINAL_ONLY',
  'TRANSLATION_AVAILABLE',
  'TRANSLATED',
  'TRANSLATION_FAILED',
  'LANGUAGE_UNKNOWN',
] as const
export type TerraLiveIntelTranslationState = (typeof TERRA_LIVE_INTEL_TRANSLATION_STATES)[number]

export type TerraLiveIntelTranslationRecord = {
  sourceText: string
  sourceLanguage: string | null
  translationText: string
  translationModel: string
  translatedAt: string
}

export type TerraPlaceNameDisplay = {
  nativeName: string | null
  englishName: string | null
  displayLabel: string | null
}

export type TerraLiveIntelLanguageFields = {
  originalLanguage: string | null
  originalHeadline: string
  englishHeadline: string | null
  originalSummary: string | null
  englishSummary: string | null
  translationState: TerraLiveIntelTranslationState
  translation: TerraLiveIntelTranslationRecord | null
}

const HIRAGANA_KATAKANA = /[\u3040-\u30ff]/
const HANGUL = /[\uac00-\ud7af]/
const HAN = /[\u4e00-\u9fff]/
const ARABIC = /[\u0600-\u06ff]/
const DEVANAGARI = /[\u0900-\u097f]/
const CYRILLIC = /[\u0400-\u04ff]/
const UKRAINIAN_LETTERS = /[іїєґІЇЄҐ]/
const NON_LATIN = /[^\u0000-\u024f\s.,;:'"!?()/\-0-9]/

/** World-clock defaults plus spec examples — bilingual labels only, not a timezone table. */
const KNOWN_PLACE_NAMES: Array<{ native: string; english: string; aliases: string[] }> = [
  { native: '東京', english: 'Tokyo', aliases: ['tokyo', '東京都', 'とうきょう'] },
  { native: '北京', english: 'Beijing', aliases: ['beijing', 'peking', '北京市'] },
  { native: '纽约', english: 'New York', aliases: ['new york', 'nyc', 'new york city'] },
  { native: 'London', english: 'London', aliases: ['london'] },
  { native: 'Lagos', english: 'Lagos', aliases: ['lagos'] },
  { native: 'دبي', english: 'Dubai', aliases: ['dubai'] },
  { native: 'नई दिल्ली', english: 'New Delhi', aliases: ['new delhi', 'delhi'] },
  { native: 'Sydney', english: 'Sydney', aliases: ['sydney'] },
  { native: 'Київ', english: 'Kyiv', aliases: ['kyiv', 'kiev'] },
  { native: 'بيروت', english: 'Beirut', aliases: ['beirut'] },
  { native: 'Akron', english: 'Akron', aliases: ['akron'] },
]

const OSM_NATIVE_NAME_KEYS = [
  'name:ja',
  'name:zh',
  'name:zh-Hans',
  'name:zh-Hant',
  'name:ko',
  'name:ar',
  'name:uk',
  'name:ru',
  'name:hi',
  'name:th',
  'name:he',
  'name:fa',
  'name:el',
  'name:bn',
  'name:ur',
  'name:am',
  'name:ka',
  'name:hy',
]

export function detectLiveIntelLanguage(text: string | null | undefined): { language: string; confidence: number } {
  const raw = (text ?? '').trim()
  if (!raw) return { language: 'und', confidence: 0 }
  if (HIRAGANA_KATAKANA.test(raw)) return { language: 'ja', confidence: 0.94 }
  if (HANGUL.test(raw)) return { language: 'ko', confidence: 0.94 }
  if (HAN.test(raw) && !HIRAGANA_KATAKANA.test(raw)) return { language: 'zh', confidence: 0.9 }
  if (ARABIC.test(raw)) return { language: 'ar', confidence: 0.92 }
  if (DEVANAGARI.test(raw)) return { language: 'hi', confidence: 0.9 }
  if (CYRILLIC.test(raw)) return { language: UKRAINIAN_LETTERS.test(raw) ? 'uk' : 'ru', confidence: 0.88 }
  if (!NON_LATIN.test(raw)) {
    const englishHits = (raw.match(/\b(the|and|of|in|to|for|with|from|a|an|earthquake|strikes|major|reported|news|today|weather|warning)\b/gi) ?? []).length
    if (englishHits >= 2) return { language: 'en', confidence: 0.82 }
  }
  const detected = detectDocumentLanguage(raw)
  if (detected.language !== 'und') return detected
  if (!NON_LATIN.test(raw) && /\b(the|and|of|in|to|for|news|today|earthquake|weather)\b/i.test(raw)) {
    return { language: 'en', confidence: 0.62 }
  }
  return detected
}

export function languageIsEnglish(language: string | null | undefined): boolean {
  return language === 'en'
}

export function languageIsForeign(language: string | null | undefined): boolean {
  return Boolean(language && language !== 'en' && language !== 'und')
}

function foldPlaceKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

export function formatPlaceDisplayLabel(nativeName: string | null | undefined, englishName: string | null | undefined): string | null {
  const native = nativeName?.trim() || null
  const english = englishName?.trim() || null
  if (native && english && foldPlaceKey(native) !== foldPlaceKey(english)) return `${native} / ${english}`
  return native ?? english
}

export function parsePlaceDisplayName(place: string | null | undefined): TerraPlaceNameDisplay {
  const raw = place?.trim() || null
  if (!raw) return { nativeName: null, englishName: null, displayLabel: null }
  const slash = raw.split(/\s+\/\s+/)
  if (slash.length === 2 && slash[0] && slash[1]) {
    const nativeName = NON_LATIN.test(slash[0]) ? slash[0] : slash[0]
    const englishName = slash[1]
    return { nativeName, englishName, displayLabel: formatPlaceDisplayLabel(nativeName, englishName) }
  }
  const known = KNOWN_PLACE_NAMES.find(entry => (
    foldPlaceKey(entry.native) === foldPlaceKey(raw)
    || foldPlaceKey(entry.english) === foldPlaceKey(raw)
    || entry.aliases.includes(foldPlaceKey(raw))
    || raw.split(/[,\s]+/).some(part => part && entry.aliases.includes(foldPlaceKey(part)))
  ))
  if (known) {
    return {
      nativeName: known.native,
      englishName: known.english,
      displayLabel: formatPlaceDisplayLabel(known.native, known.english),
    }
  }
  if (NON_LATIN.test(raw)) {
    return { nativeName: raw, englishName: null, displayLabel: raw }
  }
  return { nativeName: raw, englishName: raw, displayLabel: raw }
}

export function resolvePlaceDisplayName(input: {
  place?: string | null
  nativeName?: string | null
  englishName?: string | null
}): TerraPlaceNameDisplay {
  const native = input.nativeName?.trim() || null
  const english = input.englishName?.trim() || null
  if (native || english) {
    const parsed = parsePlaceDisplayName(input.place)
    return {
      nativeName: native ?? parsed.nativeName,
      englishName: english ?? parsed.englishName,
      displayLabel: formatPlaceDisplayLabel(native ?? parsed.nativeName, english ?? parsed.englishName) ?? input.place?.trim() ?? null,
    }
  }
  return parsePlaceDisplayName(input.place)
}

export function extractNominatimPlaceNames(
  namedetails?: Record<string, string> | null,
  fallbackName?: string | null,
): TerraPlaceNameDisplay {
  const details = namedetails ?? {}
  const english = details['name:en']?.trim() || null
  const nativeFromTags = OSM_NATIVE_NAME_KEYS.map(key => details[key]?.trim()).find(Boolean) || null
  const defaultName = details.name?.trim() || fallbackName?.trim() || null
  const native = nativeFromTags
    || (defaultName && NON_LATIN.test(defaultName) ? defaultName : null)
    || defaultName
  const parsedFallback = parsePlaceDisplayName(fallbackName)
  return {
    nativeName: native ?? parsedFallback.nativeName,
    englishName: english ?? parsedFallback.englishName,
    displayLabel: formatPlaceDisplayLabel(
      native ?? parsedFallback.nativeName,
      english ?? parsedFallback.englishName,
    ),
  }
}

export function buildLiveIntelLanguageFields(input: {
  headline: string
  summary?: string | null
  declaredLanguage?: string | null
  englishHeadline?: string | null
  englishSummary?: string | null
  translation?: TerraLiveIntelTranslationRecord | null
}): TerraLiveIntelLanguageFields {
  const originalHeadline = input.headline
  const originalSummary = input.summary ?? null
  const detected = detectLiveIntelLanguage(`${originalHeadline} ${originalSummary ?? ''}`)
  const declared = input.declaredLanguage?.trim().toLowerCase() || null
  const originalLanguage = detected.language !== 'und'
    ? detected.language
    : (declared && declared !== 'und' ? declared : null)
  const sourceEnglishHeadline = input.englishHeadline?.trim() || null
  const sourceEnglishSummary = input.englishSummary?.trim() || null
  const translation = input.translation ?? null

  if (translation?.translationText) {
    return {
      originalLanguage,
      originalHeadline,
      englishHeadline: translation.translationText,
      originalSummary,
      englishSummary: sourceEnglishSummary,
      translationState: 'TRANSLATED',
      translation,
    }
  }

  const hasSourceEnglish = Boolean(
    sourceEnglishHeadline
    && originalLanguage
    && originalLanguage !== 'en'
    && foldPlaceKey(sourceEnglishHeadline) !== foldPlaceKey(originalHeadline),
  )

  return {
    originalLanguage,
    originalHeadline,
    englishHeadline: hasSourceEnglish ? sourceEnglishHeadline : null,
    originalSummary,
    englishSummary: hasSourceEnglish ? sourceEnglishSummary : null,
    translationState: !originalLanguage
      ? 'LANGUAGE_UNKNOWN'
      : hasSourceEnglish
        ? 'TRANSLATION_AVAILABLE'
        : 'ORIGINAL_ONLY',
    translation: null,
  }
}

export function applyLiveIntelTranslation<T extends TerraLiveIntelLanguageFields>(
  item: T,
  translation: TerraLiveIntelTranslationRecord,
): T {
  return {
    ...item,
    originalHeadline: item.originalHeadline,
    originalSummary: item.originalSummary,
    originalLanguage: item.originalLanguage,
    englishHeadline: translation.translationText,
    translationState: 'TRANSLATED',
    translation,
  }
}

export function applyTranslationFailure<T extends TerraLiveIntelLanguageFields>(item: T): T {
  return {
    ...item,
    translationState: 'TRANSLATION_FAILED',
  }
}

export function sourceTextStillOriginal(item: {
  headline: string
  originalHeadline: string
}): boolean {
  return item.headline === item.originalHeadline
}

export function translationIsPresentationOnly(item: TerraLiveIntelLanguageFields): boolean {
  if (!item.englishHeadline) return true
  return item.originalHeadline.length > 0
    && item.originalHeadline !== item.englishHeadline
    && (!item.translation || item.translation.sourceText === item.originalHeadline)
}
