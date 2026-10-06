# HVS AI VIDEO MODEL ARCHITECTURE REPORT

**Title:** AI Video Model Architecture Report — Master Research Addendum  
**Date:** 2026-09-22 ~3:20 PM EDT (America/New_York)  
**Commander:** Mark · **Owner:** Personal Assistant / HVS War Room  
**Mode:** RESEARCH ONLY · **IMPLEMENTATION NOT AUTHORIZED** · Builds **HOLD**  
**Parent ACS:** `HVS_AI_NATIVE_CREATIVE_SUITE_WORLD_RESEARCH_REPORT.md`  
**Waves folded:** A (latent/DiT/flow) · B (conditioning) · C (3D/physics/AV/efficiency) · D (open families) · E (proprietary reasoned) · F (training/long/AR/world) · G (HVS contracts/sovereign)  
**Also:** `audits/OPEN_REPO_AUDIT_NOTES.md` · `RESEARCH_RULE_REASONED_INFERENCE.md`  
**Hard stop:** No downloads · no training · no WRIM changes · no commits · no code implementation · no Nebula VRAM invention  

**STATUS:** **PARTIAL** (research-only synthesis)  
**RECOMMENDED ARCHITECTURE LETTER:** **C — HYBRID** (provider primary + local open opt-in + HVS-owned contracts/compiler)  
**DAY-ONE OWNERSHIP LADDER:** **L1–L2** (L3 adapter spike)  
**PROGRESSION:** **C → D (fine-tune) → partial E (own VAE/DiT research)** — not full L8 as day-one  
**Sora:** **EXCLUDE** product path (API sunset context; public report = REFERENCE_ARCH only)  
**Nebula VRAM:** **UNKNOWN**  
**Face-ID:** **REJECT** (ACS lock; characterRefs ≠ biometric Face-ID)  
**WRIM:** **untouched**  

---

## Claim-class legend

| Class | Meaning |
|-------|---------|
| **VERIFIED** | Official paper, repo, API, model card, or provider statement |
| **STRONGLY_INFERRED** | Multiple independent signals; wording = “likely belongs to…” — **never** as fact |
| **PLAUSIBLE** | Explains behavior; list alternatives A/B/C |
| **UNKNOWN** | Evidence cannot support meaningful inference |

## Buildability legend

`YES_NOW` · `YES_WITH_OPEN_BACKBONE` · `YES_WITH_FINE_TUNING` · `YES_WITH_SIGNIFICANT_TRAINING` · `RESEARCH_REQUIRED` · `NOT_PRACTICAL_CURRENTLY`

## Ownership ladder (L1–L8)

| Level | Meaning |
|-------|---------|
| **L1** | Orchestration / Gen Router / multi-backend |
| **L2** | Prompt Compiler + control/request schema |
| **L3** | Conditioning adapters (Control/VACE/IC-LoRA/camera) |
| **L4** | Fine-tune open backbone |
| **L5** | Own VAE / latent |
| **L6** | Own transformer / flow |
| **L7** | Own training pipeline + data factory |
| **L8** | Sovereign foundation video model |

## Mystery-box kill

If a commercial capability ships, document **mechanism classes** that must exist (compressed spatiotemporal latent; iterative generative backbone; text/multimodal conditioning; temporal aggregation; efficiency layer for Turbo/Flash; safety). Unknown = *which variant*, not *whether any mechanism exists*. Never infer architecture from output quality alone.

---

## EXECUTIVE SUMMARY

**Architecture recommendation: C HYBRID.** Provider APIs remain the primary cinema-pixel path (Veo / Kling / Seedance / Runway / Luma / Hailuo). HVS owns the **product kernel**: Generation Request contract, Model Capability registry, Prompt Compiler (intent-locked structured IR), Continuity/Camera/Motion schemas, spend/privacy/safety gates. Optional **local open backbones** (Wan 2.1 Apache 1.3B, LTX distilled/FP8, CogVideoX-2B Apache, Mochi Apache where HW allows) for draft/privacy **after** Nebula inventory — Nebula VRAM remains **UNKNOWN**.

**Not A-only** — Sora / OpenAI Videos API sunset proves provider fragility (**EXCLUDE** durable dependency). **Not B-only** — Nebula UNKNOWN + quality gap vs flagships. **Not D/E as day-one** — fine-tune and from-scratch require measured HW, data factory, and capital.

**2025–2026 open production stack (VERIFIED convergence):** causal 3D VAE (~4×8×8×C16 class) + **Flow Matching / Rectified Flow DiT** (or classic diffusion for CogVideoX/SVD lineage) + strong text (T5/umT5/MLLM) + re-caption/rewrite + distillation/efficiency. UNet-heavy video is legacy for foundation T2V.

**Do not call every model “diffusion.”** CogVideoX / SVD / Latte = classic diffusion; Hunyuan / Wan / Mochi / LTX / Open-Sora 1.2+ / Movie Gen / Seedance = **flow matching / rectified flow** (**VERIFIED**).

**Highest-leverage near-term HVS-native artifacts (L1–L2):** Prompt Compiler + request/capability contracts — no video weights required. Keep **AudioGraph separate**; optional V2A Foley (MMAudio / Hunyuan-Foley) or provider native AV (Veo). Cinema long-form = **hierarchical stitch** + ContinuityGraph, not native multi-minute single-pass. Physics: label `PRIOR_PHYSICS` (learned) vs `SIM_PHYSICS` (Graphics solvers) — never market gen fluid as simulated.

**Face-ID REJECT** (ACS). **Sora EXCLUDE**. **WRIM untouched**. **IMPLEMENTATION NOT AUTHORIZED**.

**Final posture:** Recommend **C HYBRID** · STATUS **PARTIAL** · day-one ladder **L1–L2** · progression **C→D→partial E** · no mystery box.

---

## §1 — Latent video representations

### 1.1 Why not full-res RGB every step? (VERIFIED)

Modern generators denoise in a **compressed latent**, then decode to RGB. Motivations: attention ~O(n²) in tokens; spatial/temporal redundancy; train/infer cost; quality tradeoff vs aggressive compression (compensated by channels, LPIPS/GAN/DWT losses, or LTX-style denoising decoder).

### 1.2 Compressor taxonomy (VERIFIED)

| Family | Compresses | Causal? | Typical use |
|--------|------------|---------|-------------|
| 2D image VAE (SD/SDXL) | H,W | N/A | Early video / SVD / Latte |
| Temporal / 3D VAE | T,H,W | often causal | CogVideoX, Hunyuan, Wan, Mochi, LTX, Movie Gen |
| Hierarchical 2D→3D | spatial then temporal | 3D often causal | Open-Sora 1.2 |
| VQ / MAGVIT-style | discrete codes | MagViT-v2 causal option | tokenizer / AR research |
| DC-AE / deep compression | extreme spatial | image-first / video research | token reducer |
| WF-VAE | wavelet + causal cache | Open-Sora Plan | VERIFIED reports |
| Causal video VAE | no future→past leak | yes | I2V first-frame, joint I+V |

**Causal benefit (VERIFIED):** clean T=1 image encode; I2V without future bleed; streaming/tiling. Cost: slight recon asymmetry vs non-causal.

### 1.3 Per-system latent specs (VERIFIED unless noted)

| System | Spatial | Temporal | C | Causal? | Status |
|--------|---------|----------|---|---------|--------|
| CogVideoX | 8×8 | 4× | 16 | Yes | VERIFIED |
| HunyuanVideo | 8×8 | 4× | 16 | Yes | VERIFIED |
| Wan 2.1 | 8×8 | 4× | 16 | Yes | VERIFIED |
| Mochi 1 | 8×8 | 6× | 12 | Yes | VERIFIED |
| LTX-Video | 32×32 | 8× | 128 | Encoder causal | VERIFIED (~1:192 total) |
| Open-Sora 1.2 | 8×8 | 4× | 4 (3D stage) | 3D causal | VERIFIED |
| Open-Sora Plan v1.5 WF-VAE-M | 8×8 | 8× | 32 | Causal | VERIFIED (report) |
| SVD | 8×8 | 1× | 4 | N/A (2D) | VERIFIED |
| Movie Gen TAE | 8×8 | 8× | 16 | UNKNOWN causal flag | VERIFIED ratios via citations |
| Seedance 1.0 | 16×16 | 4× | 48 | Causal | VERIFIED paper |
| Sora | compressed ST | compressed | UNKNOWN | UNKNOWN | Existence VERIFIED; ratios UNKNOWN |

**Volume examples:** Cog/Hunyuan/Wan \(4×8×8=256×\) volume, C 3→16 → ~48× element reduction (**VERIFIED**). LTX \(8×32×32=8192×\), C=128 → **1:192** (**VERIFIED**).

### 1.4 Proprietary latents (reasoned)

| Product | Claim | Class |
|---------|-------|-------|
| Sora | Learned video compression network + decoder | VERIFIED |
| Sora exact ratios/channels | — | UNKNOWN |
| Gen-3 / Luma / Kling / Hailuo / Veo | Latent (not pure pixel) generative stack | STRONGLY_INFERRED (SOTA + latency; not official for all) |
| Exact proprietary ratios | — | UNKNOWN |

