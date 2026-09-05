# WR Council Research-First Orchestration

Live Council reuses `lib/research/researchRouter.ts` + `LiveResearchEvidencePacket`. It does not call the research-engine registry on every turn.

## Flow

Commander turn → `classifyCouncilTurn` → research decision (`detectResearchIntent` + Native Router V1 pilot overlay only) → evidence packet → openings / deliberation → Red Team → revision → synthesis.

FAST turns (greetings, status ping, trivial closed-form, local follow-up) skip research and family-to-family deliberation.

FULL freshness-sensitive turns run research **before** family-to-family so families receive the same packet.

World-brief queries are expanded into non-overlapping subquestions for the existing router (`expandResearchQuery`).

Partial worker failure continues with remaining evidence. All-research failure forbids pretending live evidence; synthesis must mark gaps (`applyResearchFailurePolicy`).
