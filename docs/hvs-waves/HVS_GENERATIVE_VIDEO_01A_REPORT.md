# HVS-GENERATIVE-VIDEO-01A — Live Wan 2.2 TI2V-5B proof on 16 GB (RTX 5060 Ti)

Date: 2026-10-02 (all times ET). Host: Nebula-Genesis. Repo: `war-room-os` @ `a39c9e28` on branch `live-council-intelligence-repair` (dirty worktree preserved; nothing committed).
Evidence dir: `~/.local/share/war-room-os/hvs-generative-video-01a/`.

**Summary:** Install, discovery, the typed job path, the supervisor, offline guards, failure receipts and cleanup all worked live. Real Wan inference loaded the model twice and reached sampling step 0/50 both times. Both times the worker itself ran out of VRAM (typed `GPU_OUT_OF_MEMORY`): first at 49 frames, then on the single reduced-memory retry at 25 frames. There was no Ollama model in VRAM at either failure, so these are genuine 16 GB limits and I made no further attempt. No mp4 was produced.

## Results (62 items)

### Install and runtime
1. **Wan install:** PASS. `scripts/hvs/install-wan22.sh` installed to the Seagate drive (ntfs3 `/dev/sda2`, rw), protected by the new `--require-mount` guard (tested: refusing `/` exits with code 3).
2. **Model path:** `/run/media/chosenone/Seagate/hvs-models/Wan2.2-TI2V-5B`. realpath and findmnt confirm it is on Seagate, not a symlink.
3. **Weights:** Wan-AI/Wan2.2-TI2V-5B at HF revision `921dbaf3f1674a56f47e83fb80a34bac8a8f203e` (main), license apache-2.0, not gated. Downloaded 16:56 → 17:47:49 (about 51 min, about 10–11 MiB/s), exit 0. 31.85 GiB.
4. **Download fix:** hf_xet buffered shards in RAM (0-byte `.incomplete` files, RSS climbing), so I killed my own first download and restarted with `HF_HUB_DISABLE_XET=1` and `max_workers=4`.
5. **Runtime env:** `runtimes/wan22/venv`. Python 3.12.14 (uv-managed), torch 2.13.0+cu130 (CUDA 13.0, cuDNN 92000, sm_120 present), diffusers 0.33.1, transformers 4.51.3, numpy 1.26.4. No dashscope.
6. **Code:** Wan2.2 @ `1ea34ff4` (`HVS_CODE_COMMIT`). The official import fails on `decord`; the worker stubs the unused S2V/Animate pipelines ("ti2v-only"). Import takes about 20 s.
7. **flash-attn:** FAILED after one bounded attempt (about 1 min). glibc `mathcalls.h` rsqrt/rsqrtf exception-spec conflicts with CUDA 13.1 `math_functions.h`.
8. **Attention backend:** torch SDPA through the official `attention()` fallback branch.
9. **SDPA fallback:** YES, UNOFFICIAL (`HVS_WAN22_ALLOW_SDPA_FALLBACK=1`). The SDPA branch ignores padding masks, so cross-attention to padded T5 context is unmasked. Upstream warns: "Padding mask is disabled when using scaled_dot_product_attention".
10. **Install manifest:** `hvs-install-manifest.json` records hfRevision and license.
11. **Installer cache confinement:** `HF_HUB_CACHE`, `PIP_CACHE_DIR`, `XDG_CACHE_HOME` and `TMPDIR` all point under the models dir. uv uses `--python-preference only-managed`.

### Sizes and disk
12. **Seagate install sizes:**

    | Item | Bytes |
    |---|---|
    | Model | 34,201,538,845 |
    | venv | 5,219,958,879 |
    | Code | 9,595,453 |
    | `.uv-cache` | 5,399,008,937 |
    | `.uv-python` | 103,157,342 |
    | `.hf-home` | 318,195 |
    | **Total (`du -sb hvs-models`)** | **44,933,577,651 (≈ 44.93 GB)** |

13. **Seagate free:** 7.78 TB before; 7,737,005,543,424 B after.
14. **Root `/` free:** 35.06 GB before, 27.85 GB now. Most of the drop came from Turbopack `.next/dev` during my `pnpm run dev`: `.next` is now 33,085,837,383 B (about 26 GB before). Not deleted (no cleanup authorization). The Commander may want to prune `.next/dev`.

### Discovery and status
15. **Model discovery:** INSTALLED. Weights, runtime and code all true; missing=[], mismatch=[]; present = required = 34,201,521,169 B.
16. **Discovery metadata:** modelVersion `921dbaf3…` (source: hvs-install-manifest); license apache-2.0 (readme-front-matter); config class WanModel, diffusers 0.33.0, model_type ti2v.
17. **Pre-run status (18:05:24):** modelStatusLine `WAN 2.2 READY`, install `MODEL INSTALLED`, admission `GPU ADMISSION READY`, 14262/16311 MiB free (min 14000), compat `UNTESTED_BELOW_OFFICIAL_24GB`.
18. **Status split:** install state and GPU admission are now separate lines (`modelInstallLineFor` / `gpuAdmissionLineFor`; panel testids `hvs-generate-install-status` and `hvs-generate-gpu-admission`).

