# HVS WORLD GRAPHICS & VISUAL EFFECTS RESEARCH REPORT

| Flag | Value |
|------|-------|
| **Title** | HVS WORLD GRAPHICS & VISUAL EFFECTS RESEARCH REPORT |
| **Date** | 2026-09-22 ET |
| **Commander** | Mark |
| **Mode** | RESEARCH ONLY |
| **LIVE_WEB** | YES |
| **IMPLEMENTATION** | NO |
| **FILES_MODIFIED** | 0 (research artifacts only) |
| **BUILD** | NO |
| **INSTALL** | NO |
| **COMMIT** | NO |
| **PUSH** | NO |
| **DEPLOY** | NO |
| **COMMANDER_DECISION_REQUIRED** | YES |
| **NEBULA_GPU** | UNKNOWN |
| **FROSTBITE** | PROPRIETARY REFERENCE ONLY |
| **PA2_DENSIFY** | FOLDED 2026-09-22 ET |

**Sources folded:** MISSION.md · WAVE_A · WAVE_B · WAVE_C · WAVE_D · AVENGER_EVIDENCE · AVENGER_HISTORIAN · AVENGER_SCIENCE · AVENGER_BLINDSPOT · AVENGER_ENGINEER · **WAVE_PA2_1_DESTRUCTION** · **WAVE_PA2_2_VOLUMETRICS_FLUIDS** · **WAVE_PA2_3_VEHICLE_CLOTH_HAIR_PARTICLES** · **WAVE_PA2_4_LIGHTING_RT_CAMERA** · **WAVE_PA2_5_TRACKING_NERF_UPSCALE** · **WAVE_PA2_6_ASWF_INTERCHANGE** · **WAVE_PA2_7_DESTRUCTION_ENGINE_ARCH** · **WAVE_PA2_8_SYNTHESIS_NOTES** · **sources/PA2_PRIMARY_URLS.md** · **sources/github_license_pins.txt** · **sources/license_raw_pins.md**

**Prior locks honored:** Foundry ≠ HVS ≠ Media ≠ Terra ≠ Council · `.hvsproj` SoT + EditOps · OTIO interchange only · FFmpeg LGPL-prefer · nonfree ship REFUSE · Remotion ≠ OSI OSS · AI restoration/interp OFF-default · Face-ID REJECT · Civil collapse as engineering REFUSE · Real explosives howto REFUSE · Chaos/Unreal/Houdini/Frostbite = REFERENCE or commercial backend · GPL engines = SUBPROCESS/CLI isolate · OpenUSD = TOST-1.0 (Evidence + license_raw_pins) · 3DGS original research license ≠ OSI commercial default · Nebula GPU/VRAM UNKNOWN · Blast = REFERENCE/EVAL (PA2 GameWorks caution — not default OSS path)

**Epistemic legend:** VERIFIED FACT · RESEARCH FINDING · INFERENCE · RECOMMENDATION · UNVERIFIED · UNKNOWN · PRESENT_UNPROVEN

**Conflict resolution:** Blind Spot + Evidence win on license/refuse pins; PA2 densify corrections override Wave A/B/C/D where they strengthen caution (esp. Blast class, physics P0 path, stack finals).

---

## PA2 densification delta

What PA2 packs **added or corrected** relative to the first master fold (Waves A–D + Avengers only):

| Delta | Before (Wave A–D fold) | After PA2 densify | Source |
|-------|------------------------|-------------------|--------|
| **NVIDIA Blast class** | Treated as OPEN SOURCE BSD-3 P0 NATIVE (PhysX `blast/` family; verify on adopt) | Reclassified **SOURCE AVAILABLE / FREE PROPRIETARY (GameWorks; NDev-gated common)** → **REFERENCE/EVALUATE**; own `HvsStructuralGraph` is default — do not treat Blast as default OSS path | PA2_1 · PA2_8 · Blind Spot |
| **Physics P0 path** | Jolt NATIVE as primary P0 runtime | **P0 = Bullet-via-Blender CLI** (GPL host SUBPROCESS); **P1+ = Jolt MIT NATIVE and/or PhysX BSD-3** | PA2_8 · PA2_7 · Engineer |
| **Realtime stack** | wgpu/Three WebGPU primary | Keep wgpu/Three; add **Blender EEVEE previs SUBPROCESS** + optional **Filament** (Apache-2.0) / Godot MIT | PA2_4 · PA2_8 |
| **Comp stack** | Natron + Blender | Add optional **Gaffer** (BSD-family VERIFIED raw pin) | PA2_5 · license_raw_pins |
| **License pins hardened** | Mixed VERIFIED/RESEARCH | Raw LICENSE snips for Bullet Zlib, OpenUSD TOST-1.0, Alembic BSD-3 SPDX, Mitsuba BSD, OpenVDB Apache-2.0, Embree Apache-2.0, Real-ESRGAN BSD-3, RIFE MIT, nerfstudio/gsplat Apache-2.0, OpenCV Apache-2.0, Filament Apache-2.0, OpenPBR Apache-2.0, OIIO Apache-2.0, Chrono BSD, OpenMVG MPL-2.0, Natron GPL-2, Three MIT, Babylon Apache-2.0 | sources/license_raw_pins.md · github_license_pins.txt |
| **OIDN pin** | Apache-2.0 assumed | Repo moved (RenderKit/oidn); **exact SPDX UNVERIFIED this stamp** — reconfirm on integrate; still industry default denoise | PA2_6 · github_license_pins ERROR/404 |
| **OpenFX pin** | BSD-3 prior FHVS | Raw LICENSE 404 this stamp — keep prior pin as RESEARCH FINDING | PA2_5/6 |
| **FILM SPDX** | Apache-2.0 (Evidence VERIFIED) | PA2_5 marked UNVERIFIED this stamp if re-fetch failed — **Evidence pin wins: Apache-2.0** | Evidence > PA2_5 gap |
| **AliceVision/Meshroom LICENSE path** | MPL-2.0 Evidence VERIFIED | Raw path 404 this stamp — keep Evidence MPL-2.0; reconfirm COPYING on integrate | Evidence · license_raw_pins |
| **Destruction Engine** | Present | Densified Intent schema + Foundry `hvs.destruct.*` tool list + performance Small/Medium/Large classes (Nebula still UNKNOWN) | PA2_7 · PA2_1 |
| **Couple rule volumes** | Implied | Explicit: rigid fracture first → emit dust at break faces → VDB; don't full-CFD every brick | PA2_2 |
| **Primary URL inventory** | Scattered | Central `sources/PA2_PRIMARY_URLS.md` (40 pins) | sources/ |
| **Frostbite label** | PARTIAL | Reaffirmed PARTIAL with honest alternates: not FEASIBLE-for-RT · not BLOCKED-for-offline | PA2_8 |

**Unchanged locks (PA2 reaffirmed):** `.hvsproj` SoT · OTIO ≠ renderer · Remotion ≠ OSI · Face-ID REJECT · real explosives REFUSE · AI restore/interp OFF-default · Nebula UNKNOWN · IMPLEMENTATION NOT AUTHORIZED · first mission `HVS-GFX-01_DESTRUCT_PREVIS_KERNEL` HOLD.

---

## 1. Executive summary

