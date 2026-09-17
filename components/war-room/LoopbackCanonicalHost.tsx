'use client'

import { useEffect } from 'react'

/** Host-only wr_local_session cannot be shared between localhost and 127.0.0.1. Canonical UI host is 127.0.0.1. */
export function LoopbackCanonicalHost() {
  useEffect(() => {
    const hostname = window.location.hostname.toLowerCase()
    if (hostname !== 'localhost' && hostname !== '::1') return
    const next = new URL(window.location.href)
    next.hostname = '127.0.0.1'
    window.location.replace(next.toString())
  }, [])
  return null
}
