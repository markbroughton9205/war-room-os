# WR Council Context Contamination Repair

## Root causes (not a Panama keyword strip)

1. Restore reused the first Live Council conversation (historical Panama thread).
2. Context assembler injected global directives, project state, world knowledge, thread summary, and last 20 messages on greetings.
3. `RAEL_PROFILE` included `Goal: Panama relocation`.
4. Lightweight-ping detection missed `quick status ping` and `Hey council whats going on`.
5. Prior-reply relevance treated short decrees as keep-all and treated `council` as a topic word.
6. Stable Group always ran family-to-family deliberation, skipping live research and feeding assembler context into every family.

## Fix

Architectural isolation: new session UUID, FAST vs FULL policy, gated memory influence, research-before-families, stage identity. No `if text contains Panama, remove it`.
