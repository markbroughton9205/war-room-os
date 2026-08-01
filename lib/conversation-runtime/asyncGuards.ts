export type CouncilAsyncResultIdentity = {
  mounted: boolean
  expectedSessionId: string | null | undefined
  activeSessionId: string | null | undefined
  expectedDecreeRound?: number | null
  activeDecreeRound?: number | null
  expectedConversationId?: string | null
  activeConversationId?: string | null
  expectedFlowMode?: string | null
  activeFlowMode?: string | null
  modeSensitive?: boolean
}

export function shouldAcceptCouncilAsyncResult(input: CouncilAsyncResultIdentity): boolean {
  if (!input.mounted) return false
  if (!input.expectedSessionId || !input.activeSessionId) return false
  if (input.expectedSessionId !== input.activeSessionId) return false

  if (
    typeof input.expectedDecreeRound === 'number'
    && typeof input.activeDecreeRound === 'number'
    && input.expectedDecreeRound !== input.activeDecreeRound
  ) {
    return false
  }

  if (
    input.expectedConversationId
    && input.activeConversationId
    && input.expectedConversationId !== input.activeConversationId
  ) {
    return false
  }

  if (
    input.modeSensitive
    && input.expectedFlowMode
    && input.activeFlowMode
    && input.expectedFlowMode !== input.activeFlowMode
  ) {
    return false
  }

  return true
}
