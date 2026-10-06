# HVS Piper install command plan (Wave 5 — REPORT ONLY)

**DO NOT RUN THESE COMMANDS.** Wave 5 is not Piper installation approval.

Canonical machine-readable copy: `lib/media-command/install-manifests.ts` (`PIPER_INSTALL_MANIFEST`, `PIPER_INSTALL_COMMAND_PLAN`).

## Manifest

| Item | Value |
|---|---|
| Repo | https://github.com/OHF-Voice/piper1-gpl |
| Release | v1.8.0 |
| License | GPL-3.0 (subprocess only — do not link into Next.js) |
| Voice | `en_US-lessac-medium` from rhasspy/piper-voices, MIT |
| Storage | ~80–250 MiB |
| Runtime | `application-data/media-command/models/voice/piper/` |

## Commands (never execute this wave)

```bash
ROOT="$HVS_APP_DATA/media-command/models/voice"
mkdir -p "$ROOT/piper" "$ROOT/en_US-lessac-medium"
python3 -m venv "$ROOT/piper/venv"
source "$ROOT/piper/venv/bin/activate"
pip install --upgrade pip
pip install "piper-tts @ git+https://github.com/OHF-Voice/piper1-gpl.git@v1.8.0"
curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx" -o "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx"
curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" -o "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx.json"
sha256sum "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx" | tee "$ROOT/en_US-lessac-medium/SHA256"
printf 'Higher Vision Studios' | piper --model "$ROOT/en_US-lessac-medium/en_US-lessac-medium.onnx" --output_file "$ROOT/piper/smoke.wav"
ffprobe -hide_banner "$ROOT/piper/smoke.wav"
rm -f "$ROOT/piper/smoke.wav"
```

Then write `catalog.json` with id/family/version/license/hash/bytes/backend/path/installedAt/status.

## Authority required later

Both:

- `HVS_MODEL_INSTALL_AUTHORIZATION=true`
- `HVS_PIPER_INSTALL_AUTHORIZED=true`

Wave 5 leaves both **false**.
