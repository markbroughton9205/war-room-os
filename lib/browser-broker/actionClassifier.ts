/**
 * Classify browser actions before execution.
 * Reuses Council auto-research + dangerous-action registry. Does not invent a second approval system.
 * Research/read-only actions execute. Consequential external actions require Commander approval.
 * Subject matter is not a censorship axis.
 */
import { evaluateCouncilAutoResearch } from '@/lib/permissions/councilAutoResearchAuthority'
import { resolveCanonicalDangerousKind } from '@/lib/permissions/dangerousActionRegistry'
import type { BrowserActionClassification, BrowserActionKind, BrowserActionRequest } from './types'

const RESEARCH_KINDS = new Set<BrowserActionKind>([
  'status',
  'start',
  'stop',
  'restart',
  'session.create',
  'session.close',
  'tab.open',
  'tab.close',
  'tab.switch',
  'navigate',
  'search',
  'follow',
  'back',
  'forward',
  'reload',
  'scroll',
  'read',
  'extract',
  'screenshot',
  'pdf',
  'download',
  'console',
  'network',
  'cite',
  'storage.set',
  'storage.peek',
  'wait',
  'profile.list',
  'profile.status',
  'session.status',
  'tab.list',
  'preview',
])

const FOUNDRY_VERIFY_KINDS = new Set<BrowserActionKind>([
  'click',
  'type',
  'press',
  'hover',
  'select',
])

const COMMANDER_ADMIN_KINDS = new Set<BrowserActionKind>([
  'profile.create',
  'profile.lock',
  'profile.unlock',
  'profile.disable',
  'profile.delete',
  'secureStorage.rotate',
  'control.takeover',
  'control.return',
])

const CONSEQUENTIAL_KINDS = new Set<BrowserActionKind>([
  'submit',
  'purchase',
  'payment',
  'message_send',
  'email_send',
  'account_change',
  'password_change',
  'upload',
  'delete_remote',
  'execute_download',
  'install',
  'production_change',
  'commit',
  'push',
  'deploy',
  'settlement',
  'trade',
  'wager',
])

const CONSEQUENTIAL_HINT = /\b(buy|purchase|checkout|pay now|place order|add to cart|subscribe|donate|transfer funds|wire|iban|routing number|tweet|post publicly|send email|mailto:|change password|delete account|uninstall|deploy production|git push|git commit)\b/i
const PAYMENT_HINT = /\b(checkout|payment|paypal|stripe|card number|cvv|billing|wallet|purchase|buy now)\b/i
const AUTH_MUTATION_HINT = /\b(password|new-password|current-password|account settings|delete account)\b/i

function consequentialCanonicalKind(kind: BrowserActionKind): string | null {
  const mapped: Partial<Record<BrowserActionKind, string>> = {
    purchase: 'financial',
    payment: 'financial',
    settlement: 'settlement_submit',
    trade: 'trade',
    wager: 'wager',
    message_send: 'email_send',
    email_send: 'email_send',
    account_change: 'external_account',
    password_change: 'secrets_change',
    upload: 'external_account',
    delete_remote: 'delete_data',
    execute_download: 'shell_mutating',
    install: 'shell_mutating',
    production_change: 'deploy',
    commit: 'commit',
    push: 'push',
    deploy: 'deploy',
    submit: 'external_account',
  }
  const raw = mapped[kind] ?? null
  return raw ? resolveCanonicalDangerousKind(raw) ?? raw : resolveCanonicalDangerousKind(kind)
}

