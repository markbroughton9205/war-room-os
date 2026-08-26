'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { TerraShell } from './TerraShell'

export function GodsEyeCommandCenter({ council }: { council: ReactNode }) {
  return (
    <section className="relative h-full min-h-0 overflow-hidden rounded border border-emerald-900/60 bg-black" data-testid="gods-eye-command-center">
      <TerraShell presentation="command-center" />
      <div className="pointer-events-none absolute inset-x-2 bottom-2 top-[48%] z-20 lg:inset-y-2 lg:left-auto lg:right-2 lg:w-[46%] lg:max-w-[42rem]">
        <div className="pointer-events-auto h-full min-h-0">{council}</div>
      </div>
      <Link href="/terra" className="absolute bottom-3 left-3 z-20 rounded border border-cyan-400/35 bg-black/75 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-cyan-300 backdrop-blur-sm">
        Open full Terra workspace ↗
      </Link>
    </section>
  )
}
