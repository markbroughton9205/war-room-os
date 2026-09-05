/**
 * WR-Engineer identity loader.
 *
 * Loads IDENTITY.md, SOUL.md, and USER.md as three independently addressable layers — they are
 * read from disk each call (no in-memory merge into a single blob) so a caller can always ask for
 * exactly one layer, or the full ordered stack, without the layers ever being collapsed into one
 * file. See each file's own header for what it owns:
 *   IDENTITY.md = WHO WR-Engineer is
 *   SOUL.md     = HOW WR-Engineer behaves
 *   USER.md     = WHO Commander is and WHO "we" are
 *
 * Load order (see mission brief): IDENTITY -> SOUL -> USER -> mission -> repo/runtime context ->
 * engineering memory. This module owns only the first three; mission/repo/memory context is
 * assembled by lib/wr-engineer/runtime.ts, which calls loadIdentityStack() first and appends to it.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type IdentityLayerName = 'IDENTITY' | 'SOUL' | 'USER'

/** Canonical order — every consumer of the stack must preserve this order, never re-sort or
 * merge it. Exported so callers/evals can assert against it instead of re-deriving it. */
export const IDENTITY_LAYER_ORDER: readonly IdentityLayerName[] = ['IDENTITY', 'SOUL', 'USER']

export type IdentityLayer = {
  name: IdentityLayerName
  /** Absolute path this layer was read from — kept for auditability (OBSERVED, not inferred). */
  path: string
  content: string
}

export type IdentityStack = {
  /** Same three layers, always in IDENTITY_LAYER_ORDER — never reordered, never combined. */
  layers: readonly [IdentityLayer, IdentityLayer, IdentityLayer]
  loadedAt: string
}

const IDENTITY_DIR = import.meta.dirname

const FILE_BY_LAYER: Record<IdentityLayerName, string> = {
  IDENTITY: 'IDENTITY.md',
  SOUL: 'SOUL.md',
  USER: 'USER.md',
}

async function loadLayer(name: IdentityLayerName): Promise<IdentityLayer> {
  const filePath = path.join(IDENTITY_DIR, FILE_BY_LAYER[name])
  const content = await readFile(filePath, 'utf8')
  return { name, path: filePath, content }
}

/** Loads all three layers in the mandated order. Each layer is read independently — this function
 * never concatenates them into a single string; that is left to a caller that explicitly wants a
 * prompt-assembly view (see stackToOrderedText below), so the separation is visible at every step. */
export async function loadIdentityStack(): Promise<IdentityStack> {
  const [identity, soul, user] = await Promise.all([
    loadLayer('IDENTITY'),
    loadLayer('SOUL'),
    loadLayer('USER'),
  ])
  return {
    layers: [identity, soul, user],
    loadedAt: new Date().toISOString(),
  }
}

/** Loads exactly one named layer, independent of the others — proves the layers are individually
 * addressable, not just individually stored. */
export async function loadIdentityLayer(name: IdentityLayerName): Promise<IdentityLayer> {
  return loadLayer(name)
}

/** Ordered, clearly-delimited text view for a prompt assembler further down the runtime stack.
 * The delimiters are deliberate: a downstream consumer must never be able to mistake where one
 * layer ends and the next begins, even after this is flattened to a single string. */
export function stackToOrderedText(stack: IdentityStack): string {
  return stack.layers
    .map(layer => `<<< ${layer.name} >>>\n${layer.content}\n<<< END ${layer.name} >>>`)
    .join('\n\n')
}
