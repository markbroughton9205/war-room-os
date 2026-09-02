# WR Council Provider Reliability

Timeouts are split: first-token, idle, overall (`lib/council/live-orchestration/timeoutPolicy.ts`). Greeting/social first-token is 20s, not the old 4–6.5s attendance/greeting cap that starved Claude.

Retries: one transient attempt **before** visible tokens (429/5xx/network/first-token timeout). No automatic replay after visible tokens. Partial text is kept.

Failure layers: AUTH, REQUEST, PROVIDER, RATE_LIMIT (includes credit/billing language), TRANSPORT, STREAM_PARSER, TIMEOUT, ORCHESTRATOR, PERSISTENCE, UI, DEPENDENCY.

## Claude live canary (this host)

Anthropic Messages returned HTTP 400 `invalid_request_error` with credit/billing language for both streaming and non-streaming Council-shaped payloads. Transport succeeded. This is not classified as UI or persistence failure.

OpenAI `gpt-4o` streaming canary completed with visible deltas.
