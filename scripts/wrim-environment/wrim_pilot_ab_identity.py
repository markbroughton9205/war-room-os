"""WRIM1-PILOT-AB-10M identity. Does not train by import."""
from __future__ import annotations

from pathlib import Path

from wrim_cpt_identity import AUTHORIZE_ENV, LINUX_DATA_ROOT, LINUX_VENV_PYTHON
from wrim_hvu_identity import CKPT_BASE

PROGRAM_ID = "WRIM1-PILOT-AB-10M"
AUTHORIZE_FLAG = "--authorize-wrim1-pilot-ab-10m"
AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_PILOT_AB_10M_ONLY"
SEED = 20260924
EVAL_SEED = 42

CANONICAL = "STEP_400"
CANONICAL_HASH = "f82f4364b16842ca3d43427251299f1ad38d5104f24013251f2ebc6af6607af8"

DATA_ROOT = Path(LINUX_DATA_ROOT)
CKPT_ROOT = Path(CKPT_BASE) / PROGRAM_ID
CORPUS_DIR = DATA_ROOT / "WRIM1-PILOT-CORPUS-v1"
TOKENIZER_DIR = DATA_ROOT / "WRIM1-PILOT-TOKENIZER-v1"
PROBE_DIR = DATA_ROOT / "WRIM1-PILOT-PROBES-v1"
REPORT_PATH = DATA_ROOT / "WRIM1_PILOT_AB_10M_REPORT.json"

SEQ_LEN = 512
TOKENS_PER_STEP = 4096
MICRO_BATCH = 8
MAX_PHYSICAL_TOKENS = 10_000_000
STEPS = MAX_PHYSICAL_TOKENS // TOKENS_PER_STEP  # 2441; 2442 would exceed
PHYSICAL_TOKENS = STEPS * TOKENS_PER_STEP  # 9_998_336
UNIQUE_TARGET = 10_000_000
WARMUP_FRAC = 0.02
MIN_LR_FRAC = 0.10
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
GRAD_HARD = 8.0
ROPE_THETA = 10000.0

SPECIAL_TOKENS = (
    "<|pad|>",
    "<|bos|>",
    "<|eos|>",
    "<|unk|>",
    "<|system|>",
    "<|commander|>",
    "<|assistant|>",
    "<|tool|>",
    "<|evidence|>",
)

VOCAB_CANDIDATES = (16384, 24576, 32768)
LR_A = (1e-3, 1.5e-3, 3e-3)
LR_B = (5e-4, 1e-3, 1.5e-3)
PREFLIGHT_STEPS = 6
MICRO_EVAL_EVERY = 200
FULL_EVAL_FRACS = (0.0, 0.25, 0.50, 0.75, 1.0)

ARCH_A = {
    "name": "WRIM1-A-23M-PILOT",
    "d_model": 256,
    "n_layers": 18,
    "n_heads": 4,
    "head_dim": 64,
    "d_ff": 768,
    "untied": True,
}
ARCH_B = {
    "name": "WRIM1-B-50M-PILOT",
    "d_model": 384,
    "n_layers": 20,
    "n_heads": 6,
    "head_dim": 64,
    "d_ff": 1152,
    "untied": True,
}

TARGET_MIX = {
    "prose": 0.52,
    "technical": 0.16,
    "code": 0.16,
    "json": 0.08,
    "instruction": 0.05,
    "genesis": 0.03,
}

LOCKED_NAME_NEEDLES = (
    "WRIM-FOUNDATION-EVAL",
    "WRIM-FOUNDATION-GRADUATION",
    "WR-VAL-NL",
    "STAGE3",
    "extra-unseen",
    "family_holdout",
    "template_holdout",
    "MODE-ENTRY",
    "CAPABILITY",
)

PYTHON = LINUX_VENV_PYTHON
AUTHORIZE_ENV_NAME = AUTHORIZE_ENV

# Frozen WRIM1-PILOT-AB-10M artifacts. Do not rebuild on re-run.
FROZEN_CORPUS_HASH = "9531474fd7484f70e65c4bcb578e210458ca2b3cac1b272b483f661939014f1a"
FROZEN_TOKENIZER_HASH = "4fd0e8e1b8120fc027faae3d678d0257e872683577594671670587b4f55c9b52"
FROZEN_TRAIN_WINDOWS_SHA256 = "0790f3d2b26118f7b6092039cdb1bb8c9a3867f8ee63d50d186dce7e188d1146"
FROZEN_VAL_WINDOWS_SHA256 = "210677fda35b58bfec283c4b16154670e787867e8ae6a07fe8e086d8fd98bbac"
