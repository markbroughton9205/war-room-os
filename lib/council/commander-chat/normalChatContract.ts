/**
 * Commander-facing chat contract.
 * Normal bubbles may carry speaker, prose, time, and concise state.
 * Claim ids, tool ids, route enums, and empty markdown stay in Advanced / Inspector.
 */

const INTERNAL_TOKEN =
  /\b(claim_id|evidence_id|tool_id|routingId|decisionPath|SHORT_PATH|AGENT_PATH|HANDOFF|DEEP_RESEARCH|SYSTEM_STATUS|CURRENT_LIVE|TOOL_BLOCKED|broker\.fetch|ebc\.|wr\.[a-z0-9.]+|claim_[\w-]+|e-[\w-]+)\b/gi

const COMPLETION_ENUM = /\bCompletion:\s*[A-Z_]+\.?/g

const BLOCKED_BOILERPLATE =
  /\bBlocked:\s*SENTINEL,?\s*(?:,\s*)?(?:TOOL_BLOCKED,?\s*)?or unresolved hard dependency\.?/gi

function uniqueKeepOrder(lines: string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const line of lines) {
    const key = line.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    kept.push(line.trim())
  }
  return kept
}

/** Drop empty headings, empty numbered items, and empty list markers. */
export function stripBrokenMarkdown(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,6}\s*$/.test(trimmed)) continue
    if (/^\d+\.\s*$/.test(trimmed)) continue
    if (/^[-*]\s*$/.test(trimmed)) continue
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const BARE_SECTION = /^(what i found|what is verified|sources)\s*:?\s*$/i

export function dropEmptySectionHeadings(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (BARE_SECTION.test(trimmed)) {
      let next = index + 1
      while (next < lines.length && !lines[next].trim()) next += 1
      const following = lines[next]?.trim() ?? ''
      if (!following || BARE_SECTION.test(following) || /^(what remains uncertain)\b/i.test(following)) continue
    }
    kept.push(lines[index])
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function dedupeFailureCopy(text: string): string {
  const parts = text.split(/\n+|(?<=[.!?])\s+/)
  return uniqueKeepOrder(parts).join(text.includes('\n') ? '\n' : ' ').replace(/\s{2,}/g, ' ').trim()
}

/** Prose safe for the primary Commander bubble. */
export function toNormalChatText(text: string): string {
  const cleaned = stripBrokenMarkdown(String(text ?? ''))
    .replace(INTERNAL_TOKEN, '')
    .replace(COMPLETION_ENUM, '')
    .replace(BLOCKED_BOILERPLATE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return dropEmptySectionHeadings(dedupeFailureCopy(cleaned).replace(/https?:\/\/127\.0\.0\.1:\d+\S*/g, ''))
}

/** Runtime Details body: structured lines only. Empty headings never render. */
export function sanitizeRuntimeDetailsText(text: string | null | undefined): string {
  return stripBrokenMarkdown(String(text ?? ''))
    .replace(INTERNAL_TOKEN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function dedupeList(items: readonly string[] | null | undefined): string[] {
  return uniqueKeepOrder((items ?? []).map(item => item.trim()).filter(Boolean))
}
