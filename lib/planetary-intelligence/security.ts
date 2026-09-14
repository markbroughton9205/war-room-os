const INJECTION_MARKERS = [
  /ignore (all|any|previous|prior) instructions/i,
  /you are now /i,
  /system prompt/i,
  /override (the )?(policy|governance|safety)/i,
  /exfiltrat/i,
  /drop table/i,
  /rm -rf/i,
  /grant (yourself|root|admin)/i,
  /invoke tool/i,
  /spend money/i,
  /deploy to production/i,
]

export function sanitizeUntrustedContent(text: string): { text: string; injectionDetected: boolean; markers: string[] } {
  const markers = INJECTION_MARKERS.filter(pattern => pattern.test(text)).map(pattern => pattern.source)
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  const wrapped = markers.length
    ? `[UNTRUSTED ARTICLE CONTENT — NOT WAR ROOM INSTRUCTION]\n${stripped}`
    : stripped
  return { text: wrapped, injectionDetected: markers.length > 0, markers }
}

export function injectionCannotExecute(text: string): boolean {
  const scanned = sanitizeUntrustedContent(text)
  return scanned.injectionDetected
    ? scanned.text.includes('UNTRUSTED ARTICLE CONTENT')
    : true
}
