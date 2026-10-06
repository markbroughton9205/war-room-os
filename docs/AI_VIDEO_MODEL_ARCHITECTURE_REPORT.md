# AI VIDEO MODEL INTERNAL ARCHITECTURES — MASTER RESEARCH ADDENDUM

**Title:** HVS AI Video Model Architecture Report  
**Date:** 2026-09-22 ~3:16 PM EDT (America/New_York)  
**Commander:** Mark  
**Owner fold:** Personal Assistant 2 (executor subagent)  
**Mode:** RESEARCH ONLY · LIVE WEB · **IMPLEMENTATION NOT AUTHORIZED**  
**Parent ACS:** `/home/box/hvs-ai-creative-suite/HVS_AI_NATIVE_CREATIVE_SUITE_WORLD_RESEARCH_REPORT.md`  
**Waves folded:** `waves/WAVE_1` … `WAVE_8` (W3=278 L · W4=270 L FINAL stamped 15:12 EDT)  
**Rules:** `REASONED_INFERENCE_RULES.md` · `MISSION.md`  
**Hard stop:** No downloads · no training · no installs · no WRIM changes · no commit/push/deploy · no paid APIs · no HVS code modify  

**Claim classes:** VERIFIED | STRONGLY_INFERRED | PLAUSIBLE | UNKNOWN | PROPOSED (HVS design)  
**Proprietary rule:** Never present STRONGLY_INFERRED as fact. Text encoders: exact name only if public; else `TEXT_ENCODER_UNDISCLOSED`. Nebula HW: **UNKNOWN** — do not invent.

**STATUS:** **PARTIAL**  
**RECOMMENDATION:** **C HYBRID**  
**First slice (HOLD):** `HVS-ACS-01_PROMPT_PLAN_ROUTER_KERNEL`  
**Optional follow-on (HOLD):** `HVS-VIDARCH-01_REQUEST_CAPABILITY_COMPILER_CONTRACTS`  
**Sora:** **DO-NOT-DEPEND** (API sunset 2026-09-24 — VERIFIED ACS)  
**WRIM:** untouched  

---

## EXECUTIVE SUMMARY

**Architecture recommendation: C HYBRID** — provider APIs as primary cinema pixels (Veo / Kling / Seedance / Runway / Luma), HVS-owned Prompt Compiler + CameraSpec/MotionSpec + ContinuityGraph + spend gates as the product kernel, optional local open backbones (Wan2.1 Apache, LTX distilled, CogVideoX-2B Apache, Mochi Apache) for preview/privacy after Nebula inventory. Not A-only (Sora sunset proves fragility), not B-only (Nebula UNKNOWN + quality gap), not D/E as near-term ACS default.

**Ownership ladder peek:** Operate **L1–L3 now** (orchestration → schema/compiler → adapters). Research **L4** LoRA/adapters on Wan/LTX/Hunyuan. Park **L5–L8** (own AE → own DiT/flow → own curriculum → sovereign foundation) as multi-year optionality informed by Seedance/Veo/Kling papers — no mystery box.

**Key pins:**
1. **2025 open production stack** = causal 3D VAE (~4×8×8×C16) + **Flow Matching / Rectified Flow DiT** + strong text (T5/umT5/MLLM) + PE rewrite + distillation. UNet video is legacy. **VERIFIED** across Wan, Hunyuan, Open-Sora 1.2+, Seedance paper, LTX.
2. Do **not** call all video models “diffusion” — CogVideoX/Mochi/SVD = diffusion; Hunyuan/Wan/Movie Gen/LTX/Open-Sora 1.2 = **flow matching / rectified flow**. **VERIFIED**.
3. **Full 3D spatiotemporal attention** beats factorized 2D+1D for large motion (CogVideoX, Hunyuan). **VERIFIED**.
4. **Prompt Compiler** is the highest-leverage HVS-native artifact (L1–L2): expand without changing Commander intent; provider profiles; identity-lock tokens; camera/lighting/motion slots.
5. **Keep AudioGraph separate** from video SoT; optionally ingest joint A/V plates (Veo-class). **PROPOSED**.
6. **Cinema long-form = stitch short gens** + ContinuityGraph QC — not native multi-minute single-pass. **PROPOSED**.
7. **Physics:** label `PRIOR_PHYSICS` (learned) vs `SIM_PHYSICS` (EXTERNAL Graphics). Never market gen fluid as simulated. **PROPOSED**.
8. **Sora DO-NOT-DEPEND**; WRIM boundary untouched; Nebula feasibility UNKNOWN (cite published VRAM class ranges only).

**Final posture:** Recommend **C HYBRID** · STATUS **PARTIAL** · IMPLEMENTATION **NOT AUTHORIZED** · first slice HOLD · no mystery box.

---

## §1 — Video latent representation

### 1.1 Compressor taxonomy (VERIFIED)

| Family | Compresses | Causal? | Typical use |
|--------|------------|---------|-------------|
| 2D image VAE (SD/SDXL) | H,W | N/A | Early video / SVD |
| Temporal/Video 3D VAE | T,H,W | often causal | CogVideoX, Hunyuan, Wan, LTX, Movie Gen |
| Hierarchical 2D→3D | spatial then temporal | 3D often causal | Open-Sora 1.2 |
| VQ / MAGVIT-style | discrete codes | MagViT-v2 causal option | tokenizer research |
| DC-AE | extreme spatial f32–f128 | image-first | token reducer for DiT |
| Causal video VAE | no future→past leak | yes | I2V first-frame, joint I+V |

**Causal benefit (VERIFIED):** clean T=1 image encode; I2V without future bleed; streaming/tiling. Cost: slight recon asymmetry vs non-causal.

### 1.2 Per-system specs

| System | Compressor | Spatial | Temporal | C | Label | Source |
|--------|------------|---------|----------|---|-------|--------|
| CogVideoX | 3D causal VAE | 8×8 | 4× | 16 | VERIFIED | arXiv:2408.06072 |
| Open-Sora 1.2 | Hierarchical 2D+3D | 8×8 | 4× | 4 (3D) | VERIFIED | arXiv:2412.20404 |
| HunyuanVideo | CausalConv3D | 8×8 | 4× | 16 | VERIFIED | arXiv:2412.03603 |
| Wan 2.1 | Wan-VAE 3D causal | 8×8 | 4× | 16 | VERIFIED | arXiv:2503.20314 |
| Mochi 1 | AsymmVAE causal | 8×8 | 6× | 12 | VERIFIED | HF genmo/mochi-1-preview |
| LTX-Video | Causal Video-VAE (patch in VAE) | 32×32 | 8× | 128 | VERIFIED | arXiv:2501.00103 |
| Movie Gen | TAE | 8×8 | 8× | 16 | VERIFIED (paper; weights closed) | arXiv:2410.13720 |
| SVD | SD2.1 VAE spatial only | 8×8 | 1× | 4 | VERIFIED | arXiv:2311.15127 |
| Sora | video compression network | UNDISCLOSED | UNDISCLOSED | UNDISCLOSED | VERIFIED existence; ratios UNKNOWN | openai.com world-simulators |
| Seedance 1.0 | Causal VAE | 16×16 | 4× | 48 | VERIFIED paper | arXiv:2506.09113 |

