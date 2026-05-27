import type { Metadata } from 'next'
import { ClientProviders } from '@/components/ClientProviders'
import { WandTrail } from '@/components/WandTrail'
import './globals.css'

export const metadata: Metadata = {
  title: 'War Room — Higher Vision Inc',
  description: "Ra'el Sovereign Intelligence Platform",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-black">
        <ClientProviders>{children}</ClientProviders>
        <WandTrail />
      </body>
    </html>
  )
}