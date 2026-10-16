'use client'

import { useEffect, useRef } from 'react'

/**
 * Deep-space backdrop. One small canvas, ~120 stars, slow drift, throttled to a low frame rate, DPR capped at 1.
 * It draws ONCE (static) when motion is reduced, the tab is hidden, or `paused` is set (e.g. while the local model/Foundry holds the GPU),
 * so it never competes with local inference. It encodes no status: truthful signals live in ProgressStars.
 */
export function StarfieldCanvas({ paused = false, reducedMotion = false, fps = 12 }: { paused?: boolean; reducedMotion?: boolean; fps?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let width = 0
    let height = 0
    type Star = { x: number; y: number; z: number; tw: number }
    let stars: Star[] = []
    const seed = (n: number) => { let s = n; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
    const rand = seed(7)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      canvas.width = width
      canvas.height = height
      const count = Math.min(150, Math.max(60, Math.floor((width * height) / 9000)))
      stars = Array.from({ length: count }, () => ({ x: rand() * width, y: rand() * height, z: 0.2 + rand() * 0.8, tw: rand() * Math.PI * 2 }))
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height)
      const bg = ctx.createRadialGradient(width / 2, height * 0.55, 0, width / 2, height * 0.55, Math.max(width, height) * 0.75)
      bg.addColorStop(0, '#071420')
      bg.addColorStop(0.6, '#03070d')
      bg.addColorStop(1, '#010204')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, width, height)
      for (const s of stars) {
        const a = 0.35 + 0.65 * s.z * (0.75 + 0.25 * Math.sin(t / 1800 + s.tw))
        ctx.fillStyle = `rgba(190,230,255,${a.toFixed(3)})`
        const r = 0.4 + s.z * 1.1
        ctx.fillRect(s.x, s.y, r, r)
      }
    }

    let raf = 0
    let last = 0
    let running = false
    const frameMs = 1000 / Math.max(2, fps)
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < frameMs) return
      last = now
      for (const s of stars) { s.x -= 0.06 * s.z; if (s.x < -2) s.x = width + 2 }
      draw(now)
    }
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(tick) } }
    const stop = () => { running = false; cancelAnimationFrame(raf) }

    resize()
    draw(0)
    const animate = !paused && !reducedMotion
    const onVisibility = () => { if (document.hidden) stop(); else if (animate) start() }
    if (animate && !document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); draw(performance.now()) }) : null
    ro?.observe(canvas)
    return () => { stop(); ro?.disconnect(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [paused, reducedMotion, fps])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" data-testid="immersive-starfield" data-animated={paused || reducedMotion ? 'false' : 'true'} />
}
