# HVS_GENERATIVE_VIDEO_01_REPORT

Slice: HVS-GENERATIVE-VIDEO-01 (adds Wan 2.2 TI2V-5B as a local video-generation provider)
Date: 2026-10-02 (America/New_York)
Host: Nebula-Genesis (user chosenone). All work was done in the existing local checkout. Nothing was cloned and no cloud agent was used.
Evidence scratch dir (outside the repo): `/home/chosenone/.local/share/war-room-os/hvs-generative-video-01/`

1. **Repo identity:** `/home/chosenone/Codex/war-room-os` (pnpm/Next.js monorepo). `hostname` returned Nebula-Genesis.
2. **Branch:** `live-council-intelligence-repair`. No branch was changed.
3. **HEAD:** `a39c9e2` (a39c9e2866518eac18307510b7971b9ae2305314). No new commits.
4. **Dirty state:**
   - `git status --porcelain` showed **4690** entries before and **4694** after.
   - The new porcelain entries are `?? components/war-room/higher-vision-studios/HvsGenerateVideoPanel.tsx`, `?? lib/media-command/generative/`, `?? lib/media-command/hvs.generative-video-01.validation.ts` and `?? scripts/hvs/`.
   - The route sits inside `app/api/media-command/`, which was already untracked.
   - Modified files that were already dirty or untracked: `package.json` (` M`), `lib/media-command/ai-director.ts`, `HvsAiCreateStudio.tsx`, `HvsEditorShell.tsx`, `lib/media-command/generation-backend-decision.ts` (all `??`).
   - Pre-edit copies are in `scratch/pre-edit-copies/`. All edits are additive: `diff` shows 0 removed lines for each file. The one exception is the `validate:hvs` line in package.json, which was extended by appending one `&& …` step.
   - CRLF line endings were preserved on ai-director.ts, HvsAiCreateStudio.tsx and generation-backend-decision.ts.
   - No commit, stash, reset, checkout, clean or force operation was run. The 3 pre-existing stashes are untouched.
5. **Existing architecture audit:** these existing pieces are reused.
   - `types.ts` (AssetRecord, `AssetProvenance.parameters`, AssetRights)
   - `ingest.ts` `ingestFile` (copies into originals, probes, builds AssetRecord, calls `saveProject`)
   - `paths.ts` `mediaCommandDataHierarchy` (`WAR_ROOM_LOCAL_DATA_DIR`)
   - `store.ts` `.hvsproj` load/save
   - `jobs.ts` HvsJob envelope (`createHvsJob`, `markJobRunning`, `markJobCompleted`, `markJobFailed`, `requestCancel`)
   - `ffmpeg.ts` `resolveFfmpegTools` (read-only use) and `probe.ts` `probeMediaFile`
   - `gpu-runtime.ts` `currentGpuBackend`; `compute-policy.ts` `probeNvidiaSmi`
   - `generation-requests.ts` (`promptHash`, `normalizeProviderArtifact`, `provenanceFromNormalized`); `generation-backend-decision.ts`
   - `rights.ts` `unknownRights`; `secrets.ts` (`stripSecrets`, `assertNoSecrets`)
   - `ai-director.ts` `proposeDirectorCommands`
   - UI: `HvsAiCreateStudio.tsx` (Create/AI surface), `source-monitor.ts` and `HvsEditorShell` `selectAssetForSource`
   - `middleware.ts` (auth on all `/api/*` except health)
   - `provider-registry.ts` holds remote metered stubs. It was left untouched because prior validators require its spend-blocked semantics.
   - No RenderQueue fits a GPU-exclusive Python job, so the HvsJob envelope plus a minimal FIFO queue is used instead.
