/**
 * Model lineage/ownership registry. Only `war_room_trained_from_scratch` may ever receive
 * ownershipClass: 'war_room_native' — enforced structurally here, not left to caller discipline.
 */
import { randomUUID } from 'node:crypto'
import type { ModelLineageKind, ModelManifest, ModelOwnershipClass } from './types'

function ownershipClassFor(lineageKind: ModelLineageKind): ModelOwnershipClass {
  return lineageKind === 'war_room_trained_from_scratch' ? 'war_room_native' : 'third_party'
}

/** Capability-module records live in `lib/modular-intelligence` so this file stays
 * lineage/ownership for full model checkpoints. Do not register a composed runtime
 * as a merged ModelManifest. */
export { buildCapabilityModuleRecord } from '@/lib/modular-intelligence/capabilityRegistry'

export function buildModelManifest(args: {
  lineageKind: ModelLineageKind
  checkpointId: string | null
  parentModelId: string | null
  description: string
}): ModelManifest {
  return {
    modelId: randomUUID(),
    createdAt: new Date().toISOString(),
    lineageKind: args.lineageKind,
    ownershipClass: ownershipClassFor(args.lineageKind),
    checkpointId: args.checkpointId,
    parentModelId: args.parentModelId,
    description: args.description,
  }
}