### Ollama contention
19. **VRAM before:** 11685 used / 4157 free MiB (Ollama `huihui_ai/qwen3-abliterated:14b` loaded, about 9.9 GB).
20. **Ollama unloaded for the test:** YES.
    - UNLOAD at 17:48:40. Reloaded within seconds by Foundry child mission pid 436113 (`foundry-run-child-mission.ts 396a24fb…`, driver `tmp/foundry-phase8/p8j.ts` r41).
    - UNLOAD2 at 18:05:06.
    - UNLOAD3 at 18:19:15 (by the Commander).
    - `ollama-guard.sh` re-stopped the model 37 times between 18:23:45 and 18:39:24.
    - Final `ollama stop` / check at 18:46:24.
21. **VRAM after the Ollama unload:** 1578 used / 14264 free MiB (18:05:06). Admission saw 14262 free.
22. **Reload client identified.** All reloads came from Foundry Phase-8 child missions (`node … scripts/foundry-run-child-mission.ts <missionId>`, parent `/bin/sh … foundry-job` wrapper, driver `tmp/foundry-phase8/p8j.ts`):
    - pid 538816, mission `66510bd4-9049-4725-94e5-1e3f68493c2a` (12 guard re-stops);
    - pid 549712, mission `b96528e0-2f8d-4144-bdbc-202d0c84416e` (13), under a new `timeout 7000 … p8j.ts` started 18:32;
    - pid 557662, same mission `b96528e0…` (12).

    The 18:17:05 reload matches this pattern (journal sequence /api/tags → /api/version → POST /api/generate from 127.0.0.1). The daemon and the clients were never killed. The repeated re-stops probably disrupted those Foundry missions' LLM calls; the Commander should check the Phase-8 r4x outcomes.
23. **Contention at failure time:** none. The OOM messages list only GPU processes 7942 (ptyxis, 33 MiB), 189104 (chrome, 90 MiB), 439511 (brave, 136 MiB) and the worker itself — no llama-server.
    - The guard log has no events 18:19:40–18:23:45 (attempt 1 OOM at about 18:21:47) or 18:37:59–18:39:04 (attempt 2 OOM at about 18:38:38).
    - VRAM was flat at 4345 MiB (desktop plus worker) right before each sampling start.
24. **Ollama final state:** UNLOADED (`ollama ps` empty at 18:46:24). The guard is stopped. No p8j/Foundry child process is running now. A future Foundry run will reload the model on demand.

### Live run
25. **Live run path:** a driver outside the repo calls the same typed op the route uses, `submitGenerateVideo` (`hvs.generate.video`), against the real data root with no test hooks. Project `hvs-muriho11-3zrp`, generation `gen-muriho1a-ua8fjbcw`, job `hjob-muriho1b-55fafedp`.
26. **Prompt:** "cinematic nighttime city street, wet pavement reflections, slow controlled camera movement, premium film lighting, no text, no logos". promptHash `68f4f901…74821`. Seed 42.
27. **Requested settings:** 1280×704, 24 fps, 49 frames (2.042 s), 50 steps, OFFICIAL_LOW_MEMORY (offload_model, t5_cpu, convert_model_dtype).
28. **Actual settings (final attempt):** 1280×704, 24 fps, 25 frames (1.042 s), 50 steps, REDUCED_MEMORY_RETRY (same offload flags plus `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`).
29. **Model load:** PASS, twice.
    - Attempt 1: 18:05:25 → 18:21:08 (15 min 43 s).
    - Attempt 2: 18:21:48 → 18:38:01 (16 min 13 s; checkpoint shards took 9 min 19 s).
    - Host-RAM bound: USB HDD reads, 31 GB RAM, 8 GB swap fully used, worker RSS up to about 23 GB including mmap pages, D-state IO-wait.
