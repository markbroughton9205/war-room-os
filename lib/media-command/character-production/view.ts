/**
 * Plain-language Characters page view. Filenames stay in Technical Details.
 */
import type { HvsCharacterProductionSnapshot, HvsCharacterProductionState, HvsCharacterProductionStage } from './types'

export const STAGE_LABEL: Record<HvsCharacterProductionStage, string> = {
  PREREQUISITES: 'Checking references',
  FACE_REFERENCES: 'Checking references',
  METAHUMAN_FOUNDATION: 'Preparing Unreal',
  CONFORM: 'Creating likeness',
  ASSEMBLY: 'Assembling CINE character',
  BODY_BIND: 'Connecting TAKE 3',
  CAMERA_BIND: 'Connecting Cinema',
  VALIDATION: 'Final validation',
  PREVIEW: 'Rendering preview',
}

export const STATE_LABEL: Record<HvsCharacterProductionState, string> = {
  REFERENCES_REQUIRED: 'Identity references needed',
  REFERENCES_IN_PROGRESS: 'Identity references in progress',
  REFERENCES_COMPLETE: 'Identity references complete',
  CHARACTER_READY_TO_BUILD: 'Ready to build',
  CHARACTER_PREPARING: 'Preparing',
  CHARACTER_CONFORMING: 'Creating likeness',
  CHARACTER_ASSEMBLING: 'Assembling CINE character',
  BODY_BINDING: 'Connecting TAKE 3',
  CAMERA_BINDING: 'Connecting Cinema',
  VALIDATING: 'Validating',
  PREVIEW_PREPARING: 'Rendering preview',
  CHARACTER_READY: "Ra'el ready",
  CHARACTER_BLOCKED: "Ra'el build needs your attention",
  CHARACTER_ERROR: 'Build could not finish',
  LIKELINESS_APPROVAL_REQUIRED: 'Approval required',
  LIKELINESS_AUTHORIZED: 'Permission approved',
  LIKELINESS_PREPARING: 'Preparing likeness',
  LIKELINESS_SUBMITTING: 'Creating likeness',
  LIKELINESS_PROCESSING: 'Creating likeness',
  LIKELINESS_VERIFYING: 'Verifying facial rig',
  LIKELINESS_COMPLETE: 'Likeness complete',
  LIKELINESS_BLOCKED: "Ra'el build needs your attention",
}

export const LIKENESS_APPROVAL_COPY = {
  headline: "Ra'el is ready for likeness creation.",
  body: [
    "Epic's official MetaHuman auto-rig service is required to create the production facial rig.",
    'Your original HVS reference photos remain local.',
    'The official MetaHuman workflow may send a derived Face Mesh and other required conform data to Epic for processing.',
    "This authorization is only for creating Ra'el's MetaHuman likeness.",
  ],
  authorize: 'AUTHORIZE & BUILD LIKENESS',
  keepLocal: 'KEEP LOCAL FOR NOW',
}

export const LIKENESS_PROGRESS_STEPS = [
  { id: 'references', label: 'References ready' },
  { id: 'foundation', label: 'MetaHuman foundation' },
  { id: 'permission', label: 'Permission approved' },
  { id: 'likeness', label: 'Creating likeness' },
  { id: 'verify', label: 'Verifying facial rig' },
  { id: 'cine', label: 'Assembling CINE character' },
  { id: 'take3', label: 'Connecting TAKE 3' },
  { id: 'cinema', label: 'Connecting Cinema' },
  { id: 'preview', label: 'Rendering preview' },
  { id: 'validation', label: 'Final validation' },
] as const

export function primaryCta(state: HvsCharacterProductionState): string | null {
  if (state === 'CHARACTER_READY_TO_BUILD') return "BUILD RA'EL"
  if (state === 'LIKELINESS_APPROVAL_REQUIRED') return "CONTINUE RA'EL BUILD"
  if (state === 'CHARACTER_BLOCKED' || state === 'CHARACTER_ERROR' || state === 'LIKELINESS_BLOCKED') return 'RESUME BUILD'
  if (state === 'CHARACTER_READY') return "PREVIEW RA'EL"
  return null
}

