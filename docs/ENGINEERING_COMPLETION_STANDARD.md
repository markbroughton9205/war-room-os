# Engineering completion standard

Every implementation completion report, repair packet, phase handoff, migration note, and agent summary **must** include a section titled **NEXT STEPS FOR OPERATOR**.

Use `lib/operator` helpers (`formatOperatorNextStepsMarkdown`, `buildNextStepsFromContext`, repair-packet builders) so output stays consistent.

## Required section

**NEXT STEPS FOR OPERATOR** with these subsections (plain language, numbered steps, mobile-friendly):

1. Required environment changes
2. Required SQL/migrations
3. Restart requirements
4. Verification URLs/routes
5. Expected successful output
6. Feature flags enabled/disabled
7. What should visibly change in UI
8. Safe rollback instruction if needed

If nothing applies for a subsection, write **No operator action required.** for that item, or use a single **No operator action required.** when the entire change is code-only with no deploy/env/DB work.

## Never include

- Secret values, API keys, tokens, or `.env` contents
- Placeholders like `<YOUR_OPENAI_API_KEY>` are allowed; real values are not

## Where this is enforced in code

- Council repair packets (`lib/council-repair`)
- Schema repair packets (`lib/schema-sweep/repairPacket.ts`)
- War Room OS sweep repair packets (`lib/war-room-sweep/repairPacket.ts`)
- Schema sweep API `recommendedNextAction` + `operatorNextSteps`
- Evolution repair intelligence `operatorNextSteps`
- Repair packet API JSON: `operatorNextSteps` (structured) + `operatorNextStepsMarkdown`

## Agent / Cursor rule

See `.cursor/rules/operator-next-steps-reporting.mdc` and example templates in `docs/OPERATOR_NEXT_STEPS.md`.
