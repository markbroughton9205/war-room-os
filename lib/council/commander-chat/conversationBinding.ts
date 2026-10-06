/**
 * A Home session id is not always a remote owned conversation.
 * Unauthenticated local UI and missing ids must not abort the Council round.
 * The round continues with no remote conversation reads or writes.
 * Unavailable storage and invalid ids still fail closed.
 */

export type ConversationBindingFailure = {
  status: number
  code?: string | null
}

export function shouldDetachConversationBinding(failure: ConversationBindingFailure): boolean {
  if (failure.status === 401 || failure.status === 404) return true
  return failure.code === 'UNAUTHENTICATED' || failure.code === 'NOT_FOUND'
}
