import type { Metadata } from 'next'
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
        {children}
        <WandTrail />
      </body>
    </html>
  )
}