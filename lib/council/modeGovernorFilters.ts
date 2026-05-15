import type { ModeGovernor } from '@/lib/council/modeGovernor'

/** Curated recovery / attendance blocklist — infrastructure hallucination & adversary speculation. */
const RECOVERY_ATTENDANCE_BLOCK_PATTERNS: RegExp[] = [
  /\bopenai\s+load\s+balanc(?:e|ing)\b/i,
  /\bcompetitors?\s+may\s+exploit\b/i,
  /\btargeted\s+disruption\b/i,
  /\badversary\s+(?:attack|campaign|operation)\b/i,
  /\b(?:aws|azure|gcp|cloudflare)\s+(?:outage|incident|degraded)\b/i,
  /\bprovider\s+mesh\s+(?:down|offline|compromised)\b/i,
  /\bqueue\s+(?:drained|cleared|succeeded)\b/i,
  /\b(?:all\s+)?nodes?\s+(?:online|restored)\b/i,
]

const ADVERSARY_WITHOUT_EVIDENCE =
  /\b(adversary|attacker|nation-?state|APT)\b[^.!?\n]{0,80}\b(likely|probably|suspect|may\s+be)\b/i

const MULTI_PARA_ATTENDANCE = /\n\s*\n/

const DIRECT_REINTERPRET_LINE =
  /\b(?:council\s+(?:now\s+)?routed|routing\s+(?:the\s+)?council|switching\s+to\s+(?:analysis|attendance))\b/i

const DIRECT_COMPARATIVE_FAMILY =
  /\b(?:chatgpt|claude|grok|gemini|red\s*team|kimi|baby|bridge)\s+(?:family|patterns?|approach|perspective|take)\b/i

function stripDirectInvocationReinterpretation(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const s = line.trim()
      if (!s) return true
      if (DIRECT_REINTERPRET_LINE.test(s)) return false
      if (DIRECT_COMPARATIVE_FAMILY.test(s)) return false
      return true
    })
    .join('\n')
    .trim()
}

export function applyModeGovernorFilters(text: string, governor: ModeGovernor): string {
  let t = (text ?? '').trim()
  if (!t) return t

  const presenceModes = governor.mode === 'recovery' || governor.mode === 'attendance'

  if (presenceModes) {
    for (const re of RECOVERY_ATTENDANCE_BLOCK_PATTERNS) {
      t = t.replace(re, ' ')
    }
    if (ADVERSARY_WITHOUT_EVIDENCE.test(t) && !/\b(evidence|log|trace|confirmed|observed)\b/i.test(t)) {
      t = t.replace(ADVERSARY_WITHOUT_EVIDENCE, ' ')
    }
    if (governor.mode === 'attendance' && MULTI_PARA_ATTENDANCE.test(t)) {
      t = t.split(/\n\s*\n+/)[0] ?? t
    }
  }

  if (
    !governor.allowSpeculation
    && governor.mode !== 'council'
    && governor.mode !== 'deep_analysis'
    && ADVERSARY_WITHOUT_EVIDENCE.test(t)
    && !/\b(evidence|log|trace|confirmed|observed)\b/i.test(t)
  ) {
    t = t.replace(ADVERSARY_WITHOUT_EVIDENCE, ' ')
  }

  if (governor.mode === 'direct_invocation') {
    t = stripDirectInvocationReinterpretation(t)
  }

  return t.replace(/\s{2,}/g, ' ').trim()
}
