export function attemptIdFor(input: {
  roundId: string
  family: string
  stage: string
  attempt: number
}): string {
  return `${input.roundId}:${input.family}:${input.stage}:attempt-${input.attempt}`
}

export function logicalMessageIdFor(input: { roundId: string; family: string; stage: string }): string {
  return `${input.roundId}:${input.family}:${input.stage}`
}