**HVS fit:** USE open 4×8×8@16 causal VAE (Wan/Hunyuan/Cog class) — `YES_NOW`. Own DC-AE-V / LTX-extreme — L5, `YES_WITH_SIGNIFICANT_TRAINING` / `RESEARCH_REQUIRED`. Nebula VAE profile — **UNKNOWN**.

---

## §2 — Video autoencoders

### 2.1 Design axes (VERIFIED)

| Axis | Choices | Notes |
|------|---------|-------|
| Conv family | CausalConv3D vs symmetric 3D | Causal preferred for I2V/streaming |
| Compression | Mild (4×8×8) vs extreme (8×32×32) | Extreme needs strong decoder (LTX) |
| Channels | 4–16 common; LTX 128; Seedance 48 | Channel expand offsets volume compress |
| Asymmetry | Mochi AsymmVAE enc≢dec | Memory / quality trade |
| Caching / tiling | Wan feature cache; Hunyuan spatial-temporal tiles | Arbitrary-length encode/decode |
| Decoder as denoise | LTX timestep-conditioned decoder | Last denoise in pixel space |

### 2.2 Published recon notes (VERIFIED)

| System | Notes |
|--------|-------|
| CogVideoX | 8×8×4@16 preferred; aggressive 16×16×8 hard; 3D kills flicker vs 2D |
| HunyuanVideo | PSNR tables beat CogVideoX-1.5 / OpenSora-1.2 / Cosmos on their eval |
| Wan-VAE | Competitive PSNR; **2.5× faster** recon than Hunyuan VAE (vendor claim) |
| Open-Sora Plan v1.5 | WF-VAE-M PSNR 36.91, LPIPS 0.0205 on their 1K set |
| LTX | Needs denoising decoder + rGAN + DWT; user study prefers decoder-at-t>0 |

### 2.3 Strategic note (VERIFIED)

NVIDIA Cosmos Predict2.5 **reuses Wan2.1 VAE (4×8×8)** — Wan-VAE is a strategic L5 prior for HVS (**VERIFIED** paper/HF).

### 2.4 HVS component verbs

| Component | Verb | Buildability | Ladder |
|-----------|------|--------------|--------|
| Wan/Hunyuan/Cog causal VAE | USE | YES_NOW | L4–L5 entry |
| WF-VAE / LTX extreme | ADAPT | YES_WITH_SIGNIFICANT_TRAINING | L5 |
| Own video AE | TRAIN | RESEARCH_REQUIRED → SIGNIFICANT_TRAINING | L5 |

---

## §3 — Spacetime patching

### 3.1 Concepts (VERIFIED)

After VAE, latents \(\mathbb{R}^{C×T'×H'×W'}\) become tokens: spatial patch \(p_h×p_w\), temporal \(p_t\), or joint spacetime tube. LTX moves patchify **into VAE** (transformer sees 1×1×1). Token count \(N ≈ (T'/p_t)(H'/p_h)(W'/p_w)\); full ST attention ~O(N²).

### 3.2 System table (VERIFIED)

| System | Patch / tokenize | Attention | Status |
|--------|------------------|-----------|--------|
| Sora | Spacetime latent patches; variable grid = variable dur/res/AR | DiT on patches | VERIFIED type; sizes UNKNOWN |
| CogVideoX | Spatial 2×2; v1.5 can use \(p_t=2\) | 3D full | VERIFIED |
| HunyuanVideo | 3D conv patch; often 2×2×1 | Full; dual→single stream | VERIFIED |
| Wan | Conv3d (1,2,2) | Full ST + text cross-attn | VERIFIED |
| Mochi | Latent tokens (~44k visual default) | AsymmDiT joint | VERIFIED |
| LTX | Patchify in VAE; DiT 1×1×1; ~8192 px/token | Full ST | VERIFIED |
| Open-Sora 1.2 | patch_size=[1,2,2] | Factorized STDiT | VERIFIED |
| SVD | No DiT patches — UNet | Temporal attn/conv | VERIFIED |

### 3.3 Tradeoffs

Larger patches → ↓VRAM/↑speed, risk blur/fine-motion loss. Smaller → better detail, ↑cost. Do **not** invent Nebula numbers.

### 3.4 Proprietary (reasoned)

Sora patch grid as duration/res control — **STRONGLY_INFERRED** from official report. Exact \((p_t,p_h,p_w)\) — **PLAUSIBLE** {(1,2,2), (2,2,1), VAE-absorbed}; **UNKNOWN** exact.

**HVS:** USE Wan/Hunyuan/Cog patchify — `YES_NOW`. Realtime preview — ADAPT LTX — `YES_WITH_OPEN_BACKBONE`.

---

## §4 — Diffusion Transformers

### 4.1 From U-Net to DiT (VERIFIED)

| Era | Backbone | Notes |
|-----|----------|-------|
| Early VDM / Imagen Video | 3D U-Net / cascaded | Scaling awkward |
| SVD / AnimateDiff | 2D U-Net + temporal | Good I2V; weaker foundation T2V |
| DiT (Peebles & Xie 2023) | Transformer on latent patches | LLM-like scaling |
| Video DiT 2024–26 | Full or factorized ST transformer | Dominates open T2V |

Motivations: scaling laws; unified image+video (T=1); FlashAttention/FSDP ecosystem; flexible token layouts via RoPE-3D; mitigated cost via compression/sparse/factorize/cache/distill.

### 4.2 Attention taxonomy (VERIFIED)

| Pattern | Pros | Cons | Examples |
|---------|------|------|----------|
| Full spatiotemporal | Best motion/global | O(N²) | CogVideoX, Hunyuan, Wan, LTX, Mochi |
| Factorized ST | Cheaper | Weaker long-range | Open-Sora STDiT, Latte |
| Windowed / sparse | Long context | Quality risk | Open-Sora Plan Skiparse |
| Temporal add-on UNet | Easy FT from SD | Limited | SVD, AnimateDiff |
| Cross-attn text | Strong control | — | Wan, LTX, Open-Sora |
| Joint / MM-DiT | Deep fusion | Memory | Hunyuan dual→single; Mochi AsymmDiT |
| Expert / MoE | Capacity | Complexity | CogVideoX expert; Wan2.2 MoE claims PARTIAL |

### 4.3 Backbone table (VERIFIED)

| System | Backbone | Text injection | Size |
|--------|----------|----------------|------|
| CogVideoX | Expert Transformer, 3D full | Expert AdaLN MM | 2B / 5B |
| HunyuanVideo | Dual→single full attn | MLLM + CLIP pooled | ~13B |
| Wan | DiT full ST + AdaLN-MLP | umT5 cross-attn | 1.3B / 14B |
| Mochi | AsymmDiT | T5-XXL joint | 10B |
| LTX | PixArt-like DiT | T5 cross-attn | ~2B class |
| Open-Sora 1.2 | STDiT3 | T5 cross-attn | ~1.1B |
| SVD | SD UNet + temporal | CLIP image (I2V) | ~1.5B class |
| Sora | Diffusion transformer | text (re-caption) | Size UNKNOWN |
| Movie Gen | Transformer | self+cross | 30B (+7B upsampler) |
| Seedance | Decoupled ST DiT + MMDiT | Qwen2.5 PE | params not single public number |

### 4.4 Proprietary backbones

| System | Claim | Class |
|--------|-------|-------|
| Sora | DiT-class spacetime transformer | VERIFIED |
| Sora params/attn layout | — | UNKNOWN |
| Kling launch | DiT + 3D VAE + full ST attn | VERIFIED (IR) |
| Veo | Transformer denoiser + latent dual AE | VERIFIED (not word “DiT”) |
| Gen-3 / Ray / Hailuo | DiT-like latent backbone | STRONGLY_INFERRED |
| Exact proprietary recipes | — | UNKNOWN |

**HVS:** USE Wan-1.3B / LTX locally — `YES_NOW`. FT Wan-14B/Hunyuan — `YES_WITH_FINE_TUNING`. Own DiT from scratch — `YES_WITH_SIGNIFICANT_TRAINING` (L6–L8). Beat Sora parity tomorrow — `NOT_PRACTICAL_CURRENTLY`.

---

## §5 — Flow matching

### 5.1 Families (definitions — VERIFIED literature)

| Family | Train target | Sample |
|--------|--------------|--------|
| Classic diffusion (DDPM/DDIM) | ε or v-prediction | DDIM, DPM-Solver |
| Flow matching | velocity \(u_t\) | ODE solvers |
| Rectified flow | \(v = x_1 - x_0\) on straight paths | Euler / Heun |
| Hybrid | DDPM pretrain → RF finetune | Open-Sora 1.2 |
| Distillation / consistency | match teacher ODE | CFG distill, LCM-like |

### 5.2 Objective table (VERIFIED)

| System | Objective | Sampler |
|--------|-----------|---------|
| CogVideoX | Classic diffusion (v-pred) | DDIM / DPM |
| HunyuanVideo | Flow matching | Euler ODE + timestep shift |
| Wan | Flow matching / RF | ODE (~50 steps common) |
| Mochi | Flow matching | FlowMatch Euler |
| LTX | Rectified flow | RF; decoder last denoise |
| Open-Sora 1.2 | Hybrid DDPM→RF | RF after adapt |
| SVD / Latte | Classic diffusion | EDM/DDIM family |
| Movie Gen | Flow matching class | — |
| Seedance | Flow matching + velocity | + distill (TSCD/RayFlow) |
| Sora | “Diffusion model” | Schedule type UNKNOWN |

