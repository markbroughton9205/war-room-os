'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Cursor glow + canvas trail. Rendered only after mount so SSR and the
 * first client pass stay identical (avoids hydration mismatch from mutating
 * canvas dimensions before React hydrates).
 */
export function WandTrail() {
  const [mounted, setMounted] = useState(false)
  const tipRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trailRef = useRef<{ x: number; y: number }[]>([])
  const rafRef = useRef(0)

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setMounted(true)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const tip = tipRef.current
    const canvas = canvasRef.current
    if (!tip || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const gl = ctx

    const trail = trailRef.current
    const c = canvas
    const tipEl = tip

    function resize() {
      c.width = window.innerWidth
      c.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function onMove(e: MouseEvent) {
      tipEl.style.left = `${e.clientX}px`
      tipEl.style.top = `${e.clientY}px`
      trail.push({ x: e.clientX, y: e.clientY })
      if (trail.length > 40) trail.shift()
    }
    document.addEventListener('mousemove', onMove)

    function drawTrail() {
      gl.clearRect(0, 0, c.width, c.height)
      const n = trail.length
      for (let i = 0; i < n; i++) {
        const alpha = (i / n) * 0.6
        const size = (i / n) * 4
        gl.beginPath()
        gl.arc(trail[i].x, trail[i].y, size, 0, Math.PI * 2)
        gl.fillStyle =
          i % 3 === 0 ? `rgba(255,215,0,${alpha})` : `rgba(0,255,65,${alpha})`
        gl.fill()
      }
      rafRef.current = requestAnimationFrame(drawTrail)
    }
    drawTrail()

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafRef.current)
      trail.length = 0
    }
  }, [mounted])

  if (!mounted) return null

  return (
    <>
      <div id="wand-tip" ref={tipRef} />
      <canvas
        id="wand-trail"
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 99997,
        }}
      />
    </>
  )
}
