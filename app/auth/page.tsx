'use client'

import { useState, useEffect, useRef } from 'react'

export default function Home() {
  const [command, setCommand] = useState('')
  const [log, setLog] = useState<string[]>([
    'INITIALIZING WAR ROOM SOVEREIGN INTELLIGENCE SYSTEM...',
    'HIGHER VISION INC — CLASSIFIED',
    "COMMANDER: RA'EL",
    'COUNCIL FAMILIES: ONLINE',
    '> AWAITING DECREE...',
  ])
  const [rain, setRain] = useState<{x:number,char:string,speed:number,opacity:number}[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const cols = Math.floor(canvas.width / 16)
    const drops: number[] = Array(cols).fill(1)
    const chars = 'アイウエオカキクケコ01RA3EL高視野HIGHERV1S10N戦争部屋'

    const draw = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#0f3'
      ctx.font = '14px monospace'
      drops.forEach((y, i) => {
        const char = chars[Math.floor(Math.random() * chars.length)]
        ctx.fillStyle = i % 7 === 0 ? '#FFD700' : i % 5 === 0 ? '#00ffff' : '#0f3'
        ctx.fillText(char, i * 16, y * 16)
        if (y * 16 > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      })
    }

    const interval = setInterval(draw, 50)
    return () => clearInterval(interval)
  }, [])

  const handleCommand = () => {
    if (!command.trim()) return
    const decree = command.trim().toUpperCase()
    setLog(prev => [
      ...prev,
      ``,
      `⚔ RA'EL: ${decree}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `◈ CLAUDE FAMILY ......... ONLINE`,
      `◈ CHATGPT FAMILY ........ ONLINE`,
      `◈ GROK FAMILY ........... ONLINE`,
      `◈ GEMINI FAMILY ......... ONLINE`,
      `◈ RED TEAM .............. ACTIVE`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `COUNCIL DELIBERATING...`,
      `PROPOSAL INCOMING...`,
    ])
    setCommand('')
  }

  return (
    <main className="min-h-screen bg-black font-mono flex flex-col relative overflow-hidden">

      {/* Matrix rain canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 opacity-20"
        style={{ zIndex: 0 }}
      />

      {/* Cyberpunk grid overlay */}
      <div className="absolute inset-0 opacity-5" style={{
        zIndex: 1,
        backgroundImage: 'linear-gradient(rgba(0,255,65,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.3) 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }} />

      {/* Glowing borders */}
      <div className="absolute top-0 left-0 right-0 h-px bg-green-400 opacity-60" style={{zIndex:2, boxShadow:'0 0 20px #00ff41'}} />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-yellow-400 opacity-40" style={{zIndex:2, boxShadow:'0 0 20px #FFD700'}} />
      <div className="absolute top-0 bottom-0 left-0 w-px bg-green-400 opacity-30" style={{zIndex:2}} />
      <div className="absolute top-0 bottom-0 right-0 w-px bg-green-400 opacity-30" style={{zIndex:2}} />

      {/* Content */}
      <div className="relative flex flex-col h-screen p-6" style={{zIndex:3}}>

        {/* Header */}
        <div className="mb-6 pb-4 border-b border-green-900">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-widest" style={{
                color:'#00ff41',
                textShadow:'0 0 20px #00ff41, 0 0 40px #00ff41'
              }}>
                ⚔ WAR ROOM
              </h1>
              <p className="text-xs tracking-widest mt-1" style={{color:'#FFD700'}}>
                HIGHER VISION INC — SOVEREIGN INTELLIGENCE PLATFORM
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs tracking-widest" style={{color:'#00ff41'}}>COMMANDER</div>
              <div className="text-lg font-bold tracking-widest" style={{
                color:'#FFD700',
                textShadow:'0 0 10px #FFD700'
              }}>RA'EL</div>
              <div className="text-xs" style={{color:'#444'}}>
                {new Date().toLocaleString()}
              </div>
            </div>
          </div>

          {/* Status bar */}
          <div className="flex gap-6 mt-3">
            {['CLAUDE','CHATGPT','GROK','GEMINI','RED TEAM'].map((f) => (
              <div key={f} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-400" style={{boxShadow:'0 0 6px #00ff41', animation:'pulse 2s infinite'}} />
                <span className="text-xs tracking-widest" style={{color:'#666'}}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Log */}
        <div className="flex-1 overflow-y-auto mb-4 space-y-1 pr-2" style={{
          scrollbarWidth:'thin',
          scrollbarColor:'#003300 #000'
        }}>
          {log.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed" style={{
              color: line.startsWith('⚔') ? '#FFD700' :
                     line.startsWith('◈') ? '#00ff41' :
                     line.startsWith('━') ? '#003300' :
                     line.startsWith('COUNCIL') || line.startsWith('PROPOSAL') ? '#00ccff' :
                     '#2a5a2a',
              textShadow: line.startsWith('⚔') ? '0 0 10px #FFD700' :
                          line.startsWith('◈') ? '0 0 6px #00ff41' : 'none'
            }}>
              {line || '\u00A0'}
            </p>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-green-900 pt-4">
          <div className="flex items-center gap-3 p-3 rounded" style={{
            background:'rgba(0,255,65,0.03)',
            border:'1px solid #003300',
            boxShadow:'inset 0 0 20px rgba(0,255,65,0.02)'
          }}>
            <span style={{color:'#FFD700', textShadow:'0 0 8px #FFD700'}}>⚔</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCommand()}
              placeholder="SPEAK YOUR DECREE, RA'EL..."
              className="flex-1 bg-transparent outline-none text-sm tracking-widest"
              style={{color:'#00ff41', caretColor:'#FFD700'}}
              autoFocus
            />
            <button
              onClick={handleCommand}
              className="px-4 py-1 text-xs tracking-widest rounded transition-all"
              style={{
                border:'1px solid #FFD700',
                color:'#FFD700',
                background:'transparent',
                textShadow:'0 0 8px #FFD700',
                boxShadow:'0 0 10px rgba(255,215,0,0.2)'
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,215,0,0.1)')}
              onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
            >
              DECREE
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}