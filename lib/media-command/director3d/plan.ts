import { toSeconds } from '../time'
import { nid, type Hvs3DIntent, type HvsScenePlan } from './types'

export function buildScenePlan(intent: Hvs3DIntent): HvsScenePlan {
  const durationSec = Math.max(1, Math.round(toSeconds(intent.duration)))
  const hasPerson = intent.subjects.some(item => item.kind === 'person')
  const hasCar = intent.props.some(item => item.kind === 'car')
  const hasBuilding = intent.props.some(item => item.kind === 'building')
  const orbit = intent.cameraIntent.includes('ORBIT')
  const push = intent.cameraIntent.includes('PUSH_IN')
  const reveal = intent.cameraIntent.includes('REVEAL') || intent.cameraIntent.includes('CUSTOM_PATH')

  const shotA = reveal ? { id: 'shot-reveal', order: 1, label: 'Low car reveal', durationLabel: '3 sec' } : null
  const shotB = orbit ? { id: 'shot-orbit', order: 2, label: 'Character orbit', durationLabel: '3 sec' } : null
  const shotC = push ? { id: 'shot-closeup', order: 3, label: 'Close-up', durationLabel: '2 sec' } : null
  const shots = [shotA, shotB, shotC].filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item, index) => ({ ...item, order: index + 1 }))
  if (!shots.length) {
    shots.push({ id: 'shot-hold', order: 1, label: 'Scene hold', durationLabel: `${durationSec} sec` })
  }

  const steps = [
    hasCar ? { id: 'place-car', label: 'Place the car', doneIntent: 'car-placeholder' } : null,
    hasPerson ? { id: 'place-person', label: 'Place the character beside it', doneIntent: 'person-placeholder' } : null,
    intent.subjectMotion ? { id: 'move-person', label: 'Move the character toward the building', doneIntent: 'walk-path' } : null,
    { id: 'cam-low', label: 'Start the camera low', doneIntent: 'camera-start' },
    orbit ? { id: 'cam-orbit', label: 'Circle around the character', doneIntent: 'camera-orbit' } : null,
    push ? { id: 'cam-push', label: 'Push into a close-up', doneIntent: 'camera-push' } : null,
    { id: 'lights', label: 'Add nighttime cinematic lighting', doneIntent: 'lighting' },
    hasBuilding ? { id: 'building', label: 'Place a doorway block', doneIntent: 'building-placeholder' } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item))

  const environmentLabel = intent.timeOfDay === 'night'
    ? 'Night city street'
    : intent.timeOfDay === 'day'
      ? 'Daytime street'
      : 'Directed 3D scene'

  return {
    id: nid('plan3d'),
    intentId: intent.id,
    projectId: intent.projectId,
    title: 'YOUR SCENE',
    durationLabel: `${durationSec} seconds`,
    environmentLabel,
    shotCount: shots.length,
    shots,
    steps,
    status: 'proposed',
    approvalRequired: true,
    approvalAction: 'BUILD_SCENE',
    mutated: false,
    createdAt: new Date().toISOString(),
  }
}
