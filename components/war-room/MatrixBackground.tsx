'use client'

import { useSyncExternalStore } from 'react'
import { MatrixCodeRain } from '@/components/MatrixCodeRain'

function subscribeToReducedMotion(onStoreChange: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getReducedMotionSnapshot() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Layered command-center atmosphere: canvas code rain, depth gradients,
 * fine grid, scanlines, and light CSS particles. Honors prefers-reduced-motion.
 */
export function MatrixBackground() {
  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    () => false
  )

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#020617]"
      aria-hidden
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-5%,rgba(15,23,42,0.95)_0%,transparent_50%),radial-gradient(ellipse_70%_45%_at_15%_85%,rgba(2,6,23,0.85)_0%,transparent_45%),radial-gradient(ellipse_70%_45%_at_85%_85%,rgba(2,6,23,0.85)_0%,transparent_45%),radial-gradient(ellipse_80%_50%_at_50%_100%,rgba(1,4,9,1)_0%,#00040a_100%)]"
        style={{ mixBlendMode: 'normal' }}
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          background:
            'radial-gradient(ellipse 40% 30% at 10% 15%, rgba(212,175,55,0.35), transparent), radial-gradient(ellipse 35% 28% at 90% 20%, rgba(212,175,55,0.22), transparent)',
        }}
      />
      {!reduceMotion ? <MatrixCodeRain /> : null}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,65,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,65,0.07) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 88% 72% at 50% 42%, black 18%, transparent 75%)',
        }}
      />
      <div
        className={`war-room-matrix-particles absolute inset-0 ${reduceMotion ? '' : 'opacity-35'}`}
        style={{
          backgroundImage: [
            'radial-gradient(circle at 12% 22%, rgba(0,255,65,0.1) 0, transparent 0.35%)',
            'radial-gradient(circle at 78% 18%, rgba(0,255,65,0.08) 0, transparent 0.3%)',
            'radial-gradient(circle at 44% 68%, rgba(0,255,65,0.06) 0, transparent 0.28%)',
            'radial-gradient(circle at 88% 72%, rgba(212,175,55,0.05) 0, transparent 0.25%)',
            'radial-gradient(circle at 22% 82%, rgba(148,163,184,0.06) 0, transparent 0.22%)',
            'radial-gradient(circle at 62% 38%, rgba(0,255,65,0.05) 0, transparent 0.2%)',
          ].join(', '),
          maskImage: 'radial-gradient(ellipse 100% 80% at 50% 45%, black 5%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.32]"
        style={{
          background: `
            linear-gradient(to right, rgba(0,255,65,0.08), transparent 18%, transparent 82%, rgba(0,255,65,0.08)),
            linear-gradient(to bottom, rgba(0,255,65,0.05), transparent 24%)
          `,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(0,0,0,0.55) 0%, transparent 14%, transparent 86%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      <div
        className="war-room-scanlines absolute inset-0 opacity-[0.032]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.32) 2px, rgba(255,255,255,0.32) 3px)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(ellipse 120% 90% at 50% 50%, transparent 35%, rgba(0,0,0,0.5) 100%)',
        }}
      />
    </div>
  )
}
