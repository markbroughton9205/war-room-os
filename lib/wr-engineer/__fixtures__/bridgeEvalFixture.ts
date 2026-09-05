// WR-Engineer Phase 2 native-builder bridge eval fixture. Dedicated to
// wrEngineerPhase2.validation.ts's bridge_* cases — never shared with
// lib/native-builder's own fixtures (lib/native-builder/__fixtures__/knownIssueFixture.ts),
// specifically so this suite's writes/resets can never clobber another suite's fixture content.
// Never imported by real app code.
export const bridgeFixtureMarker = 'ORIGINAL_MARKER'
