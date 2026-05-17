import type { EngineeringTaskPacket } from './engineeringTaskPacket'
import { buildCursorHandoffText } from './engineeringTaskPacket'

export type CursorEngineeringAgent = {
  id: 'cursor'
  name: 'Cursor'
  role: 'preferred_manual_executor'
  availability: 'available_manual'
  executionModel: 'manual_approved_workspace'
  repoAwareness: 'workspace_native'
  canBeInvokedByWarRoom: false
  approvalRequired: true
  notes: string
}

export const CURSOR_ENGINEERING_AGENT: CursorEngineeringAgent = {
  id: 'cursor',
  name: 'Cursor',
  role: 'preferred_manual_executor',
  availability: 'available_manual',
  executionModel: 'manual_approved_workspace',
  repoAwareness: 'workspace_native',
  canBeInvokedByWarRoom: false,
  approvalRequired: true,
  notes: 'Preferred Commander-approved engineering workspace. War Room prepares task packets and review context; Cursor execution is manual, visible, and approval-gated.',
}

export function buildCursorTaskReceiver(packet: EngineeringTaskPacket) {
  return {
    executor: CURSOR_ENGINEERING_AGENT,
    handoffText: buildCursorHandoffText(packet),
    requiredCommanderAction: 'Approve the prepared packet before any Cursor-side file mutation, commit, push, deploy, or deletion.',
  }
}
