# Council Provider Runtime Repair Report

**WAR ROOM COUNCIL PROVIDER RUNTIME REPAIR — FAIL**  
**OPENAI PROVIDER — UNHEALTHY**  
**ANTHROPIC PROVIDER — UNHEALTHY**  
**COUNCIL DELIBERATION — NOT RESTORED**

Artifact: `WR-COUNCIL-PROVIDER-RUNTIME-REPAIR-001`  
Date: 2026-09-01  
Authoritative hosts: `/Users/markbroughton/Developer/war-room-os` and `/Users/markbroughton/WarRoomNode01`

Native Router V1, WRIM, LoRA, and EXP006 were not modified.

## Incident

Production Council showed `openai:gpt-4o` failing with OpenAI’s incorrect-API-key class, then Claude (`Opening position unavailable; no prior message ID`), Red Team (`Required prior family messages unavailable`), and the ChatGPT revision (`Red Team challenge unavailable`).

## Root cause

Primary: **B. INVALID_OR_REVOKED_SECRET**.

Council ChatGPT calls `process.env.OPENAI_API_KEY` from Next.js `.env.local` (`next start` on Node01). LaunchAgent `com.warroom.node01` does not inject provider keys (only `PATH`). The variable is present but is a short bracket placeholder, not a usable OpenAI key. Live `/v1/models` from that value returns **HTTP 401**. The same sentinel is on development and Node01 (fingerprints match). This is not Node01-only stale env, not a wrong variable name, and not a model-mapping bug.

`gpt-4o` is an intentional hardcoded Chat Completions model plus display label `openai:gpt-4o` in `providerModelForFamily`. It did not cause the 401.

Anthropic `ANTHROPIC_API_KEY` is independently the same placeholder class. Standalone `/v1/models` returns **HTTP 401** (`invalid x-api-key`). In the observed Council round Claude was **not invoked**; the Claude/Red Team/revision texts are **expected dependency behavior** after a missing opening `output_message_id`.

## Cascade

`EXPECTED_DEPENDENCY_BEHAVIOR`. `appendDeliberationTurn` only issues an `output_message_id` when the provider result is complete with content. `runFamilyToFamilyDeliberation` stops when the opening ChatGPT turn has no message id. That is not an orchestration defect. Council graph was not redesigned.

## Error redaction

`callChatGPT` previously threw OpenAI’s raw `error.message`, which includes the presented key. The UI interpolated `turn.failure_reason`. `toDisplayText` also skipped redaction for strings. Repair maps auth failures to **OpenAI authentication failed.** (and Anthropic equivalent) and redacts secret-shaped fragments.

Placeholders are no longer treated as configured, so Council will not call OpenAI/Anthropic with the sentinel.

## Repair applied

Code only. No key rotation. No invented secrets.

Commander must place a real `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in Node01 (and development) `.env.local`, then restart `com.warroom.node01`.

## Router integrity

`WR_NATIVE_ROUTER_V1_PILOT` remained `1` on Node01 `.env.local`. Router source hash and WRIM-0 hash unchanged. Node01 `execute.ts` still imports `applyPilotToResearchDecision`.

Node01 was rebuilt (`pnpm run build` PASS) and `com.warroom.node01` was restarted. `http://127.0.0.1:3000/login` and `https://warroomos.com/login` returned 200. Council round was not restored because keys remain unusable.

## Git

Inspect only. No commit, push, merge, rebase, reset, or clean.
