import fs from 'node:fs'
import { HISTORICAL_WR_TOKENIZER_0_SHA256, WRIM0_ARCHITECTURE_CONFIG_HASH, WRIM0_CONTEXT_LENGTH, WRIM0_D_FF, WRIM0_D_MODEL, WRIM0_HEAD_DIM, WRIM0_N_HEADS, WRIM0_N_LAYERS, WRIM0_ROPE_THETA, WRIM0_VOCAB_SIZE } from './identity'
import { dumpWrim0FinalSidecar, dumpWrim0Lineage } from './paths'

export type Wrim0Architecture = {
  family: string
  design: string
  embeddingDimension: number
  layerCount: number
  attentionStructure: string
  headCount: number
  kvHeadArrangement: string
  ffnDesign: string
  activation: string
  normalization: string
  positionalEncoding: string
  contextWindow: number
  vocabSize: number
  parameterCount: number
  weightTying: string
  dropout: number
  initStrategy: string
  bias: boolean
  architectureConfigHash: string
  tokenizerJsonSha256: string
  corpusJsonlSha256: string
  noPretrainedWeightsLoaded: boolean
  source: string[]
}

export function recoverWrim0Architecture(dumpRoot?: string | null): Wrim0Architecture {
  const sidecar = JSON.parse(fs.readFileSync(dumpWrim0FinalSidecar(dumpRoot), 'utf8')) as {
    architectureConfig?: Record<string, number>
    architectureConfigHash?: string
    parameterCount?: number
  }
  const lineage = JSON.parse(fs.readFileSync(dumpWrim0Lineage(dumpRoot), 'utf8')) as {
    lineage?: {
      initializationAlgorithm?: string
      noPretrainedWeightsLoaded?: boolean
      tokenizerJsonSha256?: string
      corpusJsonlSha256?: string
    }
    architectureConfigHash?: string
  }
  const cfg = sidecar.architectureConfig ?? {}
  return {
    family: 'WRIM-G-20M-v1-option-A',
    design: 'decoder-only transformer (pre-RMSNorm, causal MHA, SwiGLU, tied embeddings)',
    embeddingDimension: Number(cfg.d_model ?? WRIM0_D_MODEL),
    layerCount: Number(cfg.n_layers ?? WRIM0_N_LAYERS),
    attentionStructure: 'multi-head self-attention; q/k/v/o Linear bias=false; scaled_dot_product_attention',
    headCount: Number(cfg.n_heads ?? WRIM0_N_HEADS),
    kvHeadArrangement: `MHA ${cfg.n_heads ?? WRIM0_N_HEADS} heads × head_dim ${cfg.head_dim ?? WRIM0_HEAD_DIM}; no GQA/MQA`,
    ffnDesign: `SwiGLU gate/up/down; d_ff=${cfg.d_ff ?? WRIM0_D_FF}`,
    activation: 'SiLU (SwiGLU gate)',
    normalization: 'pre-RMSNorm (attn_norm, ffn_norm) + final RMSNorm (norm_f); eps=1e-5',
    positionalEncoding: `RoPE traditional=false theta=${cfg.rope_theta ?? WRIM0_ROPE_THETA}`,
    contextWindow: Number(cfg.context_length ?? WRIM0_CONTEXT_LENGTH),
    vocabSize: Number(cfg.vocab_size ?? WRIM0_VOCAB_SIZE),
    parameterCount: Number(sidecar.parameterCount ?? 0),
    weightTying: 'tied: logits = hidden @ tok_emb.weight.T; no lm_head tensor',
    dropout: 0,
    initStrategy: String(lineage.lineage?.initializationAlgorithm ?? 'unknown'),
    bias: false,
    architectureConfigHash: String(sidecar.architectureConfigHash ?? lineage.architectureConfigHash ?? WRIM0_ARCHITECTURE_CONFIG_HASH),
    tokenizerJsonSha256: String(lineage.lineage?.tokenizerJsonSha256 ?? ''),
    corpusJsonlSha256: String(lineage.lineage?.corpusJsonlSha256 ?? ''),
    noPretrainedWeightsLoaded: lineage.lineage?.noPretrainedWeightsLoaded === true,
    source: [
      'scripts/sovereign-model-lab/wrim0_architecture.py',
      'dump model-lab/manifests/wrim0_checkpoints/checkpoint-final.json',
      'dump model-lab/manifests/wrim0_checkpoints/lineage-manifest.json',
    ],
  }
}

export function tokenizerBindingOk(arch: Wrim0Architecture): boolean {
  return (
    arch.vocabSize === WRIM0_VOCAB_SIZE &&
    arch.tokenizerJsonSha256 === HISTORICAL_WR_TOKENIZER_0_SHA256 &&
    arch.architectureConfigHash === WRIM0_ARCHITECTURE_CONFIG_HASH
  )
}
