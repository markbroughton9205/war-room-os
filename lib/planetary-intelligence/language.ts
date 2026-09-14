import { detectLanguageFromText } from '@/lib/intelligence/sourceIndependence'

export type LanguageRecord = {
  originalText: string
  originalLanguage: string
  translatedText: string | null
  translationMethod: string | null
  translationTime: string | null
  translationConfidence: number | null
}

export function preserveLanguage(input: {
  text: string
  declaredLanguage?: string | null
  translatedText?: string | null
  translationMethod?: string | null
  nowIso?: string
}): LanguageRecord {
  const detected = detectLanguageFromText(input.text) || input.declaredLanguage || 'und'
  return {
    originalText: input.text,
    originalLanguage: detected,
    translatedText: input.translatedText ?? null,
    translationMethod: input.translatedText ? (input.translationMethod ?? 'working_translation') : null,
    translationTime: input.translatedText ? (input.nowIso ?? new Date().toISOString()) : null,
    translationConfidence: input.translatedText ? 0.7 : null,
  }
}

export function languageDetectorIsPluggable(): boolean {
  return typeof detectLanguageFromText === 'function'
}

export const GEO_LANGUAGE_PRIORS: Record<string, string[]> = {
  WEST_AFRICA: ['fr', 'en', 'ha', 'yo', 'ff'],
  EAST_AFRICA: ['sw', 'en', 'am', 'so'],
  LATIN_AMERICA: ['es', 'pt'],
  EAST_ASIA: ['ja', 'zh', 'ko'],
  SOUTHEAST_ASIA: ['id', 'vi', 'th', 'ms', 'en'],
  EUROPE: ['en', 'de', 'fr', 'pl'],
  MIDDLE_EAST: ['ar', 'fa', 'tr', 'he', 'en'],
  SOUTH_ASIA: ['hi', 'bn', 'ur', 'en'],
  NORTH_AMERICA: ['en', 'es', 'fr'],
  OCEANIA: ['en'],
}
