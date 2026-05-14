let messageIdCounter = 0

function randomPart() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

export function createMessageId(prefix: string) {
  messageIdCounter += 1
  const safePrefix = prefix.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'msg'
  return `${safePrefix}-${Date.now()}-${messageIdCounter}-${randomPart()}`
}
