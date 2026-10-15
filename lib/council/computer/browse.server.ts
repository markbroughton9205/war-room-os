import 'server-only'
import { getBrowserBroker } from '@/lib/browser-broker'
import { redactSecretsFromOutput } from '@/lib/native-builder/outputRedaction'

export type CouncilBrowseResult =
  | { ok: true; sessionId: string; title: string; url: string; status: number | null; excerpt: string; citationId: string | null }
  | { ok: false; sessionId: string | null; error: string; verdict: string | null }

/**
 * Council opens a page in the shared, visible browser and reads it. Runs as the `council` owner: the broker's origin policy and
 * control-ownership rules apply (if the Commander holds control, this is refused rather than overridden).
 */
export async function councilBrowse(input: { url: string; sessionId?: string; allowLocalhost?: boolean }): Promise<CouncilBrowseResult> {
  const url = String(input.url ?? '')
  if (!/^https?:\/\//i.test(url) || url.length > 1000) return { ok: false, sessionId: null, error: 'url must be http(s)', verdict: null }
  const broker = getBrowserBroker()
  let sid = input.sessionId ?? ''
  if (!sid) {
    const created = await broker.createSession({ owner: 'council', sessionMode: 'EPHEMERAL', allowLocalhost: input.allowLocalhost === true })
    if (!created.ok) return { ok: false, sessionId: null, error: created.error, verdict: (created as { verdict?: string }).verdict ?? null }
    sid = created.result.sessionId
  }
  const nav = await broker.navigate({ owner: 'council', sessionId: sid, url })
  if (!nav.ok) return { ok: false, sessionId: sid, error: nav.error, verdict: (nav as { verdict?: string }).verdict ?? null }
  const extracted = await broker.extract(sid)
  const cited = extracted.ok ? await broker.cite(sid, undefined, extracted.result.readableText.slice(0, 280), 'web_page') : null
  const excerpt = extracted.ok ? redactSecretsFromOutput(extracted.result.readableText.replace(/\s+/g, ' ').trim().slice(0, 600)) : ''
  return {
    ok: true,
    sessionId: sid,
    title: nav.result.title,
    url: nav.result.finalUrl,
    status: nav.result.status,
    excerpt,
    citationId: cited && cited.ok ? cited.result.citationId : null,
  }
}

export function browseMessageText(r: Extract<CouncilBrowseResult, { ok: true }>): string {
  return [
    `Council opened ${r.url} in the visible browser.`,
    `Title: ${r.title || '(none)'} · HTTP ${r.status ?? 'n/a'}.`,
    r.excerpt ? `What it read: ${r.excerpt}` : 'It could not read the page text.',
  ].join('\n')
}

/** "open https://… and tell me what it says": one http(s) URL in an explicit open/visit/browse request. */
export function browseRequestUrl(text: string): string | null {
  if (!/\b(open|visit|browse|go to|navigate to|look at|check|load|read)\b/i.test(text)) return null
  const m = text.match(/https?:\/\/[^\s<>"')]+/i)
  return m ? m[0].replace(/[.,;:!?]+$/, '') : null
}
