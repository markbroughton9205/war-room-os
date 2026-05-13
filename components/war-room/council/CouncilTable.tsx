import type { CouncilFamily } from '@/lib/mockCouncilData'
import { MOCK_COUNCIL_FAMILIES } from '@/lib/mockCouncilData'
import { FamilySeat } from './FamilySeat'

function seatDeg(index: number, total: number) {
  return index * (360 / Math.max(1, total)) - 90
}

function seatStyle(deg: number, orbitFrac: number) {
  const rad = (deg * Math.PI) / 180
  const x = orbitFrac * Math.cos(rad)
  const y = orbitFrac * Math.sin(rad)
  return {
    left: `calc(50% + ${(x * 100).toFixed(4)}%)`,
    top: `calc(50% + ${(y * 100).toFixed(4)}%)`,
    transform: 'translate(-50%, -50%)' as const,
  }
}

function CouncilHub({ className = '' }: { className?: string }) {
  return (
    <div
      className={[
        'relative flex aspect-square w-[min(7.5rem,28vw)] max-w-[7.5rem] flex-col items-center justify-center rounded-full border border-[#FFD700]/30 bg-black/60 font-mono text-[10px] text-slate-300 shadow-[0_0_40px_rgba(56,189,248,0.18),0_0_60px_rgba(255,215,0,0.08),inset_0_0_28px_rgba(0,255,65,0.06)] backdrop-blur-md',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute inset-2 rounded-full opacity-70"
        style={{
          background:
            'conic-gradient(from 180deg at 50% 50%, rgba(0,255,65,0.15), transparent, rgba(56,189,248,0.12), transparent, rgba(255,215,0,0.12), transparent)',
        }}
      />
      <span className="relative text-[9px] font-semibold uppercase tracking-[0.35em] text-[#00ff41]/90">Core</span>
      <span className="relative mt-1 text-center text-[8px] uppercase tracking-[0.2em] text-[#FFD700]/80">Council</span>
      <span className="relative mt-0.5 text-[8px] text-sky-300/70">sync</span>
    </div>
  )
}

export function CouncilTable({
  families = MOCK_COUNCIL_FAMILIES,
  className = '',
}: {
  families?: CouncilFamily[]
  className?: string
}) {
  /** Radius as fraction of box edge from center; neighbor chord = this × edge — tuned so 6 seats clear max card width */
  const orbitFrac = 0.418

  return (
    <div className={['relative', className].filter(Boolean).join(' ')}>
      {/* Narrow viewports: hub + two columns */}
      <div className="lg:hidden">
        <div className="mb-4 flex justify-center">
          <CouncilHub />
        </div>
        <div className="mx-auto grid max-w-lg grid-cols-1 gap-3 sm:max-w-none sm:grid-cols-2 sm:gap-4">
          {families.map((family) => (
            <FamilySeat
              key={family.familyName}
              family={family}
              className="mx-auto w-full max-w-[min(100%,16.5rem)] sm:max-w-[min(100%,15rem)]"
            />
          ))}
        </div>
      </div>

      {/* lg+: polar seats */}
      <div
        className="relative mx-auto hidden aspect-square w-full max-w-[min(94vw,44rem)] lg:block"
        aria-label="Council seating chart"
      >
        <div className="pointer-events-none absolute inset-[10%] rounded-full border border-sky-500/10 opacity-60" />
        <div className="pointer-events-none absolute inset-[6%] rounded-full border border-[#00ff41]/5" />

        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <CouncilHub />
        </div>

        {families.map((family, i) => {
          const deg = seatDeg(i, families.length)
          return (
            <div
              key={family.familyName}
              className="absolute z-[5]"
              style={seatStyle(deg, orbitFrac)}
            >
              <FamilySeat
                family={family}
                className="w-[min(11.25rem,30vw)] max-w-[11.25rem] xl:w-[min(12rem,31vw)] xl:max-w-[12rem]"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
