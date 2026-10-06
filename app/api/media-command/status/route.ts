import { NextResponse } from 'next/server'
import { LUXURY_BEAUTY_V1, listThemeSpecs } from '@/lib/media-command/themes'
import { FILTER_SPECS } from '@/lib/media-command/filters'
import { EFFECT_KIND_SPECS } from '@/lib/media-command/effects'
import { CAMERA_CONCEPTS, describeCameraConcept } from '@/lib/media-command/camera'
import { HVS_DISPLAY_NAME, HVS_KERNEL_NAMESPACE, HVS_SLICE } from '@/lib/media-command/navigation'
import { EDIT_COMMAND_KINDS } from '@/lib/media-command/edit-commands'
import { resolveFfmpegTools, chooseEncoder, reportNvenc, bundledToolPath } from '@/lib/media-command/ffmpeg'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const ffmpeg = await resolveFfmpegTools()
  const encoder = await chooseEncoder()
  const nvenc = await reportNvenc()
  return NextResponse.json({
    name: HVS_DISPLAY_NAME,
    kernel: HVS_KERNEL_NAMESPACE,
    slice: HVS_SLICE,
    theme: LUXURY_BEAUTY_V1,
    themes: listThemeSpecs(),
    filters: FILTER_SPECS,
    effects: EFFECT_KIND_SPECS,
    editCommands: EDIT_COMMAND_KINDS,
    camera: {
      multicam: describeCameraConcept(CAMERA_CONCEPTS.MULTICAM),
      cameraSpec: describeCameraConcept(CAMERA_CONCEPTS.CAMERASPEC),
      virtualCamera: describeCameraConcept(CAMERA_CONCEPTS.VIRTUAL_CAMERA),
    },
    ffmpeg,
    bundledTools: {
      ffmpeg: bundledToolPath('ffmpeg'),
      ffprobe: bundledToolPath('ffprobe'),
    },
    encoder,
    nvenc,
    nvencUsable: nvenc.status === 'PASS',
    authority: {
      mayAnalyze: true,
      mayEdit: true,
      mayGenerate: true,
      mayRenderDrafts: true,
      mayPublish: false,
      maySpend: false,
      mayDeleteOriginals: false,
    },
  })
}