**PROPOSED (HVS sovereign):** prefer causal 3D VAE **~4×8×8×16ch** before LTX-extreme unless realtime forces 1:192 + denoising decoder.

### 1.3 Proprietary compressors (reasoned)

| Product | Claim | Class |
|---------|-------|-------|
| Sora | Spatiotemporal compression exists | VERIFIED existence; ratios UNKNOWN |
| Runway Gen-3/4 | Latent video foundation | STRONGLY_INFERRED latent DiT/diffusion family (joint I+V, dense captions, peer SOTA) — **not** official VAE table |
| Kling / Luma / Pika | High-quality T2V/I2V | PLAUSIBLE latent video transformer + compressed AE |
| Veo 3 | Separate video + audio AEs | VERIFIED (Veo-3 Tech Report) |

---

## §2 — Spatiotemporal patching

| Patch style | Who | Memory | Notes | Label |
|-------------|-----|--------|-------|-------|
| Spatial 2×2 on latent | CogVideoX | tokens ∝ HW/p² | Common DiT | VERIFIED |
| Spacetime 3D patch kt×kh×kw | Hunyuan, Movie Gen, Wan (1,2,2) | Strong reduction | Match VAE grid | VERIFIED |
| Latent-as-token (LTX) | LTX | Extreme | Patch inside VAE; DiT 1×1×1 | VERIFIED |
| Factorized ST | Open-Sora STDiT, Latte | Cheaper | Weaker joint motion than full 3D | VERIFIED |
| Sora spacetime patches | Sora | Variable grid = variable res/duration | Exact size UNKNOWN | VERIFIED high-level |

**Rule (VERIFIED):** Attention ~O(N²). Halving spatial patch side → ~4× tokens → ~16× attn FLOPs (pre-FA).

---

## §3 — Diffusion Transformers (DiT) for video

### 3.1 Why DiT over U-Net (VERIFIED consensus)
Scaling laws, unified I+V tokens (T=1), long-range motion via full ST attn, LLM ecosystem reuse. U-Net remains for SVD I2V, AnimateDiff, ControlNet stacks. Foundation T2V SOTA open 2024–2025 = **DiT + latent VAE**.

### 3.2 Attention patterns

| Pattern | Users | Pros | Cons |
|---------|-------|------|------|
| Full 3D ST self-attn | CogVideoX, Hunyuan, Wan, LTX, Movie Gen, Plan 1.2 | Best joint motion | Quadratic |
| Factorized ST | Open-Sora STDiT | Efficient open train | Weaker large motion |
| Cross-attn text | Wan, LTX, Open-Sora, Movie Gen | Modular | Weaker fusion vs MM-DiT |
| Dual→single / MM-DiT | Hunyuan, Mochi Asymm, Seedance spatial MMDiT | Strong text–vision | Heavy |
| Expert AdaLN | CogVideoX | Heterogeneous scale align | Design complexity |

### 3.3 Scale anchors (VERIFIED)
Hunyuan 13B flow · Movie Gen 30B FM · Wan 14B+1.3B · Mochi 10B · LTX <2B realtime-class · CogVideoX 2B/5B diffusion.

### 3.4 Proprietary DiT status
| System | Class |
|--------|-------|
| Sora | VERIFIED “diffusion transformer”; layer counts UNKNOWN |
| Veo 3 | VERIFIED transformer denoiser on joint A/V latents; MMDiT vs cross-attn UNKNOWN |
| Kling-Omni | VERIFIED diffusion transformer + VLM shared embedding (arXiv:2512.16776) |
| Seedance 1.0 | VERIFIED decoupled spatial/temporal DiT + MMDiT spatial |
| Runway Gen-3/4 | STRONGLY_INFERRED latent video diffusion (UNet- **or** DiT) — **not VERIFIED as DiT** |
| Luma Ray2 / Pika | PLAUSIBLE latent DiT/flow or hybrid; family not officially named |

---

## §4 — Denoising process (CRITICAL)

| System | Objective | Label |
|--------|-----------|-------|
| Sora | Diffusion (predict clean patches) | VERIFIED diffusion; details UNKNOWN |
| CogVideoX | Diffusion (v-pred / DDIM·DPM) | VERIFIED **diffusion** |
| Open-Sora 1.2 | Rectified flow / flow matching | VERIFIED **flow** |
| HunyuanVideo | Flow Matching | VERIFIED **FM** |
| Wan 2.1 | Flow Matching / Rectified Flow | VERIFIED **FM/RF** |
| Mochi 1 | Diffusion AsymmDiT | VERIFIED **diffusion** |
| LTX-Video | Rectified Flow | VERIFIED **RF** |
| Movie Gen | Flow Matching | VERIFIED **FM** |
| SVD | Latent diffusion | VERIFIED **diffusion** |
| Seedance 1.0 | Flow matching + TSCD distill | VERIFIED |

**PROPOSED:** Default new open DiT video stacks to FM/RF; keep diffusion schedulers for Cog/Mochi/SVD. Never write “all video models are diffusion.”

---

## §5 — Text conditioning

| Encoder family | Used by (VERIFIED) |
|----------------|-------------------|
| T5 / umT5 / T5-XXL | CogVideoX, Open-Sora, Mochi, LTX, Wan (umT5) |
| CLIP text pooled | Hunyuan CLIP-L; SVD ecosystem |
| MLLM decoder-only + token refiner | HunyuanVideo primary |
| UL2 + ByT5 + Long MetaCLIP | Movie Gen |
| TEXT_ENCODER_UNDISCLOSED | Sora, Runway, Kling, Luma, Pika product posts |

**Injection:** cross-attn (Wan/LTX/OS/Movie Gen) · concat+joint (CogVideoX Expert AdaLN, Mochi MM) · dual→single (Hunyuan) · AdaLN pooled.

**PROPOSED HVS:** Path A ignore encoder (Prompt Compiler); Path B standardize T5/umT5 **or** MLLM+CLIP profiles; Path E prefer documented open licenses.

---

## §6 — Re-captioning / prompt expansion

Two layers (do not conflate): **training re-caption** (dense VLM captions) vs **inference rewrite** (map short user → train distribution).

| System | Train caption | Infer rewrite | Label |
|--------|---------------|---------------|-------|
| Sora | Dense DALL·E-3-style | GPT expand | VERIFIED |
| Hunyuan | JSON VLM + 14 camera types | Hunyuan-Large (+LoRA) | VERIFIED |
| Wan | Dense MLLM dims | Qwen2.5-Plus reported | VERIFIED |
| Movie Gen | LLaMa3-Video ~100w | LLaMa3 70B→8B distill | VERIFIED |
| Open-Sora | PLLaVA + GPT-4V + flow camera | LLM refine | VERIFIED |
| Kling-Omni | — | Prompt Enhancer MLLM | VERIFIED |
| Seedance | — | Qwen2.5-14B SFT+DPO PE | VERIFIED |

