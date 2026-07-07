# Council Genesis

Phase 46 introduces the permanent Council Entity layer without changing existing provider routing, orchestration, chat behavior, or UI.

## Core Model

War Room is moving from this model:

```text
Commander
-> Provider family
```

to this model:

```text
Commander
-> Council Entity
-> Provider Brain
```

## Provider

A provider is the external or local model service that supplies temporary reasoning capacity. Claude, ChatGPT, Gemini, Grok, Kimi, and Red Team provider paths remain intact during this phase.

Providers do not own identity. They are replaceable brains.

## Council Entity

A Council Entity is the permanent War Room identity. It owns role, mission, specialties, confidence, experience, memory flags, learning flags, and personality version.

Initial entities:

- ARCHITECT maps to Claude Family compatibility.
- STRATEGIST maps to ChatGPT Family compatibility.
- LIBRARIAN maps to Gemini Family compatibility.
- SCOUT maps to Grok Family compatibility.
- ENGINEER maps to Kimi Family compatibility.
- SKEPTIC maps to Red Team compatibility.

Existing code can continue thinking in provider-family names while future systems can resolve those names to permanent entities.

## Brain

A brain is the current model backing an entity. In this foundation phase the brain is only represented by `preferredProviders` and `fallbackProviders`.

No provider invocation logic lives in the entity layer yet.

## Future Memory

Memory will eventually belong to the Council Entity, not the provider brain. This allows the ARCHITECT to keep continuity even if its preferred provider changes later.

In Phase 46 foundation, `memoryEnabled` exists as a field but no new memory behavior is activated.

## Future Learning

Learning will eventually increase experience, adjust confidence, and evolve personality versions through approved War Room memory and feedback loops.

In Phase 46 foundation, `learningEnabled` exists as a field but no new learning behavior is activated.

## Future Independence

Future phases may allow entities to become more independent from any single provider by selecting alternate brains, local engines, or specialized tools.

This phase does not add autonomy. It only creates the identity layer and compatibility registry.

## Behavior Safety

This phase intentionally does not change:

- Existing council orchestration
- Provider routing
- Chat behavior
- UI appearance
- Provider names
- Provider availability
- Memory behavior
- Learning behavior
