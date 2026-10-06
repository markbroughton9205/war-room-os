/**
 * Three camera concepts — never conflated:
 * 1. MULTICAM — real multiple cameras
 * 2. CAMERASPEC — AI/generated shot camera intent
 * 3. VIRTUAL CAMERA / FOLLOW — reframing existing footage
 */
export const CAMERA_CONCEPTS = {
  MULTICAM: 'multicam',
  CAMERASPEC: 'camera-spec',
  VIRTUAL_CAMERA: 'virtual-camera',
} as const

export type CameraConcept = (typeof CAMERA_CONCEPTS)[keyof typeof CAMERA_CONCEPTS]

export function describeCameraConcept(concept: CameraConcept): string {
  if (concept === 'multicam') return 'Real multiple cameras recorded as separate assets, synced as a MulticamGroup.'
  if (concept === 'camera-spec') return 'Generated/AI shot intent: size, angle, movement, lens, DOF, trajectory.'
  return 'Reframing existing footage from TrackSubject data. Not a second camera and not multicam.'
}
