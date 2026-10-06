import type { Metadata } from 'next'
import { Hvs3DDirectorScreen } from '@/components/war-room/higher-vision-studios/Hvs3DDirectorScreen'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '3D Director — Higher Vision Studios',
  description: 'Prompt-first HVS 3D scene directing. Placeholder previs, not generated video.',
}

export default async function Hvs3DDirectorPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; project?: string }>
}) {
  const params = await searchParams
  return (
    <Hvs3DDirectorScreen
      initialPrompt={typeof params.prompt === 'string' ? params.prompt : ''}
      initialProjectId={typeof params.project === 'string' ? params.project : null}
    />
  )
}
