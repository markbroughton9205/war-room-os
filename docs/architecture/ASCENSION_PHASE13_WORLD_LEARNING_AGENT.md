# #22 Phase 13 — Bounded WORLD_LEARNING_AGENT Runtime

**Status:** IMPLEMENTED_BOUNDED  
**Operational Ascension agents:** 9  
**Ascension autonomy:** OFF  
**#22:** CLOSED  
**#23:** WR-CORPUS ACTIVE; tokenizer/WRIM/Ra'el not started  

## Architecture (preserve)

```
AUTHORIZED LEARNING TASK
        ↓
WORLD_LEARNING_AGENT
        ↓
RESEARCH_AGENT / Search Stages 2–5 / Terra Oracle / existing evidence
        ↓
source + provenance evaluation
        ↓
claim / entity / relationship extraction
        ↓
novelty / conflict / confidence
        ↓
structured handoff
        ↓
DATA_CORPUS_AGENT (recommendation only)
```

Critical separations:

- WORLD_LEARNING_AGENT ≠ RESEARCH_AGENT  
- WORLD_LEARNING_AGENT ≠ DATA_CORPUS_AGENT  
- WORLD_LEARNING_AGENT ≠ WR-CORPUS / WR-TOKENIZER / WRIM / Ra'el  
- Understanding / research ≠ execution  
- Model output ≠ evidence  
- Candidate ≠ production corpus  
- Stale ≠ live  
- Commander private ≠ world knowledge  

## Identity

| Field | Value |
| --- | --- |
| agent_role | WORLD_LEARNING_AGENT |
| runtime_version | ascension-phase13-v1 |
| policy_profile | BOUNDED_WORLD_KNOWLEDGE_ACQUISITION |
| autonomous | FALSE |
| soft kill | `ASCENSION_WORLD_LEARNING_AGENT_ENABLED=false` |

## Invocation

- `POST /api/ascension/world-learning-agent/run`
- Local Core: `POST /api/local/ascension/world-learning-agent/run`
- Renderer has no Search/Research privilege.

## Runtime truth after this phase

```
WORLD_LEARNING_AGENT = IMPLEMENTED
WORLD_LEARNING_AGENT_OPERATIONAL = TRUE
OPERATIONAL_ASCENSION_AGENTS = 9
WORLD_LEARNING_CORPUS_HANDOFF = IMPLEMENTED
AUTONOMOUS_CORPUS_PERSISTENCE = FALSE
MODEL_TRAINING = NOT_IMPLEMENTED
WR_CORPUS = IMPLEMENTED / #23 ACTIVE
WR_TOKENIZER = NOT_STARTED (current lane)
WRIM / RAEL = NOT_IMPLEMENTED
ASCENSION_AUTONOMY = OFF
#23 = ACTIVE (WR-CORPUS only)
```
