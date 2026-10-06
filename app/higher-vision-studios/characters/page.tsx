import type { Metadata } from 'next'
import { HvsDigitalHumanScreen } from '@/components/war-room/higher-vision-studios/HvsDigitalHumanScreen'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Characters — Higher Vision Studios',
  description: 'Ra\'el, fictional actors, background cast, and webcam performance capture.',
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const params = await searchParams
  return <HvsDigitalHumanScreen initialProjectId={typeof params.project === 'string' ? params.project : null} />
}
