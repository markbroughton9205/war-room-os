/**
 * Typed HVS EffectGraph. Persistent on the same .hvsproj. No compositor runtime in Wave 1.
 * Graph output is intended to join the SAME project's RenderGraph.
 * CSS is not canonical VFX truth.
 */
export type HvsEffectNodeKind =
  | 'MediaIn'
  | 'MediaOut'
  | 'Transform'
  | 'Merge'
  | 'Mask'
  | 'ColorCorrect'
  | 'Blur'
  | 'Glow'
  | 'Text'
  | 'TrackerRef'
  | 'Background'
  | 'Keyer'
  | 'Placeholder'

export const EFFECT_CORE_NODE_KINDS: HvsEffectNodeKind[] = [
  'MediaIn',
  'MediaOut',
  'Transform',
  'Merge',
  'Mask',
  'Blur',
  'ColorCorrect',
  'Text',
  'TrackerRef',
  'Background',
  'Keyer',
]

export type HvsEffectPort = {
  id: string
  name: string
  kind: 'input' | 'output'
}

export type HvsEffectNode = {
  id: string
  kind: HvsEffectNodeKind
  inputs: HvsEffectPort[]
  outputs: HvsEffectPort[]
  parameters: Record<string, unknown>
  enabled?: boolean
}

export type HvsEffectConnection = {
  fromNode: string
  fromPort: string
  toNode: string
  toPort: string
}

export type HvsEffectGraph = {
  id: string
  projectId: string
  versionLabel: string
  nodes: HvsEffectNode[]
  connections: HvsEffectConnection[]
}

export function defaultPorts(kind: HvsEffectNodeKind): { inputs: HvsEffectPort[]; outputs: HvsEffectPort[] } {
  if (kind === 'MediaIn' || kind === 'Background' || kind === 'Text' || kind === 'TrackerRef') {
    return { inputs: [], outputs: [{ id: 'out', name: 'rgba', kind: 'output' }] }
  }
  if (kind === 'MediaOut') {
    return { inputs: [{ id: 'in', name: 'rgba', kind: 'input' }], outputs: [] }
  }
  if (kind === 'Merge') {
    return {
      inputs: [
        { id: 'a', name: 'rgba', kind: 'input' },
        { id: 'b', name: 'rgba', kind: 'input' },
      ],
      outputs: [{ id: 'out', name: 'rgba', kind: 'output' }],
    }
  }
  if (kind === 'Mask' || kind === 'Keyer') {
    return {
      inputs: [
        { id: 'in', name: 'rgba', kind: 'input' },
        { id: 'mask', name: 'matte', kind: 'input' },
      ],
      outputs: [{ id: 'out', name: 'rgba', kind: 'output' }],
    }
  }
  return {
    inputs: [{ id: 'in', name: 'rgba', kind: 'input' }],
    outputs: [{ id: 'out', name: 'rgba', kind: 'output' }],
  }
}

export function emptyEffectGraph(projectId: string): HvsEffectGraph {
  const mediaIn: HvsEffectNode = { id: 'media-in', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: {}, enabled: true }
  const mediaOut: HvsEffectNode = { id: 'media-out', kind: 'MediaOut', ...defaultPorts('MediaOut'), parameters: {}, enabled: true }
  return {
    id: `fxg-${projectId}`,
    projectId,
    versionLabel: 'Graph 1',
    nodes: [mediaIn, mediaOut],
    connections: [],
  }
}

export function passthroughEffectGraph(projectId: string, assetId?: string): HvsEffectGraph {
  const graph = emptyEffectGraph(projectId)
  graph.nodes[0].parameters = { assetId: assetId ?? null }
  graph.connections = [{ fromNode: 'media-in', fromPort: 'out', toNode: 'media-out', toPort: 'in' }]
  return graph
}

export type EffectGraphValidation = { ok: boolean; errors: string[] }

function hasCycle(graph: HvsEffectGraph): boolean {
  const adj = new Map<string, string[]>()
  for (const node of graph.nodes) adj.set(node.id, [])
  for (const edge of graph.connections) {
    adj.get(edge.fromNode)?.push(edge.toNode)
  }
  const visiting = new Set<string>()
  const seen = new Set<string>()
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (seen.has(id)) return false
    visiting.add(id)
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true
    }
    visiting.delete(id)
    seen.add(id)
    return false
  }
  return graph.nodes.some(node => dfs(node.id))
}

