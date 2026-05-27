import type { OperatorGap } from '../gapFinder'
import { auditBrokenSilentUi } from './brokenSilentUi'
import { auditConfusingLabels } from './confusingLabels'
import { auditDuplicateFeatures } from './duplicateFeatures'
import { mergeCanonicalGaps } from '../canonicalIssues'
import { dedupeGaps } from './merge'
import { auditMemoryUsefulness } from './memoryUsefulness'
import { auditMobileLayout } from './mobileLayout'
import { auditOldDiagnostics } from './oldDiagnostics'
import { auditOverOrchestration } from './overOrchestration'
import { auditPlaceholderValues } from './placeholderValues'
import { auditProviderUsability } from './providerUsability'
import { auditRevenueReadiness } from './revenueReadiness'
import type { SelfAuditContext } from './types'

export function runSelfAudit(ctx: SelfAuditContext): OperatorGap[] {
  const modules = [
    auditBrokenSilentUi,
    auditConfusingLabels,
    auditDuplicateFeatures,
    auditPlaceholderValues,
    auditOldDiagnostics,
    auditMobileLayout,
    auditProviderUsability,
    auditRevenueReadiness,
    auditMemoryUsefulness,
    auditOverOrchestration,
  ]
  const merged = modules.flatMap(fn => fn(ctx))
  return mergeCanonicalGaps(dedupeGaps(merged))
}
