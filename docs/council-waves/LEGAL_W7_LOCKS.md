# LEGAL — Council Wave 7 locks (failure / observability / frontier)
# STATUS: RESEARCH ONLY | 2026-09-20 ~20:45 ET
# Avenue: Legal Researcher | Not legal advice | Not authorization to act
# Feeds: WAVE_7 failure/obs · report authority/provenance sections
# Classes: OWNABLE | STREAM_ONLY | REQUIRE-AUTH | HOLD | REFUSE
# Labels: VERIFIED FACT | INFERENCE | RECOMMENDATION

---

## Domain L — Authority, provenance, mission logs, frontier APIs

### L1 — Capability ≠ authority (tool-authority)
| Class | Lock |
|---|---|
| **OWNABLE** | Tool *capability* (can call) ≠ *authority* (may act). Authority is Commander-granted allowlist per agent × mission × tool. |
| **REFUSE** | Auto-escalate because a tool exists; invent credentials; treat Browser Broker deny as soft-success; claim VERIFIED from model_prior. |
| **HOLD** | Any tool outside mission allowlist → TOOL_BLOCKED evidence; continue others; never silent invent. |
| **Source** | Mission brief lock “capability ≠ authority”; WAVE_6 tool allowlist. |

### L2 — Provenance of web / browser evidence
| Class | Lock |
|---|---|
| **OWNABLE** | Evidence record must carry: `kind`, `source`/`url`, `retrieved_at`, `tool_name`, `ok`, optional `hash`, `license_class` (PUBLIC \| PROVIDER_AUTH \| COMMANDER_PRIVATE). |
| **STREAM_ONLY** | Browser Broker / live page fetch: cite pointer + timestamp; do not treat page HTML scrape of restricted sites as OWNABLE corpus. |
| **REFUSE** | Promote secondary_external or model_prior over live_telemetry/tool_result; drop provenance; hotlink-as-ingest of third-party news/media without license. |
| **HOLD** | Broker deny / timeout → claim status UNVERIFIED or TOOL_BLOCKED (WAVE_7 table). |
| **Source** | WAVE_4 evidence hierarchy; Live Intel license classes. |

### L3 — Logging Commander missions (observability)
| Class | Lock |
|---|---|
| **OWNABLE** | Local War Room round telemetry (mission_id, rounds, tool_calls, gates, completion_state) on sovereign store Commander controls. |
| **REQUIRE-AUTH** | Export / share mission logs off-box; PII/secrets redaction before any external review. |
| **HOLD** | Vendor tracing (e.g. OpenAI Agents SDK spans) may leave local network — classify as STREAM_ONLY/vendor-retained unless ZDR/MAM + contract cover. |
| **REFUSE** | Log secrets, API keys, auth cookies, or raw COMMANDER_PRIVATE payloads into vendor traces by default; fake green health when tools failed. |
| **Source** | WAVE_7 telemetry object; OpenAI Agents SDK tracing (docs). |

### L4 — Frontier APIs in Council (OpenAI / Anthropic class)
| Class | Lock |
|---|---|
| **VERIFIED FACT** | OpenAI API: customer content not used for training by default (as of 2023-03-01); default abuse-monitoring logs up to ~30 days; ZDR/MAM require prior approval. Stateful endpoints (Conversations, Assistants, Files, Vector Stores, etc.) retain application state even under ZDR. URL: https://developers.openai.com/api/docs/guides/your-data |
| **VERIFIED FACT** | Anthropic commercial API: ZDR available to approved orgs (sales); not stored at rest after response except law/misuse carveouts; feature eligibility is partial (Files, batch, some tools differ). URL: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention |
| **OWNABLE** | Prefer local/sovereign models for workers when mission content is COMMANDER_PRIVATE; frontier optional for Aurora/Phoenix with redaction. |
| **REQUIRE-AUTH** | Paid/commercial org keys; explicit Commander opt-in before sending COMMANDER_PRIVATE or credentials into frontier prompts. |
| **STREAM_ONLY** | Frontier generation/tool results: treat as vendor-processed; do not assume ZDR without confirmation in org settings. |
| **REFUSE** | Consumer free tiers for Council missions with private ops data; opt-in training shares; dumping full mission board to vendor without redaction; using ZDR-ineligible stateful features while claiming “zero retention.” |
| **HOLD** | Web Search / third-party MCP via frontier: data subject to *those* retention/residency policies (OpenAI docs). |

---

## Short REFUSE list (Wave 7 failure/obs fold)
1. Capability ≠ authority — no tool without allowlist grant.
2. No VERIFIED without ranked evidence + provenance fields.
3. Browser deny / tool error → TOOL_BLOCKED / UNVERIFIED, never invented READY.
4. Mission logs: secrets out of vendor traces; redaction before export.
5. Frontier: no training opt-in; no free-tier private ops; no ZDR claim without org approval; stateful APIs ≠ ZDR.
6. Policy refuse → completion_state REFUSED; Commander notified (WAVE_7).

## Failure-table addendum (Legal)
| Failure | Behavior |
|---|---|
| Authority missing | REFUSED; do not execute tool |
| Provenance incomplete | Schema reject / claim stays PROPOSED |
| Vendor retention unknown | HOLD frontier path; prefer local |
| Secrets in trace | REFUSE write; scrub + alert Commander |

LEGAL_W7_LOCKS DONE | Ready for PA2 Wave 7 / Wave 8 fold
