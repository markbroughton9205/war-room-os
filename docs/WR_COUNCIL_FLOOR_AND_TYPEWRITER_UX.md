# WR Council Floor and Typewriter UX

Default visible order: ChatGPT → Claude → Grok → Gemini → Red Team. Unconfigured families are skipped. Only one family occupies the floor HUD at a time (`floorStream`).

Typewriter is provider `TEXT_DELTA` coalesced on `requestAnimationFrame`. There is no sleep-based character replay. `prefers-reduced-motion: reduce` flushes immediately.

Social check-in does not run synthesis or Red Team challenge. Floor handoff is immediate after each family terminal state.
