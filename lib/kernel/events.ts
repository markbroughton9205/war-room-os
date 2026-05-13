import type { KernelEventType } from './types'

export const KERNEL_EVENT_TYPES: KernelEventType[] = [
  'decree.created',
  'tool.requested',
  'research.started',
  'research.completed',
  'opportunity.found',
  'opportunity.assigned',
  'action.required',
  'approval.granted',
  'memory.recommended',
  'memory.saved',
  'build.requested',
  'build.completed',
  'deployment.requested',
  'deployment.completed',
  'error.raised',
]

export const KERNEL_EVENT_SCHEMA = {
  requiredFields: ['type', 'source', 'createdAt', 'summary'],
  optionalFields: ['capability', 'status', 'risk', 'payload'],
  eventTypes: KERNEL_EVENT_TYPES,
} as const
