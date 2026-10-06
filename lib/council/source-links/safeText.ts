import { classifyCouncilSourceUrl } from './urlSafety'

export type SafeTextPart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string; domain: string }

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi
const BARE_URL = /\bhttps?:\/\/[^\s<>"'`)]+/gi

export function splitSafeCouncilText(input: string): SafeTextPart[] {
  if (!input) return []
  const claimed = new Set<string>()
  const marks: Array<{ start: number; end: number; part: SafeTextPart }> = []

  for (const match of input.matchAll(MARKDOWN_LINK)) {
    const raw = match[2]
    const classified = classifyCouncilSourceUrl(raw)
    if (!classified.ok || match.index == null) continue
    claimed.add(`${match.index}:${match.index + match[0].length}`)
    marks.push({
      start: match.index,
      end: match.index + match[0].length,
      part: { kind: 'link', text: match[1], url: classified.url, domain: classified.domain },
    })
  }

  for (const match of input.matchAll(BARE_URL)) {
    if (match.index == null) continue
    const covered = marks.some(mark => match.index! >= mark.start && match.index! < mark.end)
    if (covered) continue
    const classified = classifyCouncilSourceUrl(match[0].replace(/[.,;:]+$/, ''))
    if (!classified.ok) continue
    marks.push({
      start: match.index,
      end: match.index + match[0].length,
      part: { kind: 'link', text: classified.url, url: classified.url, domain: classified.domain },
    })
  }

  marks.sort((a, b) => a.start - b.start)
  const parts: SafeTextPart[] = []
  let cursor = 0
  for (const mark of marks) {
    if (mark.start > cursor) parts.push({ kind: 'text', text: input.slice(cursor, mark.start) })
    parts.push(mark.part)
    cursor = mark.end
  }
  if (cursor < input.length) parts.push({ kind: 'text', text: input.slice(cursor) })
  return parts.length ? parts : [{ kind: 'text', text: input }]
}

export function hasNavigablePlainUrl(input: string): boolean {
  return splitSafeCouncilText(input).some(part => part.kind === 'link')
}
