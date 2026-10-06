'use client'

import { useParams } from 'next/navigation'
import { HvsProjectWorkspace } from '@/components/war-room/higher-vision-studios/HvsProjectWorkspace'

export default function HvsProjectPage() {
  const params = useParams<{ id: string }>()
  return <HvsProjectWorkspace projectId={String(params.id)} />
}
