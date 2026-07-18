# Commander Runtime Diagnostics

Commander Runtime Diagnostics is a permanent protected observability surface for War Room OS.

It exists to let the authenticated Commander inspect actual Live Council execution without changing Council behavior. The diagnostic captures one sanitized runtime trace for system auditing.

## Authority

The diagnostic route preserves the existing server-side authorization chain:

1. Production environment gate
2. Authenticated Supabase session
3. Verified Commander identity

Client-side visibility is convenience only. The server does not trust any client-supplied Commander flag.

## Classification

Commander Runtime Diagnostics is classified as:

- featureType: commander_diagnostic
- authority: commander_only
- runtimeImpact: observational
- executionAuthority: none
- memoryWriteAuthority: none
- providerControlAuthority: none

It does not grant operational authority.

## Purpose

The surface exists to:

- inspect actual Council execution
- verify provider-response linkage
- distinguish observed and inferred stages
- inspect Red Team integrity accounting
- verify Scope Guardian integration status
- inspect Council Report maturity
- verify memory-path behavior
- support future incident review

## Boundaries

The diagnostic must never:

- expose cookies
- expose authorization headers
- expose access or refresh tokens
- expose provider keys
- expose service-role values
- expose raw sensitive prompts
- execute actions
- save memory
- create missions
- alter provider state
- trigger automation
- affect ordinary Live Council output

Ordinary Council requests remain trace-disabled. Runtime tracing is captured only by the explicit Commander diagnostic action.

## Phase 47A Status

Authenticated runtime trace gate: passed.

Verification status: independently_reviewed.

Verified environment: production.

The diagnostic remains observational while Phase 47A is closed. It does not implement Mission Lock, Scope Guardian, or Canonical Council Reports.
