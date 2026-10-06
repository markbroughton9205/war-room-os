const FOLLOW_UP =
  /^(why\??|how\??|and then\??|what about .{1,120}|do that|do it|tell me more|are you sure\??|check this out|what happened\??|why did you say that\??|look it up\??|compare it to the other one|would .{1,120} be affected\??|what would that break\??)$/i

export function isFollowUpTurn(text: string): boolean {
  return FOLLOW_UP.test(typeof text === 'string' ? text.trim() : '')
}

export function resolveFollowUpText(text: string, priorTurns: readonly string[] = []): {
  resolved: string
  referent: string | null
  preserved_session: boolean
} {
  const raw = typeof text === 'string' ? text.trim() : ''
  const prior = priorTurns.map(turn => turn.trim()).filter(Boolean)
  const last = prior[prior.length - 1] ?? null
  if (!raw) return { resolved: raw, referent: last, preserved_session: prior.length > 0 }

  const writingTurn = /\b(rewrite|rephrase|more concise|proofread|tighten this|make that rewrite|make this (?:clearer|shorter|better|sound professional))\b/i.test(raw)
  const closingTurn = /^(thanks|thank you|that's enough)\b/i.test(raw)
  if (!isFollowUpTurn(raw) && (writingTurn || closingTurn)) {
    const rewriteSource = [...prior].reverse().find(turn => /\brewrite\b/i.test(turn) && !/\b(research|primary sources?)\b/i.test(turn)) ?? null
    if (writingTurn && rewriteSource) {
      return { resolved: `${raw}\nOriginal:\n${rewriteSource}`, referent: rewriteSource, preserved_session: true }
    }
    return { resolved: raw, referent: last, preserved_session: prior.length > 0 }
  }
  if (!isFollowUpTurn(raw) && !/\b(that|it|this|the other one)\b/i.test(raw)) {
    return { resolved: raw, referent: last, preserved_session: prior.length > 0 }
  }

  if (!last) {
    return { resolved: raw, referent: null, preserved_session: false }
  }

  if (/what would that break/i.test(raw)) {
    return { resolved: `What would break if we did this: ${last}`, referent: last, preserved_session: true }
  }
  if (/would foundry be affected/i.test(raw)) {
    return { resolved: `Would Foundry be affected by this: ${last}`, referent: last, preserved_session: true }
  }
  if (/^why did you say that/i.test(raw)) {
    return { resolved: `Why did you say that about: ${last}`, referent: last, preserved_session: true }
  }
  if (/^look it up/i.test(raw)) {
    return { resolved: `Look up current sources for: ${last}`, referent: last, preserved_session: true }
  }
  if (/^tell me more/i.test(raw)) {
    return { resolved: `Tell me more about: ${last}`, referent: last, preserved_session: true }
  }
  if (/^are you sure/i.test(raw)) {
    return { resolved: `Are you sure about: ${last}`, referent: last, preserved_session: true }
  }
  if (/^why\??$/i.test(raw)) {
    return { resolved: `Why: ${last}`, referent: last, preserved_session: true }
  }
  if (/^how\??$/i.test(raw)) {
    return { resolved: `How: ${last}`, referent: last, preserved_session: true }
  }
  if (/what about (.+)/i.test(raw)) {
    const topic = raw.replace(/^what about\s+/i, '').replace(/\?$/, '')
    return { resolved: `Regarding ${topic} in the context of: ${last}`, referent: last, preserved_session: true }
  }
  if (/compare it to the other one/i.test(raw)) {
    return { resolved: `Compare that to the other option discussed. Context: ${prior.join(' / ')}`, referent: last, preserved_session: true }
  }
  if (/^(do that|do it)$/i.test(raw)) {
    return { resolved: `Do that: ${last}`, referent: last, preserved_session: true }
  }
  return { resolved: `${raw} (context: ${last})`, referent: last, preserved_session: true }
}
