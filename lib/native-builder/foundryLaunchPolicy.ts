export type FoundryLaunchModelPolicy = 'LOCAL_ONLY'
export class FoundryLaunchPolicyError extends Error {}
export function parseLaunchModelPolicy(value: unknown): FoundryLaunchModelPolicy | undefined {
  if (value === undefined || value === null || value === 'AUTO') return undefined
  if (value === 'LOCAL_ONLY') return value
  throw new FoundryLaunchPolicyError('Unsupported model policy. Choose Foundry Auto or Local Only.')
}
/** Standalone repairs bind a workspace without forcing the application-builder lane. */
export function standaloneRepairBinding(workspaceId: string | null, continuation: boolean) {
  return { workspaceId: workspaceId ?? undefined, continueProjectId: continuation ? workspaceId ?? undefined : undefined }
}
export function localOnlyRouting(policy: FoundryLaunchModelPolicy | undefined, activeProvider: import('./foundryModelTypes').FoundryModelProviderId | null, pinnedModel?: { provider: string; modelId: string } | null) {
  return policy === 'LOCAL_ONLY' ? { requireLoopback: true, pinProvider: 'ollama' as const, pinModel: pinnedModel?.provider === 'ollama' ? pinnedModel.modelId : undefined } : { pinProvider: activeProvider }
}
export function isLoopbackModelEndpoint(endpoint: string): boolean {
  try { const url = new URL(endpoint); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) } catch { return false }
}
