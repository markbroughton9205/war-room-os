# WR Live Council Orchestration Report

**Verdict: WAR ROOM LIVE COUNCIL ORCHESTRATION — FAIL**

Foundation Rebuild isolation/research-first contracts remain passing in validators. This mission implemented floor control, stream adapters, social lane, and memory gating in development. It did **not** restore production Council on warroomos.com.

## Exact live-product causes (pre-fix)

1. `"Hi council"` hit `classifyRaElMessage` bus keyword `\bcouncil\b` → `maxFamilies: 1` → only ChatGPT.
2. `"council check in"` was `attendance` (short parallel batch) and not a lightweight ping → full prompts, opportunity/synthesis flavor, Claude incomplete, memory prompt.

## Claude

Minimal/streaming/Council-path Anthropic calls from this host: HTTP 400 credit/billing. Not 401. Not transport. Not UI.

## Provider restoration recheck (same mission)

OpenAI council-shaped stream: PASS (HTTP 200, TTFT ~0.8–1.0s).

Gemini `gemini-2.5-flash` stream: PASS after installing a live key (HTTP 200, first byte ~0.8s). Gemini SSE often omits a blank line between events; leftover-frame harvest was hardened.

Anthropic: still HTTP **400 BILLING** (credit/balance language; not AUTH; not RATE_LIMIT). Full Council path UNHEALTHY. Production promotion STOP.

Grok/xAI: HTTP **400 AUTH** — provider message class `incorrect_api_key`. Prefixing `xai-` did not change the outcome. Do not treat shape-present as live-usable.

Node01: not modified. WRIM checkpoint SHA unchanged. Native Router source hash unchanged.

Node01 was not rebuilt or restarted. Promotion is blocked until Anthropic credit/request succeeds and Grok/Gemini configuration is truthful.

Artifacts: `WR-LIVE-COUNCIL-ORCHESTRATION-001/`.
