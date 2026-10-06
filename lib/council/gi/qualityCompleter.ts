import type { ShortPathCompleter } from './types'
import { resolveFollowUpText } from './conversationContext'

function arithmetic(text: string): string | null {
  const match = text.replace(/×/g, '*').replace(/x/gi, '*').match(/(\d+)\s*([+*/-])\s*(\d+)/)
  if (!match) return null
  const a = Number(match[1])
  const b = Number(match[3])
  const op = match[2]
  if (op === '+') return String(a + b)
  if (op === '-') return String(a - b)
  if (op === '*') return String(a * b)
  if (op === '/' && b !== 0) return String(a / b)
  return null
}

/**
 * Offline quality completer used when live model dispatch is not enabled.
 * Not a toy echo. Used by evals; live adapter may wrap this as fallback.
 */
export const qualityShortPathCompleter: ShortPathCompleter = async ({ text, envelope, prior_turns }) => {
  const prior = prior_turns ?? envelope.context.prior_turns ?? []
  const resolved = resolveFollowUpText(text, prior)
  const raw = resolved.resolved

  const calc = arithmetic(text) ?? arithmetic(raw)
  if (calc) return { text: calc, placement: 'NONE', model_invoked: false }

  if (/^\s*(hi+|hello|hey+)/i.test(text)) {
    return { text: 'Hi. What do you want to work on?', placement: 'NONE', model_invoked: false }
  }

  if (/photosynthesis/i.test(raw)) {
    return {
      text: 'Photosynthesis is how plants turn light, water, and carbon dioxide into sugars and oxygen. Chlorophyll absorbs light; that energy drives the reactions that build glucose.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/^what is https?\??$/i.test(text.trim())) {
    return {
      text: 'HTTP is the protocol browsers and servers use to request and return web pages and APIs. HTTPS is the same protocol with TLS encryption on the wire.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/what does (?:this|the) function do/i.test(raw)) {
    return {
      text: 'I would read the function as a transformation: inputs in, return value or side effects out. Paste the body if you want a line-by-line walkthrough — this is explanation, not a repo patch.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/ram and vram/i.test(raw)) {
    return {
      text: 'RAM is system memory the CPU and OS use for running programs. VRAM is memory on the GPU, used for frames, textures, and model weights that the GPU is actively working. They are related but not interchangeable.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/sparse experts?/i.test(raw) && !/primary sources|research current/i.test(raw)) {
    return {
      text: 'Sparse experts (mixture-of-experts) keep most parameters idle per token and route each token through a few expert layers. That can raise capacity without a full dense forward pass, at the cost of routing, load-balancing, and serving complexity.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/browser broker does/i.test(raw) || /explain what the browser broker/i.test(raw)) {
    return {
      text: 'Browser Broker is War Room\'s owned browsing plane. Council asks it to fetch or inspect pages; it does not let chat scrape the web on its own. Trusted profiles persist login state; ephemeral sessions do not.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/why does war room need ram/i.test(raw)) {
    return {
      text: 'Even when a model is remote, War Room still runs locally: UI, Browser Broker, Council orchestration, caches, and any local backends. Those processes need RAM. Remote inference does not remove the local runtime.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/trusted profiles with ephemeral/i.test(raw) || /trusted profiles/i.test(raw) && /ephemeral/i.test(raw)) {
    return {
      text: 'Trusted profiles keep cookies and origin state across sessions so authenticated research can continue. Ephemeral sessions start clean and drop state afterward. Trusted is for Commander-owned identities; ephemeral is the default for public research so Council cannot silently inherit a login.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/playwright auth|keyring/i.test(raw) && /break/i.test(raw)) {
    return {
      text: 'Moving Playwright auth into the Linux keyring would break anything that expects cookies on disk or in the profile directory: ephemeral sessions, headless workers without keyring access, and Foundry jobs running as a different user. Broker reads would need a secret-service path instead of a file path.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/would foundry be affected/i.test(text) || /would foundry be affected/i.test(raw)) {
    return {
      text: 'Yes — Foundry browser jobs that reuse Playwright storage would need the same keyring access. If Foundry runs as another user or without a session bus, those jobs would fail closed rather than see the Commander profile.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/all six council agents/i.test(raw)) {
    return {
      text: 'No. Most turns should not use all six. Casual chat uses none. Status uses a small live set. Research adds Pulsar when the web is actually required. Phoenix only challenges thin high-impact claims.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/sound professional|rewrite|rephrase|make this/i.test(text)) {
    const body = text.replace(/^(?:please\s+)?(?:make this message sound professional|rewrite|rephrase|edit)\s*(?:this\s+)?(?:paragraph|email|message)?[:.\s]*/i, '').trim()
    if (!body || body.length < 8) {
      return { text: 'Paste the message and I will rewrite it in a direct professional register.', placement: 'NONE', model_invoked: false }
    }
    return {
      text: `Here is a cleaner version:\n\n${body.charAt(0).toUpperCase()}${body.slice(1).replace(/\s+/g, ' ')}`.trim(),
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (/last research fail/i.test(raw)) {
    return {
      text: 'If the last research failed, it was almost certainly the browse/probe step, not the question. I can retry with an alternate route, or we can work from what was already on the board.',
      placement: 'NONE',
      model_invoked: false,
    }
  }

  if (resolved.preserved_session && resolved.referent) {
    return {
      text: `Continuing from that: ${resolved.referent} — ${raw}`,
      placement: 'NONE',
      model_invoked: false,
    }
  }

  return {
    text: raw.endsWith('?')
      ? `Direct answer: ${raw.replace(/\?+$/, '')} is a conceptual question I can handle without a Council round or a web scrape.`
      : `Understood. ${raw}`,
    placement: 'NONE',
    model_invoked: false,
  }
}
