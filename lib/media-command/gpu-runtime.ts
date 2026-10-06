/**
 * GPU execution is separable from .hvsproj truth.
 * Do not rewrite the renderer in this architecture pass.
 * Project format must not depend on one GPU vendor.
 */
export type HvsGpuBackend = 'none' | 'cpu' | 'nvenc' | 'webgpu'

export type HvsGpuWorkKind =
  | 'program-viewer'
  | 'compositing'
  | 'color'
  | 'tracking'
  | 'masks'
  | 'effects'
  | 'image'
  | 'ai-inference'

export const HVS_GPU_RUNTIME_POLICY = {
  projectTruthIndependentOfGpu: true,
  vendorNeutralProjectFormat: true,
  rewriteRendererThisPass: false,
  nvencNotRequiredForPhase1: true,
  nvencPhaseOwner: '9',
  allowedBackends: ['none', 'cpu', 'nvenc', 'webgpu'] as const,
  workKinds: [
    'program-viewer',
    'compositing',
    'color',
    'tracking',
    'masks',
    'effects',
    'image',
    'ai-inference',
  ] as const satisfies HvsGpuWorkKind[],
} as const

export function currentGpuBackend(): HvsGpuBackend {
  return 'cpu'
}
