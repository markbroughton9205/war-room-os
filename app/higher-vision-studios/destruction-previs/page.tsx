import type { Metadata } from 'next'
import { HvsDestructionPrevisScreen } from '@/components/war-room/higher-vision-studios/HvsDestructionPrevisScreen'
import { HVS_DESTRUCTION_ACCEPTANCE_PROJECT_ID } from '@/lib/media-command/destruction/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Destruction Previs — Higher Vision Studios',
  description: 'Small-tier wall collapse previs. Cached transforms, not a second 3D product.',
}

export default async function HvsDestructionPrevisPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const params = await searchParams
  const projectId = typeof params.project === 'string' && params.project ? params.project : HVS_DESTRUCTION_ACCEPTANCE_PROJECT_ID
  return <HvsDestructionPrevisScreen projectId={projectId} />
}
