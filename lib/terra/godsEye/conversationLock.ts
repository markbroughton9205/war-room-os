/**
 * Hard UX lock: ordinary Terra interaction must not auto-expand conversation.
 * Only the existing EXPAND control may expand it.
 */
export const CONVERSATION_AUTO_EXPAND = 'DISABLED' as const
export const CONVERSATION_EXPAND_CONTROL_TESTID = 'gods-eye-expand' as const

export const CONVERSATION_LOCK_TRIGGERS = [
  'ordinary_click',
  'focus',
  'terra_selection',
  'building_click',
  'live_intel_click',
  'street_image_click',
] as const
export type ConversationLockTrigger = (typeof CONVERSATION_LOCK_TRIGGERS)[number]

export function conversationMayAutoExpand(_trigger: ConversationLockTrigger): false {
  return false
}
