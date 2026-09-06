/**
 * Visible Council chat must never include model scratchpads, think-tags, or hidden reasoning.
 * Reasoning may be retained internally when the adapter already separates it.
 */

const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?<\/think>/gi
const THINK_OPEN_UNCLOSED = /<think\b[^>]*>[\s\S]*$/i
const REASONING_FENCE = /```(?:reasoning|think|thought|scratchpad)[\s\S]*?```/gi
const CHINESE_SCRATCH_RUN = /(?:[\u4e00-\u9fff]{8,}[\s\S]{0,40}){2,}/g

export type SeparatedModelText = {
  visible: string
  thinking: string | null
}

export function extractVisibleModelText(payload: {
  response?: unknown
  thinking?: unknown
  message?: { content?: unknown; thinking?: unknown; reasoning?: unknown }
}): SeparatedModelText {
  const thinkingParts = [
    typeof payload.thinking === 'string' ? payload.thinking : '',
    typeof payload.message?.thinking === 'string' ? payload.message.thinking : '',
    typeof payload.message?.reasoning === 'string' ? payload.message.reasoning : '',
  ].filter(part => part.trim())
  const rawVisible =
    typeof payload.response === 'string'
      ? payload.response
      : typeof payload.message?.content === 'string'
        ? payload.message.content
        : ''
  return {
    visible: stripHiddenReasoning(rawVisible),
    thinking: thinkingParts.length ? thinkingParts.join('\n') : null,
  }
}

export function stripHiddenReasoning(raw: unknown, opts?: { trim?: boolean }): string {
  if (typeof raw !== 'string') return ''
  let text = raw.replace(THINK_BLOCK, '').replace(REASONING_FENCE, '')
  if (THINK_OPEN_UNCLOSED.test(text)) {
    text = text.replace(THINK_OPEN_UNCLOSED, '')
  }
  text = text.replace(/^\s*thinking:\s*/i, '')
  text = stripLeadingChineseScratch(text)
  text = text.replace(/\n{3,}/g, '\n\n')
  return opts?.trim === false ? text : text.trim()
}

function stripLeadingChineseScratch(text: string): string {
  if (!text.trim()) return text
  const trimmed = text.trim()
  const latinStart = trimmed.search(/[A-Za-z]/)
  const cjkCount = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length
  if (cjkCount >= 12 && latinStart > 24) {
    return trimmed.slice(latinStart).trim()
  }
  const stripped = trimmed.replace(CHINESE_SCRATCH_RUN, '').trim()
  return stripped || trimmed
}

export function containsHiddenReasoning(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false
  if (THINK_BLOCK.test(raw) || /<think\b/i.test(raw) || REASONING_FENCE.test(raw)) return true
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (raw.match(/[A-Za-z]/g) ?? []).length
  return cjk >= 16 && latin > 0 && cjk > latin
}