export function classifyBrowserAction(request: BrowserActionRequest): BrowserActionClassification {
  const haystack = [request.url, request.selector, request.text, request.query].filter(Boolean).join(' ')

  if (COMMANDER_ADMIN_KINDS.has(request.kind)) {
    if (request.owner !== 'commander') {
      return {
        verdict: 'DENIED',
        actionKind: request.kind,
        reason: 'COMMANDER_ONLY',
        reasonCode: 'COMMANDER_ONLY',
        canonicalKind: null,
        research: false,
      }
    }
    return {
      verdict: 'ALLOW_RESEARCH',
      actionKind: request.kind,
      reason: 'Commander-only browser administration.',
      reasonCode: 'ALLOWED_COMMANDER',
      canonicalKind: null,
      research: false,
    }
  }

  if (request.owner === 'commander' && (FOUNDRY_VERIFY_KINDS.has(request.kind) || RESEARCH_KINDS.has(request.kind))) {
    return {
      verdict: 'ALLOW_RESEARCH',
      actionKind: request.kind,
      reason: 'Commander takeover interaction.',
      reasonCode: 'ALLOWED_COMMANDER',
      canonicalKind: null,
      research: false,
    }
  }

  if (CONSEQUENTIAL_KINDS.has(request.kind) || CONSEQUENTIAL_HINT.test(haystack) && (request.kind === 'click' || request.kind === 'type' || request.kind === 'submit')) {
    const gate = evaluateCouncilAutoResearch({
      capability: request.kind === 'purchase' || request.kind === 'payment' || request.kind === 'trade' || request.kind === 'wager' || request.kind === 'settlement'
        ? 'PAID_SPEND'
        : 'EXTERNAL_MUTATION',
      commanderSessionContext: true,
      externalMutation: request.kind !== 'purchase' && request.kind !== 'payment' && request.kind !== 'trade' && request.kind !== 'wager' && request.kind !== 'settlement',
      financialSpend: request.kind === 'purchase' || request.kind === 'payment' || request.kind === 'trade' || request.kind === 'wager' || request.kind === 'settlement',
    })
    if (request.commanderApproved === true && gate.outcome !== 'DENY') {
      return {
        verdict: 'ALLOW_RESEARCH',
        actionKind: request.kind,
        reason: 'Commander approval present for gated browser action.',
        reasonCode: 'ALLOWED_VIA_APPROVAL',
        canonicalKind: consequentialCanonicalKind(request.kind),
        research: false,
      }
    }
    return {
      verdict: 'ACTION_REQUIRES_APPROVAL',
      actionKind: request.kind,
      reason: gate.reason,
      reasonCode: gate.outcome === 'DENY' ? 'POLICY_DENIED' : 'ACTION_REQUIRES_APPROVAL',
      canonicalKind: gate.canonicalKind ?? consequentialCanonicalKind(request.kind),
      research: false,
    }
  }

  if (PAYMENT_HINT.test(haystack) && (request.kind === 'type' || request.kind === 'submit' || request.kind === 'click')) {
    return {
      verdict: 'ACTION_REQUIRES_APPROVAL',
      actionKind: request.kind,
      reason: 'Payment/checkout interaction is a consequential external action.',
      reasonCode: 'ACTION_REQUIRES_APPROVAL',
      canonicalKind: 'financial',
      research: false,
    }
  }

  if (AUTH_MUTATION_HINT.test(haystack) && (request.kind === 'type' || request.kind === 'submit')) {
    return {
      verdict: 'ACTION_REQUIRES_APPROVAL',
      actionKind: request.kind,
      reason: 'Account/password mutation requires Commander approval.',
      reasonCode: 'ACTION_REQUIRES_APPROVAL',
      canonicalKind: 'secrets_change',
      research: false,
    }
  }

  if (RESEARCH_KINDS.has(request.kind)) {
    const gate = evaluateCouncilAutoResearch({
      capability: request.kind === 'search' ? 'SEARCH' : request.kind === 'download' ? 'FETCH' : 'READ',
      commanderSessionContext: true,
    })
    if (gate.outcome !== 'ALLOW') {
      return {
        verdict: 'ACTION_REQUIRES_APPROVAL',
        actionKind: request.kind,
        reason: gate.reason,
        reasonCode: gate.reasonCode,
        canonicalKind: gate.canonicalKind,
        research: true,
      }
    }
    return {
      verdict: 'ALLOW_RESEARCH',
      actionKind: request.kind,
      reason: 'Read/research browser action is auto-allowed.',
      reasonCode: 'ALLOWED_BOUNDED_READ',
      canonicalKind: null,
      research: true,
    }
  }

  if (FOUNDRY_VERIFY_KINDS.has(request.kind) && request.owner === 'foundry') {
    return {
      verdict: 'ALLOW_RESEARCH',
      actionKind: request.kind,
      reason: 'Foundry localhost/UI verification interaction (not a consequential external submission).',
      reasonCode: 'ALLOWED_BOUNDED_READ',
      canonicalKind: null,
      research: true,
    }
  }

  if (FOUNDRY_VERIFY_KINDS.has(request.kind) && request.owner === 'council') {
    return {
      verdict: 'ALLOW_RESEARCH',
      actionKind: request.kind,
      reason: 'Council in-page inspect/follow interaction treated as research unless classified consequential.',
      reasonCode: 'ALLOWED_BOUNDED_READ',
      canonicalKind: null,
      research: true,
    }
  }

  return {
    verdict: 'DENIED',
    actionKind: request.kind,
    reason: `Browser action ${request.kind} is unclassified and fail-closed.`,
    reasonCode: 'ACTION_KIND_UNCLASSIFIED',
    canonicalKind: null,
    research: false,
  }
}
