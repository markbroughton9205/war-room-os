'use client'

import { IconBroadcast, IconCamera } from '@/components/war-room/council/CommandIcons'
import { GODS_EYE_VIEW_MODES, type GodsEyeViewMode } from '@/lib/terra/godsEye/cameraFederation'

const MODE_HINT: Record<GodsEyeViewMode, string> = {
  EARTH: 'Globe',
  CAMERAS: 'Global camera federation',
  AREA_LIVE: 'Area cameras, live video, media, and events for the active location',
  HAZARDS: 'Hazard layers',
  INTEL: 'Live intel',
}

const MODE_LABEL: Record<GodsEyeViewMode, string> = {
  EARTH: 'EARTH',
  CAMERAS: 'CAMERAS',
  AREA_LIVE: 'AREA LIVE',
  HAZARDS: 'HAZARDS',
  INTEL: 'INTEL',
}

export function TerraGodsEyeViewMode({
  mode,
  onChange,
}: {
  mode: GodsEyeViewMode
  onChange: (mode: GodsEyeViewMode) => void
}) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded border border-cyan-400/30 bg-black/80 px-1.5 py-1 text-[9px] uppercase tracking-widest text-slate-300 shadow-[0_0_18px_rgba(34,211,238,0.08)] backdrop-blur-md"
      data-testid="gods-eye-view-mode"
    >
      <span className="px-1 font-bold text-cyan-200">God's Eye</span>
      {GODS_EYE_VIEW_MODES.map(item => (
        <button
          key={item}
          type="button"
          title={MODE_HINT[item]}
          data-testid={`gods-eye-mode-${item.toLowerCase()}`}
          aria-pressed={mode === item}
          onClick={() => onChange(item)}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-bold ${
            mode === item
              ? 'border-cyan-300/70 text-cyan-200'
              : 'border-white/15 text-slate-400 hover:border-cyan-300/50 hover:text-cyan-200'
          }`}
        >
          {item === 'CAMERAS' ? <IconCamera size={11} /> : null}
          {item === 'AREA_LIVE' ? <IconBroadcast size={11} /> : null}
          {MODE_LABEL[item]}
        </button>
      ))}
    </div>
  )
}