This report synthesizes Waves A–D, five Avenger stamps, **eight PA2 densification packs**, and **sources/** license URL pins into a single Commander-facing decision document for **HVS World Graphics / VFX / Simulation**. Mode is **RESEARCH ONLY**. **IMPLEMENTATION NOT AUTHORIZED.** Builds HOLD until Commander Mark names an authorized slice.

**Core finding (RECOMMENDATION / PA2_8):** An open/accessible **offline cinematic** destruction + volumetrics + render + compositing path is **architecturally FEASIBLE** using Blender CLI (Bullet-backed fracture/previs) + Jolt/PhysX (later NATIVE) + OpenVDB + Cycles/OIDN + Natron/Gaffer + OCIO/USD/Alembic/EXR under `.hvsproj` + EditOps as SoT. **Realtime Frostbite-class building-scale destruction parity** remains **PARTIAL** — researched from public EA/SIGGRAPH/Epic docs; open-stack parity at AAA game visual budgets is **unproven**; Nebula hardware is **UNKNOWN**.

**Blast correction (PA2):** Do **not** treat NVIDIA Blast as the default open P0 NATIVE SDK. Classify Blast as **SOURCE AVAILABLE / GameWorks (NDev caution)** → REFERENCE/EVALUATE. Own **HvsStructuralGraph**; use Blender fracture authoring + Jolt/Bullet/PhysX rigid backends.

**First mission (Engineer / PA2_7 — HOLD):** `HVS-GFX-01_DESTRUCT_PREVIS_KERNEL` — P0 brick+glass wall collapse previs (Intent→graph→fracture→Blender CLI→cache hash→`.hvsproj` attach→FFmpeg proxy). HYBRID mode. No proprietary engines. No real blast chemistry. **Commander authorization required before any build.**

**Hard refuses (Blind Spot + PA2_8):** Frostbite source seek · invent Nebula specs · DCC-as-SoT · GPL in-process without Legal · Chaos-as-OSS · game RT as film master · NC/AGPL AI weights in commercial core · Face-ID · real explosives · photogrammetry-as-PD · unproven deterministic GPU cache · zero-copy as PRODUCTION_PROVEN · CapCut scrape.

**Stack posture:** HVS owns Intent/Plan/StructuralGraph/EditOps/ThemeSpec/runtime policy/QC. External DCCs/solvers are SUBPROCESS/CLI/FILE. ASWF libs are NATIVE/FILE leaves. Remotion ≠ SoT. AI upscale/interp/face-enhance OFF-default.

---

## 2. Graphics capability taxonomy

| Class | Meaning | HVS posture | PA2 examples |
|-------|---------|-------------|--------------|
| OPEN SOURCE | OSI-approved | Prefer; GPL/AGPL/MPL = isolate or Legal | Jolt MIT, Bullet Zlib, PhysX BSD-3, Chrono BSD-3, OpenVDB Apache-2.0, OCIO BSD-3, Embree Apache-2.0, Godot MIT, Three MIT, Bevy Apache-2.0, Nerfstudio/gsplat Apache-2.0, Filament Apache-2.0 |
| SOURCE AVAILABLE / FREE PROPRIETARY | Source or binary readable, not OSI drop-in | REFERENCE / gated backend | Unreal/Chaos (Epic), **NVIDIA Blast/GameWorks**, OptiX, Instant-NGP, Remotion |
| COMMERCIAL | Paid DCC/engine | Authoring/FILE/REFERENCE | Houdini, Embergen-class, Golaem, Nuke |
| PROPRIETARY REFERENCE ONLY | Public capability docs only | Checklist — never ship/copy | Frostbite, Chaos architecture patterns |

**Integration modes:** NATIVE · SUBPROCESS · CLI · FILE · REFERENCE · REJECT

**Quality ladders (INFERENCE):** L0 Preview · L1 Interactive · L2 Shot final (baked hero + Cycles/OIDN + EXR/OCIO)

---

## 3. Destruction systems

**Capability definition:** Authoring + runtime that take solid geometry, pre-fracture or dynamically fracture, bind pieces with constraint/glue graphs, propagate strain/damage, simulate rigid-body collapse for **cinematic visual production**.

**Algorithm families (RESEARCH FINDING):** Pre-fracture + glue · Hierarchical clustering · Connection/support graphs · Voronoi/boolean/slicing · Stress solvers · Dynamic runtime fracture (costly)

**Industry preference (VERIFIED — SideFX pattern):** Pre-fracture + glue; Chaos Geometry Collections similarly offline-authored.

### Candidate class matrix (PA2_1 densified)

| Tech | Class | Integration | Role |
|---|---|---|---|
| Bullet (bullet3) | OPEN SOURCE **Zlib** VERIFIED raw LICENSE.txt | SUBPROCESS via Blender first; NATIVE later | Rigid body / contacts |
| Jolt Physics | OPEN SOURCE **MIT** VERIFIED | NATIVE (P1+) or SUBPROCESS | High-perf rigid body |
| PhysX 5 | OPEN SOURCE **BSD-3** VERIFIED | NATIVE possible; Legal+HW review | Rigid / deformable / Flow companion |
| Project Chrono | OPEN SOURCE **BSD-3** VERIFIED | NATIVE/SUBPROCESS | Multi-body, vehicle **motion**, structures |
| Blender Cell Fracture / GeoNodes / Rigid Body | OPEN SOURCE (GPL host) | **SUBPROCESS/CLI** | Fracture authoring + previs (**P0 path**) |
| **NVIDIA Blast** | **SOURCE AVAILABLE / FREE PROPRIETARY (GameWorks; NDev common)** | **REFERENCE / EVALUATE** | Fracture graph **patterns** — **not** default OSS path (**PA2 correction**) |
| Unreal Chaos + GC | PROPRIETARY REFERENCE (Epic) | REFERENCE ONLY | Clusters, damage thresholds, hierarchy |
| Frostbite | PROPRIETARY REFERENCE ONLY | REFERENCE ONLY | Capability-class — **no source seek** |
| Houdini RBD | COMMERCIAL | SUBPROCESS/FILE | Offline hero (seat-gated) |

**Blind Spot residual (PhysX):** older EULA binaries ≠ BSD-3; trademark/endorsement clause; UE5 prefers Chaos — don't assume PhysX-in-UE path.

| CAPABILITY | BEST OPEN TOOL | ALTERNATIVE | LICENSE | RT? | OFF? | MODE | PRI | RECOMMENDATION |
|---|---|---|---|---|---|---|---|---|
| Rigid body physics | Jolt (P1+) / Bullet-via-Blender (P0) | PhysX 5 | MIT / Zlib / BSD-3 | Yes game | Yes | SUBPROCESS→NATIVE | P0/P1 | P0 Blender CLI; P1+ Jolt NATIVE |
| Fracture authoring | Blender GeoNodes/Cell Fracture | Houdini RBD | GPL / Commercial | Previs | Yes | SUBPROCESS | **P0** | INTEGRATE_P0 SUBPROCESS |
| Destruction graph | **Own HvsStructuralGraph** | Blast (evaluate) | Own / GameWorks | N/A | N/A | NATIVE schema | **P0** | Own graph; Blast REF/EVAL |
| Large-scale RT destruction | — | Unreal Chaos (ref) | Epic | Yes game | Partial | REFERENCE | — | REFERENCE_ONLY |
| Multi-body / vehicle motion | Project Chrono | PhysX articulations | BSD-3 | Partial | Yes | NATIVE/SUBPROCESS | P2 | Motion ≠ destruction |
| Debris LOD / sleep | Blender particles + rigid | Custom GPU | GPL / Own | Previs | Yes | SUBPROCESS | P1 | Own LOD policy |

**HVS implication (INFERENCE + PA2):** Author offline in Blender (or commercial Houdini) → `HvsStructuralGraph` asset → runtime Jolt/PhysX (later). Do not require SideFX or Blast at farm playback if caches baked.

---

## 4. Material fracture

**Material packs (PROPOSED — not shipped; PA2_1 / Engineer):** concrete · brick · glass · wood · metal · drywall · stone — art parameters, **not** civil-engineering certifications. **REFUSE** scraped game assets. Civil collapse as engineering = **REFUSE**.

| Material | Fracture bias | Debris | Secondary FX | Structural notes |
|---|---|---|---|---|
| Concrete | Large chunks + rebar-like sticks | Heavy, short travel | Dust VDB | High mass; support columns critical |
| Brick | Mortar-aligned blocks | Medium | Dust + grit | Unitize along courses |
| Glass | Radial / Voronoi panels | Sharp shards | Thin sparkle dust | Low mass; high fragment count |
| Wood | Grain-aligned splinters | Light tumble | Fibers | Anisotropic break |
| Metal | Dent/bend before break | Heavy plates | Sparks particles | Few panels; plastic first |
| Drywall | Soft crumble | Powder | Fine dust | Low structural value |
| Stone | Irregular chunks | Heavy | Dust | Similar to concrete, less rebar |

| CAPABILITY | BEST OPEN | ALT | MODE | PRI | REC |
|---|---|---|---|---|---|
| Material fracture patterns | Blender GN/Cell Fracture (P0) | Houdini RBD Material Fracture | FILE/CLI | P0 | Build HVS material prefab packs |
| Open fracture authoring | Custom Voronoi + own graph | Blast ExtAuthoring (EVAL) | NATIVE/CLI | P0 | Prefer reproducible own packs |
| Budget authoring | Blender GN | — | CLI | P1 | Acceptable P1 content |

**Schema (INFERENCE):** `HvsDestructMaterial { id, density, fracture_toughness_visual, preferred_fracture, glue_*, plasticity, cluster_levels[], secondary_emitters[], audio_tag_prefix, interior_material_slot }`

---

## 5. Structural collapse

**Film approximation only — REFUSE civil/structural engineering.** Progressive collapse = deactivate support edges in structural graph when columns/floors fail **visually**; cascade timed for camera.

### HvsStructuralGraph (PA2_1 densified)

```
Node = part (meshRef, materialClass, mass, integrity, LOD)
Edge = joint/support (kind: weld|hinge|pin|mortar|rebar, strength, breakThreshold)
WeakPlane = preferential fracture (normal, toughness)
LoadPath = support chain for progressive collapse
```

Art-directed mode may override edge strengths / force break order. Physics-driven uses thresholds + impulses. **HYBRID = default** cinematic path.

**Performance classes (relative — Nebula SKU UNKNOWN):**

| Class | Example | Proxy estimate |
|---|---|---|
| Small | Single wall / window | Desktop GPU previs plausible |
| Medium | One building wing | Offline/previs; RT only with heavy LOD |
| Large collapse | Multi-building city block | Offline caches; RT **UNKNOWN** without HW audit |

**OOM active pieces (NOT Nebula-measured):** Preview 10² · Game-cinematic 10³–10⁴ · Heavy RT 10⁴–10⁵ · Offline hero 10⁵–10⁶+.

**Art-directed toolkit:** Constraint weakening · Damage/strain fields · Guided simulation · Anchors unlock · Cluster schedule · Paintable density · Root proxies.

**Nebula:** GPU SKU / VRAM / CPU / TFLOPs / measured piece budget = **UNKNOWN**.

---

## 6. Secondary destruction effects

Effects spawned **from** destruction events: debris chips, dust, sparks, trailing smoke, glass glitter, concrete powder, wood splinters.

**Couple rule (PA2_2):** Rigid fracture first → emit dust emitter at break faces → volume cache. **Don't solve full CFD for every brick.**

| Technique | Label |
|---|---|
| Edge/face disconnect emission | VERIFIED FACT (Houdini Debris Source) |
| Break-event particle bursts | RESEARCH FINDING |
| Trailing dust / collision sparks | RESEARCH FINDING |
| Material-tagged emitters | VERIFIED FACT (EA BF6 public) |
| Instance small debris meshes | RESEARCH FINDING |

**Event schema:** `DestructionCue { t, piece_id, material_id, event: break|collision|trail, pos, vel, mass, impulse, structural_node_id }` → VFX + Audio.

Prefer OpenVDB volumes + GPU/CPU particles after rigid split. Cache as AssetRefs with hash. Bit-identical GPU replay = **PRESENT_UNPROVEN** until golden tests (Blind Spot GFX-BS-11).

| CAPABILITY | BEST OPEN | PRI | REC |
|---|---|---|---|
| Destruction-coupled particles | Custom GPU / event bus / Blender particles | P0/P1 | Event bus: break → emit |
| Dust from debris | Sparse pyro / OpenVDB | P1 | Flipbook atlas for RT |
| Sparks/tracers | GPU ribbon/particle | P1 | Glass/metal materials |

---

## 7. Explosions (visual production ONLY)

### HARD BOUNDARY — REFUSE real explosive engineering
**REFUSE:** Explosive formulation, stoichiometry, real blast overpressure engineering, weaponization, IEDs, charge sizing, shrapnel lethality. Fail: `REAL_EXPLOSIVE_HOWTO`.

**ALLOWED (PA2_1):** Sprite sheets · pre-sim VDB fireball · impulse fields on StructuralGraph · camera shake · audio cues. Outputs `VISUAL_ONLY`.

| Layer | CG approach | Label |
|---|---|---|
| Core fireball | Pyro burn + blackbody / baked VDB | VERIFIED FACT |
| Shockwave ring | Separate pyro / VDB | VERIFIED FACT |
| Debris kick | Impulse field / radial velocity | RESEARCH FINDING |
| Flash / heat haze | Camera/grade / distortion | RESEARCH FINDING |

| CAPABILITY | BEST OPEN | MODE | PRI | REC |
|---|---|---|---|---|
| Hero offline fireball | Houdini Pyro REF / mantaflow bake | FILE | P0 offline | Bake → Flipbook/VDB atlas |
| Realtime explosion cards | Prebaked flipbooks + mesh force | FILE | P0 RT | Prefer bake over live pyro |
| Radial impulse | Solver force field | NATIVE | P0 | On HvsStructuralGraph |
| Real explosives engineering | — | REJECT | REJECT | Refuse |

---

## 8. Fire/smoke

**Sparse Eulerian pyro fields:** density · temperature · velocity · fuel/flame · divergence/pressure · active/stencil.

**Seminal:** Nguyen/Fedkiw/Jensen SIGGRAPH 2002. Film solvers = **visual energy models**, not chemistry.

| CAPABILITY | BEST OPEN | ALT | LICENSE | MODE | PRI | REC |
|---|---|---|---|---|---|---|
| Sparse volume SoT | **OpenVDB** | — | Apache-2.0 **VERIFIED** raw + GitHub | NATIVE/FILE | P0 | Lock VDB currency |
| GPU read-only | **NanoVDB** | — | OpenVDB tree Apache-2.0 (re-check file headers) | NATIVE | P0 | Convert at render boundary |
| Smoke/fire sim | Blender Mantaflow | Houdini pyro | GPL / Commercial | SUBPROCESS | P1 | Bake → `.vdb` |
| Realtime sparse fluid | NVIDIA Flow (eval) | Embergen | BSD-3? / Comm — confirm on integrate | EVALUATE | P2 | Optional RT |
| Volume beauty | Cycles NanoVDB | OSPRay / Mitsuba | Apache / GPL host | CLI | P0 | Default open beauty |
| UsdVol | UsdVol + OpenVDBAsset | Raw `.vdb` | OpenUSD TOST-1.0 | FILE | P0 | Prefer schema |

---

## 9. Volumetrics

**OpenVDB (VERIFIED Apache-2.0):** Hierarchical sparse grid — storage, CSG, resampling, filtering, level sets, particle→volume — **not itself a pyro solver**.

**NanoVDB:** Read-only linearized GPU/CPU representation. Pin exact SPDX with OpenVDB tree on integrate (PA2_2 RESEARCH FINDING).

**Storage (INFERENCE):** VDB sequences dominate — plan **TB-class** caches for long shots. Building dust = Med-High RAM/VRAM; city fire+flood = Extreme / UNKNOWN on Nebula.

**Quality ladders:** Always offline bake + optional RT preview. Exact voxel budgets = UNKNOWN until Nebula audit.

---

## 10. Fluids

| Technique | Open exemplar | Film fit |
|---|---|---|
| FLIP/APIC | mantaflow; FLIP Fluids engine MIT | Default bulk liquid |
| SPH | SPlisHSPlasH MIT; DualSPHysics LGPL-2.1 | Spray / mist secondary |
| Shallow-water | Heightfield | Wide floods |
| Ocean FFT | Blender Ocean | Bg seas |
| Whitewater | Particle layers | Foam/spray |

| CAPABILITY | BEST OPEN | LICENSE | MODE | PRI | REC |
|---|---|---|---|---|---|
| FLIP liquid | mantaflow / Blender | Apache/GPL | SUBPROCESS | P1–P2 | Local domains |
| SPH | SPlisHSPlasH | MIT | NATIVE/CLI | P1 | MIT-first splash |
| Flood / liquid hero | Mantaflow liquid | GPL | SUBPROCESS | P2 | Very High CPU/RAM |
| Wet maps | Dynamic Paint / attrib | Open | NATIVE/FILE | **P0** | Huge perceived quality |
| OpenFOAM CFD | — | GPL | REJECT film default | P3 | Wrong tool class |

---

## 11. Weather

Layered composition: precip particles + puddles/wet maps + fog/cloud VDB + lightning + wind fields. **Not** full meteorology CFD (**REJECT**).

| Layer | Tech | Pri |
|---|---|---|
| Rain/snow/hail | Particles / GeoNodes | P0 |
| Wetness | Wet maps + shader | **P0** |
| Fog / clouds | OpenVDB density + noise | P0–P1 |
| Sandstorm / tornado-like | Sparse pyro + guided velocity | P2 |
| Lightning / wind | Procedural HVS | P1 |
| Weather FX pack | GeoNodes+particles | P2 |

---

## 12. Vehicle physics

**SEPARATE from vehicle destruction (MISSION + PA2_3 lock).**

| CAPABILITY | BEST OPEN | LICENSE | MODE | PRI | REC |
|---|---|---|---|---|---|
| Game-quality vehicle | **Jolt VehicleConstraint** | MIT | NATIVE | P0 (runtime) / after P0 destr | Default motion backend |
| Engineering dynamics | **Project Chrono** | BSD-3 VERIFIED | NATIVE/SUBPROCESS | P2 | Offline plates |
| PhysX articulations | PhysX 5 | BSD-3 | NATIVE later | P2 | Alt |
| Simple raycast | Bullet vehicle | Zlib | NATIVE | P3 | Prototype |
| UE Chaos Vehicle | Chaos | Epic | REFERENCE | P2 | Architecture study |

Motion solver emits transforms/impulses to separate vehicle-destruction graph.

---

## 13. Vehicle destruction

Same destruction pipeline as buildings (PA2_3): panel fracture, glass shatter, wheel detach, visual crumple — **not** drive AI.

| CAPABILITY | BEST OPEN | PRI | REC |
|---|---|---|---|
| Panel fracture graph | Blender fracture+rigid / later Jolt+own graph | P2 | Same HvsDestruct |
| Hero crumple offline | Houdini RBD Car REF / Blender | P1–P2 | Bake hero crashes |
| Glass shatter | Prefracture glass clusters | P0 packs | Glass prefabs in material library |

---

## 14. Cloth

| Method | Notes | Label |
|---|---|---|
| PBD / XPBD | Stable RT-friendly | VERIFIED Macklin 2016 |
| Vellum | Production XPBD+ COMMERCIAL | REFERENCE |
| Blender cloth | PBD-like; GPL host | SUBPROCESS |
| ARCSim | Non-commercial Berkeley | **REJECT** ship |
| FleX | Legacy proprietary | **REJECT** |

**PA2_3 RECOMMENDATION:** P0 destruction does **not** require custom XPBD; use Blender cloth/soft as SUBPROCESS for **P2**.

| CAPABILITY | BEST OPEN | MODE | PRI | REC |
|---|---|---|---|---|
| XPBD research lib | PositionBasedDynamics MIT | NATIVE | P1–P2 | After destr kernel |
| Engine soft+cloth | Jolt SoftBody | NATIVE | P1 | Align with Jolt |
| Production authoring | Vellum / Blender Cloth | FILE/CLI | P2 | Bake caches |

---

## 15. Soft bodies

Deformable volumes: flesh, tires, bags, plastic crumple. Blender soft body (GPL SUBPROCESS) · PhysX deformables (BSD-3) · Jolt SoftBody · FEM (SOFA/Vega) P3 niche only.

**RECOMMENDATION:** Prefer single physics vendor later (Jolt); P0–P1 do not block on soft bodies.

---

## 16. Hair/fur

| CAPABILITY | BEST OPEN | MODE | PRI | REC |
|---|---|---|---|---|
| Realtime hair | Cards/shells + simple guides | FILE+NATIVE | **P0** pragmatic | Default RT: cards |
| DCC hair bake | Blender hair curves | CLI/FILE | P1–P3 | Export caches |
| Production hair | Vellum / Yeti/XGen REF | FILE/REF | P1 | Author + cache |
| USDHair schemas | OpenUSD | FILE | P3 | EVALUATE |

Alembic groom interchange. Do not lock SoT to XGen. Facial hair ≠ Face-ID.

---

## 17. Particles

Niagara = PROPRIETARY REFERENCE ONLY (architecture vocabulary).

| CAPABILITY | BEST OPEN | MODE | PRI | REC |
|---|---|---|---|---|
| Millions of particles | Custom GPU + HVS buffer SoT | NATIVE | P0 | Design SoT early |
| Particle interchange | USD Points + Partio | FILE | P0 | Standardize USD |
| Debris / sparks previs | Blender particles | SUBPROCESS | **P1** | Debris LOD |
| Sprites / mesh instances | Custom / Three / USD | NATIVE/FILE | P0 | Camera-aligned / LOD |
| Particles ↔ volumes | OpenVDB rasterize | NATIVE | P0 | Bridge to dust |
| Deterministic seeds | RNG in `.hvsproj`/EditOps | NATIVE | P0 | Automation lock |
| Godot particles | MIT VERIFIED | OPTIONAL preview | P2 | ≠ film SoT |

---

## 18. Procedural geometry

| Capability | Best open | Mode | Pri | Rec |
|---|---|---|---|---|
| Node procedural mesh | Blender Geometry Nodes | CLI/SUBPROCESS | P0 | GN+Python automation |
| USD generative procedural | OpenUSD HdGp | NATIVE/FILE | P0 | TOST-1.0 stage |
| Scatter / instancing | GN + USD PointInstancer | NATIVE/FILE | P0 | Forests/cities/debris |
| CSG / SDF | OpenVDB tools | CLI/FILE | P1 | Destruction masks/craters |

**REJECT** Houdini Apprentice for production.

---

## 19. Terrain

| Capability | Best open | Mode | Pri | Rec |
|---|---|---|---|---|
| Heightfields | Blender GN + EXR height | CLI/FILE | P0 | EXR height SoT |
| Erosion | Open algorithms / custom | REFERENCE/CLI | P1 | |
| Vegetation scatter | GN + USD PointInstancer | FILE | P0 | |
| Craters / impact | SDF/boolean + debris | CLI | P0 | Parametric crater library |
| DEM ingest | GDAL | CLI | P1 | Legal sources only; viewable ≠ PD |

---

## 20. Materials/shaders

| Capability | Best open | License | Mode | Pri | Rec |
|---|---|---|---|---|---|
| Studio material graph | **MaterialX** | Apache-2.0 VERIFIED | NATIVE/FILE | P0 | **SoT materials** |
| Standard surface | **OpenPBR** | Apache-2.0 VERIFIED raw | FILE | P0 | Lookdev interchange |
| USD binding | USDShade + MaterialX | TOST-1.0 / Apache | NATIVE | P0 | Pipeline glue |
| Realtime PBR | glTF 2.0 + KHR_* | Khronos | FILE | P0 | Web/viewport |
| Filament PBR | Filament | Apache-2.0 VERIFIED raw | NATIVE optional | P1 | RT PBR engine |
| Substance | Adobe | COMMERCIAL | REFERENCE | P3 | Reject dependency |

---

## 21. Lighting

| Capability | Technique | Pri | Rec |
|---|---|---|---|
| Raster lighting | Forward/deferred PBR, shadows, SSAO | P0 | RT viewport |
| IBL | HDRI latlong (asset rights separate) | P0 | |
| AO | SSAO/GTAO/ray AO | P1 | AOV passes |
| GI bake | Lightmaps / irradiance | P1 | Offline bake |
| ReSTIR DI/GI | Reservoir resampling; RTXDI license gate | P1 | RT viewport v2 |
| Path-traced GI | Cycles / Mitsuba / LuxCore / PBRT | P0 cinematic | Farm beauty |

---

## 22. Ray/path tracing

| Renderer | License pin | Mode | Pri | Rec |
|---|---|---|---|---|
| **Cycles** | Engine Apache-2.0; Blender host GPL | CLI/SUBPROCESS | P0 | Primary cinematic |
| **Embree** | Apache-2.0 VERIFIED raw RenderKit | NATIVE/via Cycles | P0 | CPU BVH |
| **OptiX** | NVIDIA FREE PROPRIETARY | REFERENCE/runtime | P1 | When present |
| **Vulkan RT** | Khronos | NATIVE | P0 | HVS-owned RT |
| **Mitsuba 3** | BSD-3-style VERIFIED raw | CLI | P1 | Science |
| **LuxCore** | Apache-2.0 VERIFIED | CLI | P2 | Optional beauty |
| **PBRT v4** | Apache-2.0 VERIFIED raw | CLI | P2 | Ground truth |
| **OIDN** | ASWF/RenderKit — **SPDX reconfirm** (repo move; pin UNVERIFIED this stamp) | NATIVE/CLI | P0 | Industry denoise default |

Farm = Cycles + OIDN + Embree CPU fallback. Nebula device = UNKNOWN.

---

## 23. Camera graphics

Schema (INFERENCE): `focal_mm, focus_m, f_stop, shutter_angle_deg, film_back, anamorphic_squeeze, distortion_profile_id, grain_preset, bloom_threshold, ev`.

| Effect | Pri | Notes |
|---|---|---|
| DoF / MB / shutter / EV / shake | P0 | Exact offline; approx RT |
| Lens distortion / bloom / grain | P0 | Comp-friendly |
| CA / anamorphic / vignette / flare | P1 | Art-direct |
| Rolling shutter | P2 | Default OFF cinematic |

**PA2_4:** Destruction CameraPlan = shake/focus as **CameraSpec** — ≠ Terra maps. Align Camera A/B/C classes (Multicam / Generative / Virtual follow / Cinematic CG).

HVS **owns** CameraSpec, look intent, QC, `.hvsproj` attachment. Renderers = execution backends ≠ truth.

---

## 24. Motion graphics

| Tool | License | Mode | Pri | Rec |
|---|---|---|---|---|
| SVG + Canvas | Browser | NATIVE/CLI | P0 | Safe 2D |
| Three.js | MIT VERIFIED raw | NATIVE | P0 | 3D titles |
| FFmpeg | **LGPL-prefer** | CLI | P0 | Encode; nonfree REFUSE |
| wgpu / WebGPU | Apache-2.0 (wgpu; LICENSE path variance) | NATIVE | P1 | |
| Lottie / Rive runtimes | MIT | NATIVE | P1 | Assets separate |
| Blender | GPL | CLI | P1 | Heavy 3D |
| **Remotion** | ≠ OSI OSS | REJECT core | P3 | Prior lock |

---

## 25. Compositing

| Tool | License | Mode | Pri | Rec |
|---|---|---|---|---|
| **Natron** | GPL-2.0 VERIFIED raw LICENSE.txt | CLI/SUBPROCESS | P0 | Nuke-like OFX host |
| **Blender Compositor** | GPL | CLI | P0 | .blend continuity |
| **Gaffer** | BSD-family VERIFIED raw | CLI optional | P1–P2 | Advanced lighting/comp graph (**PA2 add**) |
| OpenFX | BSD-3 prior FHVS (raw 404 this stamp) | Host | P1 | RESEARCH FINDING pin |
| Nuke / Houdini COPs | COMMERCIAL | REFERENCE | P2–P3 | Ceiling only |

---

## 26. Keying

| Method | Best open | Trap | Pri | Rec |
|---|---|---|---|---|
| Chroma + spill | Natron/Blender | Spill lighting | P0 | Prefer real chroma |
| AI image matting | rembg MIT code | Weights often NC/BRIA | P1 | Cleared weights only |
| AI video matting | RVM GPL-3 | Copyleft | P1 | SUBPROCESS + Legal |
| BackgroundMattingV2 | MIT | Needs clean BG | P1 | Prefer with plate |
| Ultralytics YOLO | Often AGPL-3.0 | Blind Spot | — | Not proprietary core without Enterprise |

Production default = chroma + spill. AI OFF unless cleared. ≠ Face-ID.

---

## 27. Tracking

| Tool | License | Mode | Pri | Rec |
|---|---|---|---|---|
| **OpenCV** | Apache-2.0 VERIFIED raw | NATIVE | P0 | Default CV |
| **COLMAP** | BSD-3 (Evidence VERIFIED; raw COPYING 404 this stamp) | CLI | P0 | Primary SfM |
| Blender Motion Tracking | GPL | CLI | P1 | Shot solve |
| OpenMVG | MPL-2.0 VERIFIED raw | CLI | P2 | Alt SfM |
| OpenMVS | AGPL-3.0 (Evidence) | CLI isolate | P2 | AGPL SaaS trap |
| AliceVision / Meshroom | MPL-2.0 Evidence (raw path 404 this stamp) | CLI | P1 | Reconfirm COPYING |

---

## 28. Character animation

| CAPABILITY | BEST OPEN | MODE | PRI | REC |
|---|---|---|---|---|
| Skeleton + FK | glTF skins + thin HVS runtime | NATIVE+FILE | P0 | OWN thin skel |
| IK / retarget | Custom + Blender leaf | NATIVE/CLI | P1 | Maps in `.hvsproj` |
| Root motion | Own clip metadata | NATIVE | P0 | Must own |
| Ragdoll | Jolt / Bullet | NATIVE | P1 | Prefer Jolt/Bullet |
| Anim bake | Alembic / USD Skel | FILE | P0 | Bake interchange |

HVS OWNS pose graph, clip IDs, root-motion, retarget maps. Remotion ≠ character runtime.

---

## 29. Facial animation (REJECT Face-ID)

| Allowed | Refused |
|---|---|
| Blendshape / FACS / lip sync / consented capture | Face recognition, biometric enrollment, 1:N identity, scrape-to-identity |

| CAPABILITY | BEST OPEN | PRI | REC |
|---|---|---|---|
| Blendshapes | glTF morphs / USD blendShapes | P0 | Own morph evaluate |
| FACS channels | Own schema | P1 | Map in `.hvsproj` |
| Lip sync | MFA MIT / open aligners | P1 | Own viseme table |
| Neural audio→face | Research (license gate) | P2 | OFF-default |
| Face restore | GFPGAN/CodeFormer | P3 | OFF-default; likeness warning |
| **Face-ID** | — | — | **REJECT** |

---

## 30. Crowds

| CAPABILITY | BEST OPEN | PRI | REC |
|---|---|---|---|
| Steering / navmesh | Recast/Detour | P1 | Flee + bake |
| Avoidance | RVO2 Apache-2.0 | P1 | Dense streets |
| Crowd LOD | Own impostors | P1 | Own policy |
| Cinematic cache | Alembic / USD instancers | P2 | Final path |
| Golaem | COMMERCIAL REF | — | Quality bar |

For Frostbite-class city destruction, crowds secondary — prioritize flee + impostors (P0–P1).

---

## 31. Photogrammetry

| CAPABILITY | BEST OPEN | LICENSE | PRI | REC |
|---|---|---|---|---|
| SfM | COLMAP | BSD-3 | P1–P2 | Default SfM |
| End-to-end | Meshroom / AliceVision | MPL-2.0 | P1 | Integrated OSS |
| MVS dense | OpenMVS / COLMAP MVS | AGPL / BSD | P2 | Isolate AGPL |
| Capture rights | — | — | **P0** | AssetProvenance always |

**Blind Spot GFX-BS-10:** Capture ≠ PD. Architecture/art/people rights separate. Ingest factory → Asset catalog → USD/glTF. Never COLMAP DB alone as SoT.

---

## 32. NeRF / Gaussian splats

| Use case | Prefer |
|---|---|
| Destruction / collision / editable heroes | Meshes + VDB |
| Background novel-view / set extension | 3DGS / NeRF |
| Realtime previs of capture | gsplat (Apache-2.0 VERIFIED raw) |

| Tool | License | Rec |
|---|---|---|
| **gsplat** | Apache-2.0 VERIFIED | Prefer; ADOPT-OFF-DEFAULT |
| nerfstudio | Apache-2.0 VERIFIED | Optional framework |
| Instant-NGP | NVIDIA Source Code License ≠ OSI | Gate |
| Original Inria 3DGS | Custom research; commercial needs consent | ≠ OSI commercial default |

**PA2_5:** NeRF/GS = plate/environment assist — **not** Frostbite destruction substitute. Dynamic 4D = PRESENT_UNPROVEN.

---

## 33. Upscaling/restoration

**OFF-default** (historical lock + PA2_5). Opt-in EditOps only.

| CAPABILITY | BEST OPEN | LICENSE | DEFAULT | PRI | REC |
|---|---|---|---|---|---|
| Upscale | **Real-ESRGAN** | BSD-3 VERIFIED raw | OFF | P1 | Opt-in; tile low VRAM |
| Video SR | BasicVSR++ | Apache-2.0 | OFF | P2 | Archive |
| Face restore | GFPGAN/CodeFormer | Apache common | OFF | P3 | Likeness danger |
| Topaz | COMMERCIAL | — | — | — | REFERENCE ONLY |

---

## 34. Frame interpolation

| CAPABILITY | BEST OPEN | LICENSE | DEFAULT | PRI | REC |
|---|---|---|---|---|---|
| Learned interp | **RIFE** | MIT VERIFIED raw | OFF | P1 | Opt-in; artifact QC |
| Film-oriented | **FILM** | Apache-2.0 (Evidence VERIFIED; wins over PA2_5 gap) | OFF | P1 | Large motion |
| Classical flow | OpenCV | Apache/BSD | — | P2 | Fallback |

Fail: `RIFE_AS_MASTER` — refuse as editorial/physics SoT. Tag `hvs.gen.interp`. Weights audit may remain UNVERIFIED vs MIT code.

---

## 35. Color/HDR

| CAPABILITY | BEST OPEN | LICENSE | MODE | PRI | REC |
|---|---|---|---|---|---|
| Color framework | **OCIO** v2 | BSD-3 VERIFIED | NATIVE | **P0** | Studio spine |
| Scene-referred HDR | **OpenEXR** | BSD-3 VERIFIED | FILE | P0 | Canonical intermediate |
| Image I/O | **OpenImageIO** | Apache-2.0 VERIFIED raw | CLI/SDK | P0 | Plate pipeline |
| ACES | via OCIO configs | Open specs | via OCIO | P0 | Studio CM intent |
| Display HDR | HDR10/HLG via FFmpeg LGPL | — | CLI | P1 | Dolby Vision gate/REFUSE core |
| LUT / CDL | OCIO FileTransform | — | FILE+EditOps | P0 | Non-destructive |
| SDR default | Rec.709 | — | NATIVE | P0 | Until HDR slice |

**PA2_6 architecture:** `EXR beauty+AOVs → OCIO/ACES looks (HVS NATIVE color) → ThemeSpec.grade → encode (FFmpeg LGPL)`. OTIO ≠ renderer.

---

## 36. Scene interchange

| Layer | Canonical (SoT) | Interchange | License pin |
|---|---|---|---|
| Project/edit/rights/ThemeSpec | **`.hvsproj` + EditOps** | OTIO | Own / Apache-2.0 |
| Scene composition | HVS Scene Graph refs | **OpenUSD** | **TOST-1.0** VERIFIED raw (≠ plain Apache) |
| Runtime mesh | — | **glTF 2.0** | Apache-2.0 spec |
| Baked anim/FX | — | **Alembic** | BSD-3 SPDX VERIFIED raw |
| Materials | ThemeSpec + subset | **MaterialX / OpenPBR** | Apache-2.0 |
| Volumes | Sim params in project | **OpenVDB** | Apache-2.0 |
| Beauty | Render settings | **OpenEXR** | BSD-3 |
| Color intent | Look IDs | **OCIO** | BSD-3 |
| Assets | HVS catalog + provenance | OpenAssetIO | Apache-2.0 |

**REJECT as SoT:** Remotion, `.blend` alone, `.umap` alone, COLMAP DB alone, NeRF checkpoints, Chaos levels.

---

## 37. Real-time rendering

| Stack | License | Mode | Pri | Rec |
|---|---|---|---|---|
| **WebGPU / wgpu** | MIT OR Apache-2.0 | NATIVE | P0 | Strategic HVS viewport |
| **Three.js WebGPURenderer** | MIT VERIFIED | NATIVE | P0 | Director preview |
| **Blender EEVEE** | GPL host | SUBPROCESS | **P1** | Previs (**PA2_8**) |
| **Filament** | Apache-2.0 VERIFIED | NATIVE optional | P1 | PBR realtime (**PA2 add**) |
| Babylon.js | Apache-2.0 VERIFIED | NATIVE | P1 | Batteries-included |
| Bevy | Apache-2.0 VERIFIED | NATIVE | P1 | Rust host |
| Godot 4 | MIT VERIFIED | SUBPROCESS/REF | P2 | Optional RT — ≠ film SoT |
| Unreal Lumen/Nanite | Epic | **REFERENCE** | P3 | Do NOT copy |

Game engines ≠ film SoT (Blind Spot GFX-BS-06). Nebula GPU/VRAM = UNKNOWN.

---

## 38. Offline rendering

| Component | Choice | License | Pri |
|---|---|---|---|
| Orchestrator | Blender CLI | GPL package | P0 |
| Path tracer | Cycles | Apache-2.0 engine | P0 |
| Denoise | OIDN | Reconfirm SPDX (repo move) | P0 |
| Looks | MaterialX / OpenPBR | Apache-2.0 | P0 |
| Outputs | OpenEXR + OCIO | BSD-3 | P0 |
| Alt | LuxCore / Mitsuba / PBRT | Apache / BSD / Apache | P1–P2 |

Integration: CLI/SUBPROCESS/FILE. Prefer subprocess isolation for GPL host.

---

## 39. GPU compute

| Class | Examples | Notes |
|---|---|---|
| CUDA | Cycles OptiX, PhysX GPU, Flow | NVIDIA-tied; Nebula SKU **UNKNOWN** |
| HIP/Metal | Cycles backends | Portability |
| Vulkan compute/RT | Cross-vendor | Long-term |
| WebGPU/wgpu | Preview agents | ≠ film master |

Policy: Abstract `ComputeDevice` (CUDA|Vulkan|CPU). Never hardcode Nebula VRAM. CPU fallbacks mandatory. Zero-copy = PRESENT_UNPROVEN.

---

## 40. ASWF ecosystem

| Project | SPDX pin | Label |
|---|---|---|
| OpenColorIO | BSD-3-Clause | VERIFIED |
| OpenEXR | BSD-3-Clause | VERIFIED |
| OpenImageIO | Apache-2.0 | VERIFIED raw |
| OpenTimelineIO | Apache-2.0 | VERIFIED |
| OpenVDB | Apache-2.0 | VERIFIED |
| MaterialX | Apache-2.0 | VERIFIED |
| OpenPBR | Apache-2.0 | VERIFIED |
| OpenFX | BSD-3 prior (raw 404) | RESEARCH FINDING |
| **OpenUSD** | **TOST-1.0** (Apache-derived; trademarks §6 differs) | VERIFIED raw LICENSE.txt |
| Alembic | BSD-3-Clause SPDX | VERIFIED raw |
| Embree | Apache-2.0 | VERIFIED |
| OpenImageDenoise | Confirm at integrate (RenderKit move) | UNVERIFIED exact this stamp |

Adopt ASWF as leaves/SDKs; never replace `.hvsproj` SoT. OTIO = editorial I/O only.

---

## 41. Frostbite-class destruction capability analysis (PUBLIC reference only)

**Classification: PROPRIETARY REFERENCE ONLY** — no source seeking.

### Public capability checklist

| Capability class | Public evidence | Open/HVS approach | Pri |
|---|---|---|---|
| Part-based hierarchical destruction | EA BF6 2025-11-10; SIGGRAPH 2010 | HvsStructuralGraph + Jolt/Bullet/PhysX | P0 |
| Debris spawning | EA BF6 | Event → mesh/particle | P0 |
| Systemic + art-directed | EA BF6 “not moonscape” | Fields + guided + anchors | P0 |
| Persistent destroyed state | EA BF6 | Cache + broken bonds | P0 |
| Material-aware VFX/audio | EA BF6 | Material tags → cues | P0 |
| Vehicle ↔ destruction | EA BF6 narrative | Separate motion + destruct | P0 |
| Terrain deformation | BF3 GDC PDF | Heightfield damage | P1 |
| Destruction masking | SIGGRAPH 2010 PDF | Damage masks / decals | P1 |
| Network prioritization | EA BF6 MP | Film N/A; preview LOD | P2 |

### Verdict (PA2_8 reaffirm)

| Axis | Status | Justification |
|---|---|---|
| Research coverage | RESEARCHED | Techniques + PA2 densify |
| Offline open pipeline | FEASIBLE (architecture) | Blender+Jolt/Bullet/PhysX+OpenVDB+OCIO/EXR/USD/Alembic |
| Realtime Frostbite-parity | PARTIAL / BLOCKED-for-parity | Unproven; Nebula UNKNOWN; Chaos/Frostbite proprietary |
| Headless automation | FEASIBLE | Blender/COLMAP/gsplat/OCIO/FFmpeg |
| Legal AI / original 3DGS | PARTIAL | Prefer Apache/BSD; gate NC; OFF-default |
| Nebula proof | BLOCKED (evidence) | UNKNOWN |

**Alternates rejected as sole labels:** RESEARCHED alone (incomplete) · FEASIBLE for RT (overclaim) · BLOCKED for offline (false — OSS path exists).

**One-line:** **FROSTBITE-CLASS BUILDING DESTRUCTION: PARTIAL**

---

## 42. HVS Destruction Engine architecture proposal

**IMPLEMENTATION NOT AUTHORIZED** — research only (Engineer + PA2_7).

### Pipeline

```
Intent → Plan → StructuralGraph → Fracture → Constraints → Physics
  → Debris → Dust/Smoke → Audio → Camera → Cache → Previs → Final
```

```
HvsDestructionIntent
  → DestructionPlan
  → StructuralGraph (parts, joints, support, weak planes)
  → Fracture (pre-fracture or runtime)
  → Constraints (hinges, welds, pins, thresholds)
  → PhysicsStep (rigid/soft/hybrid; substeps)
  → Debris (chunks, LOD, sleep, cleanup)
  → SecondaryFX (dust/smoke/sparks/glass) → OpenVDB/particles
  → AudioCues (AssetRefs — not Media SoT)
  → CameraPlan (shake/focus — CameraSpec; ≠ Terra)
  → Cache (versioned, hashed, env pins: engine/build/GPU/driver)
  → PrevisRender → FinalRender → hvs.render.* → QC → archive
```

Receipts on every stage for Foundry CompletionTruth. Tips≠ops.

### Intent schema (PROPOSED)

```
HvsDestructionIntent {
  id, shotIds[],
  mode: ART_DIRECTED | PHYSICS_DRIVEN | HYBRID,
  targets: [{ meshRef, materialClass, integrity0..1 }],
  impulse: { kind: blast|impact|cut|collapse, direction?, magnitude? },
  look: { dustAmount, glassShatterStyle, debrisTravel },
  physics: { gravity, substeps, sleepThreshold },
  camera: CameraSpecRef?,
  audio: { packId?, intensity },
  quality: PREVIS | FINAL,
  authority, provenance
}
materialClass: concrete|brick|glass|wood|metal|drywall|stone|custom
```

Default **HYBRID**. Never market “Frostbite compatible.”

### Own vs external (PA2_7)

| Own (HVS truth) | External backend |
|---|---|
| Intent, Plan, StructuralGraph, art knobs | Blender CLI fracture/sim/render |
| Cache index + hashes in `.hvsproj` | Houdini pyro/RBD (commercial seats) |
| Material packs + SPDX provenance | Unreal Chaos cook (REFERENCE/optional) |
| QC, EditOps, ThemeSpec/OCIO | FFmpeg encode |
| Typed Foundry tools `hvs.destruct.*` | Blast GameWorks REFERENCE/EVAL |

**REJECT as SoT:** Chaos/Frostbite source, CapCut packs, Remotion-as-OSS, Media howler viewport, Terra Cesium as destruction viewport.

### Typed tools (PROPOSED)

`hvs.destruct.intent_validate` · `plan` · `structural_build` · `fracture` · `sim_run` · `secondary_fx` · `audio_cues` · `camera_apply` · `previs_render` · `final_render` · `qc`

### Integration defaults (Blind Spot + PA2_7)

| Backend | Mode |
|---|---|
| Blender | SUBPROCESS/CLI/FILE (GPL — avoid in-process) |
| Jolt / Chrono / PhysX BSD-3 | NATIVE possible after Legal |
| OpenVDB/OCIO/EXR/USD/Alembic | FILE + NATIVE libs |
| Unreal/Chaos / Houdini | SUBPROCESS/FILE/REFERENCE |
| Blast GameWorks | REFERENCE/EVALUATE — account/redistrib caution |
| AI upscale/matte | SUBPROCESS + OFF defaults; AGPL/NC gate |

---

## 43. Licensing

### Hardened SPDX pins (Evidence + PA2 sources/)

| Project | SPDX / terms | Pin status |
|---|---|---|
| Jolt | MIT | VERIFIED GitHub |
| Bullet | **Zlib** (LICENSE.txt; GitHub SPDX NOASSERTION) | VERIFIED raw |
| PhysX 5 | BSD-3-Clause | VERIFIED; binary EULA residue caution |
| Chrono | BSD-3-Clause | VERIFIED raw |
| OpenVDB | Apache-2.0 | VERIFIED raw |
| Embree | Apache-2.0 | VERIFIED raw |
| MaterialX / OpenPBR | Apache-2.0 | VERIFIED |
| **OpenUSD** | **TOST-1.0** | VERIFIED raw LICENSE.txt |
| Alembic | BSD-3-Clause SPDX | VERIFIED raw |
| OCIO / OpenEXR | BSD-3-Clause | VERIFIED |
| OTIO / OIIO | Apache-2.0 | VERIFIED |
| Mitsuba 3 | BSD-3-style | VERIFIED raw |
| LuxCore / PBRT / Filament | Apache-2.0 | VERIFIED |
| Three.js | MIT | VERIFIED raw |
| Babylon / Bevy / wgpu | Apache-2.0 (wgpu dual common) | VERIFIED / RESEARCH |
| Godot | MIT | VERIFIED |
| Natron | GPL-2.0 | VERIFIED raw |
| Gaffer | BSD-family | VERIFIED raw |
| OpenCV | Apache-2.0 | VERIFIED raw |
| COLMAP | BSD-3 | Evidence VERIFIED |
| OpenMVG | MPL-2.0 | VERIFIED raw |
| OpenMVS | AGPL-3.0 | VERIFIED Evidence |
| Real-ESRGAN | BSD-3-Clause | VERIFIED raw |
| RIFE | MIT | VERIFIED raw |
| FILM | Apache-2.0 | Evidence VERIFIED |
| nerfstudio / gsplat | Apache-2.0 | VERIFIED raw |
| Original Inria 3DGS | Custom research | ≠ OSI commercial default |
| Instant-NGP | NVIDIA Source Code License | ≠ OSI |
| Cycles | Apache-2.0 engine; Blender GPL host | VERIFIED |
| **Blast** | GameWorks / NDev — SOURCE AVAILABLE | PA2 REFERENCE/EVAL |
| Chaos / Unreal | Epic EULA | Not OSS |
| Frostbite | EA proprietary | REFERENCE ONLY |
| Remotion | ≠ OSI OSS | Prior lock |
| OIDN | Confirm RenderKit SPDX | UNVERIFIED exact this stamp |
| OpenFX | BSD-3 prior FHVS | RESEARCH FINDING (raw 404) |
| FleX / ARCSim | Legacy / non-commercial | REJECT core |

### Policy
GPL/AGPL in-process → REFUSE without Legal · FFmpeg nonfree → REFUSE · AI NC weights → gate · Chaos ≠ OSS label · Blast ≠ default OSS.

---

## 44. Hardware requirements (Nebula UNKNOWN)

| Resource | Status |
|---|---|
| Nebula GPU SKU | **UNKNOWN** |
| Nebula VRAM | **UNKNOWN** |
| Nebula CPU cores | **UNKNOWN** |
| Nebula TFLOPs | **UNKNOWN** |
| Measured destr. piece budget | **UNKNOWN** |
| Film NanoVDB PT realtime | **UNKNOWN** |
| Millions GPU particles RT | **UNKNOWN** |

**Relative classes only (PA2_1):** Small wall previs plausible on desktop GPU class · Medium wing = offline/previs · Large city block = offline; RT UNKNOWN.

**Do not invent Nebula SKUs.** After Commander authorizes measurement: 1k/5k/20k piece benchmarks + VDB ladders.

---

## 45. Storage/cache requirements

| Cache type | OOM (INFERENCE) |
|---|---|
| Intent/Plan JSON | KB–MB |
| Alembic building fracture (shot) | **10–500+ GB** |
| OpenVDB smoke/dust (shot) | **10 GB–several TB** |
| Beauty EXR 4K multilayer | ~50–200+ MB/frame → **100+ GB / 1k frames** |
| 3DGS / NeRF checkpoints | 100 MB–few GB |
| Photogrammetry dense | GB–100s GB |

Cache must pin engine/build/GPU/driver/seed. Bit-identical GPU replay = PRESENT_UNPROVEN. Resource Governor + GC before P0 build. `.hvsproj` stores refs + hashes — not binary blobs inline.

---

## 46. Headless automation comparison

| System | Headless | License | HVS role |
|---|---|---|---|
| Blender `-b -P` | Excellent | GPL | Primary DCC leaf (**P0 destr previs**) |
| gsplat / Nerfstudio CLI | Excellent | Apache-2.0 | Neural leaf |
| COLMAP / Meshroom | Excellent | BSD/MPL | Capture |
| OCIO / oiiotool / FFmpeg | Excellent | BSD/Apache/LGPL | Core media |
| Natron / Gaffer | Good | GPL / BSD | Comp leaves |
| mantaflow no-GUI | Good | Apache-2.0 | Fluid/pyro bake |
| Unreal commandlets | Good | Epic | Previs REFERENCE |
| Houdini hython | Excellent | COMMERCIAL | REFERENCE / future |
| Remotion SSR | Good | ≠ OSI | Optional MG only |

---

## 47. Recommended open-source stack

| Layer | Choice | License | Mode | Pri |
|---|---|---|---|---|
| Project SoT | `.hvsproj` + EditOps | Own | NATIVE | P0 |
| Editorial I/O | OTIO | Apache-2.0 | FILE | P0 |
| Color | OCIO + ACES | BSD-3 | NATIVE | P0 |
| Pixels | OpenEXR + OIIO + FFmpeg LGPL | BSD/Apache/LGPL | FILE/CLI | P0 |
| Volumes | OpenVDB + NanoVDB | Apache-2.0 | FILE/SDK | P0 |
| Scene I/O | OpenUSD (TOST-1.0) + glTF + Alembic | TOST/BSD | FILE | P0 |
| Materials | MaterialX + OpenPBR | Apache-2.0 | FILE | P0 |
| Fracture authoring P0 | Blender GeoNodes/Cell Fracture | GPL | SUBPROCESS | P0 |
| Rigid P0 | Bullet-via-Blender | Zlib via GPL host | SUBPROCESS | P0 |
| Rigid P1+ | **Jolt** and/or PhysX 5 | MIT / BSD-3 | NATIVE | P1 |
| Destruction graph | **Own HvsStructuralGraph** | Own | NATIVE | P0 |
| Blast | — | GameWorks | REFERENCE/EVAL | — |
| Path trace | Cycles + OIDN | Apache (+ GPL host) | CLI | P0 |
| Comp | Natron + Blender (+ Gaffer opt) | GPL / BSD | CLI | P0 |
| RT viewport | wgpu/Three + EEVEE previs + Filament opt | MIT/Apache/GPL | NATIVE/SUBPROCESS | P0–P1 |
| Tracking | OpenCV + COLMAP | Apache/BSD | NATIVE/CLI | P0 |
| Crowds | Recast/Detour + RVO2 | Permissive | NATIVE | P1 |
| Photogrammetry | COLMAP + Meshroom | BSD/MPL | CLI | P1 |
| Neural bg | gsplat | Apache-2.0 | CLI | P1 OFF-default |
| Upscale / interp | Real-ESRGAN / RIFE/FILM | BSD/MIT/Apache | CLI | P1 OFF-default |
| Fluids | mantaflow / SPlisHSPlasH | Apache/MIT | SUBPROCESS | P1–P2 |
| Vehicle motion | Chrono / Jolt Vehicle | BSD-3 / MIT | NATIVE | P2 |

---

## 48. Proprietary-reference-only systems

| Product | Why |
|---|---|
| **Frostbite** | Capability-class; no code seeking |
| **Unreal Chaos / Niagara** | Epic EULA; Chaos ≠ OSS |
| **NVIDIA Blast / GameWorks** | SOURCE AVAILABLE; NDev/redistrib caution — REF/EVAL not default OSS |
| Houdini / Nuke / Golaem | Commercial craft ceilings |
| EmberGen / NVIDIA Flow (as product) | RT pyro REF; Flow SPDX confirm if used |
| RealityCapture / Metashape / Topaz | Quality bars |
| Dolby Vision | Proprietary HDR |
| **Remotion** | ≠ OSI OSS |
| OptiX | FREE PROPRIETARY acceleration |
| Substance / DMM / closed FEA | Reject dependency / REF only |
| Instant-NGP / Inria 3DGS original | Non-OSI ship gates |

---

## 49. HVS integration priorities

| Domain | HVS OWNS | EXTERNAL | REJECT |
|---|---|---|---|
| Project, EditOps, rights, ThemeSpec | YES | — | Second NLE SoT |
| Editorial I/O | Adapters | OTIO | OTIO-as-SoT |
| Destruction Intent→Plan→graph→QC | YES | Blender/Houdini/Chaos-class solvers | Copy Frostbite; Blast-as-SoT |
| Character / face channels | YES | DCC bake / aligners | Face-ID |
| Color Looks | ThemeSpec IDs | OCIO | Dolby Vision core |
| Motion graphics | ThemeSpec | Optional Remotion (gate) | Remotion as SoT |
| Encode | Presets | FFmpeg LGPL | nonfree |
| Sim runtime | HVS | Foundry typed tools only | Foundry owns sim SoT |

Module boundaries: Terra ≠ VFX plates · Media ≠ HVS comp · Council ≠ HVS · Foundry tools ≠ creative SoT.

---

## 50. P0/P1/P2/P3 roadmap

### P0 — Foundations (`HVS-GFX-01_DESTRUCT_PREVIS_KERNEL` HOLD)
1. Intent schema + StructuralGraph design (docs)
2. Blender CLI fracture previs — **brick+glass** HYBRID demo
3. Cache hash + `.hvsproj` clip attach + FFmpeg proxy
4. Material packs skeleton + DestructionCue/AudioCue schemas
5. OCIO + OpenEXR + OIIO + FFmpeg LGPL
6. OpenUSD/glTF/Alembic read; OpenVDB R/W leaf
7. Thin character skel/FK + root-motion metadata
8. wgpu/Three viewport direction + MaterialX/OpenPBR
9. Natron/Blender chroma path
10. Resource Governor stubs (UNKNOWN-aware)
11. Foundry `hvs.destruct.*` stubs (docs)
12. Jolt/PhysX/Blast evaluation plan — Blast REF/EVAL only

### P1
Material packs v0 · debris LOD · dust VDB · audio · camera shake · QC · Cycles short · Jolt and/or PhysX NATIVE · cloth XPBD path start · facial blendshapes + lip sync · Recast crowds · COLMAP/Meshroom · gsplat OFF-default · Real-ESRGAN/RIFE/FILM OFF-default · wet maps · Filament/EEVEE previs polish · Gaffer optional · Chaos/Frostbite annotated bibliography

### P2
Multi-building · vehicle destruction (≠ drive) · cloth · fluids couple · USD/Alembic round-trip · Chrono motion · Flow eval · LuxCore/PBRT · Vulkan compute · tornado/sandstorm set pieces · BasicVSR++

### P3 / gates
Neural audio face (clean license) · WebGPU broker · Metal if Mac · Houdini hython policy-gated · Remotion license evaluate never SoT · REJECT FleX/ARCSim/Face-ID/real explosives/Frostbite source/CapCut

---

## 51. Next research/build recommendation

### First mission — HOLD
**`HVS-GFX-01_DESTRUCT_PREVIS_KERNEL`**

| Field | Value |
|---|---|
| Scope | P0 only |
| Flow | Intent → structural graph → fracture → Blender CLI previs → cache hash → `.hvsproj` → FFmpeg proxy |
| Materials | Brick + glass |
| Mode | HYBRID |
| Out | Full Frostbite city · fluids · hair · Unreal/Chaos · commercial DCC CI · real blast chemistry · Media/Terra absorb · Blast as required SDK |
| Owner | Foundry typed tools; HVS sim/render runtime |
| Go | **Commander authorization required** |
| Status | **IMPLEMENTATION NOT AUTHORIZED** · HOLD |

### Parallel research (still RESEARCH ONLY)
1. Nebula GPU/VRAM measurement plan (authorize first)
2. Blast GameWorks redistribution counsel (if ever EVAL→use)
3. OIDN RenderKit SPDX reconfirm
4. OpenMVS AGPL isolation counsel
5. RIFE weight license vs MIT code
6. AliceVision/Meshroom COPYING path reconfirm
7. OpenFX LICENSE path reconfirm
8. PhysX GPU binary redistribution terms

### Success criteria for future implementation wave
- Open-license runtime path without SideFX/Epic/Blast-required at playback
- Material-tagged destruction → VFX+audio cues
- Cached replay + golden-cache tests
- Nebula benchmarks with **measured** numbers
- Commander-named slice before any HVS code lands

### Remaining UNKNOWN gaps (do not fill)
Nebula GPU/VRAM/CPU/FPS · Frostbite-class realtime on WR HW · Zero-copy HVS↔sim (PRESENT_UNPROVEN) · Bit-identical GPU cache · Houdini SaaS seat fit · OIDN exact SPDX this stamp · OpenFX raw LICENSE path · FILM re-fetch if Evidence offline · Blast commercial redistrib · Instant-NGP/Warp terms · Mac/Metal workers existence · Dynamic 3DGS production readiness · Remotion Company License decision

---

# FINAL BLOCK

HVS REAL-TIME GRAPHICS STACK:
wgpu and/or Three.js WebGPURenderer + Blender EEVEE previs (SUBPROCESS) + optional Filament (Apache-2.0) / Godot MIT / Bevy Apache preview + glTF/USD subset + glTF PBR now / MaterialX-OpenPBR subset later + HDRI/IBL + SSAO/GTAO (+ ReSTIR later) + Cat-16/CameraSpec (approx DoF/MB/exposure/shake). Unreal/Nanite/Lumen = REFERENCE only. Game engines ≠ film SoT. Nebula GPU/VRAM = UNKNOWN. Integration: NATIVE + SUBPROCESS + FILE. Priority P0–P1. IMPLEMENTATION NOT AUTHORIZED.

HVS CINEMATIC RENDER STACK:
Blender CLI headless + Cycles (Apache engine) + OIDN (reconfirm SPDX) + Embree CPU fallback + MaterialX/OpenPBR via USD + OpenEXR multilayer AOVs + OCIO. Optional: LuxCore, Mitsuba 3, PBRT v4. OptiX/HIP/Metal when user-present. GPL host = subprocess isolate. Priority P0. IMPLEMENTATION NOT AUTHORIZED.

HVS DESTRUCTION STACK:
Own HvsStructuralGraph + material packs (concrete/brick/glass/wood/metal/drywall/stone) + Blender GeoNodes/Cell Fracture/rigid CLI (P0) + Bullet-via-Blender P0 → Jolt MIT and/or PhysX BSD-3 NATIVE P1+ + art-direction fields/anchors/guided weaken (EditOps→fields) + event bus secondary debris/dust/sparks (OpenVDB + particles; couple rule: fracture→emit→VDB) + visual explosions as baked VDB/flipbooks + radial impulse (REFUSE real explosives) + authoritative hashed cache (env pins) + DestructionAudioCue → future Sound Library. Chaos/Frostbite = REFERENCE ONLY. **Blast = REFERENCE/EVALUATE (GameWorks — not default OSS).** FleX/ARCSim = REJECT. First mission: HVS-GFX-01_DESTRUCT_PREVIS_KERNEL HOLD. IMPLEMENTATION NOT AUTHORIZED.

HVS VOLUMETRIC STACK:
OpenVDB (Apache-2.0) SoT + NanoVDB GPU convert-at-boundary + OpenVDB AX (P1) + UsdVol + Cycles NanoVDB / OSPRay beauty + Blender Mantaflow baker → `.vdb` + Houdini pyro REFERENCE + EmberGen/Flow EVALUATE_P2. Couple destruction secondaries via break-face emitters. Resolution ladders; Nebula VRAM UNKNOWN; TB-class cache planning. IMPLEMENTATION NOT AUTHORIZED.

HVS PHYSICS STACK:
P0 = Bullet-via-Blender SUBPROCESS · P1+ = Jolt (MIT) NATIVE and/or PhysX 5 (BSD-3) · Fracture graph = Own HvsStructuralGraph (Blast REF/EVAL only) · Cloth/soft = XPBD/Jolt SoftBody later; Blender cloth P2 SUBPROCESS · Hair = RT cards; hero caches · Vehicle motion = Jolt VehicleConstraint / Chrono (≠ destruction) · Vehicle destruction = same HvsDestruct pipeline P2 · Chrono scientific P2 · FleX REJECT · ARCSim REJECT. IMPLEMENTATION NOT AUTHORIZED.

HVS COMPOSITING STACK:
Natron (GPL-2 OFX) + Blender Compositor + optional Gaffer (BSD-family) + OCIO + chroma/spill default + AI mattes OFF-default audited SUBPROCESS (BGV2 MIT preferred; rembg cleared weights; RVM GPL isolate; YOLO AGPL gate) + OpenEXR AOVs. Nuke/Houdini COPs = REFERENCE only. IMPLEMENTATION NOT AUTHORIZED.

HVS COLOR STACK:
OCIO v2 NATIVE + ACES configs + OpenEXR scene-referred + OpenImageIO + ThemeSpec Look IDs + non-destructive CDL/LUT EditOps + SDR Rec.709 default until HDR slice + HDR10/HLG via FFmpeg LGPL (Dolby Vision gate/REFUSE as core). IMPLEMENTATION NOT AUTHORIZED.

HVS INTERCHANGE STACK:
`.hvsproj` + EditOps = SoT · OTIO editorial only (≠ renderer) · OpenUSD TOST-1.0 scene payloads · glTF 2.0 runtime/web · Alembic BSD-3 FX/anim caches · MaterialX/OpenPBR · OpenVDB volumes · OpenEXR pixels · OCIO configs · OpenAssetIO resolver (HVS owns catalog/provenance). REJECT as SoT: Remotion, .blend alone, .umap alone, COLMAP DB alone, NeRF checkpoints, Blast/Chaos assets as project truth. IMPLEMENTATION NOT AUTHORIZED.

FROSTBITE-CLASS BUILDING DESTRUCTION:
PARTIAL — open/accessible offline cinematic path is architecturally FEASIBLE (Intent→Plan→StructuralGraph→Fracture→Cache→Comp via Blender+Jolt/Bullet/PhysX+OpenVDB+Alembic/USD/OCIO/EXR; own graph; Blast REF/EVAL only); realtime Frostbite-parity at AAA game visual budgets remains unproven and BLOCKED on evidence (no proprietary source; Nebula GPU/VRAM UNKNOWN; Chaos/Frostbite REFERENCE ONLY). PA2_8 + Wave D verdict aligned. Proceed research→authorized slices only.

IMPLEMENTATION:
NOT AUTHORIZED

NO INSTALLS. NO DOWNLOADS. NO COMMIT. NO PUSH. NO DEPLOY.
