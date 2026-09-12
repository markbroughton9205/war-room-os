/**
 * Planned PyTorch/CUDA port. Design only — this module does not import torch
 * and does not convert weights.
 */
export const PYTORCH_PORT = {
  goal: 'Numerically equivalent enough WRIM-G-20M-v1-option-A decoder to load WRIM-0 model.* F32 tensors and match the isolated numpy/Mac smoke baseline.',
  sourceOfTruth: [
    'scripts/sovereign-model-lab/wrim0_architecture.py (MLX historical)',
    'scripts/wrim-reconciliation/isolated_numpy_infer.py (Nebula numpy smoke)',
  ],
  modules: {
    RMSNorm: 'weight * x / sqrt(mean(x^2)+1e-5); no bias; no mean subtraction',
    SwiGLU: 'down(silu(gate(x)) * up(x)); three Linear bias=false',
    Attention: 'q/k/v/o Linear bias=false; reshape B,S,H,D; RoPE on q,k; SDPA causal',
    RoPE: 'MLX traditional=False: split last dim in half; rotate-half with theta=10000',
    Block: 'x = x + attn(attn_norm(x)); x = x + ffn(ffn_norm(x))',
    WRIM0Model: 'tok_emb; ModuleList of 18 Blocks; norm_f; logits = hidden @ tok_emb.weight.T',
  },
  causalMask: 'PyTorch scaled_dot_product_attention is_causal=True (or equivalent additive -inf triu mask)',
  dropout: 0,
  bias: false,
  dtypeLoad: 'Load F32 tensors as float32. Cast later only after precision measurement.',
  conversionThisPass: false,
  installThisPass: false,
}

export const PLANNED_STACK = {
  python: {
    existing: 'C:\\Users\\markb\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
    versionExisting: '3.13.15',
    compatibility: 'PyTorch Windows currently documents Python 3.10–3.14. 3.13.15 is in range.',
    venv: '%LOCALAPPDATA%\\War Room OS\\venvs\\wrim-pytorch\\',
    useSystemSite: false,
  },
  pytorch: {
    package: 'torch',
    indexPrimary: 'https://download.pytorch.org/whl/cu130',
    indexFallback: 'https://download.pytorch.org/whl/cu128',
    why: 'RTX 5060 Ti is Blackwell (sm_120). Wheels older than CUDA 12.8 do not include sm_120. Driver CUDA UMD is 13.4, so a cu130 bundled runtime is the first planned match. cu128 is the documented Blackwell fallback. Exact torch version is chosen at environment-setup time from the live index — not pinned as a measured fact here.',
    extrasForbidden: ['torchvision', 'torchaudio'],
  },
  cuda: {
    toolkitInstall: false,
    nvccRequired: false,
    bundledRuntime: 'Use the CUDA runtime shipped inside the PyTorch wheel. Do not install a full CUDA toolkit unless a later measured failure proves the bundled runtime is insufficient.',
    driverPresent: 'NVIDIA-SMI 616.64 / CUDA UMD 13.4 (measured in reconciliation).',
    arch: 'sm_120 expected; confirm torch.cuda.get_arch_list() after install.',
  },
  safetensors: {
    package: 'safetensors',
    required: true,
    reason: 'Read WRIM-0 model.* tensors without pickle.',
  },
  tokenizerLibrary: {
    package: 'tokenizers',
    requiredFromStage: 1,
    reason: 'HuggingFace Rust tokenizers can load frozen tokenizer.json read-only for packing. Vocab/merges/special IDs must not be trained or rewritten. Node WR-TOKENIZER-0 encoder remains canonical for eval probes.',
    forbidden: 'Do not train WR-TOKENIZER-1. Do not modify tokenizer.json.',
  },
  numpy: {
    alreadyPresentOnSystemPython: '2.5.2',
    inVenv: 'Install only if the venv does not inherit it; torch typically depends on numpy.',
  },
  accelerate: {
    install: false,
    reason: 'Single 19.2M-parameter GPU. No multi-device needed.',
  },
  transformers: { install: false, reason: 'Unnecessary. Architecture is first-party.' },
  bitsandbytes: { install: false },
  deepspeed: { install: false },
  mlx: { install: false, reason: 'Historical Mac framework. Not the Nebula training stack.' },
}

export const NUMERICAL_EQUIVALENCE = {
  exactFloatEquality: false,
  cpuFp32VsNumpy: {
    argmax: 'exact token id',
    entropyAbsDelta: 1e-4,
    greedy8TokenIds: 'exact match to isolated numpy baseline',
  },
  cudaFp32VsNumpy: {
    argmax: 'exact token id required',
    entropyAbsDelta: 0.02,
    greedy8TokenIds: 'exact preferred; fail Stage 0 if first generated token differs or a special-token loop appears',
  },
  smokeBaseline: {
    prompt: 'The sky is',
    bos: true,
    argmaxId: 126,
    argmaxToken: ' a',
    entropy: 6.033060550689697,
    continuation: ' a\n}_tokenizer_tokenizer_',
  },
}
