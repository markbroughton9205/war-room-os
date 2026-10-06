import type { Metadata } from 'next'
import { HvsHomeScreen } from '@/components/war-room/higher-vision-studios/HvsHomeScreen'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Higher Vision Studios — War Room',
  description: 'Direct a scene, ad, movie sequence, trailer, show, or video in ordinary language.',
}

export default function HigherVisionStudiosHomePage() {
  return <HvsHomeScreen />
}
