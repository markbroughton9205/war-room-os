import { pathToFileURL } from 'node:url'
import { translateLiveIntelText } from './liveIntelTranslate'
import { applyLiveIntelTranslation, buildLiveIntelLanguageFields } from './liveIntelLanguage'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const original = buildLiveIntelLanguageFields({ headline: '地震で鉄道に遅れ' })

  const translated = await translateLiveIntelText({
    sourceText: '地震で鉄道に遅れ',
    sourceLanguage: 'ja',
    nowIso: '2026-09-16T20:00:00.000Z',
    fetchImpl: (async () => jsonResponse({
      responseStatus: 200,
      responseData: { translatedText: 'Earthquake causes train delays' },
    })) as typeof fetch,
  })
  results.push(check('translate_returns_english_without_touching_source', Boolean(translated.ok && translated.ok && translated.translation.translationText === 'Earthquake causes train delays' && translated.translation.sourceText === '地震で鉄道に遅れ'), JSON.stringify(translated)))

  if (translated.ok) {
    const applied = applyLiveIntelTranslation(original, translated.translation)
    results.push(check(
      'applied_translation_keeps_japanese_headline',
      applied.originalHeadline === '地震で鉄道に遅れ' && applied.englishHeadline === 'Earthquake causes train delays' && applied.translationState === 'TRANSLATED',
      `${applied.originalHeadline} | ${applied.englishHeadline}`,
    ))
  }

  const englishBlocked = await translateLiveIntelText({
    sourceText: 'Earthquake causes train delays',
    sourceLanguage: 'en',
    fetchImpl: (async () => jsonResponse({ responseStatus: 200, responseData: { translatedText: 'should not run' } })) as typeof fetch,
  })
  results.push(check('english_source_is_not_retranslated', !englishBlocked.ok, JSON.stringify(englishBlocked)))

  const failed = await translateLiveIntelText({
    sourceText: '地震で鉄道に遅れ',
    sourceLanguage: 'ja',
    fetchImpl: (async () => jsonResponse({ error: 'nope' }, 503)) as typeof fetch,
  })
  results.push(check('provider_failure_is_honest', !failed.ok, JSON.stringify(failed)))

  const echo = await translateLiveIntelText({
    sourceText: '地震で鉄道に遅れ',
    sourceLanguage: 'ja',
    fetchImpl: (async () => jsonResponse({
      responseStatus: 200,
      responseData: { translatedText: '地震で鉄道に遅れ' },
    })) as typeof fetch,
  })
  results.push(check('echoed_source_is_not_invented_english', !echo.ok, JSON.stringify(echo)))

  return results
}

export async function runLiveIntelTranslateValidation(): Promise<CaseResult[]> {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLiveIntelTranslateValidation().then(results => {
    const failed = results.filter(result => !result.pass)
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    console.log(`Terra live intel translate: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
    if (failed.length) process.exit(1)
  })
}