export function validateEffectGraph(
  graph: HvsEffectGraph,
  ctx?: { assetIds?: Set<string>; subjectIds?: Set<string> },
): EffectGraphValidation {
  const errors: string[] = []
  try {
    if (!graph?.id || !graph.projectId) errors.push('Graph missing id or projectId.')
    const ids = new Set<string>()
    const nodeMap = new Map<string, HvsEffectNode>()
    let mediaOutCount = 0
    for (const node of graph.nodes ?? []) {
      if (!node.id) errors.push('Node missing id.')
      else if (ids.has(node.id)) errors.push(`Duplicate node id ${node.id}.`)
      else ids.add(node.id)
      nodeMap.set(node.id, node)
      if (!EFFECT_CORE_NODE_KINDS.includes(node.kind) && node.kind !== 'Glow' && node.kind !== 'Placeholder') {
        errors.push(`Unknown node type ${String(node.kind)}.`)
      }
      if (node.kind === 'MediaOut') mediaOutCount += 1
      if (node.kind === 'MediaIn') {
        const assetId = node.parameters.assetId
        if (typeof assetId === 'string' && ctx?.assetIds && !ctx.assetIds.has(assetId)) {
          errors.push(`MediaIn ${node.id} references missing asset ${assetId}.`)
        }
      }
      if (node.kind === 'TrackerRef') {
        const subjectId = node.parameters.subjectId
        if (typeof subjectId === 'string' && ctx?.subjectIds && !ctx.subjectIds.has(subjectId)) {
          errors.push(`TrackerRef ${node.id} must reference an existing TrackSubject.`)
        }
      }
      if (node.kind === 'Mask') {
        const shape = node.parameters.shape
        if (shape != null && shape !== 'rectangle' && shape !== 'ellipse' && shape !== 'polygon') {
          errors.push(`Mask ${node.id} has invalid shape.`)
        }
      }
    }
    if (mediaOutCount !== 1) errors.push('Graph requires exactly one MediaOut.')
    const mediaOut = (graph.nodes ?? []).find(n => n.kind === 'MediaOut')
    if (mediaOut && !(graph.connections ?? []).some(edge => edge.toNode === mediaOut.id)) {
      errors.push('MediaOut has no inbound connection.')
    }
    for (const edge of graph.connections ?? []) {
      const from = nodeMap.get(edge.fromNode)
      const to = nodeMap.get(edge.toNode)
      if (!from || !to) {
        errors.push(`Connection ${edge.fromNode} → ${edge.toNode} references missing node.`)
        continue
      }
      if (!from.outputs.some(p => p.id === edge.fromPort && p.kind === 'output')) {
        errors.push(`Invalid output port ${edge.fromNode}.${edge.fromPort}.`)
      }
      if (!to.inputs.some(p => p.id === edge.toPort && p.kind === 'input')) {
        errors.push(`Invalid input port ${edge.toNode}.${edge.toPort}.`)
      }
    }
    if (hasCycle(graph)) errors.push('EffectGraph cycle rejected.')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'EffectGraph validation failed.')
  }
  return { ok: errors.length === 0, errors }
}

export const WAVE2_EXECUTABLE_EFFECT_NODES: HvsEffectNodeKind[] = [
  'MediaIn',
  'MediaOut',
  'Transform',
  'Merge',
  'Mask',
  'Background',
  'Blur',
  'TrackerRef',
  'Text',
]

export const WAVE9_EXECUTABLE_EFFECT_NODES: HvsEffectNodeKind[] = [
  ...WAVE2_EXECUTABLE_EFFECT_NODES,
  'Keyer',
]

export const WAVE9_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'addition'] as const
export type Wave9BlendMode = (typeof WAVE9_BLEND_MODES)[number]

export const WAVE9_MASK_COMBINE = ['add', 'subtract', 'intersect'] as const
export type Wave9MaskCombine = (typeof WAVE9_MASK_COMBINE)[number]

export type TransformParams = {
  x: number
  y: number
  nx: number
  ny: number
  scaleX: number
  scaleY: number
  rotationDeg: number
  opacity: number
}

