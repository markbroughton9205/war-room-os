import type { OperatorGap } from '../gapFinder'
import { selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditProviderUsability(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []

  if (!ctx.canonicalStatus && ctx.canonicalStatusUnavailable) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-provider-canonical-unavailable',
        title: 'Cannot load official provider status',
        plainLanguage: 'Self-audit could not read the live provider status endpoint.',
        meaning: 'Gap finder and AI Team Status may disagree until canonical status loads.',
        area: 'System Health',
        category: 'Provider Usability',
        kind: 'issue',
        severity: 'medium',
        recommendedFix: 'Ensure dev server is running; open System Health and refresh.',
        cursorCommand: 'Inspect app/api/runtime/canonical-status route and client fetch error handling.',
      }),
    )
    return gaps
  }

  for (const row of ctx.canonicalStatus?.providers ?? []) {
    const avail = (row.availability ?? '').toUpperCase()
    const label = row.label ?? row.family

    if (avail === 'NOT_CONFIGURED' || row.configured === false) {
      gaps.push(
        selfAuditGap({
          id: `self-audit-provider-key-${row.family}`,
          title: `${label} — API key missing`,
          plainLanguage: `${label} is not configured; council cannot call this family reliably.`,
          meaning: 'Provider family lacks API configuration.',
          area: 'Providers',
          category: 'Provider Usability',
          kind: 'issue',
          severity: 'high',
          recommendedFix: `Configure ${row.family} keys; refresh canonical status.`,
          cursorCommand: `Verify env keys for ${row.family} and canonical-status maps NOT_CONFIGURED.`,
        }),
      )
    } else if (avail === 'RATE_LIMITED') {
      gaps.push(
        selfAuditGap({
          id: `self-audit-provider-quota-${row.family}`,
          title: `${label} — rate limited`,
          plainLanguage: `${label} hit a quota limit; expect delayed or skipped turns.`,
          meaning: 'Provider returned rate limit signals.',
          area: 'Providers',
          category: 'Provider Usability',
          kind: 'issue',
          severity: 'high',
          recommendedFix: 'Wait for quota reset or reduce parallel council load.',
          cursorCommand: `Check quota handling for ${row.family} in provider health layer.`,
        }),
      )
    } else if (avail === 'INVALID_KEY') {
      gaps.push(
        selfAuditGap({
          id: `self-audit-provider-invalid-key-${row.family}`,
          title: `${label} — invalid API key`,
          plainLanguage: `${label} key is rejected; fix credentials before the next council wave.`,
          meaning: 'Canonical status reports invalid key.',
          area: 'Providers',
          category: 'Provider Usability',
          kind: 'issue',
          severity: 'high',
          recommendedFix: 'Rotate API key in environment; reload provider health.',
          cursorCommand: `Fix ${row.family} credentials in env and canonicalStatus mapper.`,
        }),
      )
    } else if (row.health === 'unavailable' || row.connectionStatus === 'error') {
      gaps.push(
        selfAuditGap({
          id: `self-audit-provider-unreachable-${row.family}`,
          title: `${label} — unreachable`,
          plainLanguage: `${label} cannot be reached with current settings.`,
          meaning: 'Family is down or misconfigured at runtime.',
          area: 'Providers',
          category: 'Provider Usability',
          kind: 'issue',
          severity: 'high',
          recommendedFix: 'Open AI Team Status and follow recovery steps.',
          cursorCommand: `Diagnose ${row.family} in ProviderRuntimePanel (no provider completions).`,
        }),
      )
    } else if (avail === 'DEGRADED' || row.health === 'degraded') {
      gaps.push(
        selfAuditGap({
          id: `self-audit-provider-degraded-${row.family}`,
          title: `${label} — degraded usability`,
          plainLanguage: `${label} works with limits; treat answers as lower trust until healthy.`,
          meaning: 'Provider is reachable but degraded.',
          area: 'Providers',
          category: 'Provider Usability',
          kind: 'suggestion',
          severity: 'medium',
          recommendedFix: 'Read degraded reason in AI Team Status.',
          cursorCommand: `Show degradedReason for ${row.family} in operator provider panel.`,
        }),
      )
    }
  }

  return gaps
}