6. **Files changed:**
   - **New:**
     - `lib/media-command/generative/{types,contract,registry,model-storage,gpu-policy,runtime,supervisor,jobs,receipts,director,status-lines}.ts` and `generative/providers/wan22.ts`
     - `app/api/media-command/generate-video/route.ts`
     - `components/war-room/higher-vision-studios/HvsGenerateVideoPanel.tsx`
     - `scripts/hvs/wan22_worker.py`, `scripts/hvs/fake_generative_worker.py` (test only), `scripts/hvs/install-wan22.sh`
     - `lib/media-command/hvs.generative-video-01.validation.ts`
     - this report
   - **Modified (additive):** `ai-director.ts` (+21 lines), `HvsAiCreateStudio.tsx` (+15), `HvsEditorShell.tsx` (+10), `generation-backend-decision.ts` (+20: `LOCAL_VIDEO_ENGINE_DECISION`), `package.json` (+1 script, +1 step in `validate:hvs`; sha256 cfd76898… → 91c30be5…).
7. **Provider architecture:**
   - `generative/` is a narrow, typed layer, separate from Creative Intelligence and from provider-registry.
   - Capabilities: TEXT_TO_VIDEO and IMAGE_TO_VIDEO. VIDEO_TO_VIDEO and the other future values are enum placeholders that resolve to no provider.
   - Flow: `contract` validates → `jobs` orchestrates → `gpu-policy` admits → `runtime` handles lock and lifecycle → `supervisor` runs the Python worker → `probe` → `ingestFile` → `receipts`.
8. **Model/provider registered:**
   - Provider `wan`, providerFamily WAN, modelFamily Wan2.2, modelVariant TI2V-5B, modelId `wan2.2-ti2v-5b`.
   - `registryIsLocalOnly()` returns true. It is the only provider (check 01).
9. **Model discovery:** `discoverWan22()` checks every required HF file at its exact byte size, the official code files, and the worker Python.
   - States: INSTALLED, MODEL_NOT_INSTALLED, INCOMPLETE, RUNTIME_MISSING, DISABLED. `autoDownload` is always false.
   - modelVersion comes from `hvs-install-manifest.json` or the HF `.metadata` file. License comes from README front matter, LICENSE or the manifest. Neither is ever invented; if nothing is found it is reported as null/UNKNOWN.
   - **Real result: MODEL_NOT_INSTALLED** at `/home/chosenone/.local/share/war-room-os/data/media-command/models/generative/Wan2.2-TI2V-5B`; worker python missing.
   - A synthetic sparse-file fixture was used to prove the INSTALLED, INCOMPLETE and DISABLED detection paths and metadata reading (check 04).
10. **Model storage:**
    - `HVS_GENERATIVE_MODELS_DIR` defaults to `<app-data>/data/media-command/models/generative`.
    - `HVS_WAN22_MODEL_PATH` defaults to `<models>/Wan2.2-TI2V-5B`.
    - `HVS_WAN22_ENABLED` defaults to on.
    - **Recommended:** `HVS_GENERATIVE_MODELS_DIR=/run/media/chosenone/Seagate/hvs-models`. Caveats: that drive is ntfs3 and automounted under `/run/media`, so it may be missing after a reboot or before login (HVS then reports MODEL_NOT_INSTALLED). ntfs3 symlink/exec behaviour for a venv has not been tested; the installer uses `--link-mode copy`. The Seagate path is not hardcoded anywhere.
11. **Runtime environment:**
    - `HVS_GENERATIVE_WORKER_PYTHON` defaults to `<models>/runtimes/wan22/venv/bin/python`; the code dir is `<models>/runtimes/wan22/Wan2.2`.
    - No HVS venv exists yet.
    - An existing venv `~/.local/share/war-room-os/venvs/wrim-pytorch-linux` (torch 2.13.0+cu130, sm_120, CUDA OK) is evidence that this torch build works on this GPU. It was read only and not reused.
12. **Worker architecture:** `scripts/hvs/wan22_worker.py` is a dedicated process.
    - Input: typed JSON on stdin (schema `hvs.wan22.worker-input.v1`) with generationId, prompt, frames, dims, fps, seed, inputImagePath (resolved internally from an AssetRecord), outputPath, and an approved model id.
    - stdout carries only `HVS_EVENT {json}` lines. A socket network guard is active. `HF_HUB_OFFLINE` is set.
    - It mirrors the official ti2v branch (`WanTI2V(...).generate` and `save_video`), writes `.partial.mp4`, then `os.replace`s it into place.
    - The Next.js process never imports torch; the only spawn is `spawn(python, [script])` with fixed argv.
    - The worker env is minimal: no `.env.local` and no API keys (check 24 shows XAI/OPENAI keys are not forwarded).
