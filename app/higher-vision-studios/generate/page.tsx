'use client'

import Link from 'next/link'
import { HvsModuleSurface } from '@/components/war-room/higher-vision-studios/HvsModuleSurface'
import { HVS_CANONICAL_PATH } from '@/lib/media-command/navigation'

const ITEMS = [
  { id: 'video', label: 'Generate Video', href: `${HVS_CANONICAL_PATH}/ai-video`, status: 'shell' as const, body: 'Provider-neutral VIDEO_GENERATOR jobs. No live provider is connected — this is an honest shell, not fake generation.' },
  { id: 'image', label: 'Generate Image', href: `${HVS_CANONICAL_PATH}/ai-images`, status: 'shell' as const, body: 'IMAGE_GENERATOR jobs become AssetRecords with provenance. Providers are not wired yet.' },
  { id: 'voice', label: 'Generate Voice', href: `${HVS_CANONICAL_PATH}/voice`, status: 'shell' as const, body: 'VOICE / TTS router category. Results would ingest as Assets. Not implemented as a live provider.' },
  { id: 'music', label: 'Generate Music', href: `${HVS_CANONICAL_PATH}/music`, status: 'shell' as const, body: 'MUSIC jobs remain reserved. addMusic EditOps insert existing assets onto A2.' },
  { id: 'sfx', label: 'Generate SFX', href: `${HVS_CANONICAL_PATH}/music`, status: 'shell' as const, body: 'SFX category on the Media Provider Router. No fake hits are synthesized here.' },
]

export default function HvsGeneratePage() {
  return (
    <HvsModuleSurface title="Generate" kicker="Inside Higher Vision Studios · provider jobs, not a second media system" status="boundary">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid="hvs-generate-page">
        {ITEMS.map(item => (
          <Link
            key={item.id}
            href={item.href}
            className="foundry-glass rounded-lg border border-cyan-900/40 p-4"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300">{item.label}</p>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-amber-300">SHELL — providers not connected</p>
            <p className="mt-2 text-sm text-slate-400">{item.body}</p>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Working path when a provider exists: generation job → AssetRecord → Media Library → optional timeline insert via EditOp.
        Open a project in Studio to queue blocked generateVideo / generateImage jobs against the live .hvsproj.
      </p>
    </HvsModuleSurface>
  )
}