**§36 seed — Prompt Compiler (PROPOSED):** slots `intent|enrichment|camera|lighting|motion|negative|duration/fps/aspect`; provider profiles; diff+human accept; no silent cinematic takeover; identity tokens non-paraphrasable.

---

## §7 — Image conditioning (I2V / ref / identity / style / product)

| Mechanism | Documented in | Label |
|-----------|---------------|-------|
| Latent channel concat + mask | Hunyuan, Wan, SVD, Open-Sora | VERIFIED |
| Per-token timesteps (t≈0 cond) | LTX, Open-Sora masking | VERIFIED |
| CLIP/IP decoupled cross-attn | Wan CLIP global; IP-Adapter class | VERIFIED |
| Ref latent / personalization SFT | Hunyuan avatar; Movie Gen personalization | VERIFIED |
| ControlNet / residual | AnimateDiff-ControlNet; VACE | VERIFIED |
| Sora / Runway I2V | Capability VERIFIED; tensor scheme UNKNOWN | |

**Product SKU lock (PROPOSED):** Prompt Compiler non-paraphrase + ref image concat.

---

## §8 — Video conditioning (V2V / motion / pose / depth / flow)

| Family | Examples | Label |
|--------|----------|-------|
| SDEdit-like noise edit | Sora blog | VERIFIED capability |
| Masked latent replace | Open-Sora/LTX/Wan continuation | VERIFIED |
| Instruction editors | Movie Gen Edit; Wan instruction | VERIFIED |
| Control signal videos | Hunyuan pose; ControlNet video | VERIFIED |
| Unified VACE | Wan VCU [Text; Frames; Masks] | VERIFIED |
| Runway Motion Brush / Director | Product VERIFIED; net STRONGLY_INFERRED adapters/masks | |

---

## §9 — Temporal consistency

| Technique | Evidence | Class |
|-----------|----------|-------|
| 3D full ST attention | CogVideoX Fig.5; Hunyuan §4.2; Movie Gen | VERIFIED |
| Factorized ST / temporal modules | Open-Sora STDiT; AnimateDiff; SVD | VERIFIED |
| Causal 3D VAE | Cog/Hunyuan/Wan/LTX/Movie Gen | VERIFIED |
| StreamingT2V memory (CAM+APM) | CVPR 2025 | VERIFIED |
| FIFO-Diffusion | arXiv:2405.11473 | VERIFIED |
| Spacetime patch DiT (Sora-class) | OpenAI report | VERIFIED high-level; attn layout UNKNOWN |

**Why full > 2D+1D (VERIFIED CogVideoX):** large motion cannot attend prior location under separated ST — must hop via background → inconsistency.

**Commercial:** Sora permanence → STRONGLY_INFERRED spacetime DiT foresight; Veo joint A/V VERIFIED; Runway/Luma PLAUSIBLE A full-3D DiT / B STDiT / C cascade.

**Buildability:** YES_WITH_OPEN_BACKBONE adapters; YES_WITH_SIGNIFICANT_TRAINING sovereign 3D DiT.

---

## §10 — Object permanence

| Mode | Mechanism | Class |
|------|-----------|-------|
| Emergent multi-frame denoise | Full-clip latent consistency | VERIFIED Sora behavioral claim; mechanism STRONGLY_INFERRED |
| Emergent 3D attn + 3D VAE | Shared temporal compute | VERIFIED open |
| Explicit ref / identity adapter | Hunyuan avatar; Movie Gen personalization | VERIFIED |
| Memory / appearance module | StreamingT2V APM | VERIFIED |
| 3D multi-view prior | SVD MV finetune | VERIFIED |

**HVS:** Prefer **explicit Element/Character refs** for production permanence over emergent hope. ContinuityGraph = HVS-native (7Q path: provider + refs → open I2V+ref FT).

---

## §11 — Motion representation

| Rep | Controllable? | Source | Class |
|-----|---------------|--------|-------|
| motion_bucket_id | YES scalar | SVD | VERIFIED |
| FPS conditioning | YES | SVD; Movie Gen FPS token | VERIFIED |
| Optical flow / DragNUWA trajectories | YES | arXiv:2308.08089 | VERIFIED |
| Object trajectory (MotionCtrl) | YES | arXiv:2312.03641 | VERIFIED |
| Camera extrinsics / Plücker | YES | CameraCtrl | VERIFIED |
| Pose / skeleton | YES | Hunyuan pose; Animate Anyone | VERIFIED |
| Dense motion latent (implicit) | Mostly NO | All DiTs | VERIFIED concept |

**Optical flow:** training filter VERIFIED (Hunyuan/Cog); control signal VERIFIED (DragNUWA); **not** primary DiT latent — STRONGLY_INFERRED.

---

## §12 — Camera control

| Lane | Interface | Precision | Label |
|------|-----------|-----------|-------|
| A Prompt/caption tags | “dolly in”, 14/16-class classifiers | Low–medium | VERIFIED Hunyuan/Movie Gen/Cog |
| B Explicit Plücker/extrinsics | CameraCtrl → temporal attn | High (RotErr/TransErr) | VERIFIED |

**ACS link:** CameraSpec/CameraPath → (1) Prompt Compiler Lane A (2) export poses for Lane B open adapters.

**Proprietary:** Sora/Veo geometric API UNKNOWN; STRONGLY_INFERRED learned camera prior; Plücker-like PLAUSIBLE if UI presets. Runway/Luma product camera PLAUSIBLE micro-cond; internals UNKNOWN.

**7Q:** CameraSpec→prompt YES_NOW; Plücker YES_WITH_OPEN_BACKBONE; CameraSpec HVS-native.

---

## §13 — 3D-aware video

Relevance ladder L0 prompt 3D language → L1 Plücker → L2 multi-view prior (SVD) → L3 depth/normal adapters → L4 SV3D-class turntables → L5 Gaussian/NeRF driver (PhysDreamer; Graphics EXTERNAL) → L6 Cosmos-class world platforms.

**Critical (PROPOSED):** Do not collapse Graphics/VFX into ACS. 3D Director authors layout; AI Video consumes poses/depth/renders as optional condition — EXTERNAL beauty sim stays Graphics.

Sora “3D consistency” = behavioral VERIFIED / mechanism STRONGLY_INFERRED learned multi-view prior inside spacetime DiT (not guaranteed explicit NeRF).

---

## §14 — Physics: learned priors vs simulation

| Class | Definition | Examples |
|-------|------------|----------|
| Learned visual priors | Statistical “looks right” | Sora/Movie Gen/Cog “physics” scores |
| Physics-grounded hybrid | Infer params → run sim → optional diffusion refine | PhysGen; PhysDreamer (MPM on 3DGS) |
| Engine simulation | Chaos/Bullet/Blender/FEM | Graphics EXTERNAL |

OpenAI “world simulators” = aspirational framing VERIFIED as author claim — **not** certified physics engine.