### 5.3 Acceleration (VERIFIED techniques)

Timestep shifting (Hunyuan); CFG distillation; Wan attention/CFG cache; FP8; LTX decoder-as-denoise; CausVid/DMD few-step students; VideoLCM; SF-V adversarial distill.

### 5.4 Proprietary

Flagships 2024–26 — **STRONGLY_INFERRED** flow or modern v-diffusion; exact schedules **UNKNOWN**. Fast product modes — **PLAUSIBLE** ∈ {consistency, adversarial, DMD, step-distill, cache}.

**HVS:** USE Flow-Match Euler on Wan/Hunyuan/LTX — `YES_NOW`. Consistency student — `YES_WITH_SIGNIFICANT_TRAINING`.

---

## §6 — Text conditioning

### 6.1 Mechanism families (VERIFIED)

| Mechanism | Open exemplars |
|-----------|----------------|
| Frozen LM → cross-attn | Wan umT5; LTX T5; Open-Sora T5; Movie Gen UL2+ByT5+MetaCLIP |
| Frozen LM → MM-DiT / joint | CogVideoX T5+Expert AdaLN; Mochi AsymmDiT; Hunyuan MLLM dual→single |
| Pooled CLIP global | Hunyuan CLIP-L; SVD CLIP **image** (I2V) |
| LLM / MLLM encoder + refiner | Hunyuan MLLM + SingleTokenRefiner |
| Multi-encoder fusion | Movie Gen three-tower concat |
| Prompt rewrite | Hunyuan Prompt Rewrite; Movie Gen LLaMa3 rewrite |

Encoders supply **conditioning embeddings** — not proof of “understanding.”

### 6.2 Per-system table

| System | Encoder | Class | Injection |
|--------|---------|-------|-----------|
| CogVideoX | T5-XXL | VERIFIED | MM concat + Expert AdaLN |
| Wan2.1 | umT5-XXL | VERIFIED | Cross-attn |
| HunyuanVideo | MLLM + CLIP-L | VERIFIED | Dual→single + pooled |
| Mochi / LTX / Open-Sora | T5-XXL | VERIFIED | Joint or cross-attn |
| Movie Gen | UL2+ByT5+MetaCLIP | VERIFIED | Cross-attn |
| Sora / Veo / Gen-* / Kling / Luma / Pika | Exact encoder | **TEXT_ENCODER_UNDISCLOSED** | — |
| Seedance PE | Qwen2.5-14B | VERIFIED (paper) for PE | — |

### 6.3 Proprietary triangulation

**STRONGLY_INFERRED** for frontier closed T2V: large frozen LM/VLM (≥T5-XXL or LLM 7B–70B class) + DiT/flow with cross-attn or MM-DiT — based on open SOTA, Movie Gen/Hunyuan recipes, API CFG surfaces. Exact checkpoint **UNKNOWN**.

**PLAUSIBLE alts:** Movie Gen multi-encoder · single T5 · internal MLLM · proprietary joint embed (less likely).

**Buildability:** `YES_WITH_OPEN_BACKBONE` — ship Wan/Cog/LTX with documented encoders; wrap providers without claiming their encoder.

---

## §7 — Re-captioning

### 7.1 Two jobs (do not conflate)

| Job | When | Goal | Exemplars (VERIFIED) |
|-----|------|------|----------------------|
| Training-set re-caption | Offline | Dense structured captions | DALL·E 3 synth; ShareGPT4Video; Hunyuan JSON; Movie Gen LLaMa3-Video; Open-Sora PLLaVA |
| User-prompt expansion | Inference | Short→train distribution **without changing intent** | DALL·E 3 upsample; Hunyuan Prompt Rewrite; Movie Gen rewrite (+ distilled 8B) |

### 7.2 Enrichment dimensions (VERIFIED)

Hunyuan: Short/Dense/Background/Style/Shot/Lighting/Atmosphere + **14 camera types**. Movie Gen: ~100-word dense + **16-class camera** prefix. Open-Sora: append aesthetic/motion/camera scores. DALL·E 3: subject→surroundings/style/color.

### 7.3 HVS Prompt Compiler precedent

Slots: `subjects | environment | lighting | camera | motion | physics | sound | continuity | shot_timing`. Intent lock + self-revision (Hunyuan/Movie Gen). Anti-patterns: invent brands/IP, add characters, contradict storyboard.

**Buildability:** Orchestration rewrite — `YES_NOW`. Dedicated rewrite LoRA — `YES_WITH_FINE_TUNING`. Grounded physics/continuity vs locked shot list — `RESEARCH_REQUIRED`.

---

## §8 — Image conditioning

### 8.1 Mechanism catalog (VERIFIED)

| Mechanism | Exemplars |
|-----------|-----------|
| Latent channel concat / replace | SVD; CogVideoX-I2V; Hunyuan first-frame replace |
| Per-token timestep / soft cond | LTX; Open-Sora mask_strategy |
| CLIP / vision → cross-attn | SVD; DynamiCrafter; IP-Adapter |
| MLLM semantic image tokens | Hunyuan I2V |
| Reference latent prepend (VACE) | Wan VACE |
| Control maps depth/canny/pose | SparseCtrl; Open-Sora Plan; pose avatar |

**Identity / Face-ID:** ACS **Face-ID REJECT**. Prefer sheet/style refs + rights/consent. Do not equate marketing “identity consistency” with biometric FaceNet adapters.

### 8.2 Provider surfaces (VERIFIED capability; internals reasoned)

Luma frame0/frame1; Kling image_url + optional tail; Runway/Veo/Pika i2v exist. Internals — **STRONGLY_INFERRED** VAE encode + concat/mask/timestep class.

**Buildability:** Local — `YES_WITH_OPEN_BACKBONE`. Cinematic — `CALL_PROVIDER`.

---

## §9 — Video conditioning

| Capability | Mechanism class | Exemplars |
|------------|-----------------|-----------|
| v2v | Encode + strength denoise / ControlNet-like | LTX; Wan VACE; Movie Gen Edit (paper) |
| Motion transfer | Pose/flow/traj | MotionCtrl; Tora; AnimateAnyone-class |
| Style transfer | IP-Adapter / LoRA | — |
| Camera transfer | Plücker / pose seq | CameraCtrl; MotionCtrl |
| Pose/depth/canny | Structural control videos | SparseCtrl; Fun Control |
| Optical flow cond | Flow as tokens | Tora; DragNUWA lineage |
| Reference video | Latent concat / VACE | Wan VACE |

**Kling** dynamic_masks + trajectories — **VERIFIED** API → **STRONGLY_INFERRED** MotionCtrl/Tora-class guidance; exact fusion **UNKNOWN**.

**Buildability:** Basic v2v — `YES_WITH_OPEN_BACKBONE`. Traj brush — `YES_WITH_FINE_TUNING`. Cinematic provider v2v — `CALL_PROVIDER`.

---

## §10 — Temporal consistency

### 10.1 Operational axes (not anthropomorphic)

Appearance/identity stability · background/texture · motion continuity · occlusion · lighting. Do **not** claim “model knows the person” or “physics engine inside” without evidence. Eval: Movie Gen human axes; Physics-IQ / MemoBench as **tests**.

### 10.2 Techniques (VERIFIED)

3D/full ST attention · factorized STDiT · 3D causal VAE · 3D RoPE · reference/first-frame anchors · AnimateDiff/SVD temporal modules · trajectory/pose conditioning · inference-time regularizers (research). Memory banks — mostly `RESEARCH_REQUIRED` for gen video.

### 10.3 Proprietary

**STRONGLY_INFERRED:** combo of ST transformer/temporal layers + 3D latent + motion-quality data + optional reference anchors. Exact memory modules — **UNKNOWN**.

**Buildability:** Short-clip — `YES_WITH_OPEN_BACKBONE`. Long-horizon multi-shot permanence — `YES_WITH_SIGNIFICANT_TRAINING`. Match closed cinematic on Nebula without measured HW — `NOT_PRACTICAL_CURRENTLY`.

---

## §11 — Object permanence

**Definition:** Object leaves/occludes then reappears with compatible geometry/appearance.

| Mode | How | Evidence bar |
|------|-----|--------------|
| Model-emergent | 3D attn + data statistics | Measure with probes — don’t assert from demos |
| Explicitly conditioned | Ref bank, tracking tokens, pose/mesh, memory | Architecture/API must expose it |

Open papers improve large-motion continuity via **3D full attention** + strong VAEs; they do **not** document a dedicated permanence module (**VERIFIED** stance). Proprietary “world simulator” language ≠ verified permanence architecture.

**HVS practical:** Reference stills · traj/pose lock · shot-length limits + editorial cut · Prompt Compiler continuity slot (text alone ≠ pixel permanence).

**Buildability:** Short-clip emergent — `YES_WITH_OPEN_BACKBONE`. Reliable long occlusion reappearance — `RESEARCH_REQUIRED`. Production guarantee = gen + lock + NLE — `YES_NOW` at editorial layer.

