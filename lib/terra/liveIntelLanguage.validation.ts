import { pathToFileURL } from 'node:url'
import {
  applyLiveIntelTranslation,
  applyTranslationFailure,
  buildLiveIntelLanguageFields,
  detectLiveIntelLanguage,
  extractNominatimPlaceNames,
  parsePlaceDisplayName,
  resolvePlaceDisplayName,
  sourceTextStillOriginal,
  translationIsPresentationOnly,
} from './liveIntelLanguage'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check(
    'japanese_detected',
    detectLiveIntelLanguage('地震で鉄道に遅れ').language === 'ja',
    detectLiveIntelLanguage('地震で鉄道に遅れ').language,
  ))
  results.push(check(
    'kyiv_ukrainian_detected',
    detectLiveIntelLanguage('Київ під обстрілом').language === 'uk',
    detectLiveIntelLanguage('Київ під обстрілом').language,
  ))
  results.push(check(
    'beirut_arabic_detected',
    detectLiveIntelLanguage('انفجار في بيروت').language === 'ar',
    detectLiveIntelLanguage('انفجار في بيروت').language,
  ))
  results.push(check(
    'french_detected',
    detectLiveIntelLanguage("Grève des transports aujourd'hui à Paris").language === 'fr',
    detectLiveIntelLanguage("Grève des transports aujourd'hui à Paris").language,
  ))

  const japanese = buildLiveIntelLanguageFields({
    headline: '地震で鉄道に遅れ',
    summary: '首都圏の在来線に遅れが出ています。',
  })
  results.push(check(
    'original_japanese_not_auto_englished',
    japanese.originalLanguage === 'ja'
      && japanese.originalHeadline === '地震で鉄道に遅れ'
      && japanese.englishHeadline === null
      && japanese.translationState === 'ORIGINAL_ONLY',
    `${japanese.originalLanguage}:${japanese.translationState}:${japanese.englishHeadline ?? 'none'}`,
  ))

  const translated = applyLiveIntelTranslation(japanese, {
    sourceText: japanese.originalHeadline,
    sourceLanguage: 'ja',
    translationText: 'Earthquake causes train delays',
    translationModel: 'mymemory',
    translatedAt: '2026-09-16T20:00:00.000Z',
  })
  results.push(check(
    'translation_does_not_replace_original',
    translated.originalHeadline === '地震で鉄道に遅れ'
      && translated.englishHeadline === 'Earthquake causes train delays'
      && translated.translationState === 'TRANSLATED'
      && translationIsPresentationOnly(translated)
      && sourceTextStillOriginal({ headline: translated.originalHeadline, originalHeadline: japanese.originalHeadline }),
    `${translated.originalHeadline} | ${translated.englishHeadline}`,
  ))

  const failed = applyTranslationFailure(japanese)
  results.push(check(
    'translation_failure_keeps_original',
    failed.originalHeadline === '地震で鉄道に遅れ'
      && failed.englishHeadline === null
      && failed.translationState === 'TRANSLATION_FAILED',
    failed.translationState,
  ))

  const bilingual = buildLiveIntelLanguageFields({
    headline: '地震で鉄道に遅れ',
    englishHeadline: 'Earthquake causes train delays',
  })
  results.push(check(
    'source_bilingual_is_available_not_overwrite',
    bilingual.translationState === 'TRANSLATION_AVAILABLE'
      && bilingual.originalHeadline === '地震で鉄道に遅れ'
      && bilingual.englishHeadline === 'Earthquake causes train delays',
    bilingual.translationState,
  ))

  const tokyo = parsePlaceDisplayName('Tokyo')
  results.push(check(
    'tokyo_native_and_english',
    tokyo.nativeName === '東京' && tokyo.englishName === 'Tokyo' && tokyo.displayLabel === '東京 / Tokyo',
    tokyo.displayLabel ?? 'none',
  ))
  const kyiv = parsePlaceDisplayName('Київ')
  results.push(check(
    'kyiv_native_and_english',
    kyiv.nativeName === 'Київ' && kyiv.englishName === 'Kyiv' && kyiv.displayLabel === 'Київ / Kyiv',
    kyiv.displayLabel ?? 'none',
  ))
  results.push(check(
    'slash_pair_preserved',
    resolvePlaceDisplayName({ place: '東京 / Tokyo' }).displayLabel === '東京 / Tokyo',
    resolvePlaceDisplayName({ place: '東京 / Tokyo' }).displayLabel ?? 'none',
  ))

  const osmTokyo = extractNominatimPlaceNames({
    name: '東京都',
    'name:en': 'Tokyo',
    'name:ja': '東京都',
  }, 'Tokyo')
  results.push(check(
    'nominatim_namedetails_not_a_hand_table',
    osmTokyo.nativeName === '東京都' && osmTokyo.englishName === 'Tokyo' && osmTokyo.displayLabel === '東京都 / Tokyo',
    osmTokyo.displayLabel ?? 'none',
  ))

  const english = buildLiveIntelLanguageFields({
    headline: 'Major earthquake strikes Los Angeles',
    summary: 'A magnitude 5.1 earthquake was reported.',
  })
  results.push(check(
    'english_source_stays_original_only',
    english.originalLanguage === 'en' && english.englishHeadline === null && english.translationState === 'ORIGINAL_ONLY',
    `${english.originalLanguage}:${english.translationState}`,
  ))

  return results
}

export function runLiveIntelLanguageValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLiveIntelLanguageValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra live intel language: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