**PROPOSED labels:** `PRIOR_PHYSICS` vs `SIM_PHYSICS`. Hybrid orchestration YES_NOW; PhysDreamer-class RESEARCH_REQUIRED.

---

## §15 — Audio–video joint vs HVS AudioGraph

| Family | Evidence | Class |
|--------|----------|-------|
| Joint latent diffusion same denoiser | Veo 3 Tech Report | VERIFIED |
| Separate Video FM + Audio FM | Movie Gen 30B + 13B | VERIFIED |
| Post-hoc V2A | Hunyuan V2A flow DiT + HiFi-GAN | VERIFIED |
| Speech-driven avatar A→V | Hunyuan whisper×face-mask | VERIFIED |

**PROPOSED:** Keep AudioGraph separate SoT; optionally ingest joint A/V plates; never delete separate path. Joint Veo-class sovereign = NOT_PRACTICAL_CURRENTLY.

---

## §16 — Variable resolution / aspect / duration / fps

| Technique | Who | Class |
|-----------|-----|-------|
| Aspect/duration/res buckets | Hunyuan; Movie Gen 5×5 | VERIFIED |
| Multi-res frame packing | CogVideoX (NaViT/Patch’n Pack) | VERIFIED |
| Spacetime patch grid sizing | Sora | VERIFIED high-level |
| Progressive res curriculum | Cog/Hunyuan/Movie Gen | VERIFIED |
| FPS as condition | SVD; Movie Gen; Hunyuan stride | VERIFIED |
| Spatial upsampler cascade | Movie Gen 7B + MultiDiffusion | VERIFIED |
| VAE temporal tiling | Movie Gen TAE; Hunyuan | VERIFIED |

**PROPOSED schema:** `aspect_bucket`, `duration_s`, `fps_class`, `res_class`, `variable_ok`.

---

## §17 — Positional encoding

| Design | Split / form | Source | Class |
|--------|--------------|--------|-------|
| 3D-RoPE CogVideoX | channels 3/8, 3/8, 2/8 | arXiv:2408.06072 | VERIFIED |
| 3D-RoPE Hunyuan | (d_t,d_h,d_w)=(16,56,56) 13B | arXiv:2412.03603 | VERIFIED |
| 3D-RoPE Wan | T/H/W head split θ=10000 | arXiv:2503.20314 | VERIFIED |
| Factorized absolute PE Movie Gen | φ_h,φ_w,φ_t all layers | arXiv:2410.13720 | VERIFIED |
| Multishot MM-RoPE | Seedance | arXiv:2506.09113 | VERIFIED |
| Sora / Veo PE | — | UNKNOWN; PLAUSIBLE 3D RoPE or factorized abs | |

---

## §18 — Attention efficiency

FlashAttention/FA2 (arXiv:2205.14135) · PyTorch SDPA · xFormers/Sage · Ring Attention (arXiv:2310.01889) · Context Parallelism · Ulysses SP · window/sparse (Open-Sora STDiT VERIFIED pattern) · FusedAttention.

CogVideoX appendix: full 3D attn slower than 2D+1D but FA keeps tractable — quality preferred. Fast APIs STRONGLY_INFERRED FA-class + few-step distill (exact kernel UNKNOWN).

---

## §19 — Model parallelism + published HW

| System | Published | Class |
|--------|-----------|-------|
| Movie Gen 30B | up to 6,144× H100 80GB; ~73K tokens; TP+SP+CP+FSDP | VERIFIED |
| Hunyuan 13B | 5D TP/SP/CP/DP+Zero; GPU count UNKNOWN in excerpt | VERIFIED methods |
| CogVideoX-5B infer | ~26GB 480p-class / ~76GB 768p (bf16 H800 50 steps) | VERIFIED |
| CogVideoX-2B | ~18GB / ~53GB same shapes | VERIFIED |
| CameraCtrl train | 16–32× A100 | VERIFIED |
| Wan 1.3B | ~8.19 GB claim | VERIFIED |
| Veo / Sora train HW | — | UNKNOWN |

---

## §20 — Memory optimization · Nebula local realism

**Nebula GPU/VRAM/CPU/NVMe = UNKNOWN.** Do not invent. Published class ranges only:

| Technique | 12–24GB | 24–48GB | 48GB+ | Source |
|-----------|---------|---------|-------|--------|
| model/sequential CPU offload | YES (slow) | YES | Optional | Diffusers |
| VAE tiling/slicing | YES HD | YES | YES | Diffusers; Hunyuan |
| FA2 / BF16 | YES | YES | YES | Dao; Diffusers |
| FP8 layerwise casting | Helps | Helps | Optional | Diffusers Cog example |
| INT8/INT4 | PLAUSIBLE trade | Experiments | Optional | Community; quality UNKNOWN |

**Anchors:** Cog5B ~26/76GB · Cog2B ~18/53GB · Wan1.3B ~8GB · Hunyuan 45–60GB@720p129f · LTX distilled consumer · Mochi ~60GB official / <20GB community.

**PROPOSED policy:** Provider for hero HD/long; local gated by future VRAM probe; always VAE tile HD; no realtime Nebula DiT promise.

---

## §21 — Distillation for latency

| Method | Exemplars | Steps | Class |
|--------|-----------|-------|-------|
| Progressive step distill | AnimateDiff-Lightning | →2–4 | VERIFIED arXiv:2403.12706 |
| Consistency (CM/LCM/VideoLCM) | VideoLCM; AnimateLCM | 4–8 | VERIFIED |
| Adversarial (ADD/SF-V) | SF-V on SVD | 1-step | VERIFIED arXiv:2406.04324 |
| DMD / RayFlow score distill | Seedance | 1–4 | VERIFIED |
| TSCD / HyperSD | Seedance | ~4× NFE cut | VERIFIED |
| CFG baking | VideoLCM; LTX distilled | halves CFG cost | VERIFIED |

**Latency signals (VERIFIED):** SF-V ~23× · LTX distilled ~15× / HD~10s H100 · Seedance 10× E2E; 5s 1080p in 41.4s on L20.

**PROPOSED:** Preview = open distilled LTX/Lightning; production = full-NFE Wan/Hunyuan/Cog or commercial API; own distill = YES_WITH_FINE_TUNING.

---

## §22 — Open model family comparison table

