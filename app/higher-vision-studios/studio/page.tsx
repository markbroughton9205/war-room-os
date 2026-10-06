'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HvsEditorShell } from '@/components/war-room/higher-vision-studios/HvsEditorShell'
import { hvsStudioHref, readHvsResume } from '@/lib/media-command/navigation'

export default function HvsStudioPage() {
  const router = useRouter()
  useEffect(() => {
    const projectId = readHvsResume()?.projectId
    if (projectId) router.replace(hvsStudioHref(projectId))
  }, [router])
  return <HvsEditorShell />
}
