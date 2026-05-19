import 'server-only'

import { collectRuntimeGraph } from '@/lib/runtime-graph/collect'
import { buildPriorityEngineSnapshot } from './engine'
import type { PriorityEngineSnapshot } from './types'

export async function collectPriorityEngine(req: Request): Promise<PriorityEngineSnapshot> {
  const graph = await collectRuntimeGraph(req)
  return buildPriorityEngineSnapshot(graph)
}
