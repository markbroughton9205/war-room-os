'use client'

import { useParams } from 'next/navigation'
import { HvsEditorShell } from '@/components/war-room/higher-vision-studios/HvsEditorShell'

export default function HvsProjectEditorPage() {
  const params = useParams<{ id: string }>()
  return <HvsEditorShell projectId={String(params.id)} />
}
