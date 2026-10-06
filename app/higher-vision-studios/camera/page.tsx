import type { Metadata } from 'next'
import { HvsCinemaDirectorScreen } from '@/components/war-room/higher-vision-studios/HvsCinemaDirectorScreen'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Camera — Higher Vision Studios',
  description: 'Cinema Director: natural-language movie camera direction. Structured shots, not a prompt blob.',
}

export default async function HvsCameraPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; project?: string }>
}) {
  const params = await searchParams
  return (
    <HvsCinemaDirectorScreen
      initialPrompt={typeof params.prompt === 'string' ? params.prompt : ''}
      initialProjectId={typeof params.project === 'string' ? params.project : null}
    />
  )
}
