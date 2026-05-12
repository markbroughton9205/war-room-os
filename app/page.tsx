'use client'

import { useState } from 'react'

export default function Home() {
  const [command, setCommand] = useState('')
  const [response, setResponse] = useState('')

  const handleSubmit = async () => {
    if (!command.trim()) return
    setResponse('Council receiving your decree...')
    setCommand('')
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold text-yellow-500 mb-2">War Room</h1>
      <p className="text-gray-400 mb-8 text-sm tracking-widest uppercase">Ra'el — Higher Vision Inc</p>
      
      <div className="w-full max-w-2xl bg-gray-900 rounded-lg p-6 mb-6 min-h-48">
        <p className="text-gray-300">{response || 'Awaiting your decree...'}</p>
      </div>

      <div className="w-full max-w-2xl flex gap-3">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Speak your decree, Ra'el..."
          className="flex-1 bg-gray-900 border border-yellow-900 rounded-lg px-4 py-3 text-white placeholder-gray-600 outline-none focus:border-yellow-500"
        />
        <button
          onClick={handleSubmit}
          className="bg-yellow-600 hover:bg-yellow-500 text-black font-bold px-6 py-3 rounded-lg"
        >
          Decree
        </button>
      </div>
    </main>
  )
}
