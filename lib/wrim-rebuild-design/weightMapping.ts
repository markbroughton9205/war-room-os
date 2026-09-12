import {
  D_FF,
  D_MODEL,
  HEAD_DIM,
  LM_HEAD_INDEPENDENT,
  N_HEADS,
  N_LAYERS,
  TIED_EMBEDDINGS,
  VOCAB_SIZE,
} from './identity'

export type WeightMapEntry = {
  mlxKey: string
  torchKey: string
  shape: number[]
  load: boolean
  notes: string
}

const INNER = N_HEADS * HEAD_DIM

export function plannedWeightMap(): WeightMapEntry[] {
  const entries: WeightMapEntry[] = [
    {
      mlxKey: 'model.tok_emb.weight',
      torchKey: 'tok_emb.weight',
      shape: [VOCAB_SIZE, D_MODEL],
      load: true,
      notes: 'Token embedding. Tied to logits via hidden @ tok_emb.weight.T. No independent lm_head.',
    },
    {
      mlxKey: 'model.norm_f.weight',
      torchKey: 'norm_f.weight',
      shape: [D_MODEL],
      load: true,
      notes: 'Final RMSNorm scale. eps=1e-5.',
    },
  ]
  for (let i = 0; i < N_LAYERS; i++) {
    entries.push(
      {
        mlxKey: `model.layers.${i}.attn_norm.weight`,
        torchKey: `layers.${i}.attn_norm.weight`,
        shape: [D_MODEL],
        load: true,
        notes: 'pre-RMSNorm before attention',
      },
      {
        mlxKey: `model.layers.${i}.ffn_norm.weight`,
        torchKey: `layers.${i}.ffn_norm.weight`,
        shape: [D_MODEL],
        load: true,
        notes: 'pre-RMSNorm before SwiGLU',
      },
      {
        mlxKey: `model.layers.${i}.attn.q.weight`,
        torchKey: `layers.${i}.attn.q.weight`,
        shape: [INNER, D_MODEL],
        load: true,
        notes: 'Linear out×in; MLX and PyTorch share this layout. bias=false.',
      },
      {
        mlxKey: `model.layers.${i}.attn.k.weight`,
        torchKey: `layers.${i}.attn.k.weight`,
        shape: [INNER, D_MODEL],
        load: true,
        notes: 'MHA K. No GQA.',
      },
      {
        mlxKey: `model.layers.${i}.attn.v.weight`,
        torchKey: `layers.${i}.attn.v.weight`,
        shape: [INNER, D_MODEL],
        load: true,
        notes: 'MHA V. No GQA.',
      },
      {
        mlxKey: `model.layers.${i}.attn.o.weight`,
        torchKey: `layers.${i}.attn.o.weight`,
        shape: [D_MODEL, INNER],
        load: true,
        notes: 'Attention output projection.',
      },
      {
        mlxKey: `model.layers.${i}.ffn.gate.weight`,
        torchKey: `layers.${i}.ffn.gate.weight`,
        shape: [D_FF, D_MODEL],
        load: true,
        notes: 'SwiGLU gate (SiLU).',
      },
      {
        mlxKey: `model.layers.${i}.ffn.up.weight`,
        torchKey: `layers.${i}.ffn.up.weight`,
        shape: [D_FF, D_MODEL],
        load: true,
        notes: 'SwiGLU up.',
      },
      {
        mlxKey: `model.layers.${i}.ffn.down.weight`,
        torchKey: `layers.${i}.ffn.down.weight`,
        shape: [D_MODEL, D_FF],
        load: true,
        notes: 'SwiGLU down.',
      },
    )
  }
  return entries
}

export function optimizerKeysPolicy() {
  return {
    mlxPattern: 'opt.*',
    action: 'IGNORE',
    resume: false,
    reason:
      'MLX AdamW moments are framework-specific. Historical WRIM-0 file contains 330 opt.* tensors. New Nebula run uses a fresh PyTorch AdamW. Do not convert or resume optimizer state.',
  }
}

export function lmHeadPolicy() {
  return {
    independentLmHead: LM_HEAD_INDEPENDENT,
    tiedEmbeddings: TIED_EMBEDDINGS,
    logits: 'F.linear(hidden, tok_emb.weight)  # hidden @ tok_emb.weight.T',
    createParameter: false,
    notes: 'Do not allocate lm_head.weight. A view/reference to tok_emb.weight is allowed; a second Parameter is not.',
  }
}

export function expectedModelTensorCount(): number {
  return plannedWeightMap().length
}

export function verifyInspectedShapes(
  tensors: Array<{ name: string; shape: number[] }>,
): { ok: boolean; mismatches: string[] } {
  const byName = new Map(tensors.map(t => [t.name, t.shape]))
  const mismatches: string[] = []
  for (const entry of plannedWeightMap()) {
    const actual = byName.get(entry.mlxKey)
    if (!actual) {
      mismatches.push(`missing ${entry.mlxKey}`)
      continue
    }
    if (actual.join(',') !== entry.shape.join(',')) {
      mismatches.push(`${entry.mlxKey} expected [${entry.shape.join(',')}] got [${actual.join(',')}]`)
    }
  }
  if (byName.has('model.lm_head.weight') || byName.has('lm_head.weight')) {
    mismatches.push('unexpected lm_head present')
  }
  return { ok: mismatches.length === 0, mismatches }
}
