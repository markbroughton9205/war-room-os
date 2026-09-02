# WR Council Full-Visibility UI

Desktop layout (`LiveRoomShell`):

- Left: `CouncilSessionNavigator` (+ New Chat, search, recent sessions, rename, archive)
- Center: Council stream (primary)
- Right: optional `CouncilContextInspector` (Evidence / Research / Terra / Diagnostics)
- Expand Chat: full-width stream (both rails hidden, still mounted)

Synthesis is a final stream message. The old sticky synthesis card is collapsed by default and lives in the inspector, not over the transcript.

Each bubble shows actor and stage (Opening, Response, Challenge, Revision, Final). Hygiene no longer collapses distinct stages of the same family into one ChatGPT Family row.