---

## §12 — Motion representations

| Representation | Explicit? | Exemplars |
|----------------|-----------|-----------|
| Optical flow fields | Yes | Tora, DragNUWA |
| Sparse trajectories | Yes | MotionCtrl; Kling dynamic_masks |
| Pose sequences | Yes | Hunyuan pose-driven; AnimateAnyone-class |
| Camera pose / Plücker | Yes | CameraCtrl; MotionCtrl |
| Motion buckets (amount) | Partial | SVD motion_bucket_id |
| Caption motion scores | Soft | Open-Sora |
| Latent motion (emergent) | No | All T2V DiTs |
| Audio-driven | Yes (avatar) | Hunyuan audio avatars |

**Luma** `dolly_zoom` concepts — **VERIFIED** named keys; **PLAUSIBLE** {concept tokens · prompt macro · lightweight camera adapter} — not full SE(3).

**Buildability:** Explicit traj/camera on open — `YES_WITH_FINE_TUNING`. Scalar amount — `YES_NOW` via prompt/scores.

---

## §13 — Camera conditioning

### 13.1 Split

| Class | Definition | Examples |
|-------|------------|----------|
| PROMPT-ONLY | NL / phrase list in captions | Open-Sora labels; Hunyuan/Movie Gen camera classifiers; Luma camera strings |
| EXPLICIT | Numeric/geometric path (poses, Plücker) | CameraCtrl; MotionCtrl; Kling camera_control.config axes |
| HYBRID / CONCEPT | Named macros | Luma concepts; Kling compound types |

Vocabulary: pan · tilt · roll · dolly/truck · pedestal · crane · orbit · zoom · handheld · tracking. Zoom ≠ dolly.

### 13.2 Buildability

| Goal | Class |
|------|-------|
| Prompt-only camera language | YES_NOW (Prompt Compiler) |
| Named concept macros | YES_WITH_FINE_TUNING |
| Metric SE(3) / Plücker | YES_WITH_FINE_TUNING (CameraCtrl-class on Wan) |
| Match Kling cinematic camera | CALL_PROVIDER near-term; SIGNIFICANT_TRAINING for sovereign |

---

## §14 — 3D-aware generation

Pure T2V learns **implicit** geometry. HVS path: **3D Director** emits camera/geometry IR → render/encode → condition DiT.

| Class | Signal | Exemplars | Status |
|-------|--------|-----------|--------|
| Camera pose / Plücker | Extrinsics+intrinsics | CameraCtrl; VD3D; CamI2V | VERIFIED |
| Depth / normal | Mono/MV depth | ControlNets; Uni3C Depth-Pro | VERIFIED |
| Point-cloud / mesh render | Unproject→cache→re-render | GEN3C; Uni3C PCDController on Wan | VERIFIED |
| Gaussian splat / 4DGS | Render→VAE→DiT | CAT4D; GS-DiT | VERIFIED papers |
| Implicit-only | Scale + captions | Movie Gen camera classifier; Sora framing | Geometry module UNKNOWN for Sora |

**Boundary:** 3D Director (Graphics) → Renderer → Conditioning video/latent → AI Video Generator.

**HVS:** Camera IR — `YES_NOW` (L2). Uni3C/CameraCtrl adapters — `YES_WITH_OPEN_BACKBONE` / `YES_WITH_FINE_TUNING` (L3–L4). Full dynamic 4DGS world — `YES_WITH_SIGNIFICANT_TRAINING`. Match Sora multi-minute 3D — `NOT_PRACTICAL_CURRENTLY`.

---

## §15 — Physics priors

### 15.1 Mandatory separation

| Track | What | Guarantees |
|-------|------|------------|
| **A. LEARNED VISUAL PRIORS** | DiT absorbs physics-looking motion | **No** conservation laws |
| **B. REAL PHYSICS SIM** | Bullet/PhysX/Taichi/Warp/MPM | Soft/hard constraints |
| **C. HYBRID** | Sim motion/geo → diffusion texture/refine | Partial — **preferred HVS boundary** |

Do **not** equate “looks physical” with “has a physics engine.” Movie Gen physics prompts are human-judged visual axes (**VERIFIED**), not disclosed Newtonian solvers.

### 15.2 Published approaches (VERIFIED)

PhyT2V (prompt CoT) · PhysGen (rigid sim→diffusion) · PhysCtrl (learned traj from sim animations) · PhysGaussian/PhysDreamer (MPM on GS).

**HVS:** Prompt physics slots — `YES_NOW`. Force adapters — `YES_WITH_FINE_TUNING`. Orchestrate Graphics sim → condition video — `YES_WITH_OPEN_BACKBONE`. Replace DCC physics with pure T2V — `NOT_PRACTICAL_CURRENTLY`. Label `PRIOR_PHYSICS` vs `SIM_PHYSICS`.

---

## §16 — Audio-video generation

| Pattern | Exemplars | Status |
|---------|-----------|--------|
| Joint tokens / joint DiT | Research AV-DiTs | PARTIAL at SOTA video scale |
| Cross-modal conditioned | MMAudio | VERIFIED |
| Separate synced decoders | Synchformer family | VERIFIED |
| Audio-after-video (V2A) | Movie Gen Audio 13B; MMAudio; HunyuanVideo-Foley | VERIFIED — dominant production pattern |
| Speech-driven avatar | HunyuanVideo-Avatar | VERIFIED |

**Movie Gen Audio (VERIFIED):** Separate 13B FM transformer + DAC-VAE — **not** one joint AV token stream at flagship scale with 30B Video.

**HVS recommendation:** Prefer **separate AudioGraph** + optional V2A Foley over waiting for sovereign joint AV DiT. Provider native AV (Veo) via CALL_PROVIDER. No Wav2Lip NC path (ACS).

| Buildability | What |
|--------------|------|
| YES_NOW | Timeline mix; TTS; library SFX |
| YES_WITH_OPEN_BACKBONE | MMAudio / Hunyuan-Foley |
| RESEARCH_REQUIRED | True joint speech+music+video tokens at Movie Gen quality |

---

## §17 — Variable resolution / aspect / duration

| Technique | Who | Status |
|-----------|-----|--------|
| Bucketing (res, frames, AR) | Open-Sora; Movie Gen | VERIFIED |
| Multi-stage res curriculum | Movie Gen 256→768; Open-Sora 144p→720p | VERIFIED |
| Patch packing / NaViT-style | Image common; video PARTIAL | — |
| Factorized absolute PE grids | Movie Gen | VERIFIED |
| 3D RoPE / fractional RoPE | CogVideoX, Hunyuan, LTX, Wan | VERIFIED |
| FPS as condition | Movie Gen; Open-Sora | VERIFIED |
| Spatial upsampler cascade | Movie Gen 7B | VERIFIED |
| Chunk extension / tiling | Movie Gen TAE; CausVid | VERIFIED |

**Sora (VERIFIED):** variable duration/res via patch grid; exact bucket recipe **UNKNOWN**.

**HVS:** Multi-AR via providers — `YES_NOW`. Local multi-AR — `YES_WITH_OPEN_BACKBONE`. Minute-long native HD single pass — `RESEARCH_REQUIRED` / `NOT_PRACTICAL_CURRENTLY` at marketing parity.

---

## §18 — Positional encoding

| PE class | Examples | Status |
|----------|----------|--------|
| Factorized absolute (t,h,w) | Movie Gen | VERIFIED |
| 3D RoPE | CogVideoX, Hunyuan, Mochi | VERIFIED |
| Normalized / fractional RoPE | LTX | VERIFIED |
| RIFLEx (extrapolation) | CogVideoX/Hunyuan community | VERIFIED project |

**Impact:** Duration generalization → 3D RoPE + mixed-length + RIFLEx. Res/AR → fractional/normalized or factorized + buckets. Camera coherence → PE alone insufficient (needs pose cond + full ST attn).

**Sora PE type — UNKNOWN.** HVS L6 default: **3D RoPE** (open SOTA) unless aligning Movie Gen absolute.

---

## §19 — Efficient attention

Levers: fewer tokens (stronger VAE) · FlashAttention/SDPA · window/sparse/sliding tile · factorized ST · sequence/context parallel · TeaCache/NaviCache · fewer steps (distill).

| Method | Exact? | Status |
|--------|--------|--------|
| FlashAttention / FA2 / SDPA | Yes | VERIFIED |
| Window / STA (FastVideo) | Approx | VERIFIED community |
| Skiparse / SUV | Approx | VERIFIED Plan reports |
| Ring Attention / USP (xDiT) | Exact distributed | VERIFIED |
| Ulysses SP | Exact distributed | VERIFIED |

**Hunyuan (VERIFIED):** 1280×720×129f ×50 steps: 1×GPU 1904s → 8×GPU 338s (~5.6×).

**Buildability:** FA2/xDiT on open — `YES_NOW`. Novel sparse matching full-attn at minute scale — `RESEARCH_REQUIRED`.

---

## §20 — Parallelism

| Mode | Helps |
|------|-------|
| DDP | Throughput |
| FSDP / ZeRO | Model-state memory |
| Tensor Parallel | Big width |
| Pipeline Parallel | Depth |
| Sequence / Context Parallel | **Long video tokens** |
| Expert Parallel | MoE (Wan2.2 claims PARTIAL) |

