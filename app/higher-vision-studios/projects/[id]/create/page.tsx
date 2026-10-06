'use client'

import { useParams } from 'next/navigation'
import { HvsAiCreateStudio } from '@/components/war-room/higher-vision-studios/HvsAiCreateStudio'

export default function HvsProjectCreatePage() {
  const params = useParams<{ id: string }>()
  return <HvsAiCreateStudio projectId={String(params.id)} />
}
