'use client'

import { HvsEditorShell } from '@/components/war-room/higher-vision-studios/HvsEditorShell'
import { HvsModuleSurface } from '@/components/war-room/higher-vision-studios/HvsModuleSurface'

export default function HvsAiDirectorPage() {
  return (
    <HvsModuleSurface title="AI Director" kicker="Structured EditOps · never UI clicking" status="live">
      <p className="mb-3 text-sm text-slate-400">Modes: MANUAL · AI ASSIST · AI SUGGEST · AI FIRST CUT · AI DIRECTOR · AUTOMATIC DRAFT. Proposals validate, preview, then commit.</p>
      <HvsEditorShell />
    </HvsModuleSurface>
  )
}