**Published HW (VERIFIED only):** Movie Gen Video 30B — up to **6144× H100 80GB**, context ~73K tokens. Hunyuan — single 80GB peaks **60GB** / **45GB**. Wan 1.3B — **8.19 GB**. CogVideoX-5B — ~33GB / 19GB / 11GB / <4GB by offload tier. Sora/Veo/Gen-3 train clusters — **UNKNOWN**. **Nebula — UNKNOWN**.

---

## §21 — Memory optimization

| Technique | Saves | Notes |
|-----------|-------|-------|
| Attention slicing | Peak attn | ≤24GB class |
| VAE slicing / tiling | Encode/decode acts | CogVideoX tiling VERIFIED |
| Model / sequential CPU offload | GPU footprint | Slow |
| BF16 / FP16 | ~½ vs FP32 | Default |
| FP8 | ~½ vs BF16 weights | Hunyuan ~10GB savings claim |
| INT8 / INT4 / GGUF | More | Quality risk |
| Activation checkpointing | Train | Train only |
| Lower res / fewer frames | Tokens | Always available |

### Published VRAM tiers (Nebula = UNKNOWN)

| Tier | Published fits |
|------|----------------|
| 8–12 GB | Wan 1.3B @8.19GB; LTX optimized community; Cog sequential offload |
| 16–24 GB | CogVideoX-5B offload+tiling; Wan1.3B comfortable — **not** full Hunyuan 720p 129f |
| 48 GB | Many 5–14B with offload; tight for Hunyuan 720p native |
| 80 GB | Hunyuan recommended; Movie Gen–class shard |
| Multi-80GB | Movie Gen train; Wan14B/Hunyuan multi-GPU |

Until Nebula measured: feasibility per backbone = **UNKNOWN on Nebula**, cite published tiers only.

---

## §22 — Distillation

| Class | Exemplars | Status |
|-------|-----------|--------|
| Consistency (LCM-like) | VideoLCM | VERIFIED |
| Adversarial / GAN distill | SF-V; OSV | VERIFIED |
| Distribution matching (DMD) | CausVid (~9.4 FPS streaming claim) | VERIFIED |
| Flow / rectified distill | With FM teachers | VERIFIED class |
| Prompt rewrite distill | Movie Gen 70B→8B | VERIFIED (not denoiser) |
| Cache / skip (not true distill) | TeaCache | VERIFIED community |

LTX realtime via **architecture** (extreme compression) ± distilled SKUs — cite paper/H100 carefully. Commercial fast modes — **PLAUSIBLE** distill class; recipe **UNKNOWN**.

**HVS:** Run distilled LTX / FastVideo — `YES_WITH_OPEN_BACKBONE`. Distill Wan/Hunyuan CausVid-style — `YES_WITH_SIGNIFICANT_TRAINING`. One-step cinematic = teacher — `RESEARCH_REQUIRED` / `NOT_PRACTICAL_CURRENTLY`.

---

## §23 — Open model comparison

### Master comparison (synthesis of Wave D + audit)

| MODEL | Arch | VAE | Text | Objective | Open weights | License (verify card) | Local fit | HVS FIT |
|-------|------|-----|------|-----------|--------------|----------------------|-----------|---------|
| **Wan 2.1** | Flow DiT full ST | Wan-VAE 4×8×8 C16 | umT5 | Flow matching | Yes 1.3B/14B | Apache-2.0 | **High** 1.3B (8.19GB) | **TOP LOCAL / ADAPT** |
| **LTX-Video** | DiT + extreme VAE | 32×32×8 C128 | T5 | Rectified flow | Yes | OpenRail/community **PARTIAL** | **High** distilled/FP8 | **TOP SPEED / CONTROL** |
| **HunyuanVideo** | Dual→single DiT ~13B | Causal 4×8×8 C16 | MLLM+CLIP | Flow matching | Yes | Community — diligence | Medium–Low (45–60GB) | ADAPT / FT / license gate |
| **CogVideoX** | Expert DiT | Causal 4×8×8 C16 | T5-XXL | Diffusion v-pred | Yes | 2B Apache; 5B gate **PARTIAL** | High 2B | ADAPT / FT |
| **Mochi 1** | AsymmDiT 10B | AsymmVAE 8×8×6 C12 | T5-XXL | Flow matching | Yes | Apache-2.0 | Medium (~60GB) | REFERENCE / FT if HW |
| **Open-Sora** | STDiT→MMDiT | Evolving 2D→3D/DC-AE | T5(+CLIP 2.0) | RF (1.2+) | Yes | Apache-2.0 | Medium–High research | **TRAIN playbook** L7 |
| **Open-Sora Plan** | Cross-DiT / sparse | WF-VAE | T5-class | Diff/flow variants | Yes | MIT-friendly | Medium | ADAPT VAE/sparse |
| **SVD** | UNet ST | SD VAE | CLIP image | Diffusion | Yes | Community | High short I2V | Legacy REFERENCE |
| **AnimateDiff** | SD + motion modules | SD VAE | CLIP | Diffusion | Yes | Often Apache modules | Very High | Control ecosystem donor |
| **Latte** | Factorized DiT | Image VAE | T5 | Diffusion | Yes | Research | Medium | STDiT precursor |
| **Cosmos Predict2.5** | DiT world foundation | **Wan2.1 VAE** | Richer text | RF/diffusion WFM | Yes | NVIDIA Open Model | Medium | World-sim track; attribution |
| **Sora (public)** | DiT spacetime patches | Compression net | UNDISCLOSED | Diffusion | No | Proprietary | N/A | **EXCLUDE** product; REFERENCE_ARCH |

### Cross-repo patterns (audit VERIFIED)

1. Convergence: 3D causal VAE + DiT/MMDiT + flow + T5/umT5/MLLM.  
2. Control layer wins products: VACE / IC-LoRA / AnimateDiff-ControlNet — HVS should own L2–L3.  
3. VAE leverage: Wan VAE reused by Cosmos Predict2.5.  
4. Memory engineering first-class: FP8, xDiT, offload, tiling, distill.  
5. Licenses heterogeneous — diligence before commercial ship.

### Component donor cheat-sheet

| Subsystem | Best donors | Action |
|-----------|-------------|--------|
| VAE | Wan, Hunyuan, LTX | USE → later TRAIN L5 |
| DiT | Wan 1.3B/14B, LTX, Hunyuan, Cog | USE small; FT; later TRAIN |
| Text | umT5, T5, MLLM | USE; REPLACE prompt path with Compiler |
| Control | VACE, IC-LoRA, CameraCtrl, Fun Control | ADAPT heavily |
| Scheduler | Flow-Match / RF | USE |
| Train pipeline | Open-Sora, Cog finetune, LTX trainer | ADAPT → L7 |
| Safety / PE | — | **REPLACE** with HVS |

---

## §24 — Proprietary model verified + reasoned architecture table

| PROVIDER | PRODUCT | VERIFIED architecture facts | UNDISCLOSED | Inference class | HVS FIT |
|----------|---------|----------------------------|-------------|-----------------|---------|
| OpenAI | Sora / Videos API | Diffusion transformer on spacetime patches of compressed latents; compression net + decoder; recaption; GPT expand | Ratios, depth, params, sampler | DiT-patch family VERIFIED; details UNKNOWN | **EXCLUDE** durable; REFERENCE_ARCH; API sunset context |
| Google | Veo 3/3.1 | Latent diffusion; **separate audio & video AEs**; transformer denoiser; Gemini captions; SynthID | Exact AE ratios; “DiT” by name; text encoder id | STRONGLY_INFERRED DiT/MMDiT-class joint A/V | **CALL_PROVIDER** primary AV |
| Kuaishou | Kling | Launch IR: **DiT + 3D VAE + full ST attn** | Later SKU deltas, encoder | Continuity STRONGLY_INFERRED DiT family | **CALL_PROVIDER**; camera API VERIFIED |
| Kuaishou | Kling Omni/O1 | MVL; MLLM PE; Omni-Generator; Multimodal SR; DiT↔VLM aligned | Layer counts | DiT + PE/SR shells PLAUSIBLE | CALL_PROVIDER unified edit |
| ByteDance | Seedance 1.0 | Causal VAE (4,16,16) C=48; decoupled ST DiT; MMDiT; MM-RoPE; **flow matching**; cascade refiner; PE **Qwen2.5-14B**; RLHF; distill | Absolute param count | Paper = strongest public commercial blueprint | CALL_PROVIDER + **REFERENCE_ARCH** curriculum |
| Luma | Ray2 | “Multi-modal”; 10× compute vs Ray1.6; trained on video; keyframes/extend API | DiT/VAE/encoder | STRONGLY_INFERRED DiT-family (weaker than Kling) | CALL_PROVIDER keyframes |
| Runway | Gen-3/4/4.5/Aleph | Joint image+video train; dense captions; Motion Brush/camera/Director; refs; delivery formats | Core denoiser family | STRONGLY_INFERRED latent DiT/hybrid | CALL_PROVIDER controls/delivery |
| Pika | Offline 2.x | Product controls | Backbone | Weak–moderate DiT-family | CALL_PROVIDER |
| Pika | PikaStream1.0 | **FlashVAE** + **9B DiT** teacher→causal student; RLHF; ~24 FPS 480p | Relation to offline | Do **not** equate to offline Pika | REFERENCE_ARCH streaming |
| MiniMax | Hailuo 02 | **NCR** efficiency; ~3× params; native 1080p | Backbone family | STRONGLY_INFERRED DiT-under-NCR | CALL_PROVIDER cost lane |
| MiniMax | H3 | H3-VAE; Omni Transformer; in-context regen; stereo; ≤15s @2K; dropped Hailuo-02 arch | Full card pending | Track ADAPT_OSS when weights open | Watch |
| Alibaba | Wan 2.1 (open) | DiT + flow + Wan-VAE + umT5 | N/A open | — | **ADAPT_OSS / LOCAL / FT** |

