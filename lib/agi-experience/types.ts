export type TurnKind = 'commander_message' | 'assistant_response' | 'prompt_generated'
export type OutcomeSignal = 'none' | 'commander_correction' | 'commander_approval' | 'provider_error'
export type FailureKind = 'commander_rejection' | 'commander_correction' | 'provider_error' | 'validation_failure'

export type CaptureExperienceInput = {
  conversationId: string | null
  messageId: string | null
  contextSnapshotId: string | null
  promptArtifactId: string | null
  modelTarget: Record<string, unknown>
  turnKind: TurnKind
  outcomeSignal: OutcomeSignal
}

export type RecordFailureInput = {
  conversationId: string | null
  experienceRecordId: string | null
  failureKind: FailureKind
  detail?: string
  providerFamily?: string
}
