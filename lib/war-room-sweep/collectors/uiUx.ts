import 'server-only'

import type { SweepFinding } from '../types'

/** Lightweight static/heuristic UI checks — no filesystem crawl. */
export function collectUiUxFindings(): SweepFinding[] {
  const findings: SweepFinding[] = [
    {
      id: 'sweep:ui:split-tabs',
      title: 'Operator vs Engineering still exposed as full-page tabs',
      category: 'ui_ux',
      severity: 'MEDIUM',
      evidence: [
        'Legacy OPERATOR_TABS still include Engineering View and Diagnostics as separate destinations.',
        'Unified Live Room should emphasize mode toggles and engineering drawer instead.',
      ],
      affectedFeature: 'Command Center layout',
      affectedPanel: 'Live Room shell',
      suggestedAction: 'Use Live Room mode toggles (Operator/Builder/Intelligence/Repair) and Engineering drawer for heavy diagnostics.',
      classification: 'fix',
      repairPacketAvailable: true,
      cursorReadyCommand: 'Refactor app/page.tsx tab nav to LiveRoomMode toggles; move Schema/Sweep/Repair panels into engineering drawer.',
    },
    {
      id: 'sweep:ui:duplicate-session-controls',
      title: 'Council session controls may duplicate between toolbar and legacy strips',
      category: 'ui_ux',
      severity: 'LOW',
      evidence: [
        'LiveRoomCenter toolbar renders session controls (mode, pause, deep discussion).',
        'Non-unified command path may still render overlapping provider/session UI.',
      ],
      affectedFeature: 'Live Council',
      affectedPanel: 'Center · Council toolbar',
      suggestedAction: 'Keep a single session control cluster in Live Room center toolbar when unified layout is active.',
      classification: 'fix',
      repairPacketAvailable: false,
    },
    {
      id: 'sweep:ui:evolution-placement',
      title: 'War Room Evolution appears in Live Environment and left rail',
      category: 'ui_ux',
      severity: 'INFO',
      evidence: ['WarRoomEvolutionPanel is mounted in LiveEnvironmentPanel and LiveRoomLeftRail.'],
      affectedFeature: 'War Room Evolution',
      affectedPanel: 'Left Rail / Live Environment',
      suggestedAction: 'Prefer left rail summary in unified layout; hide duplicate in Live Environment when left rail is visible.',
      classification: 'remove',
      repairPacketAvailable: false,
      duplicateOf: 'sweep:ui:split-tabs',
    },
  ]
  return findings
}