13. **Process lifecycle:**
    - The worker runs `detached` in its own process group. Supervision covers ready timeout, total timeout, crash, OOM and load failure.
    - Shutdown: process-group SIGTERM, then SIGKILL after a grace period, plus a final group kill; `processGroupGone` is verified.
    - Check 10: a hang worker with a grandchild `sleep` → GENERATION_TIMEOUT, groupGone=true. No zombie or fake worker remained (`pgrep` check 30).
14. **GPU detection:** bounded `nvidia-smi --query-gpu/--query-compute-apps` with fixed args and a 4 s timeout, plus the existing `probeNvidiaSmi` and `currentGpuBackend`.
    - Real: **NVIDIA GeForce RTX 5060 Ti, 16311 MiB total, ~11720 MiB used, ~4.0–4.2 GB free**, driver 595.91.07, CUDA backend.
    - **Holder of most of the ~11.8 GB: Ollama `llama-server` pid 264296 at 9890 MiB** (`~/.local/lib/ollama/llama-server` serving an Ollama blob model on port 43351; parent `ollama` pid 2213 on :11434).
    - Smaller holders: Cursor 210 MiB, ptyxis 49 MiB, Chrome 36 MiB; the rest is graphics/non-compute.
    - Nothing was killed.
15. **VRAM policy:**
    - Default admission requires 14000 MiB free (env `HVS_WAN22_MIN_FREE_VRAM_MIB`, bounded 6000–49152).
    - Compatibility is reported as `UNTESTED_BELOW_OFFICIAL_24GB`. The official README says the 5B single-GPU command with `--offload_model True --convert_model_dtype --t5_cpu` needs at least 24 GB.
    - Plan: OFFICIAL_LOW_MEMORY (offload_model, t5_cpu, convert_model_dtype, 1280×704 or 704×1280, 24 fps, 121 frames ≈ 5.04 s, 50 steps).
    - **Current real state: INSUFFICIENT_VRAM** (holders listed in the reason). 16 GB compatibility is NOT claimed.
16. **Heavy-model lock:**
    - An in-process owner plus an O_EXCL lockfile at `media-command/jobs/_generative/wan22.heavy.lock`. A stale lock is reclaimed only if its pid is dead.
    - Lifecycle states: UNLOADED/LOADING/READY/GENERATING/UNLOADING/ERROR with guarded transitions.
    - Check 08: maxConcurrent=1, the lock was held during the job, a thief acquire returned null, and the lock was released with lifecycle back to UNLOADED.
17. **Job queue:** each generation gets an HvsJob (kind `provider`, backend `local-wan22`) at `media-command/jobs/<projectId>/<jobId>.json`. Execution order uses a minimal global FIFO.
    - Check 07: the second job was QUEUED, then both COMPLETE, and the job file shows status COMPLETED.
18. **Generation contract:** `hvs.generate.video`.
    - Request fields: projectId, prompt (3–1500 characters), durationSeconds (1–5), width/height (1280×704 or 704×1280), fps (24), seed (0..2^31−1), sourceImageAssetId (an AssetRecord id only), modelPreference (`wan2.2-ti2v-5b`).
    - Unknown keys and forbidden keys (command/shell/bash/pythonCode/script/paths/env/url) are rejected. A path-like asset id is rejected.
    - The result carries every requested field (status QUEUED…CANCELLED, error {code,message}) plus progress, requested/actual, attempts, liveGeneration and fixture.
    - Checks 02 and 03: 10/10 bounds rejections and 11/11 forbidden-key rejections.
