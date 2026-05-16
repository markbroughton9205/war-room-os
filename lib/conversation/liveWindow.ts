export const LIVE_CHAT_VISIBLE_MESSAGE_COUNT = 50

export type LiveWindowMessage = {
  id: string
  familyName: string
  messageType: string
}

export type LiveChatWindowResult<T extends LiveWindowMessage> = {
  visibleMessages: T[]
  archivedMessages: T[]
  hiddenCount: number
}

function isRaelMessage(message: LiveWindowMessage): boolean {
  return message.messageType === 'decree' || message.familyName.toUpperCase().includes("RA'EL")
}

function isFamilyResponse(message: LiveWindowMessage): boolean {
  return message.messageType === 'response' && !isRaelMessage(message) && message.familyName !== 'SYSTEM'
}

/**
 * Presentation-only live chat windowing. It never mutates or deletes the backing transcript.
 */
export function windowLiveChatMessages<T extends LiveWindowMessage>(
  messages: T[],
  visibleCount = LIVE_CHAT_VISIBLE_MESSAGE_COUNT,
): LiveChatWindowResult<T> {
  if (messages.length <= visibleCount) {
    return { visibleMessages: messages, archivedMessages: [], hiddenCount: 0 }
  }

  const keepIds = new Set<string>()
  for (const message of messages.slice(-visibleCount)) keepIds.add(message.id)

  const latestDecreeIndex = messages.findLastIndex(isRaelMessage)
  if (latestDecreeIndex >= 0) {
    for (const message of messages.slice(latestDecreeIndex)) keepIds.add(message.id)

    const response = messages.slice(latestDecreeIndex + 1).find(isFamilyResponse)
    if (response) keepIds.add(response.id)
  }

  const visibleMessages = messages.filter(message => keepIds.has(message.id))
  const archivedMessages = messages.filter(message => !keepIds.has(message.id))

  return {
    visibleMessages,
    archivedMessages,
    hiddenCount: archivedMessages.length,
  }
}
