import 'server-only'

import { collectCouncilFindings } from './collectors/council'
import { collectEngineeringFindings } from './collectors/engineering'
import { collectMissingConfigFindings } from './collectors/missingConfig'
import { collectMissionFindings } from './collectors/mission'
import { collectProviderFindings } from './collectors/providers'
import { collectSchemaFindings } from './collectors/schema'
import { collectSignalFindings } from './collectors/signals'
import { collectUiUxFindings } from './collectors/uiUx'
import { buildRepairPacketFromFinding } from './repairPacket'
import type { SweepClassification, SweepFinding, SweepReport, SweepSeverity } from './types'

const SEVERITY_ORDER: Record<SweepSeverity, number> = {
  BLOCKER: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
}

function sortBySeverity(findings: SweepFinding[]): SweepFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

function dedupeFindings(findings: SweepFinding[]): SweepFinding[] {
  const seen = new Map<string, SweepFinding>()
  for (const finding of findings) {
    const key = finding.title.toLowerCase().replace(/\s+/g, ' ')
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, finding)
      continue
    }
    if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[existing.severity]) {
      seen.set(key, { ...finding, duplicateOf: existing.id })
    } else if (!existing.duplicateOf) {
      seen.set(key, { ...existing, duplicateOf: finding.id })
    }
  }
  return [...seen.values()]
}

function buildSummary(findings: SweepFinding[], readinessScore: number): SweepReport['summary'] {
  const fixes = sortBySeverity(findings.filter(f => f.classification === 'fix'))
  const additions = sortBySeverity(findings.filter(f => f.classification === 'add'))
  const removals = sortBySeverity(findings.filter(f => f.classification === 'remove'))
  const duplicates = findings.filter(f => f.duplicateOf)
  const missingConfig = findings.filter(f => f.category === 'missing_configuration')
  const staleDegraded = findings.filter(
    f => f.category === 'signal_intelligence' || f.category === 'provider_runtime',
  ).filter(f => f.severity === 'HIGH' || f.severity === 'MEDIUM')

  const topBlocker = sortBySeverity(findings.filter(f => f.repairPacketAvailable || f.severity === 'BLOCKER' || f.severity === 'HIGH'))[0]

  return {
    readinessScore,
    missingConfigCount: missingConfig.length,
    repairCount: fixes.length,
    duplicateCount: duplicates.length,
    staleDegradedCount: staleDegraded.length,
    topFixes: fixes.slice(0, 5),
    topAdditions: additions.slice(0, 3),
    topRemovals: removals.slice(0, 3),
    duplicates,
    missingConfig,
    recommendedNextRepairPacketId: topBlocker?.id ?? null,
  }
}

export async function runWarRoomOsSweep(req: Request): Promise<SweepReport> {
  const generatedAt = new Date().toISOString()
  const sources: SweepReport['sources'] = []

  const chunks: SweepFinding[][] = []

  try {
    chunks.push(await collectMissingConfigFindings(req))
    sources.push({ id: 'missing-config', label: 'Missing configuration', status: 'ok' })
  } catch {
    sources.push({ id: 'missing-config', label: 'Missing configuration', status: 'error' })
  }

  try {
    chunks.push(await collectSchemaFindings(req))
    sources.push({ id: 'schema', label: 'Schema / database', status: 'ok' })
  } catch {
    sources.push({ id: 'schema', label: 'Schema / database', status: 'error' })
  }

  try {
    chunks.push(await collectProviderFindings(req))
    sources.push({ id: 'providers', label: 'Provider runtime', status: 'ok' })
  } catch {
    sources.push({ id: 'providers', label: 'Provider runtime', status: 'error' })
  }

  try {
    chunks.push(await collectSignalFindings())
    sources.push({ id: 'signals', label: 'Signal intelligence', status: 'ok' })
  } catch {
    sources.push({ id: 'signals', label: 'Signal intelligence', status: 'error' })
  }

  chunks.push(collectUiUxFindings())
  sources.push({ id: 'ui-ux', label: 'UI / UX heuristics', status: 'ok' })

  chunks.push(collectEngineeringFindings())
  sources.push({ id: 'engineering', label: 'Engineering manifest', status: 'ok' })

  try {
    chunks.push(await collectCouncilFindings(req))
    sources.push({ id: 'council', label: 'Council orchestration', status: 'ok' })
  } catch {
    sources.push({ id: 'council', label: 'Council orchestration', status: 'error' })
  }

  try {
    chunks.push(await collectMissionFindings(req))
    sources.push({ id: 'mission', label: 'Mission / revenue', status: 'ok' })
  } catch {
    sources.push({ id: 'mission', label: 'Mission / revenue', status: 'error' })
  }

  const merged = dedupeFindings(chunks.flat())
  for (const finding of merged) {
    if (finding.repairPacketAvailable && !finding.cursorReadyCommand) {
      finding.cursorReadyCommand = buildRepairPacketFromFinding(finding).cursorReadyPrompt
    }
  }

  let readinessScore = 100
  for (const finding of merged) {
    if (finding.severity === 'BLOCKER') readinessScore -= 18
    else if (finding.severity === 'HIGH') readinessScore -= 10
    else if (finding.severity === 'MEDIUM') readinessScore -= 5
    else if (finding.severity === 'LOW') readinessScore -= 2
  }
  readinessScore = Math.max(0, Math.min(100, readinessScore))

  return {
    generatedAt,
    findings: sortBySeverity(merged),
    summary: buildSummary(merged, readinessScore),
    sources,
    guardrails: {
      diagnosticOnly: true,
      autoMutation: false,
      exposesSecrets: false,
    },
  }
}

export function filterFindings(
  findings: SweepFinding[],
  filters: { category?: string; severity?: string; classification?: SweepClassification },
): SweepFinding[] {
  return findings.filter(f => {
    if (filters.category && f.category !== filters.category) return false
    if (filters.severity && f.severity !== filters.severity) return false
    if (filters.classification && f.classification !== filters.classification) return false
    return true
  })
}
