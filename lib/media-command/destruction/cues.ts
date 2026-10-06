import type { HvsAudioCue, HvsCameraFxCue, HvsDestructionEvent, HvsMaterialId, HvsVolumeCue } from './types'

export function audioCueClass(materialId: HvsMaterialId | null, type: HvsDestructionEvent['type']): string | null {
  if (materialId === 'CONCRETE' && (type === 'CHUNK_IMPACT' || type === 'GROUND_IMPACT')) return 'concrete_impact'
  if (materialId === 'BRICK' && type === 'GROUND_IMPACT') return 'brick_impact'
  if (materialId === 'GLASS' && type === 'CONSTRAINT_BREAK') return 'glass_break'
  if (materialId === 'WOOD' && type === 'CHUNK_IMPACT') return 'wood_crack'
  if (materialId === 'METAL' && type === 'MAJOR_COLLAPSE') return 'metal_groan'
  if (materialId === 'DRYWALL' && type === 'CHUNK_IMPACT') return 'drywall_thud'
  if (materialId === 'STONE' && type === 'GROUND_IMPACT') return 'stone_impact'
  if (type === 'MAJOR_COLLAPSE') return 'collapse_body'
  if (type === 'CONSTRAINT_BREAK') return 'support_break'
  return null
}

export function cuesFromEvents(events: HvsDestructionEvent[], dustClass: 'GENTLE' | 'MODERATE' | 'STRONG', shakeClass: 'GENTLE' | 'MODERATE' | 'STRONG'): {
  audio: HvsAudioCue[]
  volume: HvsVolumeCue[]
  camera: HvsCameraFxCue[]
} {
  const audio: HvsAudioCue[] = []
  const volume: HvsVolumeCue[] = []
  const camera: HvsCameraFxCue[] = []
  let impacts = 0
  for (const event of events) {
    const cueClass = audioCueClass(event.materialId, event.type)
    if (cueClass && audio.length < 32) {
      audio.push({ time: event.time, cueClass, materialId: event.materialId, sourceEventId: event.id })
    }
    if ((event.type === 'GROUND_IMPACT' || event.type === 'MAJOR_COLLAPSE') && volume.length < 16) {
      volume.push({
        type: 'DUST',
        time: event.time,
        position: event.position,
        bounds: {
          min: { x: event.position.x - 0.4, y: 0, z: event.position.z - 0.4 },
          max: { x: event.position.x + 0.4, y: 0.8, z: event.position.z + 0.4 },
        },
        materialId: event.materialId ?? 'CONCRETE',
        intensityClass: dustClass,
        duration: event.type === 'MAJOR_COLLAPSE' ? 2.4 : 1.2,
      })
    }
    if (event.type === 'MAJOR_COLLAPSE' || (event.type === 'GROUND_IMPACT' && impacts++ % 6 === 0)) {
      if (camera.length < 8) {
        camera.push({
          time: event.time,
          duration: event.type === 'MAJOR_COLLAPSE' ? 0.8 : 0.28,
          type: event.type === 'MAJOR_COLLAPSE' ? 'SHAKE' : 'GRIT',
          intensityClass: shakeClass,
          sourceEventId: event.id,
        })
      }
    }
  }
  if (volume.length > 0 && !camera.some(cue => cue.type === 'HAZE')) {
    camera.push({
      time: volume[0].time,
      duration: 1.5,
      type: 'HAZE',
      intensityClass: dustClass,
      sourceEventId: volume[0] ? events.find(event => event.time === volume[0].time)?.id ?? events[0].id : events[0].id,
    })
  }
  return { audio, volume, camera }
}
