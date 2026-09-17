import { pathToFileURL } from 'node:url'
import {
  buildMediaPreviewFromSource,
  extractYoutubeVideoIdFromUrl,
  observedMediaFacts,
  sanitizeMediaPreviewForAuth,
  validateYoutubeVideoId,
} from './liveIntelMedia'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check(
    'watch_v_extracts_id',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw') === 'jNQXAC9IVRw',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw') ?? 'none',
  ))
  results.push(check(
    'watch_v_with_extra_params',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=12s') === 'jNQXAC9IVRw',
    'extra query params',
  ))
  results.push(check(
    'youtu_be_extracts_id',
    extractYoutubeVideoIdFromUrl('https://youtu.be/jNQXAC9IVRw') === 'jNQXAC9IVRw',
    extractYoutubeVideoIdFromUrl('https://youtu.be/jNQXAC9IVRw') ?? 'none',
  ))
  results.push(check(
    'embed_extracts_id',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/embed/jNQXAC9IVRw') === 'jNQXAC9IVRw',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/embed/jNQXAC9IVRw') ?? 'none',
  ))
  results.push(check(
    'shorts_extracts_id',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/shorts/jNQXAC9IVRw') === 'jNQXAC9IVRw',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/shorts/jNQXAC9IVRw') ?? 'none',
  ))
  results.push(check(
    'article_url_is_not_a_youtube_id',
    extractYoutubeVideoIdFromUrl('https://www.bbc.com/news/world-jNQXAC9IVRw') === null,
    'unrelated host rejected',
  ))
  results.push(check(
    'bare_id_from_url_helper_is_rejected',
    extractYoutubeVideoIdFromUrl('jNQXAC9IVRw') === null,
    'bare id is not an official URL form',
  ))
  results.push(check(
    'validate_dedicated_field',
    validateYoutubeVideoId('jNQXAC9IVRw') === 'jNQXAC9IVRw' && validateYoutubeVideoId('not-an-id') === null,
    'dedicated field',
  ))

  const none = buildMediaPreviewFromSource({
    sourceUrl: 'https://www.bbc.com/news/quake-1',
    provider: 'public_rss',
    retrievedAt: '2026-09-16T19:00:00.000Z',
  })
  results.push(check(
    'article_seed_is_none',
    none.type === 'NONE' && !none.posterUrl && !none.youtubeVideoId,
    none.type,
  ))

  const yt = buildMediaPreviewFromSource({
    sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    provider: 'public_rss',
    retrievedAt: '2026-09-16T19:00:00.000Z',
  })
  results.push(check(
    'official_youtube_url_builds_muted_embed',
    yt.type === 'YT_MUTE_EMBED'
      && yt.youtubeVideoId === 'jNQXAC9IVRw'
      && yt.posterUrl === 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg'
      && yt.previewUrl === 'https://www.youtube.com/embed/jNQXAC9IVRw?autoplay=1&mute=1&playsinline=1'
      && yt.accessClass === 'PUBLIC',
    `${yt.type}:${yt.youtubeVideoId}:${yt.posterUrl}`,
  ))

  const privateMedia = buildMediaPreviewFromSource({
    sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    provider: 'commander_archive',
    retrievedAt: '2026-09-16T19:00:00.000Z',
    accessClass: 'COMMANDER_PRIVATE',
  })
  const stripped = sanitizeMediaPreviewForAuth(privateMedia, 'AUTH_REQUIRED')
  results.push(check(
    'commander_private_not_serialized_publicly',
    stripped.type === 'NONE'
      && !stripped.youtubeVideoId
      && !stripped.posterUrl
      && !stripped.previewUrl
      && stripped.accessClass === 'PUBLIC',
    JSON.stringify(stripped),
  ))
  const kept = sanitizeMediaPreviewForAuth(privateMedia, 'AUTHENTICATED')
  results.push(check(
    'commander_private_kept_when_authenticated',
    kept.type === 'YT_MUTE_EMBED' && kept.youtubeVideoId === 'jNQXAC9IVRw',
    kept.type,
  ))

  const providerAuth = buildMediaPreviewFromSource({
    youtubeVideoId: 'jNQXAC9IVRw',
    provider: 'exa',
    retrievedAt: '2026-09-16T19:00:00.000Z',
    accessClass: 'PROVIDER_AUTH',
  })
  results.push(check(
    'provider_auth_stripped_without_session',
    sanitizeMediaPreviewForAuth(providerAuth, 'AUTH_REQUIRED').type === 'NONE',
    sanitizeMediaPreviewForAuth(providerAuth, 'AUTH_REQUIRED').type,
  ))

  const facts = observedMediaFacts(yt)
  results.push(check(
    'observed_facts_are_provenance_not_analysis',
    facts.includes('MEDIA TYPE: YT_MUTE_EMBED')
      && facts.includes('YOUTUBE VIDEO ID: jNQXAC9IVRw')
      && facts.some(line => /does not confirm the story/i.test(line))
      && !facts.some(line => /confirmed because/i.test(line)),
    facts.join(' | '),
  ))

  return results
}

export function runLiveIntelMediaValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLiveIntelMediaValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra live intel media: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