30. **Real Wan inference:** STARTED, NOT COMPLETED. Both attempts entered GENERATING and reached step 0/50, then hit OOM before step 1.
31. **Attempt 1 error:** `GPU_OUT_OF_MEMORY`. The retry path in `jobs.ts:468` runs only on that code. VRAM went 4523 → 15195 MiB within about 10 s of sampling start.
32. **Attempt 2 error (final, typed):** `GPU_OUT_OF_MEMORY` — "CUDA out of memory during sampling … Tried to allocate 74.00 MiB. GPU 0 has a total capacity of 15.47 GiB of which 117.69 MiB is free … this process has 13.7x GiB …". It logged expandable_segments mapping failures at 18:38:37–38.
33. **Measured peak VRAM:** device total 15731 MiB at 18:38:36 (attempt 2) and 15195 MiB at 18:21:28 (attempt 1). That is about 15.4 GB for the worker. The worker-sampled receipt `peakVramMiB` is 13910.
34. **VRAM during load:** the worker held about 2.9 GB during load (T5 on CPU). The DiT move to GPU at sampling start took usage from about 4.3 to about 14.0 GB; activations exhausted the rest.
35. **Phase times:**
    - QUEUED 18:05:24.4
    - LOADING_MODEL (final attempt, worker spawned) 18:22:12.6
    - GENERATING 18:38:00.9
    - FAILED 18:39:00.3
    - Total 2,015,919 ms (33 min 36 s). No encode or ingest phases were reached.
36. **Additional attempt:** NOT made. Both failures were the worker's own VRAM exhaustion with no Ollama model resident, not reload contention.
37. **Driver exit:** `LIVE_EXIT=1` at 18:39:00, within the `timeout 5400` budget.
38. **Failure receipt:** `projects/hvs-muriho11-3zrp/generations/gen-muriho1a-ua8fjbcw/receipt.json` (4262 B). It records status FAILED, errorCode GPU_OUT_OF_MEMORY, attempts 2, requested/actual, modelVersion, localGeneration true, liveGeneration false, fixture false, network none, gpu info and a bounded worker log tail.
39. **Job record:** `jobs/hvs-muriho11-3zrp/hjob-muriho1b-55fafedp.json`. status FAILED, typed error, authority spend/externalUpload/sensitiveTransfer all false.

### Output, ingest and UI
40. **Live video:** NONE (no mp4 produced).
41. **ffprobe:** NOT APPLICABLE (no output).
42. **Live ingest:** NOT REACHED.
43. **Live AssetRecord:** NONE (outputAssetId null).
44. **Live provenance:** failure receipt only. A LIVE asset provenance (liveMarker LIVE) cannot exist without output.
45. **Live Source monitor:** NOT REACHED (selectedAssetId null).
46. **Auto timeline insert:** NO. Timeline clips 0 → 0.
47. **Live UI:** BLOCKED — Commander sign-in required. The local Commander must sign in at http://127.0.0.1:3001/login (POST `/api/sovereign/local-auth/login` sets `wr_local_session`), then open HVS Create → GENERATE VIDEO. Local auth status: bootstrapped=true, authenticated=false. No screenshots were taken.
48. **Route auth hardening:** `app/api/media-command/generate-video/route.ts` now calls `requireCommanderSession` in both GET and POST. Before the fix, a forged cookie got HTTP 200 on GET; after it, GET and POST return 401. Unauthenticated GET/POST → 401; `/login` → 200. Evidence: `route-auth-proof.log`.

