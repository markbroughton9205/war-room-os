export type TrafficCameraSequenceItem = {
  id: string
  layerId: string
}

/** Resolve one adjacent camera from the frozen bounded player sequence. No wrap is intentional. */
export function adjacentTrafficCamera<T extends TrafficCameraSequenceItem>(
  sequence: readonly T[],
  current: TrafficCameraSequenceItem,
  offset: -1 | 1,
): T | null {
  const index = sequence.findIndex(camera => camera.id === current.id && camera.layerId === current.layerId)
  if (index < 0) return null
  return sequence[index + offset] ?? null
}
