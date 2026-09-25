import { randomUUID } from 'node:crypto'
import type { ExternalTargetBinding, ExternalWindowIdentity } from './types'

const bindings = new Map<string, ExternalTargetBinding>()

export function bindTarget(input: Omit<ExternalTargetBinding, 'bindingId' | 'timestamp'>): ExternalTargetBinding {
  const binding: ExternalTargetBinding = {
    ...input,
    bindingId: randomUUID(),
    timestamp: new Date().toISOString(),
  }
  bindings.set(binding.bindingId, binding)
  return binding
}

export function getBinding(bindingId: string): ExternalTargetBinding | null {
  return bindings.get(bindingId) ?? null
}

export function invalidateBinding(bindingId: string): void {
  bindings.delete(bindingId)
}

export function invalidateAppBindings(appId: string): void {
  for (const [id, binding] of bindings) {
    if (binding.application === appId) bindings.delete(id)
  }
}

export function invalidateAllBindings(): void {
  bindings.clear()
}

export function bindingStillValid(
  binding: ExternalTargetBinding,
  live: { window: ExternalWindowIdentity; frameGeneration: string },
): { ok: boolean; reason?: string } {
  if (binding.application !== live.window.appId) return { ok: false, reason: 'application-changed' }
  if (binding.windowIdentity.title !== live.window.title) return { ok: false, reason: 'window-title-changed' }
  const a = binding.windowIdentity.screen
  const b = live.window.screen
  if (a && b && (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height)) {
    return { ok: false, reason: 'window-moved-or-resized' }
  }
  if (binding.frameGeneration !== live.frameGeneration) return { ok: false, reason: 'frame-generation-changed' }
  return { ok: true }
}
