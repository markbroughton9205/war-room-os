import 'server-only'

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SweepFinding } from '../types'

const EXPECTED_API_ROUTES = [
  'app/api/war-room/sweep/route.ts',
  'app/api/evolution/repair-intelligence/route.ts',
  'app/api/schema/sweep/route.ts',
  'app/api/schema/repair-packet/route.ts',
  'app/api/runtime/canonical-status/route.ts',
  'app/api/council/repair-packet/route.ts',
  'app/api/engineering/queue/route.ts',
  'app/api/chat/route.ts',
] as const

const ORPHAN_ROUTE_CANDIDATES = [
  'app/api/debug/action-queue-write/route.ts',
] as const

/** Manifest-based route checks — advisory only. */
export function collectEngineeringFindings(repoRoot = process.cwd()): SweepFinding[] {
  const findings: SweepFinding[] = []

  for (const route of EXPECTED_API_ROUTES) {
    const full = join(repoRoot, route)
    if (!existsSync(full)) {
      findings.push({
        id: `sweep:eng:missing-route:${route}`,
        title: `Expected API route missing: ${route}`,
        category: 'engineering_runtime',
        severity: route.includes('war-room/sweep') ? 'BLOCKER' : 'HIGH',
        evidence: [`File not found at ${route}`],
        affectedFeature: 'War Room APIs',
        affectedPanel: 'Engineering · Route manifest',
        suggestedAction: `Restore or implement ${route}.`,
        classification: 'add',
        repairPacketAvailable: true,
      })
    }
  }

  for (const route of ORPHAN_ROUTE_CANDIDATES) {
    const full = join(repoRoot, route)
    if (existsSync(full)) {
      findings.push({
        id: `sweep:eng:orphan:${route}`,
        title: `Debug route candidate: ${route}`,
        category: 'engineering_runtime',
        severity: 'LOW',
        evidence: ['Route exists under debug/ — confirm it is intentional and not exposed in operator UI.'],
        affectedFeature: 'Engineering diagnostics',
        affectedPanel: 'Engineering drawer',
        suggestedAction: 'Gate behind advanced mode or remove if unused.',
        classification: 'remove',
        repairPacketAvailable: false,
      })
    }
  }

  findings.push({
    id: 'sweep:eng:lazy-panels',
    title: 'Heavy engineering panels should stay drawer-lazy',
    category: 'engineering_runtime',
    severity: 'INFO',
    evidence: [
      'SchemaSweepPanel, RepairPacketPanel, WarRoomSweepPanel use dynamic import in unified layout.',
    ],
    affectedFeature: 'Performance',
    affectedPanel: 'Engineering drawer',
    suggestedAction: 'Keep diagnostics behind drawer open; avoid mounting on initial Command Center paint.',
    classification: 'fix',
    repairPacketAvailable: false,
  })

  return findings
}