| Model | Year | Backbone | VAE | Text | Objective | Open | License (weights) | Audio | Local feas. | HVS FIT |
|-------|------|----------|-----|------|-----------|------|-------------------|-------|-------------|---------|
| Sora (public) | 2024 | Diff. Transformer | compression net | TEXT_ENCODER_UNDISCLOSED | diffusion | No | Proprietary | No (2024 report) | NOT_PRACTICAL | A when allowed; **DO-NOT-DEPEND** product |
| CogVideoX | 2024 | Expert DiT | 3D causal 4×8×8 C16 | T5-XXL | diffusion | Yes | 2B Apache; 5B CogVideoX Lic. | No | YES_NOW 2B | B/C strong |
| Open-Sora | 2024–25 | STDiT→11B | 3D VAE evolving | T5 | rectified flow 1.2+ | Yes | Apache-family check ckpt | No | YES_WITH_OPEN_BACKBONE | C/D train ops |
| Open-Sora Plan | 2024–25 | SparseUMMDiT/SUV | WFVAE 8×8×8 | T5+CLIP v1.5 | diffusion | Yes | check repo | No | YES_WITH_OPEN_BACKBONE | C sparse ideas |
| **Wan2.1** | 2025 | Flow DiT | Wan-VAE 4×8×8 C16 | umT5 | flow matching | Yes | **Apache 2.0** | V2A task | YES_NOW 1.3B | **B/C primary** |
| HunyuanVideo | 2024 | Dual→single DiT | Causal 4×8×8 C16 | MLLM+CLIP-L | flow matching | Yes | Tencent — Legal gate | Avatar sep. | YES_WITH_OPEN_BACKBONE | B/C quality+MLLM |
| Mochi 1 | 2024 | AsymmDiT 10B | AsymmVAE 8×8×6 C12 | T5-XXL | diffusion | Yes | Apache 2.0 | No | YES_WITH_OPEN_BACKBONE | B/C motion |
| **LTX-Video** | 2024–25 | DiT 2B/13B | High-CR causal | T5-XXL | RF + distill | Yes | OpenRail-M | LTX-2 A/V | YES_NOW distilled | **B/C latency** |
| SVD | 2023 | UNet+temporal | SD VAE | CLIP vision I2V | diffusion | Yes | Stability Community | No | YES_NOW legacy | Legacy I2V |
| AnimateDiff | 2023–24 | SD+motion mod | SD VAE | CLIP | diffusion | Yes | Apache/SD | No | YES_NOW | Adapters/distill |
| Latte | 2024 | Factorized DiT | VAE | variants | diffusion | Yes | Apache 2.0 | No | YES_WITH_OPEN_BACKBONE | Pedagogical |
| Seedance 1.0* | 2025 | Decoupled MMDiT | Causal 4×16×16 C48 | decoder LLM | flow + distill | Weights not fully open | Proprietary | 1.0 silent | N/A | A + design bible |

\*Seedance for triangulation; full proprietary block §23.

---

## §23 — Proprietary systems (VERIFIED + inferred — never conflate)

### Honest comparison

| System | Official disclosure | Safe family wording | Distill | Native A/V | Open analogue |
|--------|---------------------|---------------------|---------|------------|---------------|
| Sora | Partial DiT+patches | VERIFIED diffusion transformer + latent compression | UNKNOWN | Not in 2024 report | Open-Sora/Wan/Hunyuan |
| Veo 3 | Strong dual AE + transformer | VERIFIED joint A/V latent diffusion transformer | UNKNOWN | VERIFIED | LTX-2 / research AV |
| Kling-Omni | Strong PE+DiT+SR+RL+distill | VERIFIED diffusion transformer + VLM | VERIFIED | product-dep. | Hunyuan+VACE |
| Seedance 1.0 | Very strong paper | VERIFIED flow MMDiT decoupled + VAE C48 | VERIFIED 10× | 1.0 silent | Hunyuan+Wan+LTX distill |
| Runway Gen-3/4 | Weak product | STRONGLY_INFERRED latent video diffusion ± controls (**not** DiT-as-fact) | PLAUSIBLE | typically post | LTX IC-LoRA / VACE |
| Luma Ray2 | Weak | STRONGLY_INFERRED latent multimodal video gen | UNKNOWN | UNKNOWN | Wan/Mochi |
| Pika | Weak | PLAUSIBLE diffusion / multi-backend | UNKNOWN | effects product | AnimateDiff+LoRA |

### Capability → mechanism (selected)

| Capability | Must exist | Open analogue | Buildability |
|------------|------------|---------------|--------------|
| Variable res/aspect/duration | Patch packing / buckets | Sora report; Cog Frame Pack; Hunyuan buckets | YES_WITH_SIGNIFICANT_TRAINING full; YES_NOW schema |
| Native synced A/V | Dual AE + joint denoiser | Veo VERIFIED; Hunyuan V2A cascade | NOT_PRACTICAL joint sovereign; YES_NOW API |
| Motion brush / regional motion | Spatial masks + motion cond | VACE; LTX IC-LoRA | YES_WITH_FINE_TUNING |
| Multi-shot narrative | Multishot RoPE / shot tokens + PE | Seedance paper | YES_WITH_SIGNIFICANT_TRAINING; YES_NOW compiler shot lists |
| Character multi-shot consistency | Ref encoders / MVL tokens | Wan VACE; HunyuanCustom | YES_WITH_FINE_TUNING LoRA |
| World-sim physics | Data scale + capacity OR hybrid sim | PhysGen/PhysDreamer | RESEARCH_REQUIRED / hybrid YES_NOW orchestration |

### Final 7Q (compressed per class) — see also §40

**Long cinematic clip:** (1) AE+long ST backbone+captions+extend (2) Wan14B/Hunyuan/OS2 (3) API+compiler+LTX/Wan1.3B preview (4) train for parity (5) foundation yes (6) compiler+schema HVS-native (7) L1→L3→L4→L6 if funded.

**Native dialogue video:** (1) dual AE+joint transformer (2) LTX-2 when weights (3) Veo API or silent+TTS/lipsync (4) yes joint (5) yes (6) AudioGraph+AV slots (7) API→open silent+audio→joint FT.

**Director camera+motion:** (1) trajectory encoder+regional maps (2) CameraCtrl/LTX IC-LoRA/VACE (3) Runway API + open LoRAs (4) LoRA yes (5) moderate (6) CameraSpec HVS-native (7) L2→L3→L4.

**Character-consistent multi-shot:** (1) identity/ref+temporal+PE (2) VACE/Phantom/HunyuanCustom (3) Kling/Seedance API + VACE (4) adapters yes (5) medium/huge (6) Character Bible HVS-native (7) L2→L3→L4.

---

## §24 — Open model code audit synthesis

**Audit principle:** Prefer `modules/*.py`, Diffusers pipelines, papers over README adjectives. No weight downloads performed.

| Family | Verified stack sketch | HVS action |
|--------|----------------------|------------|
| Wan2.1 | CausalConv3d VAE z=16; Flow DiT; umT5; UniPC flow; VACE; offload/xDiT | **USE** primary Apache |
| HunyuanVideo | Dual→single; MLLM+CLIP; flow-shift; FP8; 60GB@720p129f | ADAPT MLLM path; Legal gate |
| Mochi | AsymmDiT 3072/1536; AsymmVAE; T5; ~60GB | USE motion ref |
| LTX | High-CR VAE; Transformer3D; distilled YAMLs; IC-LoRA; Trainer | **USE** latency+distill textbook |
| CogVideoX | Expert AdaLN; T5; 3D VAE; DDIM/DPM; 2B Apache vs 5B gated | USE 2B default |
| Open-Sora | STDiT→11B; rectified flow; full train scripts | ADAPT train ops |
| Open-Sora Plan | WFVAE; SUV sparse MMDiT; Ascend emphasis | ADAPT sparse ideas |
| SVD/AD/Latte | UNet/motion module / factorized DiT | Legacy / teaching |

