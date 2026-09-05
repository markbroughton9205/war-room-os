/**
 * WR-Engineer Phase 5 — bound prompts for a 7B–14B local coding model.
 *
 * Phase 4 already bounds turn observations (MAX_TOTAL_CONTEXT_BYTES). This layer additionally
 * caps the assembled system prompt so a local engine is never handed the whole repository.
 * Does not change identity load order — truncation only drops trailing overflow.
 */
import { LOCAL_MAX_SYSTEM_PROMPT_BYTES } from './engineTypes'

export function boundSystemPrompt(systemPrompt: string, maxBytes: number = LOCAL_MAX_SYSTEM_PROMPT_BYTES): {
  text: string
  truncated: boolean
  bytes: number
} {
  const bytes = Buffer.byteLength(systemPrompt, 'utf8')
  if (bytes <= maxBytes) return { text: systemPrompt, truncated: false, bytes }
  let text = systemPrompt
  while (Buffer.byteLength(text, 'utf8') > maxBytes && text.length > 0) {
    text = text.slice(0, Math.max(0, text.length - 1024))
  }
  text = `${text}\n\n[truncated — local engine context bound; do not invent omitted file contents]`
  return { text, truncated: true, bytes: Buffer.byteLength(text, 'utf8') }
}