19. **Text-to-video:** implemented and wired. Proven only through a fake worker; there is **no live Wan output** because the model is not installed.
20. **Image-to-video:** implemented. The source image is resolved from the project AssetRecord pool only (image/graphic/logo, contained path). The fixture run records `sourceImageAssetId` and `parentAssetId`; an unknown id gives SOURCE_ASSET_NOT_FOUND. Not live-proven.
21. **Typed failures:** all 12 codes exist.
    - Exercised: MODEL_NOT_INSTALLED, MODEL_LOAD_FAILED, GPU_OUT_OF_MEMORY, INVALID_GENERATION_REQUEST, SOURCE_ASSET_NOT_FOUND, GENERATION_TIMEOUT, GENERATION_FAILED, ENCODE_FAILED (no output, escape path), CANCELLED.
    - GPU_UNAVAILABLE and INSUFFICIENT_VRAM are proven through admission. INGEST_FAILED is mapped in code but has no forced test.
22. **Retry policy:**
    - At most 2 attempts. The single retry happens only after GPU_OUT_OF_MEMORY, in REDUCED_MEMORY_RETRY mode (frames capped at 49 ≈ 2 s, official low-memory flags kept, `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`). Requested and actual settings are both recorded.
    - Check 12: requested 121 → actual 49 frames. The final OOM message includes model, resolution, frames, GPU, free MiB and attempts.
23. **Cancellation:** an AbortSignal kills the process group. The result is CANCELLED with no outputAssetId, no file and no asset added (2→2). A queued job can also be cancelled. Cancel is refused once INGESTING starts (check 09).
24. **Timeout:** `HVS_WAN22_TIMEOUT_MS` (default 60 min, bounded 5 s–4 h) plus a ready timeout that maps to MODEL_LOAD_FAILED (check 10).
25. **Progress reporting:** only real states are shown (QUEUED → LOADING_MODEL → GENERATING → ENCODING → INGESTING → terminal). Step progress (`step n/50`) comes only from parsed worker/tqdm events. No percentages exist (check 22).
26. **Output storage:**
    - The worker writes to `media-command/projects/<pid>/generations/<genId>/wan22-<genId>.mp4`.
    - `isContainedOutputPath` requires the media-command root, not tmp, and passes a realpath check.
    - A worker that reports any other path gets ENCODE_FAILED.
    - The final asset goes through `ingestFile` into `media-command/originals/` (checks 13 and 14).
27. **ffmpeg/probe integration:** `probeMediaFile` from `probe.ts` plus `resolveFfmpegTools` from `ffmpeg.ts`, used read-only. ffmpeg.ts is unchanged (hash OK). Output with no video stream gives ENCODE_FAILED.
28. **Ingest integration:** the existing `ingestFile` is called with `generated:true`, `rights: unknownRights(...)` and role ORIGINAL. A proxy is created. Errors give INGEST_FAILED (check 15).
29. **AssetRecord proof (fixture only):** kind video, 320×176, generated=true, immutableOriginal, sha256 matches the file, duration > 0, rights UNKNOWN with commercialOk=false (check 17). This is not a live asset.
30. **Provenance:**
    - Asset fields: origin `generated`, provider `wan`, model `Wan2.2-TI2V-5B`, providerJobId = generationId, promptHash (sha256), seed, `externalTransfer.transferred=false`.
    - `parameters.hvsGeneration` holds generationId, providerFamily/modelFamily/modelVariant, modelVersion (null/UNKNOWN unless installed metadata exists), license, requested/actual, generatedAt, sourceImageAssetId, localGeneration=true, synthetic=true, liveGeneration, fixture (check 16).
31. **Source monitor integration:**
    - `loadAssetIntoSource` accepts the generated asset (check 18).
    - The panel's "Open in Source monitor" link goes to the editor with `?sourceAsset=<id>`. `HvsEditorShell` calls the existing `selectAssetForSource` for it. No new player.
32. **Timeline behavior:** no automatic insertion. Clips went 0→0, and jobs.ts has no insert/commit calls (check 19).
33. **Director integration:**
    - "Generate a 5-second cinematic nighttime city shot." → `generativeOps[0] = {op:'hvs.generate.video', request:{prompt:'cinematic nighttime city shot', durationSeconds:5}, execute:false}`, with 0 timeline commands and a jobProposal with execute:false.
    - The legacy "Generate an establishing shot." stays BLOCKED_PENDING_APPROVAL. "Generate a voice line." is unchanged.
    - ai-director does not import jobs or the supervisor, so LLM/freeform text cannot launch Python (check 20).