**Cross-cutting (VERIFIED):** (1) 3D causal VAE + Flow/Diff DiT + strong text (2) FM dominates new train (3) Distill productized (4) Control → VACE/IC-LoRA/masks (5) PE/rewrite LLM standard (6) Memory: offload+tiling+FA2+FP8+USP (7) License landmines: Cog5B, Stability, Tencent vs Apache Wan/Mochi/OpenRail LTX.

---

## §25 — Training data pipeline

**VERIFIED CogVideoX:** ~35M single-shot clips + ~2B aesthetic images; progressive 256→480/720→768×1360; HQ FT ~20% cleanest.

**VERIFIED Hunyuan:** hierarchical 256/360/540/720p rising thresholds; DOVER aesthetic; flow motion; TransNet/PySceneDetect; OCR; YOLOX-like watermark; manual SFT.

**PROPOSED filter taxonomy:** provenance → shot seg → duration → res buckets → aesthetic → motion → OCR → watermark → NSFW/CSAM/PII → near-dupe → splice/noise negatives → caption quality.

**HVS:** ACS does **not** need train corpus to ship. Data pipeline = L6–L8 only; outside WRIM and production `.hvsproj`.

---

## §26 — Video captioning → future HVS VIDEO CAPTIONER

Dense recaption >> short alt-text (**VERIFIED** CogVideoX / DALL·E-3 lineage). Landscape: CogVLM2-Caption, ShareGPT4Video, video-SALMONN, D-ORCA, LLaVA-Video/Qwen2.5-VL, specialty captioners 2025–26.

**PROPOSED HVS VIDEO CAPTIONER (future, not P0):** structured slots SUBJECTS·SCENE·SHOT·CAMERA·MOTION·LIGHTING·PHYSICS·CONTINUITY·AUDIO·NEGATIVE·OCR·WATERMARK·AESTHETIC·MOTION_SCORE. Buildability YES_WITH_OPEN_BACKBONE. **WRIM:** may consume outputs; MUST NOT train WRIM.

---

## §27 — Training curriculum

**VERIFIED CogVideoX progressive:** 256/~6s → 480/~6s → 768/~10s → HQ FT; Multi-Res Frame Pack; 3D-RoPE extrapolate; image=T=1 joint.

**STRONGLY_INFERRED commercial:** same family; exact schedules UNKNOWN.

**PROPOSED:** Curriculum docs for L5–L8 research only; ACS P0 = provider shorts + storyboard stills.

---

## §28 — Joint image + video training

Images supply appearance/aesthetic cheaply; image as T=1; Frame Pack avoids mode split; I2V often FT via channel-concat (**VERIFIED** Cog/SVD). Joint I+V matters for HVS only if owning backbone L4+.

---

## §29 — Control systems (ControlNet-like video)

| Signal | Open mechanism | Buildability |
|--------|----------------|--------------|
| Pose/depth/edges/seg | ControlVideo, SparseCtrl, Wan Fun Control, community CN | YES_WITH_OPEN_BACKBONE |
| Camera/trajectory | CameraCtrl, MotionCtrl | YES_WITH_OPEN_BACKBONE |
| Identity/style | IP-Adapter ports, LoRA (fiction only; REJECT non-consent Face-ID) | YES_WITH_OPEN_BACKBONE / FT |
| First/last frame | Channel concat / FLF2V | YES_WITH_OPEN_BACKBONE |

Commercial control tensors UNKNOWN; STRONGLY_INFERRED same design space as open ControlNet-video literature.

**PROPOSED:** provider-neutral CameraSpec + motionSpec + optional pose/depth/seg refs on request object; adapters map without silently rewriting Commander intent.

---

## §30 — Inpaint / outpaint

Design space: masked latent replace · **VACE-class context branch (VERIFIED)** · separate inpaint CN · AR token mask-infill (VideoPoet VERIFIED).

**HVS P0:** provider edit APIs + FFmpeg composite; local VACE if license/VRAM OK — Nebula UNKNOWN → HOLD.

---

## §31 — Long video

| Method | Open refs | Failures |
|--------|-----------|----------|
| Sliding local attn | FreeNoise | Stagnation |
| Chunk AR + appearance memory | StreamingT2V CAM+APM | Drift/seams |
| Overlap co-denoise | Gen-L class | Quality drop |
| Native long DiT | Cog stage3; LTX long claims | VRAM cube |
| **Storyboard stitch** | **HVS native** | Continuity QC |

**Why short dominates:** quadratic memory, rare clean long shots, AR error accumulation, product UX, eval/safety.

**PROPOSED default:** Cinema = many short gens + EditCommands + ContinuityGraph — **not** native 2-minute single-pass.

---

## §32 — Autoregressive visual tokens vs DiT

| Family | Strengths | Weaknesses | Examples |
|--------|-----------|------------|----------|
| Latent DiT/Flow | Fidelity, open SOTA | Fixed-length bias | Wan, Cog, Hunyuan, LTX |
| Discrete AR tokens | Causal continue, edit tasks | Seq cost, tokenizer bottleneck | VideoPoet+MAGVIT-v2 |
| Continuous AR | Efficiency claims | Smaller ecosystem | NOVA |
| Hybrid AR+Diffusion MoT | Plan+fidelity | Complex | Cosmos 3 VERIFIED |

**STRONGLY_INFERRED:** 2025–26 commercial T2V quality still clusters on latent DiT/flow; AR/world rising for interactive/robotics.

---

## §33 — World models / interactive / action-conditioned

| System | What | Class |
|--------|------|-------|
| Genie 1/2/3 | Interactive world; Genie 3 ~24fps 720p claims | VERIFIED product claims; internals UNKNOWN |
| NVIDIA Cosmos / Cosmos 3 | MoT AR Reasoner + diffusion Generator; action tokens | VERIFIED disclosures |
| GameNGen / UniSim | Diffusion game / robotics world | VERIFIED research |

**PROPOSED:** EXCLUDE world-model training from ACS P0–P2. Track as **D/E research reference only** — separate sovereign program. NOT_PRACTICAL_CURRENTLY as ACS product feature.

---

## §34 — PROPOSED `HvsVideoGenerationRequest` fields

`prompt` · `negativePrompt?` · `structuredIntent?` · `durationSec` · `resolution` · `aspect` · `fps` · `seed?` · `sourceImage?` · `sourceVideo?` · `firstFrame`/`lastFrame?` · `characterRefs[]` · `objectRefs[]` · `styleRefs[]` · `cameraSpec?` · `motionSpec?` · `depthRef`/`poseRef`/`segmentationRef?` · `audioIntent?` (routes AudioGraph) · `qualityTier` · `privacyPolicy` · `costLimit`+dryRun · `providerHints?` · `continuityKeys?`

