'use client'

import { useParams } from 'next/navigation'
import { HvsEditorShell } from '@/components/war-room/higher-vision-studios/HvsEditorShell'
import { HvsProductionWorkspace } from '@/components/war-room/higher-vision-studios/HvsProductionWorkspace'
import type { HvsProductionPageId } from '@/lib/media-command/production-pages'

export function HvsProjectPageRoute({ page }: { page: HvsProductionPageId }) {
  const params = useParams<{ id: string }>()
  const projectId = String(params.id)
  if (page === 'edit' || page === 'cut') return <HvsEditorShell projectId={projectId} />
  return <HvsProductionWorkspace projectId={projectId} page={page} />
}
