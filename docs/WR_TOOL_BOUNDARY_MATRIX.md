# WR-TOOL Boundary Matrix

Date: 2026-08-31  
Authority: `lib/tools/toolRegistry.ts`, `lib/modular-intelligence/toolCatalog.ts`, `app/api/tools/web/route.ts`, `app/api/tools/research/route.ts`.

These classes are semantically close. Gold must follow **War Room runtime meaning**, not generic chatbot habits.

## WEB

**Correct when:** Commander wants an **external web lookup or page retrieval** now — a single search/fetch. Endpoint `/api/tools/web`. Live stack is Tavily (`TAVILY_API_KEY`); GET reports `standby` vs `config_needed`.

**Not:** session memory, workspace files, or a multi-source research brief.

## RESEARCH

**Correct when:** Commander wants **multi-source research synthesis**. Endpoint `/api/tools/research`. GET requires Tavily **and** Firecrawl for a full stack (`config_needed` / `partial` / `standby`). Gym analog: `research_engine` claim extraction and source comparison (`lib/agi-gym/engine.ts`).

**Not:** one web hit, reading an uploaded path, or recalling a prior War Room decision.

Shared Tavily provider with WEB is why lexical overlap is dangerous.

## FILES

**Correct when:** Inspect a **workspace / uploaded artifact by path**. Registry `files` → `/api/files`. Gym analog: `code_operator` `read_file` on a repo path (Wave 4.2 manifest).

**Not:** hashing the filename string with `sha256` unless the request is to hash text. Not memory recall.

## MEMORY

**Correct when:** Retrieve **session or long-term War Room memory**. Endpoint `/api/tools/memory`, `requiresAuth: true`.

**Not:** files on disk, live web, or a research briefing.

## Pair rules

| pair | A | B | same-topic contrast |
|---|---|---|---|
| WEB vs RESEARCH | Search the internet for current X | Sourced multi-source investigation of X | UTC time servers |
| FILES vs MEMORY | Find X in my uploaded document / repo path | Recall what we previously decided about X | Wave 4.2 dataset hash |
| NO_TOOL vs WEB | Explain a concept; do not look anything up | Look up current external facts | search engines |
| NO_TOOL vs MEMORY | Define a term in general | Retrieve our prior decision | “memory” |

## NO_TOOL reasons (only if evidence exists)

`ANSWER_DIRECTLY`, `INSUFFICIENT_INFORMATION`, `UNSUPPORTED_TOOL`, `AMBIGUOUS`, `TOOL_NOT_REQUIRED`, `TOOL_UNAVAILABLE`.

Unsupported live tools (e.g. gym `curl`) are **NO_TOOL** with `UNSUPPORTED_TOOL`, not WEB.

## Hard contrasts in the pool

Labeled **SYNTHETIC** unless they came from gym/test (curl refusals are **REAL_TEST** / **REPLAY**). See `hard-negative-bank.jsonl`.