34. **UI integration:**
    - A compact GENERATE VIDEO panel inside the existing `HvsAiCreateStudio` Create/AI surface, rendered after `hvs-ai-understands`.
    - Fields: prompt, duration, an optional source image from project assets, Propose (via the Director parser), Generate, Cancel, and Open in Source monitor.
    - Existing studio strings are kept ("Final generated footage isn't enabled yet").
    - Proven by source and typecheck only. The browser UI was not rendered (no dev server was started).
35. **Model-status UI:**
    - The server computes `modelStatusLineFor`: WAN 2.2 READY only when installed, admitted and not busy; otherwise MODEL NOT INSTALLED / INSUFFICIENT VRAM / BUSY / ERROR / GPU UNAVAILABLE / DISABLED.
    - The panel shows CHECKING… until the server answers, and Generate is disabled unless the line is READY.
    - Real value right now: MODEL NOT INSTALLED (check 21).
36. **Generation-status UI:** `generativeVideoStatus` + `generationStateLine` (pure, `generative/status-lines.ts`), with 2 s polling while active (check 22).
37. **Rights boundary:** rights.ts is unchanged. Generated assets get `unknownRights` (UNKNOWN, commercialOk=false). Nothing is auto-marked OWNABLE or rights-valid (check 26).
38. **Commander authority:**
    - Director ops are proposals with `execute:false`.
    - Generation needs an explicit POST `generate` from the panel or API, behind existing middleware auth (check 25).
    - `mayPublishAutomatically()===false`. There is no publish, deliver or render path (check 27).
39. **Network boundary:**
    - Zero network at generation time: worker HF/Transformers offline env, socket guard, no `fetch(` in generative code.
    - The only network use is the installer's explicit opt-in `--venv`/`--code`/`--download`, and `--check` (an HF API metadata listing).
