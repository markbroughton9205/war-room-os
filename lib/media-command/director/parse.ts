import type { HvsDirectorTiming } from './types'

export const DIRECTOR_ACCEPT_PROMPT =
  "Create an 11-second nighttime action scene. Ra'el is standing beside a black car in an alley. Start with a 24mm wide establishing shot. Cut low behind the car. Have Ra'el walk toward a doorway. Orbit clockwise around him. At about six seconds the building behind him begins collapsing. Pull the camera backward during the collapse. Nearby background actors react and move away. Finish on an 85mm close-up of Ra'el while dust crosses the foreground."

export function isDirectorOrchestrationPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  const destruction = /\b(collaps\w*|debris|destruction|pull the camera backward|dust crosses)\b/.test(lower)
  const subjects = /\b(person|ra'?el|car|alley|building|doorway|background actors?)\b/.test(lower)
  return destruction && subjects
}

export function isDirectorFollowUp(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  return /\b(orbit slower|collapse|doorway before|final close-up|tighter|camera lower|keep more of the falling|move the car|reach the door|later|slower|wider|lower and tighter|look back|move faster|more background|lower the camera|collapse later|rael|ra'el)\b/.test(lower)
}

export function defaultDirectorTiming(prompt: string): HvsDirectorTiming {
  const lower = prompt.toLowerCase()
  const durationMatch = prompt.match(/(\d+(?:\.\d+)?)\s*-?\s*seconds?/i)
  const durationSec = durationMatch ? Number(durationMatch[1]) : 11
  const collapseMatch = lower.match(/(?:at about|at|around)\s+(\d+(?:\.\d+)?)\s*seconds?/)
  const collapseSec = collapseMatch ? Number(collapseMatch[1]) : Math.min(6, durationSec * 0.55)
  const orbitStartSec = Math.min(4, durationSec * 0.36)
  const orbitEndSec = collapseSec
  const walkArriveSec = Math.max(orbitStartSec + 1, collapseSec - 0.4)
  const closeupStartSec = Math.min(durationSec - 2, Math.max(collapseSec + 2.5, durationSec * 0.8))
  const crowdMatch = lower.match(/(\d+)\s+background/)
  return {
    durationSec,
    walkArriveSec,
    collapseSec,
    retreatSec: collapseSec + 0.1,
    impactSec: collapseSec + 1.2,
    dustSec: collapseSec + 1.4,
    closeupStartSec,
    orbitStartSec,
    orbitEndSec,
    closeupHeight: 1.48,
    closeupDistance: 2.15,
    closeupFocalMm: /\b85mm\b/.test(lower) ? 85 : 85,
    establishFocalMm: /\b24mm\b/.test(lower) ? 24 : 24,
    revealFocalMm: 28,
    orbitFocalMm: 35,
    retreatFocalMm: 35,
    crowdReactSec: collapseSec + 0.2,
    crowdFleeSec: collapseSec + 0.35,
    crowdCount: crowdMatch ? Math.max(12, Number(crowdMatch[1])) : 12,
    lookBack: false,
    lookBackSec: collapseSec + 0.15,
    turnToCameraSec: collapseSec + 0.9,
  }
}

export function directorCreativeGoal(prompt: string): string {
  if (/collaps/i.test(prompt)) return "Night alley action: geography, Ra'el walk, collapse, crowd reaction, close-up."
  return prompt.slice(0, 120)
}