**Hard rules:** fiction-tagged character refs (REJECT non-consent Face-ID); drop unsupported fields only with **capability miss receipt**; audio intent-only here.

---

## §35 — PROPOSED `HvsVideoModelCapability` descriptor

`modelId`/`providerId` · modalities · maxDuration/Res/aspects/fps · supportsNegativePrompt/Seed/CameraSpec/MotionControl/ControlMaps/RefAdapters/Audio · privacy · pricing · licenseClass · localHardware or CLOUD_ONLY · status ACTIVE/DEPRECATED/**DO_NOT_DEPEND** · notes (Sora = DO_NOT_DEPEND sunset 2026-09-24 **VERIFIED**).

---

## §36 — PROPOSED HVS Prompt Compiler

**Pipeline:** Parse NL+Plan → structured slots → Validate ContinuityGraph/Bible/BrandKit → Compile per-provider → Receipt (intent+payload+modelId+cost).

**MUST slots:** SUBJECTS · SCENE · SHOT · CAMERA · MOTION · LIGHTING · PHYSICS · CONTINUITY · AUDIO · NEGATIVE

**MUST NOT silently change Commander intent.** Allowed: format, truncate-with-warning, logged synonym map, drop unsupported with receipt. Forbidden: invent subjects, change shot size, strip negatives, add brand-violating style.

**Buildability:** YES_NOW as software on HVS kernel (ties to `HVS-ACS-01_PROMPT_PLAN_ROUTER_KERNEL`).

---

## §37 — Local feasibility (published figures only · Nebula UNKNOWN)

| Model | Min VRAM (pub.) | Rec | License note | Feasibility class |
|-------|-----------------|-----|--------------|-------------------|
| Wan2.1 T2V-1.3B | ~8.19 GB | 12–24 GB | Apache-2.0 verify card | YES_NOW class |
| Wan 14B class | FP8 ~24–40 / full ~65–80 | 80 GB | check | YES_WITH_OPEN_BACKBONE |
| CogVideoX-2B | ~12.5 GB FP16 | 18–24 | Apache family | YES_NOW class |
| CogVideoX-5B | ~20.7 GB BF16 | 24–48 | Apache family / card | YES_WITH_OPEN_BACKBONE |
| HunyuanVideo 13B | 45–60 GB | 80 GB | Tencent CLA Legal gate | YES_WITH_OPEN_BACKBONE |
| LTX-Video ~2B distilled | ~8–10 GB | 12–24 | OpenRail-M verify | YES_NOW class |
| Mochi-1 | ~22–42 GB | 48–80 | Apache-2.0 | YES_WITH_OPEN_BACKBONE |

Until Nebula inventory: local = **capability research**, not deployment commitment. All Nebula-specific feasibility = **UNKNOWN**.

---

## §38 — Sovereign path · components · ladder · buildability

### Path options
| Path | Cost | When |
|------|------|------|
| From scratch AE+DiT+data | Extreme | L7–L8 |
| Fine-tune open backbone | High | L4 |
| Adapter/LoRA | Medium | L3–L4 |
| Distill student | High + teacher | L4–L5 |

### Component USE / ADAPT / REPLACE / TRAIN (near-term ACS)

| Subsystem | Action | Rationale |
|-----------|--------|-----------|
| Orchestration / Router / spend gates | **USE** (build HVS) | Kernel strength |
| `.hvsproj` / Intent/Plan | **USE** | SoT |
| Prompt Compiler | **TRAIN**-lite rules / build | HVS-native ASAP |
| CameraSpec / MotionSpec | **USE** schema | Provider-neutral |
| Provider T2V/I2V APIs | **USE** | Quality now |
| Open DiT (Wan/Cog/LTX) | ADAPT eval → **USE** local when HW known | License+VRAM gated |
| ControlNet / VACE / IC-LoRA | ADAPT → USE | Strong open analogues |
| Video AE | USE open; REPLACE/TRAIN late | Hardest early own |
| Text encoder | USE frozen open | |
| Character ref | ADAPT IP-Adapter-class; FT LoRA | Fiction only |
| AudioGraph | **USE** separate | ACS≠joint AV default |
| Safety / QC / C2PA | **USE** HVS CreativeQC | |
| Training data pipeline | none → TRAIN L6+ | |
| World model / action | none / separate program | §33 |
| **WRIM weights** | **DO NOT TOUCH** | Commander lock |

### Ownership ladder L1–L8

| Level | Name | Owns | Buildability |
|-------|------|------|--------------|
| **L1** | Orchestration | War Room, Router stubs, spend/publish, receipts | YES_NOW → slice HOLD |
| **L2** | Prompt/control schema | Structured intent, CameraSpec, Capability, Compiler | YES_NOW |
| **L3** | Adapters | Provider adapters + optional local wrappers; control maps | YES_WITH_OPEN_BACKBONE |
| **L4** | Fine-tune open | LoRA on Wan/Cog for Brand/fiction | YES_WITH_FINE_TUNING |
| **L5** | Own AE/latent | HVS 3D VAE | YES_WITH_SIGNIFICANT_TRAINING |
| **L6** | Own transformer/flow | HVS DiT/flow | YES_WITH_SIGNIFICANT_TRAINING |
| **L7** | Own training stack | Data+caption+curriculum | RESEARCH_REQUIRED then auth |
| **L8** | Sovereign foundation | Independent weights+AE+train+eval | NOT_PRACTICAL_CURRENTLY ACS timeline |

**Default:** Operate **L1–L3 (hybrid)**; research L4 opportunistically; park L5–L8 multi-year outside ACS P0.

### Buildability — capability classes

| Class | Buildability |
|-------|--------------|
| Short T2V/I2V cinema cells | YES_NOW providers; YES_WITH_OPEN_BACKBONE local |
| Storyboard→multi-shot assembly | YES_NOW (FFmpeg/EditCommands) |
| Camera language control | YES_NOW schema; YES_WITH_OPEN_BACKBONE numeric |
| Pose/depth/edge control | YES_WITH_OPEN_BACKBONE |
| Character continuity (fiction) | YES_WITH_FINE_TUNING |
| Native AV joint | YES_NOW provider if offered; else AudioGraph |
| Masked inpaint/outpaint | YES_WITH_OPEN_BACKBONE |
| Minute-scale single-pass | RESEARCH_REQUIRED — stitch instead |
| Real-time interactive world | NOT_PRACTICAL_CURRENTLY in ACS |
| Fully sovereign foundation | NOT_PRACTICAL_CURRENTLY |

---

## §39 — WRIM / HVS boundary (untouched)

| Allowed (conceptual) | Forbidden |
|----------------------|-----------|
| Scene reasoning / planning assist | Any WRIM weight update / train / FT |
| Prompt compile suggestions | WRIM as gen backend without Commander auth |
| QC critique of gens | Coupling WRIM gradients to video loss |
| Read-only WRIM *text* outputs in Plan | Modifying WRIM repo / configs / checkpoints |

**PROPOSED policy:** NO WRIM training authorized; **DO NOT modify WRIM.** This research made **zero** WRIM changes.

---

## §40 — Decision A–E + FINAL recommendation

| Option | Meaning | Verdict |
|--------|---------|---------|
| **A PROVIDER-ONLY** | SaaS only | Fragile (Sora sunset); privacy/cost risk |
| **B LOCAL OPEN** | Only open weights | Blocked by Nebula UNKNOWN + quality gap |
| **C HYBRID** | Provider primary + local optional + HVS schemas | **RECOMMENDED** |
| **D OWN FINE-TUNE** | LoRA/FT on open | L4 add-on after C |
| **E FROM-SCRATCH** | Sovereign foundation | L8 research only — not near-term |

### RECOMMEND: **C HYBRID**

**Why:** Replaceable backends + CameraSpec + spend gates already ACS-shaped; Sora proves A-only fragility; B-only blocked; D follows C; E is multi-year capital.

### STATUS: **PARTIAL**
Architecture contracts densified across W1–W8; Nebula HW unknown; some vendor ToS/price not re-pinned this fold; proprietary layer counts remain UNKNOWN where undisclosed.

### IMPLEMENTATION: **NOT AUTHORIZED**

### First eng slice — **HOLD** (not executed)
`HVS-ACS-01_PROMPT_PLAN_ROUTER_KERNEL`

### Optional follow-on — **HOLD**
`HVS-VIDARCH-01_REQUEST_CAPABILITY_COMPILER_CONTRACTS`  
(= §34–§36 schemas + Sora DO_NOT_DEPEND + dry-run Router; **no** model download, **no** paid gen, **no** WRIM touch)

### Sora DO-NOT-DEPEND
OpenAI Videos API / Sora shutdown **2026-09-24**, recommended replacement **none** (**VERIFIED** ACS / OpenAI deprecations). Exclude from router candidates.

### No mystery box
When internals UNKNOWN, document feasible mechanism classes: latent DiT/flow + 3D VAE · temporal ControlNet/VACE · ref-adapter/LoRA · chunked AR memory · AR+diffusion MoT (world) · dense caption+PE. Prefer VERIFIED over STRONGLY_INFERRED on conflicts; never assert closed “DiT-X layers” without disclosure.

---

## CONFLICTS & RESOLUTION NOTES

| Topic | Conflict | Resolution |
|-------|----------|------------|
| “All video = diffusion” | Marketing vs papers | Prefer VERIFIED objectives: many are **flow matching** |
| Runway “is DiT” | Industry assumption vs disclosure | Keep **STRONGLY_INFERRED latent diffusion ± controls**; not VERIFIED DiT |
| Sora as HVS backend | Prior product interest vs deprecation | **DO-NOT-DEPEND** VERIFIED sunset |
| W7 folder path note | Wave mentions alternate folder | Canonical fold path = `/home/box/hvs-ai-creative-suite/video-model-architecture/` |
| Seedance 2.0 arch blogs | Third-party vs 1.0 paper | Prefer Seedance **1.0 paper** VERIFIED; 2.0 claims UNVERIFIED/THIRD_PARTY |

---

## GAPS STILL UNKNOWN

1. Exact Sora VAE ratios, channels, causal flag, patch size, sampler, PE, train HW  
2. Runway/Luma/Pika official AE+DiT tables and PE  
3. Veo exact MMDiT vs cross-attn, channel sizes, step counts, train cluster  
4. Nebula GPU/VRAM/CPU/NVMe inventory → all local deployment commitments  
5. Quantitative permanence rates per vendor (no standardized public leaderboard)  
6. Whether commercial camera UIs map to Plücker-class conditioning  
7. INT4/INT8 video DiT quality bars (not standardized in foundation reports)  
8. Joint A/V open foundation at Veo quality (gap; V2A cascades only until LTX-2 weights mature)  
9. Product-ID-safe Prompt Compiler eval set (PROPOSED only — not built)  
10. Kling-Omni exact VAE ratios / dual-stream dims beyond report sketch  

---

## PRIMARY SOURCES (deduplicated index)

Full URL list: `sources/primary_urls.txt` (normalized this fold).

**Core papers/docs:**  
https://openai.com/index/video-generation-models-as-world-simulators/ · https://openai.com/index/sora-system-card/ · https://arxiv.org/abs/2408.06072 (CogVideoX) · https://arxiv.org/abs/2412.03603 (Hunyuan) · https://arxiv.org/abs/2503.20314 (Wan) · https://arxiv.org/abs/2410.13720 (Movie Gen) · https://arxiv.org/abs/2501.00103 (LTX) · https://arxiv.org/abs/2412.20404 (Open-Sora) · https://arxiv.org/abs/2311.15127 (SVD) · https://arxiv.org/abs/2506.09113 (Seedance) · https://arxiv.org/abs/2512.16776 (Kling-Omni) · https://storage.googleapis.com/deepmind-media/veo/Veo-3-Tech-Report.pdf · https://arxiv.org/abs/2404.02101 (CameraCtrl) · https://arxiv.org/abs/2312.03641 (MotionCtrl) · https://arxiv.org/abs/2405.11473 (FIFO) · https://arxiv.org/abs/2501.03575 (Cosmos) · https://arxiv.org/abs/2312.09109 (VideoLCM) · https://arxiv.org/abs/2403.12706 (Lightning) · https://arxiv.org/abs/2406.04324 (SF-V) · Diffusers memory/CogVideoX/Wan/Hunyuan/Mochi/LTX docs · Wan/Hunyuan/Mochi/LTX/CogVideo/Open-Sora GitHub READMEs  

---

## WAVE FOLD LEDGER

| Wave | Focus | Lines | Stamp |
|------|-------|-------|-------|
| W1 | Latents/DiT/Flow §1–4 | 324 | DONE 15:12 EDT |
| W2 | Conditioning/Prompt §5–8 | 357 | DONE 15:12 EDT |
| W3 | Temporal/Camera/3D/Physics §9–14 | **278** | **FINAL** 15:12 EDT |
| W4 | A/V/RoPE/Attn/Memory §15–20 | **270** | **FINAL** 15:12 EDT |
| W5 | Distill + Open families §21–22 | 432 | DONE 15:25 EDT |
| W6 | Proprietary + code audit §23–24 | 470 | DONE 15:40 EDT |
| W7 | Train/Control/Long/AR/World §25–33 | 227 | DONE |
| W8 | Contracts/Sovereign/Decision §34–40 | 347 | DONE |

---

**FINAL:** Recommend **C HYBRID** · STATUS **PARTIAL** · **IMPLEMENTATION NOT AUTHORIZED** · First slice HOLD `HVS-ACS-01_PROMPT_PLAN_ROUTER_KERNEL` · Optional HOLD `HVS-VIDARCH-01_REQUEST_CAPABILITY_COMPILER_CONTRACTS` · Nebula **UNKNOWN** · WRIM **untouched** · Sora **DO-NOT-DEPEND** · **no mystery box**.

**Fold stamp:** 2026-09-22 ~3:16 PM EDT · RESEARCH FOLD ONLY