export function nextActionCopy(snapshot: HvsCharacterProductionSnapshot): string {
  if (snapshot.productionState === 'CHARACTER_READY') return 'CAPTURE FACIAL PERFORMANCE'
  if (snapshot.productionState === 'CHARACTER_READY_TO_BUILD') return "BUILD RA'EL"
  if (snapshot.productionState === 'LIKELINESS_APPROVAL_REQUIRED') {
    return snapshot.approvalGateOpen ? LIKENESS_APPROVAL_COPY.authorize : "CONTINUE RA'EL BUILD"
  }
  if (snapshot.productionState === 'CHARACTER_BLOCKED' || snapshot.productionState === 'LIKELINESS_BLOCKED') {
    if (snapshot.epicSignInRequired) return 'EPIC SIGN-IN REQUIRED'
    return snapshot.operation?.blocked?.operatorStep ?? snapshot.operatorGate?.expectedAction ?? 'Resume build'
  }
  if (snapshot.productionState === 'CHARACTER_ERROR') {
    if (snapshot.unrealProcess.status === 'STOPPED' || snapshot.unrealProcess.status === 'UNRESPONSIVE') {
      return snapshot.unrealProcess.status === 'UNRESPONSIVE' ? 'UNREAL IS NOT RESPONDING' : 'UNREAL STOPPED'
    }
    return 'RESUME BUILD'
  }
  if (snapshot.operation?.status === 'RUNNING') return "Building Ra'el"
  if (!snapshot.faceReferences.complete) return 'Finish identity references'
  return snapshot.nextAction
}

export function blockedHeadline(snapshot: HvsCharacterProductionSnapshot): string | null {
  if (snapshot.unrealProcess.status === 'UNRESPONSIVE' && snapshot.operation?.status === 'RUNNING') return 'UNREAL IS NOT RESPONDING'
  if (snapshot.unrealProcess.status === 'STOPPED' && snapshot.operation?.status === 'FAILED') return 'UNREAL STOPPED'
  if (snapshot.epicSignInRequired) return 'EPIC SIGN-IN REQUIRED'
  if (snapshot.operatorGate?.kind === 'CREATOR_LANDMARK') return "RA'EL BUILD NEEDS YOUR ATTENTION"
  if (snapshot.productionState === 'CHARACTER_BLOCKED' || snapshot.productionState === 'LIKELINESS_BLOCKED') {
    return "RA'EL BUILD NEEDS YOUR ATTENTION"
  }
  return snapshot.operation?.blocked?.headline ?? null
}

export function likenessProgressStatus(
  snapshot: HvsCharacterProductionSnapshot,
  stepId: (typeof LIKENESS_PROGRESS_STEPS)[number]['id'],
): 'COMPLETE' | 'RUNNING' | 'PENDING' {
  const receipts = snapshot.operation?.receipts ?? []
  const likeness = snapshot.likenessState
  const complete = (stage: string) => receipts.find(item => item.stage === stage)?.status === 'COMPLETE'
  if (stepId === 'references') return snapshot.faceReferences.complete ? 'COMPLETE' : 'PENDING'
  if (stepId === 'foundation') return complete('METAHUMAN_FOUNDATION') ? 'COMPLETE' : 'PENDING'
  if (stepId === 'permission') return snapshot.authority ? 'COMPLETE' : likeness ? 'RUNNING' : 'PENDING'
  if (stepId === 'likeness') {
    if (likeness === 'LIKELINESS_COMPLETE') return 'COMPLETE'
    if (likeness === 'LIKELINESS_SUBMITTING' || likeness === 'LIKELINESS_PROCESSING' || likeness === 'LIKELINESS_PREPARING' || likeness === 'LIKELINESS_AUTHORIZED') return 'RUNNING'
    return 'PENDING'
  }
  if (stepId === 'verify') {
    if (likeness === 'LIKELINESS_COMPLETE') return 'COMPLETE'
    if (likeness === 'LIKELINESS_VERIFYING') return 'RUNNING'
    return 'PENDING'
  }
  if (stepId === 'cine') return complete('ASSEMBLY') && likeness === 'LIKELINESS_COMPLETE' ? 'COMPLETE' : snapshot.productionState === 'CHARACTER_ASSEMBLING' ? 'RUNNING' : 'PENDING'
  if (stepId === 'take3') return complete('BODY_BIND') && likeness === 'LIKELINESS_COMPLETE' ? 'COMPLETE' : snapshot.productionState === 'BODY_BINDING' ? 'RUNNING' : 'PENDING'
  if (stepId === 'cinema') return complete('CAMERA_BIND') && likeness === 'LIKELINESS_COMPLETE' ? 'COMPLETE' : snapshot.productionState === 'CAMERA_BINDING' ? 'RUNNING' : 'PENDING'
  if (stepId === 'preview') return snapshot.highFidelityPreview ? 'COMPLETE' : snapshot.productionState === 'PREVIEW_PREPARING' ? 'RUNNING' : 'PENDING'
  if (stepId === 'validation') return complete('VALIDATION') && snapshot.productionState === 'CHARACTER_READY' ? 'COMPLETE' : snapshot.productionState === 'VALIDATING' ? 'RUNNING' : 'PENDING'
  return 'PENDING'
}
