/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/areaLiveAudio.validation.ts
 *
 * Expand is not Play. Area Live YouTube/native stay muted unless commanderPlay is true.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { youtubeMuteEmbedUrl, youtubeUnmuteEmbedUrl } from '../liveIntelMedia'
import {
  areaLiveCommanderAudible,
  areaLiveNativeVideoMuted,
  areaLiveYoutubeIframeSrc,
} from './areaLiveMedia'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const VIDEO_ID = 'jNQXAC9IVRw'
const MUTE_URL = 'https://www.youtube.com/embed/jNQXAC9IVRw?autoplay=1&mute=1&playsinline=1'
const UNMUTE_URL = 'https://www.youtube.com/embed/jNQXAC9IVRw?autoplay=1&mute=0&playsinline=1'

function run(): CaseResult[] {
  const viewerPath = join(dirname(fileURLToPath(import.meta.url)), '../../../components/war-room/terra/AreaLiveMediaViewer.tsx')
  const shellPath = join(dirname(fileURLToPath(import.meta.url)), '../../../components/war-room/terra/TerraShell.tsx')
  const viewer = readFileSync(viewerPath, 'utf8')
  const shell = readFileSync(shellPath, 'utf8')
  const viewSrc = areaLiveYoutubeIframeSrc(VIDEO_ID, false)
  const expandSrc = areaLiveYoutubeIframeSrc(VIDEO_ID, false)
  const playSrc = areaLiveYoutubeIframeSrc(VIDEO_ID, true)

  return [
    check('mute_url_contract', youtubeMuteEmbedUrl(VIDEO_ID) === MUTE_URL, youtubeMuteEmbedUrl(VIDEO_ID)),
    check('unmute_url_is_play_only_helper', youtubeUnmuteEmbedUrl(VIDEO_ID) === UNMUTE_URL, youtubeUnmuteEmbedUrl(VIDEO_ID)),
    check('view_uses_mute_url', viewSrc === MUTE_URL && viewSrc.includes('autoplay=1') && viewSrc.includes('mute=1') && viewSrc.includes('playsinline=1'), viewSrc),
    check('expand_uses_same_mute_url', expandSrc === MUTE_URL && expandSrc === viewSrc, expandSrc),
    check('expand_does_not_contain_mute_0', !expandSrc.includes('mute=0'), expandSrc),
    check('play_uses_unmute_url', playSrc === UNMUTE_URL && areaLiveCommanderAudible(true), playSrc),
    check('commander_play_false_not_audible', areaLiveCommanderAudible(false) === false, String(areaLiveCommanderAudible(false))),
    check('native_muted_until_play', areaLiveNativeVideoMuted(false) === true, String(areaLiveNativeVideoMuted(false))),
    check('native_unmuted_only_on_play', areaLiveNativeVideoMuted(true) === false, String(areaLiveNativeVideoMuted(true))),
    check('viewer_does_not_swap_unmute_on_expand', !viewer.includes('expanded ? youtubeUnmuteEmbedUrl') && !viewer.includes('youtubeUnmuteEmbedUrl('), viewer.includes('areaLiveYoutubeIframeSrc') ? 'uses helper' : 'missing helper'),
    check('viewer_does_not_unmute_native_on_expand', !viewer.includes('muted={!expanded}') && viewer.includes('areaLiveNativeVideoMuted'), 'native helper'),
    check('viewer_iframe_key_ignores_expanded', !/iframe[\s\S]{0,400}key=\{`\$\{[^}]*expanded/.test(viewer) && viewer.includes('commanderPlay ? \'a\' : \'m\''), 'iframe key is play-gated'),
    check('viewer_resets_play_on_media_change', viewer.includes('setCommanderPlay(false)') && viewer.includes('[mediaKey]'), 'remount silent'),
    check('camera_still_is_img_only', viewer.includes('data-testid="area-live-camera-still"') && !/CAMERA_STILL[\s\S]{0,400}<(iframe|video|audio)/.test(viewer), 'still path'),
    check('shell_expand_is_not_playVideo', !shell.includes('areaLiveHoverRowId || areaLiveMediaExpanded'), shell.includes('Boolean(areaLiveHoverRowId)') ? 'hover show only' : 'playVideo missing'),
  ]
}

export function runAreaLiveAudioValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Area Live audio safety: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