### Locality and safety
49. **Local only:** YES. The worker env sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`, and an in-process socket guard allows loopback/AF_UNIX only. Receipt network = none.
50. **Cloud fallback:** NONE.
51. **Grok runtime dependency:** NONE. No cloud, xAI or paid API in the path.
52. **Worker cleanup:** PASS. No `wan22_worker` or driver processes remain, and none of the zombies are mine (a pre-existing `sd_espeak-ng-mb <defunct>` from 15:52 is unrelated). VRAM is back to 1430 used / 14412 free MiB (desktop apps only).
53. **Host OOM safety:** the worker sets `oom_score_adj=1000`. The host OOM killer never fired, despite full swap.

### Code changes and validation
54. **01A code changes** (pre-edit copies in `pre-edit-copies/`):
    - `wan22_worker.py`: bf16 direct DiT load and mmap `torch.load`; opt-out `HVS_WAN22_OFFICIAL_HOST_LOAD=1`.
    - `types.ts`, `supervisor.ts`, `jobs.ts`: phaseTimes, liveMarker, worker info, peakVram, install/admission lines.
    - `providers/wan22.ts`: reduced-memory step 49 → 25.
    - `HvsGenerateVideoPanel.tsx`, `route.ts` (auth), and the validator (checks 12/16/21/25).
    - Installer edits are listed in items 1, 4 and 11.
55. **Focused validation:** 30/30 PASS at 18:40:55 (`focused-validator-3.log`). The first post-run attempt at 18:40:24 was 29/30: check 10_timeout had groupGone=false. The process-group liveness probe ran right after SIGKILL while the system was still recovering (6.3 GB swap, load avg about 7). I did not touch the supervisor kill path; the immediate re-run passed. Treat it as a transient flake under load.
56. **Full HVS validation:** BASELINE_PRESERVED.
    - `pnpm run validate:hvs` exits 1 at the same pre-existing "The camera disconnected." step.
    - The per-step run `steps-after01a2.tsv` is 66/68. The only failures are the same two pre-existing camera steps (`hvs.digital-human.foundation`, `hvs.performance-capture.local`).
    - No common step changed status versus the baseline. The new generative-video-01 step is 30/30.
57. **Scoped tsc:** clean for all slice files. Remaining errors are pre-existing `node:sqlite` typing in `candidateStore.ts` and `local-ownership/store.ts`, pulled in through commanderSession.
58. **Protected core hashes:** UNCHANGED, 8/8 OK (`ffmpeg.ts`, `rights.ts`, `policy.ts`, `ingest.ts`, `preview-engine.ts`, `render-engine.ts`, `director3d/blender-audit.ts`, `character-production/authority.ts`).
59. **Git state:** HEAD `a39c9e28`, same branch, 3 stashes. Porcelain is 4695: 4690 pre-01 plus slice-01 paths plus ` M lib/native-builder/foundryEngineeringDepth.ts`. That last file was modified at 17:59:55 by the concurrent Foundry Phase-8 work, NOT by this slice; I left it untouched. No add, commit, stash, reset, clean or checkout.

### Conclusions
60. **16 GB viability:** INSUFFICIENT for the current runtime at 1280×704, even at 25 frames, with the official offload_model + t5_cpu + bf16 settings and SDPA. Factors:
    - The worker alone needs more than about 15.4 GB at sampling start, against a 15.47 GiB device.
    - Host RAM pressure: 31 GB RAM plus 8 GB swap saturated, and about 16 min loads from a USB HDD.
    - The Foundry/Ollama reload churn around the runs.
    - Official guidance is 24 GB for TI2V-5B at 720p.
61. **Recommended next paths** (recommendations only, not done):
    - fp8/quantized DiT or a GGUF-style 5B;
    - VAE decode on CPU or tiled decode;
    - a lower-resolution config, if upstream supports one, or a smaller model;
    - NVMe models dir and more system RAM;
    - pausing Foundry Phase-8 / setting `OLLAMA_KEEP_ALIVE=0` during generation;
    - retrying the flash-attn build with a glibc/CUDA-compatible toolchain (gcc/glibc pin or CUDA 12.8 headers).
62. **Times:**
    - Install 16:41–17:47:49;
    - live run 18:05:24–18:39:00;
    - validators 18:40:12–18:45:58;
    - final Ollama state 18:46:24.

## FINAL
```
WAN_INSTALL: PASS
MODEL_INSTALLED: YES
MODEL_DISCOVERY: INSTALLED
MODEL_PATH: /run/media/chosenone/Seagate/hvs-models/Wan2.2-TI2V-5B
RUNTIME_ENV: /run/media/chosenone/Seagate/hvs-models/runtimes/wan22/venv (Python 3.12.14, torch 2.13.0+cu130)
OLLAMA_UNLOADED_FOR_TEST: YES
VRAM_BEFORE: 11685 MiB used / 4157 MiB free
VRAM_AFTER_OLLAMA_UNLOAD: 1578 MiB used / 14264 MiB free
MODEL_LOAD: PASS
REAL_WAN_INFERENCE: STARTED_NOT_COMPLETED (step 0/50, GPU_OUT_OF_MEMORY x2)
16GB_VIABILITY: INSUFFICIENT
ATTENTION_BACKEND: SDPA
SDPA_FALLBACK: YES (UNOFFICIAL)
LIVE_GENERATION_PROOF: FAIL (typed GPU_OUT_OF_MEMORY, 2 attempts)
LIVE_VIDEO: NONE
FFPROBE: NOT_APPLICABLE
LIVE_INGEST: NOT_REACHED
LIVE_ASSET_RECORD: NONE
LIVE_PROVENANCE: FAILURE_RECEIPT_ONLY
LIVE_SOURCE_MONITOR: NOT_REACHED
LIVE_UI: BLOCKED (Commander sign-in required at http://127.0.0.1:3001/login)
AUTO_TIMELINE_INSERT: NO
LOCAL_ONLY: YES
CLOUD_FALLBACK: NONE
GROK_RUNTIME_DEPENDENCY: NONE
WORKER_CLEANUP: PASS
MEASURED_PEAK_VRAM: 15731 MiB device total (worker ~15.4 GB; receipt 13910 MiB)
FOCUSED_VALIDATION: PASS (30/30)
FULL_HVS_VALIDATION: BASELINE_PRESERVED
PROTECTED_CORE_HASHES: UNCHANGED (8/8)
CANONICAL: PRESERVED
COMMIT: NOT_AUTHORIZED
PUSH: NO
DEPLOY: NO
OVERALL: PARTIAL
```
MP4: none. Screenshots: none — Commander sign-in required at http://127.0.0.1:3001/login.
