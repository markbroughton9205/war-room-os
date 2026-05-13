'use client'

import { useEffect, useRef, useState } from 'react'

const CHARSET = '01│·⟨⟩{}[]λx01'

function pickChar() {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)] ?? '0'
}

function MatrixCodeRainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const colsRef = useRef<
    { x: number; y: number; speed: number; head: string; len: number; trail: string[] }[]
  >([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2)

    const layout = () => {
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const h = Math.max(1, rect.height)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const spacing = Math.max(72, w / 18)
      const n = Math.min(20, Math.max(8, Math.floor(w / spacing)))
      const cols: { x: number; y: number; speed: number; head: string; len: number; trail: string[] }[] = []
      for (let i = 0; i < n; i++) {
        const len = 4 + Math.floor(Math.random() * 5)
        cols.push({
          x: (i + 0.5) * (w / n),
          y: Math.random() * h,
          speed: 10 + Math.random() * 18,
          head: pickChar(),
          len,
          trail: Array.from({ length: Math.max(0, len - 1) }, () => pickChar()),
        })
      }
      colsRef.current = cols
    }

    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(canvas)

    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w < 1 || h < 1) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      ctx.fillStyle = 'rgba(2, 6, 23, 0.22)'
      ctx.fillRect(0, 0, w, h)

      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (const c of colsRef.current) {
        c.y += c.speed * dt
        if (c.y > h + c.len * 14) {
          c.y = -c.len * 14
          c.speed = 10 + Math.random() * 18
          c.len = 4 + Math.floor(Math.random() * 5)
          c.head = pickChar()
          c.trail = Array.from({ length: Math.max(0, c.len - 1) }, () => pickChar())
        } else if (Math.random() < 0.004 * dt * 60) {
          c.head = pickChar()
        }

        for (let i = 0; i < c.len; i++) {
          const py = c.y - i * 14
          if (py < -14 || py > h + 14) continue
          const ch = i === 0 ? c.head : (c.trail[i - 1] ?? '0')
          const fade = 1 - i / (c.len + 1)
          const blue = `rgba(56, 189, 248, ${0.04 + fade * 0.1})`
          const gold = `rgba(212, 175, 55, ${0.02 + fade * 0.05})`
          ctx.fillStyle = i === 0 ? 'rgba(125, 211, 252, 0.14)' : i < 2 ? blue : gold
          ctx.fillText(ch, c.x, py)
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full opacity-[0.55]"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}

/**
 * Layered command-center atmosphere: sparse canvas code rain, depth gradients,
 * fine grid, scanlines, and light CSS particles. Honors prefers-reduced-motion.
 */
export function MatrixBackground() {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(mq.matches)
    const onChange = () => setReduceMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#020617]"
      aria-hidden
    >
      {/* Deep base + layered radial depth */}
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-5%,rgba(15,23,42,0.95)_0%,transparent_50%),radial-gradient(ellipse_70%_45%_at_15%_85%,rgba(2,6,23,0.85)_0%,transparent_45%),radial-gradient(ellipse_70%_45%_at_85%_85%,rgba(2,6,23,0.85)_0%,transparent_45%),radial-gradient(ellipse_80%_50%_at_50%_100%,rgba(1,4,9,1)_0%,#00040a_100%)]"
        style={{ mixBlendMode: 'normal' }}
      />
      {/* Subtle gold lift — corners */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          background:
            'radial-gradient(ellipse 40% 30% at 10% 15%, rgba(212,175,55,0.35), transparent), radial-gradient(ellipse 35% 28% at 90% 20%, rgba(212,175,55,0.22), transparent)',
        }}
      />
      {/* Code rain (canvas) */}
      <div className="absolute inset-0 opacity-90">
        {!reduceMotion ? <MatrixCodeRainCanvas /> : null}
      </div>
      {/* Fine matrix grid */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(56,189,248,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(56,189,248,0.07) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 88% 72% at 50% 42%, black 18%, transparent 75%)',
        }}
      />
      {/* Faint floating particles */}
      <div
        className={`war-room-matrix-particles absolute inset-0 ${reduceMotion ? '' : 'opacity-40'}`}
        style={{
          backgroundImage: [
            'radial-gradient(circle at 12% 22%, rgba(56,189,248,0.12) 0, transparent 0.35%)',
            'radial-gradient(circle at 78% 18%, rgba(125,211,252,0.08) 0, transparent 0.3%)',
            'radial-gradient(circle at 44% 68%, rgba(56,189,248,0.06) 0, transparent 0.28%)',
            'radial-gradient(circle at 88% 72%, rgba(212,175,55,0.05) 0, transparent 0.25%)',
            'radial-gradient(circle at 22% 82%, rgba(148,163,184,0.06) 0, transparent 0.22%)',
            'radial-gradient(circle at 62% 38%, rgba(56,189,248,0.05) 0, transparent 0.2%)',
          ].join(', '),
          maskImage: 'radial-gradient(ellipse 100% 80% at 50% 45%, black 5%, transparent 70%)',
        }}
      />
      {/* Electric blue edge bloom */}
      <div
        className="absolute inset-0 opacity-[0.42]"
        style={{
          background: `
            linear-gradient(to right, rgba(56,189,248,0.12), transparent 18%, transparent 82%, rgba(56,189,248,0.1)),
            linear-gradient(to bottom, rgba(56,189,248,0.07), transparent 24%)
          `,
        }}
      />
      {/* Cinematic side vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(0,0,0,0.55) 0%, transparent 14%, transparent 86%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      {/* Scanline band (slow CSS animation) */}
      <div
        className="war-room-scanlines absolute inset-0 opacity-[0.032]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.32) 2px, rgba(255,255,255,0.32) 3px)',
        }}
      />
      {/* Bottom + corner vignette */}
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