**Mystery-box kill list:** compressed ST latent · iterative backbone (diffusion/flow DiT or AR/hybrid) · text/multimodal conditioning · temporal aggregation · Turbo efficiency layer · safety. Unknown = which variant.

---

## §25 — Training data pipeline

Canonical stage graph (VERIFIED across Movie Gen / Hunyuan / Open-Sora):

```
raw → shot split → quality filters → motion filters → dedupe/rebalance
  → duration/AR/FPS buckets → caption/re-caption/metadata
  → curriculum subsets → SFT gold
```

| Filter | Exemplars | Status |
|--------|-----------|--------|
| Shot split | PySceneDetect, TransNet v2, FFmpeg | VERIFIED |
| Aesthetic | LAION Aesthetic, Dover | VERIFIED |
| Motion | UniMatch / optical flow / VMAF | VERIFIED |
| OCR / watermark | DBNet++, YOLOX-like | VERIFIED |
| Dedupe | Copy-detection / VideoCLIP | VERIFIED |
| Concept balance | k-means + 1/√n resample | VERIFIED (Movie Gen/Hunyuan) |

Open-Sora stages (VERIFIED): WebVid → Panda aes≥4.5 → HQ with score-append. Hunyuan: hierarchical volumes ~½–⅕ each stage; ~1M human SFT. Movie Gen: 4–16s buckets; copy-detection; LLaMa3-Video captions.

**HVS:** L7-prep data factory tooling — `YES_NOW`. Scale captioning — `YES_WITH_SIGNIFICANT_TRAINING`. L8 from-scratch — `NOT_PRACTICAL_CURRENTLY` without massive data+compute. Earliest sovereign win = **dataset factory + captioner before L6 DiT**.

---

## §26 — Video captioning

| Job | Offline | Online |
|-----|---------|--------|
| Dense/structured video caption | Train labels | Rarely shown to users |
| Prompt rewrite | Optional distill pairs | Short→train distribution |

**Rich captions encode:** subjects, actions/temporal events, camera (14–16 class), lighting/atmosphere/style, shot type, optional aes/motion scores.

**Movie Gen ablation (VERIFIED):** Video captions preferred 67% vs frame-rewrite 15%; motion alignment **+10.8%** (+16.1% high-motion).

Captioner families: proprietary VLM teachers · ShareCaptioner-Video (4 modes) · finetuned video-LLM · structured JSON (Hunyuan).

**HVS VIDEO CAPTIONER** — highest leverage early win (L2–L3 → L7-prep): schema `YES_NOW`; student LoRA on open VLM `YES_WITH_FINE_TUNING`; 100M-clip re-caption `YES_WITH_SIGNIFICANT_TRAINING`. Prefer structured IR over purple prose.

---

## §27 — Training curriculum

Consensus progression (VERIFIED Movie Gen / Hunyuan / CogVideoX / SVD / Open-Sora):

```
image pretrain (low-res, multi-aspect)
  → joint image + short/low-res video
  → longer / higher-res video (+ image mix)
  → HQ / cinematic SFT
  → optional capability post-train (I2V, control, edit)
```

Axes: resolution low→high · duration short→long · motion non-trivial · multi-aspect buckets · data quality loose→strict · continuous image mix (anti-forgetting).

**Movie Gen (VERIFIED):** From-scratch joint T2I/V worse than T2I warm-up then joint — image warm-up not optional for efficiency.

**Buildability:** Curriculum design `YES_NOW`. Full execution `YES_WITH_SIGNIFICANT_TRAINING`.

---

## §28 — Joint image/video training

Motivations (VERIFIED): concept/style coverage from image-text scale; images as T=1 with causal 3D VAE; anti-forgetting; world knowledge; one foundation → T2I+T2V.

Mechanisms: same transformer; shared VAE; temporal PE expansion; batch mixing; same flow/diffusion loss.

**STRONGLY_INFERRED** for closed T2V: image+video joint or image-initialized — universal in disclosed SOTA; exact ratios **UNKNOWN**.

**HVS:** Always mix stills in L4/L7 FT data — policy `YES_NOW`. Use joint open checkpoints — `YES_WITH_OPEN_BACKBONE` / `YES_WITH_FINE_TUNING`.

---

## §29 — Control architectures

| Control | Injection | Open exemplars |
|---------|-----------|----------------|
| Pose / depth / edges | ControlNet-like / SparseCtrl / Fun Control | ControlVideo, Wan-Fun |
| Camera Plücker | CameraCtrl / T2I-Adapter-style | CameraCtrl |
| Trajectory / flow | Motion patches on DiT | MotionCtrl, Tora |
| Identity / character | IP-Adapter-class sheets | **Face-ID REJECT** for biometric |
| Style / ref image | Decoupled cross-attn | IP-Adapter |
| Ref video / mask / V2V | VACE condition unit | Wan VACE |
| Scores in text | Prompt append | Open-Sora |

Design space: full ControlNet clone · SparseCtrl · T2I-Adapter · Tora patches · unified VACE · training-free ControlVideo.

**HVS stack:** L2 schema `pose|depth|edge|camera|traj|ref|mask` — `YES_NOW`. L3 VACE/Fun/CameraCtrl — `YES_WITH_OPEN_BACKBONE`. Fastest path: **VACE + Fun-Control on Wan** before custom CN.

---

## §30 — Inpainting / outpainting

| Task | Need |
|------|------|
| Region inpaint | Spatial (±temporal) mask |
| Background replace | Inverse mask |
| Spatial outpaint | Expand canvas |
| Temporal extension | Future/past masked |
| Instruction edit | Text + optional mask (Movie Gen Edit class) |

Architecture deltas: mask/masked latent channels · context encoder · per-token timesteps · flow-guided prior (ProPainter) · temporal MultiDiffusion · unified VACE.

**Buildability:** Masked V2V via VACE — `YES_WITH_OPEN_BACKBONE`. Own inpaint DiT — `YES_WITH_SIGNIFICANT_TRAINING`. Movie Gen–class instruction edit without pairs — `RESEARCH_REQUIRED`. Fastest: **VACE on Wan** as L3 editor.

---

## §31 — Long-video techniques

Why short-form dominates: O(n²) tokens · train clip statistics 4–16s · memory · drift · product UX <20s. Movie Gen native max **16s** class (**VERIFIED**). Infinite demos usually = extension tricks.

| Class | Exemplars | Tradeoff |
|-------|-----------|----------|
| Native long context | Movie Gen 16s | Expensive |
| Sliding / chunked | StreamingT2V | Seam/drift |
| Latent continuation | I2V-as-extend | Subject drift |
| FIFO diagonal denoise | FIFO-Diffusion | Train-infer gap |
| FreeNoise | FreeNoise | Can look static |
| AR chunks | StreamingT2V; §32 | Compounding error |
| Hierarchical storyboard | Production pipelines | Not one model — **HVS preferred** |

**HVS stance:** ≤ native length single shot · 30–120s narrative = **Prompt Compiler shot list → N clips → stitch** (`YES_NOW` L1–L2) · true single-pass long = experiments (`YES_WITH_OPEN_BACKBONE` quality caveat) · sovereign long foundation = `YES_WITH_SIGNIFICANT_TRAINING` / `RESEARCH_REQUIRED`.

---

## §32 — Autoregressive video

**Rule:** Do not assume diffusion-only future.

| Family | Exemplars | Status |
|--------|-----------|--------|
| Discrete AR LM | VideoPoet, Emu3, Phenaki | VERIFIED |
| Masked generative | MAGVIT | VERIFIED |
| Continuous AR (no VQ) | NOVA | VERIFIED |
| Hybrid AR + diffusion | Transfusion-class (image); video PARTIAL | PLAUSIBLE endgame |
| World-model AR | Cosmos discrete tokenizers | VERIFIED platform |

| Axis | DiT/flow | AR |
|------|----------|-----|
| Sampling | Iterative | Sequential |
| Extensibility | Hard without tricks | Natural variable length |
| Quality SOTA cinematic 2024–25 | **Leads** | Competitive/improving |
| LLM stack overlap | Medium | High |

**HVS:** Near-term product T2V stay on **DiT/flow** (Wan/Hunyuan/Cog/LTX). Parallel AR/NOVA/Cosmos skunkworks for long/interactive — dual-track, not either/or.

---

## §33 — World models

