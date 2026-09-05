# WR Council Memory Candidate Gating

Path: `app/page.tsx` previously prompted Chronicle save whenever `anySuccess && intent.tier !== 'casual' && !attendanceWave`. `"Council check in"` is coordination-tier, so it spuriously asked to save memory.

Gate: `decideMemoryCandidatePrompt` in `lib/council/live-orchestration/memoryCandidateGate.ts`.

Never prompt for: hi/hey council, council check-in, thanks, okay, status check, routine social pings.

May prompt (still Commander-approved, never auto-save): standing decrees, explicit preferences, architecture decisions, `"From now on, use X for Y."`
