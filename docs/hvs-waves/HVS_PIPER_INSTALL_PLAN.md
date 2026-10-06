# HVS Piper install plan (Wave 4 — plan only)

**Do not install. Do not download voices. Generate does not install.**

This is the HVS-native Piper integration plan. Canonical machine-readable copy: `lib/media-command/local-generation-plans.ts` (`PIPER_INSTALL_PLAN`).

## Official source

| Item | Value |
|---|---|
| Maintained repo | https://github.com/OHF-Voice/piper1-gpl |
| License | GPL-3.0 |
| Release audited | v1.8.0 |
| Archived predecessor | https://github.com/rhasspy/piper (MIT, archived). Development moved. |

## Runtime

- Linux amd64/arm64 CPU. No VRAM required. ~200–500 MiB RAM.
- Disk: engine < 50 MiB + one English voice 15–60 MiB. Plan 250 MiB.
- CLI: `piper --model <voice.onnx> --output_file <out.wav>`
- Python: `PiperVoice.synthesize`
- Output: 16-bit PCM WAV, typically mono 16 kHz or 22.05 kHz. **Always probe** before AssetRecord.
- Voices: per-voice license. Prefer MIT/CC-BY English. Record id/version/license/hash/size in `models/catalog.json`. Do not copy proprietary license text into git.

## HVS adapter

`PiperAdapter` capability `VOICE_SYNTHESIS`.

Flow: `GenerateVoiceRequest` → Provider Router (only if `INSTALLED`) → `PiperAdapter` → `ProviderJob` → WAV → probe → `AssetRecord` + provenance → Media Library.

**No timeline auto-insert.**

HVS must exec Piper as a **subprocess**, not link the GPLv3 engine into the Next.js process.

## Storage

`application-data/media-command/models/voice/` — never git, never `.hvsproj`.

## Install authority

States: `NOT_INSTALLED` → `INSTALL_APPROVAL_REQUIRED` → `INSTALLING` → `INSTALLED` | `FAILED`.

Wave 4 flags stay false. Request-install records approval-required only. No download.

## Security

Sanitize text. Do not interpolate prompts into a shell. Loopback/offline after install. Output under media-command tmp/originals only.