export function readTransformParams(node: HvsEffectNode): TransformParams {
  const p = node.parameters ?? {}
  const num = (key: string, fallback: number) => {
    const v = p[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  return {
    x: num('x', 0),
    y: num('y', 0),
    nx: num('nx', 0),
    ny: num('ny', 0),
    scaleX: num('scaleX', 1),
    scaleY: num('scaleY', 1),
    rotationDeg: num('rotation', num('rotationDeg', 0)),
    opacity: Math.max(0, Math.min(1, num('opacity', 1))),
  }
}

export function effectTransformToPreviewCss(params: TransformParams): string {
  return `translate(${params.x}px, ${params.y}px) scale(${params.scaleX}, ${params.scaleY}) rotate(${params.rotationDeg}deg)`
}

export type MaskParams = {
  type: 'rectangle' | 'ellipse'
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  feather: number
  invert: boolean
  subjectId: string | null
}

export function readMaskParams(node: HvsEffectNode | undefined, subjectBox?: { x: number; y: number; width: number; height: number } | null): MaskParams {
  const p = node?.parameters ?? {}
  const num = (key: string, fallback: number) => {
    const v = p[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const fromSubject = subjectBox && (typeof p.subjectId === 'string' || p.trackerRef === true)
  const x = fromSubject ? subjectBox.x : num('x', num('nx', 0))
  const y = fromSubject ? subjectBox.y : num('y', num('ny', 0))
  const width = fromSubject ? subjectBox.width : num('width', num('nw', 0.5))
  const height = fromSubject ? subjectBox.height : num('height', num('nh', 1))
  const type = p.type === 'ellipse' || p.shape === 'ellipse' ? 'ellipse' : 'rectangle'
  return {
    type,
    x,
    y,
    width,
    height,
    centerX: num('centerX', x + width / 2),
    centerY: num('centerY', y + height / 2),
    radiusX: num('radiusX', width / 2),
    radiusY: num('radiusY', height / 2),
    feather: Math.max(0, Math.min(1, num('feather', 0))),
    invert: p.invert === true,
    subjectId: typeof p.subjectId === 'string' ? p.subjectId : null,
  }
}

export function maskPreviewCss(params: MaskParams): string {
  if (params.type === 'ellipse') {
    const cx = (params.invert ? params.centerX : params.centerX) * 100
    const cy = params.centerY * 100
    const rx = params.radiusX * 100
    const ry = params.radiusY * 100
    return `ellipse(${rx}% ${ry}% at ${cx}% ${cy}%)`
  }
  const x = params.x * 100
  const y = params.y * 100
  const w = params.width * 100
  const h = params.height * 100
  return `inset(${y}% ${Math.max(0, 100 - x - w)}% ${Math.max(0, 100 - y - h)}% ${x}%)`
}

export function firstMaskedMergeGraph(
  projectId: string,
  backgroundAssetId: string,
  foregroundAssetId: string,
  transform?: Partial<TransformParams>,
  mask?: Partial<MaskParams>,
): HvsEffectGraph {
  const base = firstMergeGraph(projectId, backgroundAssetId, foregroundAssetId, transform)
  const maskNode: HvsEffectNode = {
    id: 'mask-1',
    kind: 'Mask',
    ...defaultPorts('Mask'),
    enabled: true,
    parameters: {
      shape: mask?.type ?? 'rectangle',
      type: mask?.type ?? 'rectangle',
      x: mask?.x ?? 0,
      y: mask?.y ?? 0,
      width: mask?.width ?? 0.5,
      height: mask?.height ?? 1,
      centerX: mask?.centerX ?? 0.5,
      centerY: mask?.centerY ?? 0.5,
      radiusX: mask?.radiusX ?? 0.28,
      radiusY: mask?.radiusY ?? 0.36,
      feather: mask?.feather ?? 0,
      invert: mask?.invert ?? false,
      subjectId: mask?.subjectId ?? null,
    },
  }
  return {
    ...base,
    id: `fxg-mask-${projectId}`,
    versionLabel: 'Wave 3 Masked Merge',
    nodes: [...base.nodes.filter(n => n.id !== 'media-out'), maskNode, base.nodes.find(n => n.id === 'media-out')!],
    connections: [
      { fromNode: 'media-a', fromPort: 'out', toNode: 'merge-1', toPort: 'a' },
      { fromNode: 'media-b', fromPort: 'out', toNode: 'xf-b', toPort: 'in' },
      { fromNode: 'xf-b', fromPort: 'out', toNode: 'mask-1', toPort: 'in' },
      { fromNode: 'mask-1', fromPort: 'out', toNode: 'merge-1', toPort: 'b' },
      { fromNode: 'merge-1', fromPort: 'out', toNode: 'media-out', toPort: 'in' },
    ],
  }
}

export type EffectLoweringPlan = {
  backend: 'ffmpeg'
  filters: string[]
  filterComplex: string | null
  notes: string[]
  executable: boolean
  previewCss: string | null
}

function graphExecutable(graph: HvsEffectGraph): boolean {
  const check = validateEffectGraph(graph)
  if (!check.ok) return false
  return graph.nodes.every(n => WAVE9_EXECUTABLE_EFFECT_NODES.includes(n.kind) || n.enabled === false)
}

export function firstMergeGraph(projectId: string, backgroundAssetId: string, foregroundAssetId: string, transform?: Partial<TransformParams>): HvsEffectGraph {
  const xf: TransformParams = {
    x: transform?.x ?? 40,
    y: transform?.y ?? 80,
    nx: transform?.nx ?? 0.08,
    ny: transform?.ny ?? 0.09,
    scaleX: transform?.scaleX ?? 0.35,
    scaleY: transform?.scaleY ?? 0.35,
    rotationDeg: transform?.rotationDeg ?? 0,
    opacity: transform?.opacity ?? 0.92,
  }
  const mediaA: HvsEffectNode = { id: 'media-a', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: { assetId: backgroundAssetId, role: 'background' }, enabled: true }
  const mediaB: HvsEffectNode = { id: 'media-b', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: { assetId: foregroundAssetId, role: 'foreground' }, enabled: true }
  const xfNode: HvsEffectNode = { id: 'xf-b', kind: 'Transform', ...defaultPorts('Transform'), parameters: { ...xf }, enabled: true }
  const merge: HvsEffectNode = { id: 'merge-1', kind: 'Merge', ...defaultPorts('Merge'), parameters: { order: 'A-background-B-foreground' }, enabled: true }
  const out: HvsEffectNode = { id: 'media-out', kind: 'MediaOut', ...defaultPorts('MediaOut'), parameters: {}, enabled: true }
  return {
    id: `fxg-merge-${projectId}`,
    projectId,
    versionLabel: 'Wave 2 Merge',
    nodes: [mediaA, mediaB, xfNode, merge, out],
    connections: [
      { fromNode: 'media-a', fromPort: 'out', toNode: 'merge-1', toPort: 'a' },
      { fromNode: 'media-b', fromPort: 'out', toNode: 'xf-b', toPort: 'in' },
      { fromNode: 'xf-b', fromPort: 'out', toNode: 'merge-1', toPort: 'b' },
      { fromNode: 'merge-1', fromPort: 'out', toNode: 'media-out', toPort: 'in' },
    ],
  }
}

export function planEffectGraphLowering(graph: HvsEffectGraph): EffectLoweringPlan {
  const executable = graphExecutable(graph)
  const xf = graph.nodes.find(n => n.kind === 'Transform')
  const params = xf ? readTransformParams(xf) : null
  const notes = [
    'CSS is not canonical VFX truth. Program preview CSS is derived from the same Transform parameters.',
    `Nodes: ${graph.nodes.map(n => n.kind).join(', ') || '(none)'}`,
    executable ? 'Wave 9 lowering emits FFmpeg overlay/geq/gblur/drawtext/chromakey/blend for MediaIn/Transform/Mask/Blur/Text/TrackerRef/Merge/Keyer/MediaOut. CSS preview is not composite truth.' : 'Graph is not executable in this wave.',
  ]
  return {
    backend: 'ffmpeg',
    filters: executable && params
      ? [
          `scale=iw*${params.scaleX}:ih*${params.scaleY}`,
          `overlay=${params.x}:${params.y}`,
        ]
      : [],
    filterComplex: null,
    notes,
    executable,
    previewCss: (() => {
      const mask = readMaskParams(graph.nodes.find(n => n.kind === 'Mask'))
      const blur = graph.nodes.find(n => n.kind === 'Blur' && n.enabled !== false)
      const radius = typeof blur?.parameters.radius === 'number' ? blur.parameters.radius : 0
      const xfCss = params ? `transform:${effectTransformToPreviewCss(params)};opacity:${params.opacity}` : ''
      const maskCss = graph.nodes.some(n => n.kind === 'Mask') ? `;clip-path:${maskPreviewCss(mask)}` : ''
      const blurCss = blur && radius > 0 ? `;filter:blur(${radius}px)` : ''
      return xfCss || maskCss || blurCss ? `${xfCss}${maskCss}${blurCss}` : null
    })(),
  }
}

export function firstEllipseMaskGraph(
  projectId: string,
  backgroundAssetId: string,
  foregroundAssetId: string,
  mask?: Partial<MaskParams>,
): HvsEffectGraph {
  return firstMaskedMergeGraph(projectId, backgroundAssetId, foregroundAssetId, { nx: 0, ny: 0, scaleX: 1, scaleY: 1, x: 0, y: 0, opacity: 1 }, {
    type: 'ellipse',
    centerX: mask?.centerX ?? 0.5,
    centerY: mask?.centerY ?? 0.5,
    radiusX: mask?.radiusX ?? 0.32,
    radiusY: mask?.radiusY ?? 0.42,
    feather: mask?.feather ?? 0.08,
    invert: mask?.invert ?? false,
    subjectId: mask?.subjectId ?? null,
  })
}

export function firstTrackedMaskGraph(
  projectId: string,
  backgroundAssetId: string,
  foregroundAssetId: string,
  subjectId: string,
): HvsEffectGraph {
  const base = firstEllipseMaskGraph(projectId, backgroundAssetId, foregroundAssetId, { type: 'ellipse', feather: 0.06, invert: false, subjectId })
  const tracker: HvsEffectNode = {
    id: 'tracker-1',
    kind: 'TrackerRef',
    ...defaultPorts('TrackerRef'),
    enabled: true,
    parameters: { subjectId, label: 'TRACKED GEOMETRIC — not semantic segmentation' },
  }
  return {
    ...base,
    id: `fxg-tracked-${projectId}`,
    versionLabel: 'Wave 4 Tracked Geometric Mask',
    nodes: [tracker, ...base.nodes],
  }
}

export function firstBlurGraph(projectId: string, assetId: string, radius = 8): HvsEffectGraph {
  const media: HvsEffectNode = { id: 'media-in', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: { assetId }, enabled: true }
  const blur: HvsEffectNode = { id: 'blur-1', kind: 'Blur', ...defaultPorts('Blur'), parameters: { radius, enabled: true }, enabled: true }
  const out: HvsEffectNode = { id: 'media-out', kind: 'MediaOut', ...defaultPorts('MediaOut'), parameters: {}, enabled: true }
  return {
    id: `fxg-blur-${projectId}`,
    projectId,
    versionLabel: 'Wave 4 Blur',
    nodes: [media, blur, out],
    connections: [
      { fromNode: 'media-in', fromPort: 'out', toNode: 'blur-1', toPort: 'in' },
      { fromNode: 'blur-1', fromPort: 'out', toNode: 'media-out', toPort: 'in' },
    ],
  }
}

export function firstTrackedBackgroundBlurGraph(projectId: string, assetId: string, subjectId: string, radius = 10): HvsEffectGraph {
  const media: HvsEffectNode = { id: 'media-in', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: { assetId }, enabled: true }
  const blur: HvsEffectNode = { id: 'blur-1', kind: 'Blur', ...defaultPorts('Blur'), parameters: { radius, label: 'TRACKED GEOMETRIC BACKGROUND BLUR' }, enabled: true }
  const mask: HvsEffectNode = {
    id: 'mask-1',
    kind: 'Mask',
    ...defaultPorts('Mask'),
    parameters: { type: 'ellipse', shape: 'ellipse', invert: true, feather: 0.08, subjectId },
    enabled: true,
  }
  const tracker: HvsEffectNode = {
    id: 'tracker-1',
    kind: 'TrackerRef',
    ...defaultPorts('TrackerRef'),
    parameters: { subjectId, label: 'TRACKED GEOMETRIC — not semantic segmentation' },
    enabled: true,
  }
  const merge: HvsEffectNode = { id: 'merge-1', kind: 'Merge', ...defaultPorts('Merge'), parameters: {}, enabled: true }
  const out: HvsEffectNode = { id: 'media-out', kind: 'MediaOut', ...defaultPorts('MediaOut'), parameters: {}, enabled: true }
  return {
    id: `fxg-tracked-blur-${projectId}`,
    projectId,
    versionLabel: 'Wave 5 Tracked Geometric Background Blur',
    nodes: [tracker, media, blur, mask, merge, out],
    connections: [
      { fromNode: 'media-in', fromPort: 'out', toNode: 'blur-1', toPort: 'in' },
      { fromNode: 'blur-1', fromPort: 'out', toNode: 'merge-1', toPort: 'a' },
      { fromNode: 'media-in', fromPort: 'out', toNode: 'mask-1', toPort: 'in' },
      { fromNode: 'mask-1', fromPort: 'out', toNode: 'merge-1', toPort: 'b' },
      { fromNode: 'merge-1', fromPort: 'out', toNode: 'media-out', toPort: 'in' },
    ],
  }
}

export function firstDualMaskGraph(projectId: string, backgroundAssetId: string, foregroundAssetId: string): HvsEffectGraph {
  const base = firstEllipseMaskGraph(projectId, backgroundAssetId, foregroundAssetId, {
    type: 'ellipse', centerX: 0.35, centerY: 0.45, radiusX: 0.22, radiusY: 0.3, feather: 0.06,
  })
  const mask2: HvsEffectNode = {
    id: 'mask-2',
    kind: 'Mask',
    ...defaultPorts('Mask'),
    enabled: true,
    parameters: {
      type: 'rectangle', shape: 'rectangle', x: 0.55, y: 0.2, width: 0.35, height: 0.55, feather: 0.04, invert: false,
    },
  }
  return {
    ...base,
    id: `fxg-dual-mask-${projectId}`,
    versionLabel: 'Wave 5 Dual Mask',
    nodes: [...base.nodes.filter(n => n.id !== 'media-out'), mask2, base.nodes.find(n => n.id === 'media-out')!],
    connections: [
      ...base.connections.filter(c => !(c.fromNode === 'mask-1' && c.toNode === 'merge-1')),
      { fromNode: 'mask-1', fromPort: 'out', toNode: 'mask-2', toPort: 'in' },
      { fromNode: 'mask-2', fromPort: 'out', toNode: 'merge-1', toPort: 'b' },
    ],
  }
}

export type KeyerParams = {
  keyColor: string
  similarity: number
  blend: number
  spill: number
}

export function readKeyerParams(node: HvsEffectNode | undefined): KeyerParams {
  const p = node?.parameters ?? {}
  const num = (key: string, fallback: number) => {
    const v = p[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  return {
    keyColor: typeof p.keyColor === 'string' ? p.keyColor : '0x00FF00',
    similarity: Math.max(0.01, Math.min(1, num('similarity', 0.3))),
    blend: Math.max(0, Math.min(1, num('blend', 0.2))),
    spill: Math.max(0, Math.min(1, num('spill', 0.1))),
  }
}

export function firstChromaKeyGraph(projectId: string, assetId: string, keyColor = '0x00FF00'): HvsEffectGraph {
  const media: HvsEffectNode = { id: 'media-in', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: { assetId }, enabled: true }
  const keyer: HvsEffectNode = {
    id: 'keyer-1',
    kind: 'Keyer',
    ...defaultPorts('Keyer'),
    parameters: { keyColor, similarity: 0.4, blend: 0.15, spill: 0.12 },
    enabled: true,
  }
  const out: HvsEffectNode = { id: 'media-out', kind: 'MediaOut', ...defaultPorts('MediaOut'), parameters: {}, enabled: true }
  return {
    id: `fxg-keyer-${projectId}`,
    projectId,
    versionLabel: 'Wave 9 Chroma Key',
    nodes: [media, keyer, out],
    connections: [
      { fromNode: 'media-in', fromPort: 'out', toNode: 'keyer-1', toPort: 'in' },
      { fromNode: 'keyer-1', fromPort: 'out', toNode: 'media-out', toPort: 'in' },
    ],
  }
}

export function firstBlendGraph(projectId: string, backgroundAssetId: string, foregroundAssetId: string, blendMode: Wave9BlendMode = 'multiply'): HvsEffectGraph {
  const base = firstMergeGraph(projectId, backgroundAssetId, foregroundAssetId, { nx: 0, ny: 0, scaleX: 1, scaleY: 1, x: 0, y: 0, opacity: 1 })
  return {
    ...base,
    id: `fxg-blend-${projectId}`,
    versionLabel: `Wave 9 Blend ${blendMode}`,
    nodes: base.nodes.map(n => n.kind === 'Merge' ? { ...n, parameters: { ...n.parameters, blendMode } } : n),
  }
}

export function firstMaskCombineGraph(
  projectId: string,
  assetId: string,
  op: Wave9MaskCombine = 'intersect',
): HvsEffectGraph {
  const media: HvsEffectNode = { id: 'media-in', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: { assetId }, enabled: true }
  const maskA: HvsEffectNode = {
    id: 'mask-a',
    kind: 'Mask',
    ...defaultPorts('Mask'),
    enabled: true,
    parameters: { type: 'rectangle', x: 0, y: 0, width: 0.6, height: 1, feather: 0 },
  }
  const maskB: HvsEffectNode = {
    id: 'mask-b',
    kind: 'Mask',
    ...defaultPorts('Mask'),
    enabled: true,
    parameters: { type: 'rectangle', x: 0.4, y: 0, width: 0.6, height: 1, feather: 0, combine: op },
  }
  const out: HvsEffectNode = { id: 'media-out', kind: 'MediaOut', ...defaultPorts('MediaOut'), parameters: {}, enabled: true }
  return {
    id: `fxg-maskcombine-${projectId}`,
    projectId,
    versionLabel: `Wave 9 Mask ${op}`,
    nodes: [media, maskA, maskB, out],
    connections: [
      { fromNode: 'media-in', fromPort: 'out', toNode: 'mask-a', toPort: 'in' },
      { fromNode: 'mask-a', fromPort: 'out', toNode: 'mask-b', toPort: 'in' },
      { fromNode: 'mask-b', fromPort: 'out', toNode: 'media-out', toPort: 'in' },
    ],
  }
}

export function firstKeyframeTransformGraph(projectId: string, backgroundAssetId: string, foregroundAssetId: string): HvsEffectGraph {
  const base = firstMergeGraph(projectId, backgroundAssetId, foregroundAssetId, { nx: 0, ny: 0.2, scaleX: 0.4, scaleY: 0.4, x: 20, y: 40, opacity: 1 })
  return {
    ...base,
    id: `fxg-xf-kf-${projectId}`,
    versionLabel: 'Wave 9 Transform Keyframes',
    nodes: base.nodes.map(n => n.kind === 'Transform'
      ? {
          ...n,
          parameters: {
            ...n.parameters,
            keyframes: [
              { t: 0, x: 10, y: 20, scaleX: 0.4, scaleY: 0.4, rotationDeg: 0, opacity: 1 },
              { t: 1, x: 80, y: 40, scaleX: 0.55, scaleY: 0.55, rotationDeg: 12, opacity: 0.85 },
            ],
          },
        }
      : n),
  }
}

export function firstTextGraph(projectId: string, assetId: string, text = 'HVS'): HvsEffectGraph {
  const media: HvsEffectNode = { id: 'media-in', kind: 'MediaIn', ...defaultPorts('MediaIn'), parameters: { assetId }, enabled: true }
  const title: HvsEffectNode = {
    id: 'text-1',
    kind: 'Text',
    ...defaultPorts('Text'),
    parameters: { text, fontSize: 42, x: 24, y: 48, fontcolor: 'white' },
    enabled: true,
  }
  const merge: HvsEffectNode = { id: 'merge-1', kind: 'Merge', ...defaultPorts('Merge'), parameters: {}, enabled: true }
  const out: HvsEffectNode = { id: 'media-out', kind: 'MediaOut', ...defaultPorts('MediaOut'), parameters: {}, enabled: true }
  return {
    id: `fxg-text-${projectId}`,
    projectId,
    versionLabel: 'Wave 4 Text',
    nodes: [media, title, merge, out],
    connections: [
      { fromNode: 'media-in', fromPort: 'out', toNode: 'merge-1', toPort: 'a' },
      { fromNode: 'text-1', fromPort: 'out', toNode: 'merge-1', toPort: 'b' },
      { fromNode: 'merge-1', fromPort: 'out', toNode: 'media-out', toPort: 'in' },
    ],
  }
}

export function identityEffectGraphsOr(graphs: HvsEffectGraph[] | null | undefined, _projectId: string): HvsEffectGraph[] {
  if (!Array.isArray(graphs)) return []
  return graphs
}