| Sense | Meaning | Example |
|-------|---------|---------|
| A. Rhetoric | T2V as “world simulator” framing | Sora blog |
| B. Video prediction | Future frames (± action) | Cosmos Predict |
| C. Interactive WM | Action-conditioned realtime | Genie, Oasis, GameNGen |
| D. MBRL WM | Dynamics for agents | DIAMOND, Dreamer |

**Do not** equate Sora-class T2V APIs with Genie-class interactive simulators without evidence.

**HVS recommendation:** Keep **inside** creative suite near-term: physics/consistency evals, camera/traj control, hierarchical longform. **Separate sister program:** interactive/action-conditioned WM (Cosmos/Genie-class). Do not block L3–L4 creative shipping on WM research. PLAUSIBLE future L8 merge — evidence not here yet.

**Buildability:** Interactive WM product — `RESEARCH_REQUIRED` / `NOT_PRACTICAL_CURRENTLY` for creative roadmap. Prediction experiments — `YES_WITH_OPEN_BACKBONE` if terms allow later (**no downloads this mission**).

---

## §34 — HVS generation request contract

**Proposed:** `HvsVideoGenerationRequest` — provider-neutral IR for Router, Compiler, local runners, QC.

**Buildability:** `YES_NOW` (schema only — no video weights). Ladder **L1–L2**.

### Field catalog (proposal)

| Field | Req? | Purpose |
|-------|------|---------|
| `requestId` | yes | Idempotency / audit |
| `commanderIntent` | yes | **Immutable** short intent; diff-checked vs expansions |
| `prompt` / `structuredPrompt` | yes* | Working prompt / Compiler IR |
| `negativePrompt` | no | If backend supports |
| `durationSec`, `resolution`, `aspectRatio`, `fps` | yes | Geometry; Router clamps to capability |
| `seed` | no | Where exposed |
| `sourceImage` / `sourceVideo` / `firstFrame` / `lastFrame` | no | I2V / V2V / FLF |
| `characterRefs[]` / `objectRefs[]` / `styleRefs[]` | no | **Non-biometric** sheets; rights + consent for real persons |
| `cameraSpec` / `motionSpec` | no | CameraIR / MotionIR |
| `depthRef` / `poseRef` / `segmentationRef` | no | Control maps |
| `audioIntent` | no | native/silent/post — **not** Wav2Lip NC |
| `qualityTier` | yes | draft \| standard \| hero |
| `privacyPolicy` | yes | local_only \| provider_ok \| redacted |
| `costLimit` | yes | Hard stop; fail closed |
| `preferredBackends[]` / `excludeBackends[]` | no | Soft prefs; hard excludes (`openai_videos` always) |
| `capabilityRequirements` | no | Route by need (§35) |
| `editMode` / `extensionOf` | no | generate/inpaint/outpaint/extend/restyle/v2v |
| `safetyProfile` | yes | Face-ID reject, consent, IP gates |
| `watermarkPolicy` / `outputFormat` | no | SynthID/C2PA; mp4/prores/… |
| `metadata` | no | Shot/episode; optional `wrimPlanId` **reference only** |

**OpenAI Videos / Sora:** EXCLUDE from product mapping.

---

## §35 — Model capability descriptor

**Proposed:** `HvsVideoModelCapability` — machine-readable SKU registry so Router selects by **need**, not brand mythology.

Key fields: `modelId`, `provider`, booleans for t2v/i2v/v2v/first/last/refs, `characterConsistency` enum (**never** imply Face-ID biometric), camera/depth/pose/motion control enums, audio/nativeAudio, inpaint/outpaint/extension, `maxDurationSec`, `maxResolution`, aspects, fps, `local`, `license`, `commercialOk`, `costClass`, `vramPublishedGb` (**UNKNOWN** if unmeasured), `acsExcluded`, notes.

### Example rows (published / API-visible only)

| modelId | Highlights | VRAM pub | Notes |
|---------|------------|----------|-------|
| wan2.1-t2v-1.3b | T2V local Apache | **8.19 GB VERIFIED** | Top LOCAL draft |
| wan2.1-i2v/vace-14b | I2V / edit control | UNKNOWN single-GPU peak | Offload/multi-GPU |
| ltx distilled/fp8 | Speed + IC-LoRA | Exact GB UNKNOWN; low-VRAM design | Iteration LOCAL |
| hunyuanvideo-13b | Quality open | **45–60 GB VERIFIED** | License review |
| runway:gen4.5 / aleph2 | Controls + delivery | N/A | Arch UNDISCLOSED |
| kling:t2v | Camera API-visible | N/A | DiT+3D VAE at launch VERIFIED |
| veo:3.1 | Native AV + extend | N/A | CALL_PROVIDER hero AV |
| openai:sora / videos | — | — | **acsExcluded=true** |

---

## §36 — HVS Prompt Compiler

**Recommendation: YES — own provider-neutral expansion at L2.**

Flow: Commander short intent → locked `commanderIntent` → structured IR → per-backend compile **without silently changing intent** → provenance (original / structured / per-backend / diff).

### Structured IR slots

`SUBJECTS | SCENE | SHOT | CAMERA | MOTION | LIGHTING | PHYSICS | CONTINUITY | AUDIO | NEGATIVE`

### Guardrails (mandatory)

1. Immutable commanderIntent  
2. Diff reject: added characters, era change, invented logos/IP, storyboard contradictions  
3. No silent Master-mode upgrades — cinematic enrichment opt-in (`qualityTier=hero`)  
4. Provider compile is mechanical — map slots→vendor grammar; do not re-author  
5. Face-ID / real-person: require consent receipts; never invent identity  
6. Show expansion before spend when cost mid/high  

### Precedents (VERIFIED)

Hunyuan structured JSON + Prompt Rewrite · Movie Gen LLaMa3 rewrite (+8B distill) · DALL·E 3 upsample · ShareGPT4Video · Open-Sora score append · Wan Qwen extend · Seedance Qwen2.5 PE + DPO (REFERENCE_ARCH) · Kling-Omni PE (existence proof)

| Piece | Buildability |
|-------|--------------|
| LLM schema rewrite + diff gate | YES_NOW |
| Dedicated rewrite LoRA | YES_WITH_FINE_TUNING |
| Grounded PHYSICS/CONTINUITY vs shot graph | RESEARCH_REQUIRED |

**Fastest sovereign path:** L2 compiler **before** L4 backbone FT.

---

## §37 — Local feasibility

**Rule:** Published figures only. **Nebula = UNKNOWN** (not measured; not invented).

| Model | Published VRAM / notes | Local feas. (generic) |
|-------|------------------------|------------------------|
| Wan 2.1 T2V-1.3B | **8.19 GB**; ~4 min / 5s 480P on 4090 w/o quant (README) | **High** |
| Wan 14B class | Offload / multi-GPU; single-GPU peak UNKNOWN official | Medium; Nebula fit UNKNOWN |
| HunyuanVideo ~13B | **60GB** / **45GB** peaks; 80GB recommended | Low–Medium without multi-GPU/FP8 |
| LTX 2B distilled/FP8 | Designed low-VRAM; community ~8GB-class PARTIAL | **High** for iteration |
| LTX 13B distilled | H100 “HD in ~10s” claim; exact GB UNKNOWN | Medium–High if VRAM allows |
| CogVideoX-2B / 5B | 5B ~11–33GB by offload tier | High / Medium |
| Mochi 10B | ~60GB official | Medium |
| AnimateDiff / SVD | Consumer 8–24GB class PARTIAL | Very High for animatics — not SOTA T2V |

**Day-one LOCAL candidates without Nebula numbers:** Wan 1.3B + LTX distilled/FP8. Hold 14B/Hunyuan/Mochi until **measured** inventory. Do **not** schedule Builds off invented VRAM.

---

## §38 — Sovereign HVS model options

| Strategy | What | Buildability | When |
|----------|------|--------------|------|
| **A. From scratch** | Own VAE+DiT+data | NOT_PRACTICAL_CURRENTLY / multi-year SIGNIFICANT_TRAINING | L8 aspiration |
| **B. Fine-tune open** | Full/partial FT Wan/LTX/Hunyuan/Cog | YES_WITH_FINE_TUNING | L4 after HW+data |
| **C. Adapter / LoRA** | Control/style/camera/character LoRAs; VACE specialists | YES_WITH_OPEN_BACKBONE / YES_WITH_FINE_TUNING | **L3 first** |
| **D. Distill** | Teacher→student latency | YES_WITH_SIGNIFICANT_TRAINING | After L4 quality bar |

### Subsystem ownership map

| Subsystem | Near-term | Ladder |
|-----------|-----------|--------|
| VAE | USE Wan/Hunyuan causal 3D | L5 later TRAIN |
| DiT / Flow | USE Wan/LTX/Hunyuan; FT domain | L4→L6 |
| Text encoder | USE frozen umT5/T5; REPLACE prompt path with Compiler | L2–L4 |
| Camera / motion | Prompt slots now; adapters later | L2→L3 |
| Character | Sheet refs; **Face-ID REJECT** | L3 |
| Audio | CALL_PROVIDER native AV short-term; AudioGraph + V2A | L1→L6 |
| Prompt Compiler | **OWN now** | **L2** |
| Safety / rights | **OWN now** | L1–L2 |
| Train / data pipelines | ADAPT Open-Sora/LTX-Trainer patterns | L7 |

