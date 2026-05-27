'use client'

import { memo, useEffect, useRef, useState } from 'react'

const CHARSET = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF'
const GREEN = '0, 255, 102'

type Stream = {
  x: number
  y: number
  speed: number
  length: number
  fontSize: number
}

function pickChar() {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)] ?? '0'
}

function makeStreams(width: number, height: number, mobile: boolean): Stream[] {
  const fontSize = mobile ? 11 : 13
  const columnWidth = fontSize * 1.8
  const columnCount = Math.min(mobile ? 18 : 42, Math.ceil(width / columnWidth))

  return Array.from({ length: columnCount }, (_, index) => ({
    x: index * columnWidth + Math.random() * fontSize,
    y: Math.random() * height,
    speed: 22 + Math.random() * 36,
    length: 6 + Math.floor(Math.random() * 12),
    fontSize,
  }))
}

export const MatrixRain = memo(function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const streamsRef = useRef<Stream[]>([])
  const lastTimeRef = useRef(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const narrow = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      setReducedMotion(motion.matches)
      setMobile(narrow.matches)
    }
    sync()
    motion.addEventListener('change', sync)
    narrow.addEventListener('change', sync)
    return () => {
      motion.removeEventListener('change', sync)
      narrow.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    const maxDpr = mobile ? 1 : 1.25

    const resize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      streamsRef.current = makeStreams(width, height, mobile)
    }

    const draw = (time: number) => {
      if (document.visibilityState !== 'visible') {
        lastTimeRef.current = time
        rafRef.current = window.requestAnimationFrame(draw)
        return
      }

      const width = window.innerWidth
      const height = window.innerHeight
      const delta = Math.min(64, time - (lastTimeRef.current || time))
      lastTimeRef.current = time

      context.fillStyle = 'rgba(0, 0, 0, 0.14)'
      context.fillRect(0, 0, width, height)
      context.textAlign = 'center'
      context.font = `${streamsRef.current[0]?.fontSize ?? 13}px ui-monospace, monospace`

      for (const stream of streamsRef.current) {
        stream.y += stream.speed * (delta / 1000)
        if (stream.y - stream.length * stream.fontSize > height + 40) {
          stream.y = -Math.random() * height * 0.25
        }

        for (let i = 0; i < stream.length; i++) {
          const y = stream.y - i * stream.fontSize
          if (y < -stream.fontSize || y > height + stream.fontSize) continue
          const fade = Math.max(0, 1 - i / stream.length)
          const alpha = (i === 0 ? 0.22 : 0.1 * fade) * (mobile ? 0.75 : 1)
          context.fillStyle = `rgba(${GREEN}, ${alpha})`
          context.fillText(pickChar(), stream.x, y)
        }
      }

      rafRef.current = window.requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    rafRef.current = window.requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [mobile, reducedMotion])

  if (reducedMotion) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(0,255,102,0.04), transparent 55%)' }}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-40"
      style={{ mixBlendMode: 'screen' }}
    />
  )
})
