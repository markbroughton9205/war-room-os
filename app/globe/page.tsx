'use client'

import { useEffect, useRef, useState } from 'react'

export default function GlobePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    let angle = 0
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const r = Math.min(cx, cy) * 0.6

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      const glow = ctx!.createRadialGradient(cx, cy, r * 0.5, cx, cy, r)
      glow.addColorStop(0, 'rgba(0,255,65,0.08)')
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx!.beginPath()
      ctx!.arc(cx, cy, r * 1.3, 0, Math.PI * 2)
      ctx!.fillStyle = glow
      ctx!.fill()

      ctx!.beginPath()
      ctx!.arc(cx, cy, r, 0, Math.PI * 2)
      ctx!.strokeStyle = '#00ff41'
      ctx!.lineWidth = 1.5
      ctx!.shadowBlur = 20
      ctx!.shadowColor = '#00ff41'
      ctx!.stroke()
      ctx!.shadowBlur = 0

     for (let i = 1; i < 6; i++) {
  const lat = (i / 6) * Math.PI
  const yr = Math.sin(lat) * r
  const xr = Math.abs(Math.cos(lat)) * r
  ctx!.beginPath()
  ctx!.ellipse(cx, cy - r + yr * 2, Math.max(xr, 1), Math.max(yr * 0.3, 1), 0, 0, Math.PI * 2)
  ctx!.strokeStyle = 'rgba(0,255,65,0.15)'
  ctx!.lineWidth = 0.5
  ctx!.stroke()
}

      for (let i = 0; i < 8; i++) {
        const a = angle + (i / 8) * Math.PI * 2
        ctx!.beginPath()
        ctx!.ellipse(cx, cy, Math.abs(Math.cos(a)) * r, r, 0, 0, Math.PI * 2)
        ctx!.strokeStyle = `rgba(0,255,65,${Math.abs(Math.cos(a)) * 0.2})`
        ctx!.lineWidth = 0.5
        ctx!.stroke()
      }

      const points = [
        { x: cx - r * 0.2, y: cy - r * 0.3, label: 'AKRON, OH' },
        { x: cx + r * 0.5, y: cy + r * 0.1, label: 'CHIRIQUI, PANAMA' },
        { x: cx - r * 0.6, y: cy - r * 0.1, label: 'WEST AFRICA' },
        { x: cx + r * 0.2, y: cy - r * 0.5, label: 'EUROPE' },
      ]

      points.forEach(p => {
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, 4, 0, Math.PI * 2)
        ctx!.fillStyle = '#FFD700'
        ctx!.shadowBlur = 10
        ctx!.shadowColor = '#FFD700'
        ctx!.fill()
        ctx!.shadowBlur = 0
        ctx!.fillStyle = 'rgba(255,215,0,0.7)'
        ctx!.font = '9px monospace'
        ctx!.fillText(p.label, p.x + 8, p.y + 3)
      })

      angle += 0.003
      requestAnimationFrame(draw)
    }

    draw()

    canvas.addEventListener('click', (e) => {
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < r) {
        setInfo(`SCANNING — LAT ${(dy / r * 90).toFixed(1)} LNG ${(dx / r * 180).toFixed(1)} — INTELLIGENCE INCOMING`)
      }
    })
  }, [])

  return (
    <main className="min-h-screen bg-black relative font-mono overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute top-6 left-6 z-10">
        <h1 className="text-xl font-bold tracking-widest" style={{color:'#00ff41',textShadow:'0 0 20px #00ff41'}}>
          GLOBAL INTELLIGENCE
        </h1>
        <p className="text-xs tracking-widest mt-1" style={{color:'#FFD700'}}>
          CLICK THE GLOBE TO SCAN
        </p>
      </div>
      <a href="/war-room" className="absolute top-6 right-6 z-10 text-xs tracking-widest px-4 py-2 rounded"
        style={{border:'1px solid #FFD700',color:'#FFD700'}}>
        WAR ROOM
      </a>
      {info && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 p-4 rounded"
          style={{background:'rgba(0,0,0,0.9)',border:'1px solid #00ff41',minWidth:'300px',textAlign:'center'}}>
          <p className="text-xs tracking-widest" style={{color:'#00ff41'}}>{info}</p>
          <button onClick={() => setInfo(null)} className="mt-3 text-xs" style={{color:'#444'}}>DISMISS</button>
        </div>
      )}
    </main>
  )
}