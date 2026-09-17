import { detectLanguageFromText } from '@/lib/intelligence/sourceIndependence'

export const QUERY_LANGUAGE_CLASSES = [
  'NATIVE_QUERY_CONFIRMED',
  'MIXED_LANGUAGE_QUERY',
  'ENGLISH_FALLBACK',
  'LANGUAGE_GENERATION_FAILED',
] as const
export type QueryLanguageClass = (typeof QUERY_LANGUAGE_CLASSES)[number]

export type LanguageTruth = {
  requestedLanguage: string
  queryLanguage: string
  detectedDocumentLanguage: string
  translationLanguage: string | null
  evidenceLanguageMatch: boolean
  detectedLanguageConfidence: number
}

const NATIVE_MARKERS: Record<string, RegExp> = {
  fr: /[àâœçùûêëîô]|\b(le|la|les|des|une|pour|aujourd'hui|reportages|actualités|journalisme)\b/i,
  es: /[ñ¿¡]|\b(el|los|las|una|por|hoy|noticias|reportes|periodismo|investigación|investigaciones|científica)\b/i,
  pt: /[ãõ]|\b(uma|não|hoje|notícias|reportagens)\b/i,
  de: /[äöüß]|\b(der|die|das|und|für|heute|aktuelle|meldungen|lokale|photovoltaik|energiewende)\b/i,
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/,
  ar: /[\u0600-\u06ff]/,
  hi: /[\u0900-\u097f]/,
  sw: /\b(habari|haraka|leo|ya|za|na|katika|uandishi|mitaa|kanda|afya|hospitali|chanjo|magonjwa|jamii|wahudumu)\b/i,
  id: /\b(berita|terbaru|hari ini|di|yang|dan|untuk|lokal|jurnalisme|daerah|kembali|usai)\b/i,
  en: /\b(the|and|news|today|breaking|local|reporting|research)\b/i,
}

const DOCUMENT_SCORE: Array<{ language: string; pattern: RegExp; weight: number }> = [
  { language: 'ja', pattern: /[\u3040-\u30ff\u4e00-\u9fff]/g, weight: 4 },
  { language: 'ar', pattern: /[\u0600-\u06ff]/g, weight: 4 },
  { language: 'hi', pattern: /[\u0900-\u097f]/g, weight: 4 },
  { language: 'de', pattern: /[äöüß]/g, weight: 4 },
  { language: 'de', pattern: /\b(der|die|das|und|für|mit|auf|von|im|den|dem|eine|nicht|photovoltaik|energiewende|stromnetz|windkraft)\b/gi, weight: 2 },
  { language: 'es', pattern: /[ñ¿¡]/g, weight: 4 },
  { language: 'es', pattern: /\b(el|los|las|una|por|investigación|investigaciones|científica|científicas|noticias|revistas)\b/gi, weight: 2 },
  { language: 'pt', pattern: /[ãõ]|ção|\bnão\b/gi, weight: 3 },
  { language: 'fr', pattern: /[àâœçùûêëîô]/g, weight: 3 },
  { language: 'fr', pattern: /\b(les|des|une|pour|aujourd'hui|actualités)\b/gi, weight: 2 },
  { language: 'id', pattern: /\b(berita|yang|dan|untuk|infrastruktur|jalan|jembatan|kereta|stasiun|pemerintah|masyarakat|terbaru|kembali|usai|pada|dengan|dari)\b/gi, weight: 2 },
  { language: 'sw', pattern: /\b(habari|afya|hospitali|chanjo|magonjwa|jamii|wahudumu|katika|uandishi|kiswahili)\b/gi, weight: 3 },
  { language: 'en', pattern: /\b(the|and|news|today|warning|research|for|with|community|health)\b/gi, weight: 1 },
]

export function foldDocumentText(text: string): string {
  return text.normalize('NFKC')
}

export function detectDocumentLanguage(text: string | null | undefined): { language: string; confidence: number } {
  const raw = foldDocumentText((text ?? '').trim())
  if (!raw) return { language: 'und', confidence: 0 }
  const script = detectLanguageFromText(raw)
  if (script === 'ja' || script === 'ko' || script === 'ar') {
    return { language: script, confidence: 0.92 }
  }
  const scores = new Map<string, number>()
  for (const entry of DOCUMENT_SCORE) {
    const matches = raw.match(entry.pattern)
    if (!matches?.length) continue
    scores.set(entry.language, (scores.get(entry.language) ?? 0) + matches.length * entry.weight)
  }
  if ((scores.get('sw') ?? 0) < 6) scores.delete('sw')
  let best = 'und'
  let bestScore = 0
  for (const [lang, score] of scores) {
    if (score > bestScore) {
      best = lang
      bestScore = score
    }
  }
  if (best !== 'und' && bestScore >= 2) {
    return { language: best, confidence: Math.min(0.95, 0.55 + bestScore / 20) }
  }
  if (script === 'en' || script === 'de' || script === 'fr' || script === 'es') {
    return { language: script, confidence: 0.7 }
  }
  return { language: 'und', confidence: 0.2 }
}

export function classifyGeneratedQuery(query: string, requestedLanguage: string): {
  class: QueryLanguageClass
  queryLanguage: string
} {
  const text = query.trim()
  if (!text) return { class: 'LANGUAGE_GENERATION_FAILED', queryLanguage: 'und' }
  const requested = requestedLanguage.trim().toLowerCase() || 'und'
  const hasRequested = requested !== 'und' && NATIVE_MARKERS[requested]?.test(text)
  const hasEnglish = NATIVE_MARKERS.en.test(text)
  const hasOtherNative = Object.entries(NATIVE_MARKERS).some(([lang, pattern]) => lang !== requested && lang !== 'en' && pattern.test(text))

  if (requested === 'en') {
    return { class: hasEnglish || /^[\x00-\x7F]+$/.test(text) ? 'NATIVE_QUERY_CONFIRMED' : 'MIXED_LANGUAGE_QUERY', queryLanguage: 'en' }
  }
  if (hasRequested && hasEnglish) return { class: 'MIXED_LANGUAGE_QUERY', queryLanguage: requested }
  if (hasRequested && !hasEnglish) return { class: 'NATIVE_QUERY_CONFIRMED', queryLanguage: requested }
  if (!hasRequested && hasEnglish) return { class: 'ENGLISH_FALLBACK', queryLanguage: 'en' }
  if (hasOtherNative) return { class: 'MIXED_LANGUAGE_QUERY', queryLanguage: requested }
  return { class: 'LANGUAGE_GENERATION_FAILED', queryLanguage: 'und' }
}

export function languageTruthFor(input: {
  requestedLanguage: string
  query: string
  originalText: string
  translatedText?: string | null
}): LanguageTruth & { queryClass: QueryLanguageClass } {
  const query = classifyGeneratedQuery(input.query, input.requestedLanguage)
  const detected = detectDocumentLanguage(input.originalText)
  const requested = input.requestedLanguage.trim().toLowerCase() || 'und'
  const match = detected.language !== 'und'
    && detected.language === requested
    && query.class !== 'ENGLISH_FALLBACK'
  return {
    requestedLanguage: requested,
    queryLanguage: query.queryLanguage,
    detectedDocumentLanguage: detected.language,
    translationLanguage: input.translatedText ? query.queryLanguage : null,
    evidenceLanguageMatch: match,
    detectedLanguageConfidence: detected.confidence,
    queryClass: query.class,
  }
}

export function englishFallbackCannotSatisfy(requestedLanguage: string, detectedDocumentLanguage: string): boolean {
  return requestedLanguage !== 'en' && detectedDocumentLanguage === 'en'
}

export function undCannotSatisfyLanguageCell(detectedDocumentLanguage: string): boolean {
  return detectedDocumentLanguage === 'und' || !detectedDocumentLanguage
}

export function translationDoesNotReplaceOriginal(originalText: string, translatedText: string | null): boolean {
  if (!translatedText) return true
  return originalText.length > 0 && originalText !== translatedText
}
