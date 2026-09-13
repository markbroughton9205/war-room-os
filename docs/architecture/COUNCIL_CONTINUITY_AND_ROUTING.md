# Council continuity and routing

The Council is War Room's highest collective reasoning and synthesis layer. It compares, challenges, reconciles, and narrates the strongest available synthesis to the Commander from Terra observations, stored knowledge, research, live retrieval, Foundry reports, specialist agents, local memory, configured model perspectives, and future WRIM / Ra'el intelligence.

Council health is **not** synonymous with any commercial cloud provider.

## Seat vs backing

- **Council seat** is the War Room identity (AURORA, ORION, PULSAR, LUMEN, NOVA). ORION is the correct Claude-seat name (not ORIGIN).
- **Backing provider** is the model/runtime currently serving that seat.

Missing `OPENAI_API_KEY` means AURORA's OpenAI backing is `NOT_CONFIGURED`. It must never be labeled OpenAI READY. Local Qwen/Ollama may provide continuity backing without impersonating OpenAI, Claude, Grok, or Gemini.

## NOVA / local role

NOVA remains the explicit local Council member. Shared GENERAL local weights may also serve other seats when routing allows. That shared brain is not a fifth cloud vendor and is not WRIM.

## Packaged routing

Canonical setting: `COUNCIL_ROUTING_MODE`.

Preference values: `AUTO` | `LOCAL_ONLY` | `LOCAL_FIRST` | `HYBRID` | `EXTERNAL_ONLY`.

Resolution order:

1. `%LOCALAPPDATA%\War Room OS\data\council-runtime.json` (`routingMode` or `COUNCIL_ROUTING_MODE`)
2. Process / Windows USER environment `COUNCIL_ROUTING_MODE`
3. Default `AUTO`

Checkout `.env.local` is never read by packaged Electron and must not be bundled.

`AUTO` effective mode:

- any configured cloud Council key → `HYBRID`
- otherwise → `LOCAL_FIRST`

Missing optional cloud credentials must not destroy local Council continuity.

## Operational states

- `READY_MULTI_MODEL` — multiple external Council brains available
- `READY_HYBRID` — local + at least one external provider
- `READY_LOCAL` — sovereign local reasoning; no external provider required
- `DEGRADED_PARTIAL` — usable, but a configured component failed
- `UNAVAILABLE` — no usable reasoning backend (`NO_REASONING_BACKEND`)

## External provider states

`AVAILABLE` | `NOT_CONFIGURED` | `AUTH_FAILED` | `BILLING_BLOCKED` | `NETWORK_ERROR` | `PROVIDER_ERROR` | `DISABLED` | `UNKNOWN`

Do not collapse `NOT_CONFIGURED` into a runtime outage.

## Independent status planes

Network egress, research-provider configuration, Council models, and Terra connectivity are separate. Direct internet can be available while Tavily/Firecrawl/xAI search keys are absent.

Qwen is a local partner/continuity model, not the permanent primary intelligence target. AGI / WRIM remains the strategic model-development target.