### Realistic progression

| Stage | Horizon | Exit |
|-------|---------|------|
| L1 | Day-one | Multi-provider generate with one IR; Sora exclude |
| L2 | Day-one→90d | Intent-locked Compiler; provider compiles |
| L3 | 90d–6mo | LoRA/VACE/IC-LoRA on Apache Wan (+ LTX) |
| L4 | ~6–12mo | Domain FT; measured Nebula; curated data |
| L5 | Year-2+ | Own causal video VAE research |
| L6 | Year-2–3 | Own DiT/flow init |
| L7 | Parallel from L4 | Captioners, rewards, distill factory, evals |
| L8 | Multi-year | Joint AV foundation — capital + data + safety org |

**Day-one:** L1–L2 (+ L3 spike). **Year-two:** L4 solid, L5 research — **not** L8.

---

## §39 — WRIM / HVS boundary

**DO NOT MODIFY WRIM. DO NOT AUTHORIZE WRIM TRAINING. DO NOT COMMIT TO WRIM REPOS.**

| Layer | Owner | Role |
|-------|-------|------|
| WRIM / planning | WRIM | Scene reasoning, shot lists, continuity plans, QC rubrics; may **draft** slots |
| HVS Prompt Compiler | HVS | Intent lock, schema validation, provider compile, spend gates — may **consume** WRIM plans |
| HVS Gen Router + models | HVS | Synthesis; never blocked on WRIM weights |
| Graphics / destruction | Separate ACS lane | **Not** HVS generative video |

**Boundary rule:** WRIM may **propose**; HVS **owns** generation contracts, safety/rights, cost, backend binding. WRIM enters as `metadata.wrimPlanId` + optional suggested structured prompt that still passes Commander intent fidelity.

WRIM must **not** become: video DiT/VAE owner · Face-ID/consent bypass · training target under this research mission.

Integration: metadata handshake `YES_NOW` (sketch). Tight closed-loop QC `RESEARCH_REQUIRED`. **No WRIM code changes in this report.**

---

## §40 — Recommended HVS architecture

### Options

| Opt | Name | Summary |
|-----|------|---------|
| **A** | PROVIDER-ONLY | All pixels from Veo/Kling/Runway/Luma/Hailuo/… |
| **B** | LOCAL OPEN ONLY | Only Wan/LTX/Hunyuan/… on owned GPUs |
| **C** | HYBRID LOCAL + PROVIDER | One IR; Router picks local vs provider by capability/privacy/cost |
| **D** | OWN FINE-TUNED VIDEO MODEL | L4 on open backbone (+ L3 adapters) |
| **E** | FUTURE FROM-SCRATCH | L5–L8 sovereign foundation |

### Tradeoffs

| Opt | Pros | Cons | Now |
|-----|------|------|-----|
| A | Fastest quality/AV; no VRAM risk | Vendor churn (Sora lesson); privacy; margin | YES_NOW but fragile alone |
| B | Privacy; Apache Wan path | Quality gap; Nebula UNKNOWN; ops | YES_NOW only for light SKUs |
| **C** | Best risk hedge; privacy tiers; cost limits | Router complexity; dual QC | **YES_NOW recommended** |
| D | Brand motion/look ownership | Needs data + measured HW + license diligence | YES_WITH_FINE_TUNING after inventory |
| E | Full sovereignty | Capital, data, safety org; years | NOT_PRACTICAL_CURRENTLY as day-one |

### Decision

**Letter: C (HYBRID)** as architecture class.  
**Progression: C → D → partial E** (not full E unless funded).

| Phase | Ladder | Architecture |
|-------|--------|--------------|
| **Day-one** | **L1–L2** (+ L3 spike) | **C**: providers for hero/AV/controls; local opt-in Wan-1.3B / LTX distilled for draft/privacy; §§34–36 live; **Sora EXCLUDE** |
| **Year-one** | L3→**L4** | **C+D**: adapters + domain FT on Apache Wan (primary) / LTX controls; Hunyuan after license review |
| **Year-two** | L4 solid; **L5 research**; selective L6 | **partial E**: own VAE experiments; optional DiT continued pretrain — **not** claim foundation parity |
| **Later** | L7–L8 | Full E only with dedicated capital |

### Provider day-one mix (non-exclusive)

- **Veo** — native audio + extend quality  
- **Kling** — motion / camera API-visible / value  
- **Runway** — controls + delivery formats  
- **Luma / Hailuo** — keyframes / cost lanes  
- **Seedance** — REFERENCE_ARCH curriculum + CALL when available  
- **Never durable:** OpenAI Videos / Sora product  

### Local day-one mix

- **Wan 2.1 1.3B** — published 8.19 GB  
- **LTX distilled/FP8** — speed + IC-LoRA path  
- Hold 14B/Hunyuan until Nebula measured  

### Why not A/B/D/E alone

- **A alone** repeats Sora-dependence failure.  
- **B alone** Nebula UNKNOWN + quality gap.  
- **D alone** premature without IR/Compiler/data/HW.  
- **E alone** fantasy schedule; violates research honesty.

### Must exist for C

IR (§34) · capability registry (§35) · Compiler (§36) · Router · safety/rights · dual local/provider paths · Continuity/Camera/Motion schemas · spend gates.

---

## FINAL STACKS / DECISION

| Item | Value |
|------|-------|
| **Architecture letter** | **C HYBRID** |
| **Progression** | **C → D → partial E** |
| **Day-one ladder** | **L1–L2** (L3 spike) |
| **Year-two ladder** | **L4** (+ L5 research) |
| **Primary local backbone** | Wan 2.1 1.3B (Apache) + LTX distilled |
| **Primary provider heroes** | Veo (AV) · Kling (motion/camera) · Runway (controls) · Luma (keyframes) |
| **REFERENCE_ARCH papers** | Seedance 1.0 · Movie Gen · Wan · Hunyuan · Kling IR · Sora public report (only) |
| **Earliest HVS-native wins** | Prompt Compiler · Request/Capability contracts · Video Captioner + data factory (L7-prep) · VACE/CameraCtrl adapters |
| **Audio** | Separate AudioGraph + optional V2A; provider native AV when needed |
| **Long-form** | Hierarchical stitch ≫ native minute DiT |
| **Physics** | PRIOR vs SIM labeled; Graphics sim → condition video |
| **Sora** | **EXCLUDE** |
| **Face-ID** | **REJECT** |
| **Nebula VRAM** | **UNKNOWN** |
| **WRIM** | **untouched** |
| **STATUS** | **PARTIAL** |
| **IMPLEMENTATION** | **NOT AUTHORIZED** · Builds **HOLD** |

### First slices (HOLD — not executed)

1. `HVS-ACS-01_PROMPT_PLAN_ROUTER_KERNEL` (ACS parent HOLD)  
2. Optional: `HVS-VIDARCH-01_REQUEST_CAPABILITY_COMPILER_CONTRACTS`  

---

## Gaps / UNKNOWN register

1. Nebula GPU/VRAM/latency — **UNKNOWN**  
2. Exact proprietary VAE ratios, text encoders (most closed), PE, distill recipes — **UNKNOWN** / TEXT_ENCODER_UNDISCLOSED  
3. Whether closed models use explicit memory for permanence — **UNKNOWN**  
4. Hunyuan / LTX / CogVideoX-5B commercial license edge cases — **PARTIAL** (legal review)  
5. Kling official OpenAPI vs mirrors — re-pin before production bind  
6. Optimal HVS image:video mix — empirically UNKNOWN until FT sweeps  
7. Interactive world-model product readiness — RESEARCH_REQUIRED  
8. Step-Video pinned card — PARTIAL  

---

## Source wave index

| Wave | Path | Scope |
|------|------|-------|
| A | `waves/WAVE_A_LATENT_PATCH_DIT_FLOW.md` | §§1–5 core (latent/patch/DiT/flow) |
| B | `waves/WAVE_B_CONDITIONING_TEMPORAL_MOTION.md` | §§6–13 conditioning |
| C | `waves/WAVE_C_3D_PHYSICS_AV_EFFICIENCY.md` | §§14–22 efficiency cluster |
| D | `waves/WAVE_D_OPEN_MODEL_FAMILIES.md` | §23 open |
| E | `waves/WAVE_E_PROPRIETARY_REASONED.md` | §24 proprietary |
| F | `waves/WAVE_F_TRAINING_LONG_AR_WORLD.md` | §§25–33 training/long/AR/world |
| G | `waves/WAVE_G_HVS_CONTRACTS_SOVEREIGN.md` | §§34–40 HVS decision |
| Audit | `audits/OPEN_REPO_AUDIT_NOTES.md` | Repo structure traces |
| Rule | `RESEARCH_RULE_REASONED_INFERENCE.md` | Claim/buildability/ladder |
| URLs | `sources/WAVE_*_URLS.md` | Primary URL indexes |

---

**END REPORT** · RESEARCH ONLY · 2026-09-22 EDT · **Recommend C HYBRID** · **L1–L2 day-one** · **IMPLEMENTATION NOT AUTHORIZED**
