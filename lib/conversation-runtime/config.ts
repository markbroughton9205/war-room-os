/** localStorage key for Phase 32 persistent conversational runtime (survives browser restart). */
export const CONVERSATION_RUNTIME_STORAGE_KEY = 'war-room-conversation-runtime-v1'

/** Idle sessions are marked stale after 24h without activity. */
export const IDLE_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** Max provider turns per single continue request (server-bounded). */
export const MAX_CONTINUATION_STEPS_PER_REQUEST = 3

/** Max autonomous burst turns before requiring Ra'el (per session window). */
export const MAX_TURNS_PER_BURST = 6

/** Cooldown between auto-continuation invocations (client + server). */
export const AUTO_CONTINUATION_COOLDOWN_MS = 30_000

/** Trigger rolling compression when message count exceeds this. */
export const MESSAGE_THRESHOLD_FOR_COMPRESSION = 24

/** Rough token estimate threshold for compression (chars / 4). */
export const TOKEN_ESTIMATE_THRESHOLD = 12_000

export const CONVERSATION_RUNTIME_VERSION = 1 as const
