# WR-TOKENIZER reconciliation — #23

**Roadmap:** #22 CLOSED · **#23:** ACTIVE  
**Architecture ID:** `WR_TOKENIZER` (exactly one)  
**Historical version:** `WR-TOKENIZER-0`  
**Recommendation:** `KEEP_AND_EXTEND_LATER`  
**Reconciliation:** COMPLETE  
**Training:** NOT_STARTED (no Train button)

This pass recovered and reconciled the historical HuggingFace `tokenizer.json` BPE artifact. It did **not** train a tokenizer, mutate vocab/merges/IDs, start WRIM, or create Ra'el.

## Artifact

| Field | Value |
|---|---|
| Identity | WR-TOKENIZER-0 |
| Status | HISTORICAL TRAINED + VALIDATED |
| SHA-256 | `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7` |
| Format | HuggingFace tokenizer.json |
| Algorithm | ByteLevel BPE |
| Vocab requested / produced | 16384 / 15126 |
| Special IDs 0–8 | `<\|pad\|>` `<\|bos\|>` `<\|eos\|>` `<\|unk\|>` `<\|system\|>` `<\|commander\|>` `<\|assistant\|>` `<\|tool\|>` `<\|evidence\|>` |
| Used by | WRIM-0, WRIM-1 lineage |

Recovery dump remains read-only. Active copy:

`%LOCALAPPDATA%\War Room OS\data\wr-tokenizer\WR-TOKENIZER-0\`

Runtime encode/decode uses Node 24 ByteLevel BPE on Windows (Nebula Genesis). No Mac `python3` path. Python `tokenizers` / `sentencepiece` were not installed for this pass.

## Decision

`KEEP_AND_EXTEND_LATER`: keep WR-TOKENIZER-0 canonical for historical WRIM continuation. A future tokenizer, if authorized, must be a new `WR-TOKENIZER-1` artifact. Do not mutate this vocab in place. Qwen having a larger vocab is not a replacement reason.

Replacement thresholds (measured, not preference): English unknown > 1%, corpus unknown > 2%, English tokens/byte > 0.45, or English/code/JSON round-trip failure.

## Binding

WRIM-0 `lineage.tokenizerJsonSha256` equals this SHA; `vocab_size` = 15126. Changing the tokenizer invalidates the 15,126-row embedding matrix. WRIM-1 run manifests reuse the same tokenizer SHA (`compatible`) but collapsed WRIM-1 is not promoted.

## Surfaces

- `GET /api/wr-tokenizer/status`
- `GET /api/local/wr-tokenizer/status`
- WR-CORPUS page tokenizer panel (`/wr-corpus`)
- `pnpm run validate:wr-tokenizer`
- `pnpm run import:wr-tokenizer`

Do not create Tokenizer2, WRTokenizer2, RaelTokenizer, or WRIMTokenizer.
