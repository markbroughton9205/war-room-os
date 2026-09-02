# WR-TOOL RESEARCH Class Forensics

Date: 2026-08-31  
No training. Evidence only.

## EXP-003 fact

EVAL-2 **RESEARCH recall = 0**. Train accuracy on V3 was high. This is a generalization / class-boundary failure, not an r=2 proof.

## V3 RESEARCH training vs EVAL-2 wording

V3 RESEARCH prompts are template families (`res.brief`, `res.short`, `res.web_compete`, …) that almost always contain the literal tokens **research**, **multi-source**, **dossier**, or **synthesis**.

EVAL-2 RESEARCH items (`e2.sel.res`, `e2x.sel.res3`, `e2x.real.res`, …) are family-held-out. Several still contain those tokens (`Produce a multi-source brief…`, `research query=…`). Others paraphrase (`Need a proper multi-source writeup…`, `Dossier please on eval2 cedar…`).

**Finding:** collapse is **not** explained only by EVAL-2 hiding the word `research`. The linear+LoRA classifier did not form a stable RESEARCH region against WEB / MEMORY / FILES on held-out templates.

## Lexical shortcuts

Keyword baseline **beat** EXP-003 on EVAL-2 (0.626 vs 0.504). RESEARCH training overfit to name-of-tool cues. EVAL-2 distractors explicitly mention WEB vs RESEARCH (`One web hit is insufficient; research …`), which a keyword model can use and a poorly separated embedding may not.

## Semantic overlap (runtime)

- **WEB:** `/api/tools/web`, Tavily, single lookup.
- **RESEARCH:** `/api/tools/research`, Tavily + Firecrawl, multi-source synthesis.
- **MEMORY:** auth memory store, prior War Room state.
- **FILES:** workspace path.

Shared Tavily + shared `query` argument schema makes WEB↔RESEARCH the tightest pair.

## Missing real wording

V3 RESEARCH is **synthetic**. This acquisition pass found **three** `research_engine` gym missions (conflict / single / corroborated) mapped as **SUPPORTED** analogs — not live `/api/tools/research`. **REAL_RUNTIME research traces = 0.**

## Class definition

Registry: “Multi-source research synthesis foundation.” Training used the tool **name** as the teaching signal. Natural requests that omit the name were not acquired.

## Do not conclude

r=2 is too small; 19.2M cannot learn tools; LoRA failed; tool learning is impossible.

## Do conclude

RESEARCH needs **real/test wording**, **WEB contrast with identical topics**, and **no keyword-only gold**. EVAL-3 holds out `fam.research.gauges-corroborated` plus synthetic WEB/RESEARCH UTC contrasts.