40. **Grok runtime boundary:** there are no grok/xai/OpenAI/Anthropic/Gemini references or keys in generative/*, the worker or the route (check 24). The chain is HVS → local worker → file → ingest.
41. **Cloud-provider boundary:**
    - `dashscope` (in the official requirements.txt, used only for cloud prompt extension) is deliberately excluded.
    - Prompt extension is not used, and there is no import from provider-adapters, provider-router or provider-registry (check 23).
42. **Unreal boundary:** HVSRuntime, MetaHuman, Ra'el, character authority and the Unreal bridge are untouched. `character-production/authority.ts` hash is OK, and the unreal validators still pass.
43. **Creative Intelligence boundary:** CI code is untouched and there are no CI imports in generative code. CI-01 still passes 45/45 and CI-02 56/56.
44. **Dependency environment:**
    - Nothing was installed.
    - Planned: uv venv, Python 3.12; torch 2.13.0 + torchvision 0.28.0 (cu130 index); numpy 1.26.4, opencv-python 4.11.0.86, diffusers 0.33.1, transformers 4.51.3, tokenizers 0.21.1, accelerate 1.6.0, huggingface_hub 0.34.4, safetensors 0.5.3, tqdm, imageio 2.37.0, imageio-ffmpeg 0.6.0, easydict, ftfy, einops, regex, pillow.
    - flash-attn 2.8.3.post1 is optional (source build; `nvcc` 13.1 is present but untested).
    - Without flash_attn the official `WanModel` asserts. The worker then fails with MODEL_LOAD_FAILED unless the user opts into `HVS_WAN22_ALLOW_SDPA_FALLBACK=1`, which is unofficial and ignores padding masks.
    - None of these pins were install-tested.
45. **Install helper:** `scripts/hvs/install-wan22.sh` (bash -n OK). The default mode only prints a plan.
    - Both plan runs exited 0 (default dir and Seagate dir); nothing was created.
    - Exact commands:
      - `scripts/hvs/install-wan22.sh --check` (plan + HF metadata size)
      - `HVS_GENERATIVE_MODELS_DIR=/run/media/chosenone/Seagate/hvs-models scripts/hvs/install-wan22.sh --venv --code`
      - optional `... --flash-attn`
      - `HVS_GENERATIVE_MODELS_DIR=/run/media/chosenone/Seagate/hvs-models scripts/hvs/install-wan22.sh --download` (Commander authorization required; **NOT run**)
      - Then export the same `HVS_GENERATIVE_MODELS_DIR` (and optionally `HVS_WAN22_ALLOW_SDPA_FALLBACK=1`) for the HVS server.
46. **Disk-space requirements:**
    - Weights: **34,203,123,497 bytes (31.85 GiB)**, measured from the HF API file listing at revision 921dbaf3.
    - Runtime venv + caches: about **12 GiB — ESTIMATE**.
    - The installer requires that size plus a 4 GiB margin and refuses otherwise.
    - Root has 33 GB free, so the default location would be refused for weights (34.2 GB + 4 GiB > 33 GB). Seagate has 7.1 TB free.
47. **Focused validation:** `pnpm run validate:hvs-generative-video-01` → **HVS_GENERATIVE_VIDEO_01 30/30 PASS**, exit 0, about 11.5 s.
    - It runs in an isolated root `~/.local/share/war-room-os/validation-roots/hvs-gv01-*` (not /tmp), which is removed afterwards.
    - The fake worker is used only for supervision and plumbing, and is never counted as live proof.
    - It prints `LIVE_GENERATION NOT_RUN model=MODEL_NOT_INSTALLED gpu=INSUFFICIENT_VRAM`.
    - Scoped `tsc --noEmit` over the new and modified files (about 100 project files) exits 0.
48. **Existing validation:** each prior HVS step was run separately before and after (per-step runner).
    - Baseline: 65/67 pass. After: 66/68 pass (the extra step is the new validator).
    - **No prior step changed status.**
    - The same 2 failures existed before and after. Both are hardware: `hvs.digital-human.foundation.validation.ts` and `hvs.performance-capture.local.validation.ts` → "Error: The camera disconnected." (CAMERA_DISCONNECTED).
    - No prior validator was edited or weakened.
49. **Full HVS validation:** `pnpm run validate:hvs` → **EXIT=1 after 130 s** (baseline: EXIT=1 after 132 s). The `&&` chain stops at the camera failure, identical to baseline, so the full chain cannot pass on this machine without a camera. Per-step counts: **66 pass / 2 fail of 68** (baseline 65/2 of 67).
50. **Protected hashes (before = after, all OK; match `/home/chosenone/Codex/hvs-workflow-discipline-01-baseline/BASELINE_MANIFEST.json`):**
    - ffmpeg.ts 4c9fcbff…da17
    - rights.ts ba21c510…07d1
    - policy.ts af2ad03f…35b9
    - ingest.ts 811afec6…3e43
    - preview-engine.ts 3934fac7…f542d
    - render-engine.ts 82b29977…3e73
    - director3d/blender-audit.ts 3213c668…c726
    - character-production/authority.ts 26227f25…b205
51. **Installed runtime proof:** NOT_RUN.
    - Ports 3847, 3848 and 3001 are DOWN (`ss` and curl). The lockfiles point to dead pids.
    - The installed bundle `~/.local/opt/war-room-os-0.1.0-a39c9e2-foundry-eng-05ar` was built from committed a39c9e2 and cannot contain this uncommitted code without a rebuild/reinstall, so I did not do one.
52. **Source/runtime match:** MISMATCH. The source has the provider; the installed runtime does not.
53. **Live Wan generation attempt:** NOT_RUN. There are no weights, no runtime venv, and the GPU is INSUFFICIENT_VRAM (about 4 GB free).
54. **Live output ffprobe:** NOT_RUN.
55. **Live AssetRecord:** NOT_RUN.
56. **Live Source-monitor proof:** NOT_RUN.
57. **Limitations:**
    - No live generation; no install.
    - 16 GB VRAM is untested (official minimum is 24 GB), and Ollama currently holds about 9.9 GB.
    - flash_attn is not installed. The SDPA fallback is unofficial and opt-in.
    - Pins are not install-tested.
    - The Seagate drive is ntfs3 and automounted.
    - The queue lives in memory per server process; the lockfile guards across processes. Queued jobs do not survive a server restart (their HvsJob files stay QUEUED).
    - The UI was not browser-rendered; the HTTP route was not exercised over HTTP.
    - The full `validate:hvs` `&&` chain stops at the pre-existing camera failure.
    - Root disk is 97% full.
58. **Exact next clean layer:**
    1. With Commander authorization: `HVS_GENERATIVE_MODELS_DIR=/run/media/chosenone/Seagate/hvs-models scripts/hvs/install-wan22.sh --venv --code`, optionally `--flash-attn`, then `--download`.
    2. Free VRAM by unloading the Ollama model (e.g. `ollama stop <model>`) or setting `OLLAMA_KEEP_ALIVE`.
    3. Run one live 5 s 1280×704 generation through `/api/media-command/generate-video` on a dev server with the same env, and capture ffprobe, the AssetRecord, the receipt and the Source monitor.
    4. Only then tune `HVS_WAN22_MIN_FREE_VRAM_MIB` from the measured peak.
    5. Commit and rebuild the installed runtime only when authorized.

## FINAL
```
WAN_PROVIDER: REGISTERED (local, typed; wan / Wan2.2 / TI2V-5B)
MODEL: Wan-AI/Wan2.2-TI2V-5B (pinned HF rev 921dbaf3…, Apache-2.0 per HF/official LICENSE)
MODEL_INSTALLED: NO
MODEL_DISCOVERY: PASS (real state MODEL_NOT_INSTALLED; no auto-download)
LOCAL_ONLY_GENERATION: YES (by design + validator; not live-proven)
GROK_RUNTIME_DEPENDENCY: NONE
CLOUD_API_DEPENDENCY: NONE
TYPED_GENERATION_OP: PASS (hvs.generate.video)
ARBITRARY_SHELL: NONE
WORKER_ISOLATION: PASS (separate Python process group, fixed argv, minimal env; fake-worker supervision proof)
GPU_DETECTION: PASS (RTX 5060 Ti 16311 MiB; Ollama llama-server holds 9890 MiB)
VRAM_POLICY: PASS (current state INSUFFICIENT_VRAM; 16 GB UNTESTED vs official 24 GB)
QUEUE: PASS
ONE_HEAVY_JOB: PASS
TEXT_TO_VIDEO: IMPLEMENTED_NOT_LIVE_PROVEN
IMAGE_TO_VIDEO: IMPLEMENTED_NOT_LIVE_PROVEN
OUTPUT_STORAGE: PASS (contained project media storage; never /tmp)
FFMPEG_PROBE: PASS (existing probe; ffmpeg.ts unchanged)
INGEST: PASS (existing ingestFile; fixture only)
ASSET_RECORD: PASS (fixture only)
PROVENANCE: PASS
SOURCE_MONITOR: PASS (logic + link; not browser-rendered)
AUTO_TIMELINE_INSERT: NO
DIRECTOR_INTEGRATION: PASS (proposal only, execute:false)
UI_INTEGRATION: PASS (source + typecheck; not browser-rendered)
RIGHTS_BOUNDARY: PASS
COMMANDER_AUTHORITY: PASS
UNREAL_BOUNDARY: PASS
CREATIVE_INTELLIGENCE_BOUNDARY: PASS
FOCUSED_VALIDATION: PASS 30/30
FULL_HVS_VALIDATION: FAIL_PREEXISTING (chain EXIT=1 at camera-disconnected step, same as baseline; per-step 66/68, 0 regressions)
PROTECTED_CORE_HASHES: PASS (8/8 unchanged)
LIVE_GENERATION_PROOF: NOT_RUN
LIVE_OUTPUT_VIDEO: NOT_RUN
LIVE_ASSET_INGEST: NOT_RUN
LIVE_SOURCE_MONITOR: NOT_RUN
MODEL_INSTALL_REQUIRED: YES
OVERALL: PARTIAL
CANONICAL: NO (uncommitted; installed runtime not rebuilt)
COMMIT: NOT_AUTHORIZED
PUSH: NO
DEPLOY: NO
```
