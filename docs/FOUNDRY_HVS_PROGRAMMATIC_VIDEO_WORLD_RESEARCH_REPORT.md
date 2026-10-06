# FOUNDRY_HVS_PROGRAMMATIC_VIDEO_WORLD_RESEARCH_REPORT

## Header metadata

| Field | Value |
|---|---|
| **Date** | 2026-09-22 (America/New_York / ET) |
| **Mode** | DEEP FULL-WEB RESEARCH / RESEARCH ONLY |
| **LIVE_WEB_RESEARCH** | YES |
| **IMPLEMENTATION_PERFORMED** | NO |
| **FILES_MODIFIED** | 0 (research artifacts only) |
| **BUILD** | NO |
| **PACKAGE** | NO |
| **INSTALL** | NO |
| **ACTIVATE** | NO |
| **COMMIT** | NO |
| **PUSH** | NO |
| **DEPLOY** | NO |
| **COMMANDER_DECISION_REQUIRED** | YES |
| **PRIMARY_SOURCES_USED** | YES |
| **OFFICIAL_REPOS_VERIFIED** | YES (high-value set; gaps noted) |
| **LICENSES_VERIFIED** | YES (high-value set; gaps listed as UNKNOWN/PRESENT_UNPROVEN) |
| **MUSEUMS_RESEARCHED** | YES |
| **PUBLIC_ARCHIVES_RESEARCHED** | YES |
| **PUBLIC_ART_RESEARCHED** | PARTIAL (FoP caution; Wave C) |
| **PUBLIC_DOMAIN_RIGHTS_DISTINGUISHED** | YES |
| **IIIF_RESEARCHED** | YES |
| **MEDIA_APIS_RESEARCHED** | YES |
| **PROGRAMMATIC_VIDEO_RESEARCHED** | YES |
| **FFMPEG_RESEARCHED** | YES |
| **GSTREAMER_RESEARCHED** | YES |
| **OTIO_RESEARCHED** | YES |
| **BLENDER_RESEARCHED** | YES |
| **OPENCOLORIO_RESEARCHED** | YES |
| **OPENIMAGEIO_RESEARCHED** | YES |
| **WHISPER_ECOSYSTEM_RESEARCHED** | YES |
| **HVS_TOOL_API_PROPOSED** | YES |
| **FOUNDRY_HVS_BOUNDARY_DEFINED** | YES |
| **NEBULA_GPU_SPECS** | UNKNOWN (unmeasured — do not invent) |

> **Architecture name:** FHVS Programmatic Video Kernel  
> **Primary first mission:** `FHVS-ENG-01_HVS_TOOL_KERNEL`  
> **Aliases:** `HVS-CODE-01` · `HVS-CODE-KERNEL-0` · Wave D “Project Skeleton + Probe + Deterministic QC Gate”  
> Labels: VERIFIED FACT | RESEARCH FINDING | INFERENCE | RECOMMENDATION | UNVERIFIED | UNKNOWN | PRESENT_UNPROVEN  
> Extends (do not contradict): HVS Master Media Report · Foundry Standalone Engineer Report · prior FHVS wave locks  
> Conflict resolution authority: Blind Spot + Evidence pins (Remotion ≠ OSI OSS; OTIO interchange ≠ SoT; FFmpeg LGPL product preference; viewable ≠ PD)

---

## 1. EXECUTIVE SUMMARY

1. **Foundry** = mission owner / workflow engineer / typed tool broker. **HVS** = creative runtime (`.hvsproj` SoT, timeline, ThemeSpec, render, rights, QC). Collapse Foundry↔HVS or absorb Media/Terra/Council/Browser Broker = REFUSE. (**RECOMMENDATION** / Blind Spot / Engineer)
2. **SoT = `.hvsproj` + EditOps (`hvs.edit.v1`); OTIO = interchange only (lossy)** — not renderer, not sole DB. (**VERIFIED FACT** ASWF OTIO role + Historian/Engineer locks)
3. **Media plane = FFmpeg LGPL-prefer**; NVENC = Nebula **operator** path; redistributable `--enable-nonfree` = REFUSE. (**VERIFIED FACT** ffmpeg.org/legal.html)
4. **Remotion ≠ OSI open source** — source-available Remotion License; Company/Automator gates. (**VERIFIED FACT** LICENSE.md 2026-09-22 Evidence)
5. **PUBLICLY VIEWABLE ≠ PD ≠ OA ≠ CC0 ≠ CC BY ≠ FAIR USE ≠ UNKNOWN.** Gov-hosted ≠ auto-PD. Sculpture photo ≠ artwork PD. IIIF ≠ license. (**Blind Spot / Historian / Wave C**)
6. **Gen media:** open-weights (Wan2.1, CogVideoX-2B class Apache-2.0) = opt-in local after HW inventory; cloud APIs via Router; **Sora EXCLUDE** (~2026-09-24 shutdown lineage). Beauty OFF default; AI ≠ photo. (**Evidence / Science**)
7. **License traps:** Ultralytics YOLO AGPL · Rubber Band GPL · Essentia/JUCE AGPL · GSAP ≠ MIT · Remotion Company. (**Blind Spot / Wave B**)
8. **First post-research mission:** `FHVS-ENG-01_HVS_TOOL_KERNEL` (H0–H3: project + timeline + ffmpeg tools + queue receipts). Builds HOLD. (**Engineer**; aliases §68)
9. **Nebula GPU/VRAM/NVENC measured SKU = UNKNOWN** — PRESENT_UNPROVEN for zero-copy scrub claims. (**Science / PA2_8**)
10. **Met Collection API v1/search retires 2026-10-01** — adapters must use **v1.1**. (**PA2_6 VERIFIED**)

## 2. PURPOSE & SCOPE

Discover lawful software, OSS, APIs, archives, museums, public-domain, creative-coding, rendering, VFX, animation, audio, and programmable-video ecosystems that make **Foundry** + **HVS** capable of engineering, generating, editing, assembling, rendering, enhancing, and delivering professional video via code and natural language.

**Out of scope this packet:** implementation, package installs, large model downloads, Foundry/HVS code mutation, commits, pushes, deploys, invented Nebula benches.

## 3. METHOD & EPISTEMICS

Prefer primary official site/docs/repo/LICENSE/ToS. Wave stamps under `waves/` (A–D, Science, Blind Spot, Avengers, PA2_*). Live web 2026-09-22. Listicles = UNVERIFIED as license authority. Missing detail → UNKNOWN or PRESENT_UNPROVEN — never fabricate licenses/URLs/HW specs.

## 4. PROGRAMMABLE VIDEO FRAMEWORKS

| Stack | Role | License | HVS fit |
|---|---|---|---|
| Remotion | React/TS frame composition | Source-available / Company — **not OSI OSS** | Optional MG adapter; LICENSE_HOLD |
| MoviePy | Python clip graph → FFmpeg | MIT | Script adapter |
| Manim CE | Math/explainer | MIT | Niche generator → Library |
| Three.js / PixiJS | WebGL titles/preview | MIT | Capture→ingest; not SoT |
| Editly | Declarative Node NLE | MIT (confirm) | FUTURE thin adapter |
| FFmpeg filtergraphs | Procedural media plane | LGPL-prefer | **Default encode/proxy/QC** |

**RECOMMENDATION:** Programmable frameworks emit assets into HVS Library; **never** replace `.hvsproj` SoT. Three stacks stay separate: clip assembler ≠ code-as-composition ≠ realtime nodes (FUTURE).

## 5. NLE ARCHITECTURES & OSS EDITORS

**Hybrid lock:** tracks in `.hvsproj` = authoring SoR; magnetic = EditOps/UX; OTIO Timeline→Stack→Track→Clip/Gap/Transition = interchange shape.

| Class | Stance |
|---|---|
| CapCut / Premiere / FCP / Resolve | UX prior art only; invented write APIs REFUSE; scrape REFUSE |
| Kdenlive / Shotcut / Flowblade / OpenShot | GPL UIs — REFERENCE ONLY |
| Pitivi / GES · MLT | SPIKE once as compose backend; not project SoT |
| Blender VSE | Subprocess later — GPL isolate |
| Olive | SLOW/ALPHA — HOLD depend |

## 6. FFMPEG MEDIA PLANE

**VERIFIED FACT:** decode/encode/filter/mux; legal.html LGPL default; `--enable-gpl` upgrades; `--enable-nonfree` unredistributable. **RECOMMENDATION:** Default HVS media plane; product ship LGPL; NVENC operator-only on Nebula. Fail classes: `NONFREE_FFMPEG_SHIPPED` · `GPL_CLAIMED_LGPL` · `PROXY_AS_MASTER`.

## 7. GSTREAMER (+ GES)

Core generally LGPL; **plugin license matrix varies** — per-plugin SPDX required. GES = editing services candidate beside MLT. Evaluate in compose spike; do not assume all plugins ship-safe.

## 8. DECODE / FRAME LIBRARIES

PyAV (BSD-3 + FFmpeg) · OpenCV Video I/O (Apache-2.0) · Skia (BSD-3) · WebCodecs (browser) — adapters/helpers; **not** project SoT.

## 9. HARDWARE ACCELERATION

Linux + NVIDIA NVDEC/NVENC via FFmpeg **VERIFIED** generically (NVIDIA Video Codec SDK / FFmpeg GPU guide). Exact Nebula GPU/VRAM/NVMe/concurrency = **UNKNOWN — unmeasured**. Prefer proxy-first; software fallback always. Zero-copy DMA-BUF/CUDA-GL scrub = **PRESENT_UNPROVEN**. Peers: VA-API, Vulkan Video, AMF, QSV — driver-dependent.

## 10. CODECS & PATENT NOTES

| Codec | Impl note | Patent/commercial |
|---|---|---|
| H.264/AVC | libx264=GPL; NVENC HW | VIA LA / historical MPEG LA — counsel |
| H.265/HEVC | libx265=GPL; NVENC | Fragmented pools — counsel |
| AV1 | libaom/dav1d/svt; av1_nvenc | AOMedia Patent License 1.0 RF Necessary Claims; market assertions = counsel |
| VP9 | libvpx | WebM ecosystem |
| ProRes / DNx | FFmpeg interop ≠ brand clearance | Decode-first until Legal |

**Lock:** patent pools ≠ OSS clearance.


## 11. COLOR — OCIO / ACES

OpenColorIO **BSD-3** (ASWF). ACES under ASWF (Apache-2.0 repos; Academy trademarks). **INTEGRATE V2**; V1 ThemeSpec display-referred looks labeled “not OCIO”. HVS owns color runtime; Foundry passes look intent.

## 12. IMAGE I/O — OPENEXR / OIIO

OpenEXR BSD-3 · OpenImageIO Apache-2.0 — VFX plates **INTEGRATE V2+**. LittleCMS MIT for ICC soft-proof optional.

## 13. VFX — OPENFX / NATRON / BRIDGES

OpenFX host↔plugin API **BSD-3** (confirm LICENSE on checkout). **BUILD host V2** + SPDX-gated plugs. Natron = GPL subprocess later. Unsandboxed OFX = REFUSE (`UNSANDBOXED_PLUGIN`).

## 14. MOTION GRAPHICS

Lottie/Rive runtimes preferred for slots (Rive `.riv` proprietary caution). Remotion = licensed adapter. **GSAP ≠ MIT** (Webflow Standard; competitive clause → Legal). HVS owns ThemeSpec/MGFX slots; AE project ≠ SoT.

## 15. 2D / 3D TOOLING

Blender GPL → `hvs.blender.*` **subprocess isolate**. USD (TOST 1.0) / glTF interchange. Assimp BSD-3. Godot/Babylon = interactive preview lanes, not `.hvsproj` SoT.

## 16. AUDIO DSP

FFmpeg LGPL filters primary (`loudnorm`/EBU R128). **Rubber Band GPL-2** (+ commercial) = LICENSE_TRAP. Essentia AGPL · JUCE AGPL/commercial — out of proprietary core. PipeWire/LV2 for Linux host path.

## 17. SPEECH / CAPTIONS

Whisper / faster-whisper / whisper.cpp = **MIT · LOCAL-LEGAL**. Captions = `hvs.caption.*` + human proofread for commercial. Formats: SRT / WebVTT / ASS / TTML. Diarization (pyannote) only after HF license acceptance logged. Cloud TTS/STT via Router with consent_id.

## 18. COMPUTER VISION

**RECOMMENDATION:** permissive detector → ByteTrack (MIT) → **SAM2 Apache-2.0** → MediaPipe optional. **Ultralytics YOLO AGPL = LICENSE_TRAP** without Enterprise. Pipeline: detect → track → segment → HVS TrackSubject.

## 19. GENERATIVE MEDIA

| Class | Examples | Stance |
|---|---|---|
| LOCAL-LEGAL open weights | Wan2.1 Apache-2.0 · CogVideoX-2B Apache-2.0 · Diffusers Apache-2.0 | Optional local after HW inventory; Character Bible / STARRDOM locks |
| NC / restrictive weights | CogVideoX-5B may differ — VERIFY | Not auto commercial |
| CLOUD-ONLY | Veo · Runway · Kling · Luma · Firefly · Pika · ElevenLabs | Media Provider Router |
| EXCLUDE | **OpenAI Sora / Videos API** (shutdown ~2026-09-24) | Do not depend |

## 20. RESTORATION / ENHANCEMENT

Real-ESRGAN BSD-3 · RIFE MIT · VapourSynth LGPL — **OFF-by-default**; label `AI_ENHANCED`; never source-of-truth. Fail: `INTERP_AS_SOURCE_TRUTH`.

## 21. IMAGE / STILLS PIPELINE

OIIO(+OCIO) color-critical; Sharp/libvips web proxies; ImageMagick subprocess; Skia/Cairo for 2D.

## 22. METADATA / PROBE

Default: **ffprobe** (LGPL) + MediaInfo; ExifTool Artistic/GPL subprocess for XMP/rights write.

## 23. SCENE / SHOT DETECT

PySceneDetect **BSD-3** + FFmpeg scene filters; store cut list + method provenance in `.hvsproj`.

## 24. TECHNOLOGY ROLLUP

See mandatory **TECHNOLOGY CATALOG** (§70 annex). Verdicts: INTEGRATE CORE · LICENSE GATE · SPIKE · SUBPROCESS · OPT-IN · EXCLUDE · REFERENCE ONLY.

## 25. PERFORMANCE / THROUGHPUT

Proxy-first; render-cache keyed by content+graph hash; one heavy GPU tenant until measured; no invented Nebula FPS. Proxies ≠ masters.

## 26. DAM / MAM FIT

HVS owns production AssetIndex + AssetProvenance — **not** Immich/PhotoPrism AGPL as SoT. ResourceSpace = strong candidate for rights-aware internal vault (IIIF Presentation). Pimcore = heavier productized ops if already in stack.

## 27. PREVIEW vs MASTER

Proxies ≠ masters (`PROXY_AS_MASTER` fail). PreviewTickets for AI tx diffs; conform at final encode.

## 28. COMPOSE-ENGINE SPIKE GATE

Choose **once**: lean custom+FFmpeg **or** MLT LGPL **or** GES — document decision before OFX/OCIO depth. Do not start at Blender/gen/OFX.

## 29. BRIDGE — PUBLIC MEDIA → PROJECT

Asset Search → RightsDecision → AssetRef in `.hvsproj` → EditOps. Bytes stay at source until commit; IIIF preferred for museum stills region/size. UNKNOWN → hard block commercial OWNABLE.

## 30. WIKIMEDIA COMMONS & AGGREGATORS

Commons + Openverse + Europeana + Internet Archive/Prelinger — item-level licenses; Openverse discovery must re-verify origin. Wikidata = identity spine, not media bytes SoT.

## 31. US FEDERAL / NATIONAL MEDIA

LOC · NARA · Smithsonian OA (**designated CC0 only**) · NASA (no endorsement/logos/merch carve-outs) · NOAA/USGS/NPS · NGA OA · DVIDS — access APIs ≠ blanket PD. Probe `workOfUSGovernment` + contractor flags per item (17 USC §105).

## 32. MUSEUM OPEN ACCESS LANDSCAPE

Pattern: CC0 OA images of PD works + APIs/IIIF strong (Met, AIC, CMA, NGA, Smithsonian OA, Rijksmuseum, Getty Open Content); object-level partial (Harvard, Yale, V&A); NC friction (British Museum often BY-NC-SA). See Museums table §43.

## 33. IIIF

Image API + Presentation API (3.0); Change Discovery for harvest. **IIIF = delivery interoperability — agnostic to rights.** Pair Manifest `rights` + `requiredStatement` before byte fetch. Fail: `IIIF_AS_LICENSE`.

## 34. WIKIDATA

Federation spine (Q-ids ↔ museum IDs ↔ Commons ↔ IIIF) — not media bytes. Verify Commons license on file page.

## 35. STOCK PLATFORMS

Pexels/Pixabay/Unsplash/Mixkit/Coverr = **custom licenses ≠ CC**; re-verify ToS; no bulk mirror; honor train/ML bans; standalone resale ban. Fail: `STOCK_API_MIRROR` · `STOCK_TRAIN_BAN` · `STOCK_STANDALONE_RESALE`.

## 36. AUDIO / MUSIC LIBRARIES

Freesound · FMA · Musopen · LibriVox — per-track CC/PD; filter NC/ND. Separate composition / recording / performance rights.

## 37. 3D / PBR / HDRI

Poly Haven · ambientCG · Sketchfab per-model · Smithsonian 3D CC0 OA · NASA 3D — verify per asset.

## 38. RIGHTSSTATEMENTS.ORG & CREATIVE COMMONS

CC licenses + CC0 + PDM; RS.org = status vocabulary (**not** SPDX licenses). Map status and license as distinct fields.

## 39. C2PA CONTENT CREDENTIALS

Spec provenance; read/preserve on ingest; write-path tooling choice = open unknown (U-C2PA-1).

## 40. RIGHTS SCHEMA (DRAFT)

Minimum AssetProvenance (Blind Spot / Wave C / Evidence):  
`source` · `licenseSpdxOrDeed` · `rightsClass` (OWNABLE|STREAM_ONLY|REQUIRE_AUTH|REFUSE|AI_GENERATED|UNKNOWN) · `commercialOk` · `trainOk` · `attributionText` · `retrievedAt` · `tosArchiveHash` · `contentHash` · `moduleOwner` · optional `iiif_manifest` · `jurisdiction`.  
Missing rights_uri / UNKNOWN → commercial export **BLOCKED**. Never upgrade UNKNOWN → OWNABLE by wishlist.

## 41. FEDERATED ASSET-SEARCH ARCHITECTURE

Search federates (Wikidata + IIIF Discovery + aggregators); bytes at source; thin adapters (IIIF-native / REST OA / gov / stock gated / 3D-audio specialty); Rights Decision Engine before fetch; optional ResourceSpace vault. Stock adapters never become archives.

## 42. MEDIA / ARCHIVE MATRIX

*(Mandatory table — Wave C Table A; 34 sources)*

| SOURCE | INSTITUTION | COUNTRY | MEDIA_TYPES | API | IIIF | BULK_DATA | RIGHTS_MODEL | PD_AVAIL | COMMERCIAL | ATTRIBUTION | AUTOMATION | FORMATS | HVS_VALUE | SOURCE_URL | RIGHTS_URL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Wikimedia Commons | Wikimedia Foundation | US (intl) | Image, audio, video, 3D | Yes (MW Action/REST) | Partial | Dumps / Enterprise | Per-file CC/PD | Yes | Yes if license allows | Often required (BY/SA) | Yes w/ rate limits & UA | Original + derivatives | Critical | https://commons.wikimedia.org | https://commons.wikimedia.org/wiki/Commons:Licensing |
| Internet Archive | Internet Archive | US | All | Advanced Search + metadata | Rare | Item ZIP/orig | Item-level | Yes (subset) | Item-dependent | Item-dependent | Polite yes | Many | Critical | https://archive.org | Per-item + ToS |
| Openverse | WordPress | US | Image, audio | REST | No | No full dump | Aggregated CC/PD | Yes | Filter-dependent | Helper-provided | Yes w/ ToS | Upstream | High discovery | https://openverse.org | Upstream licenses |
| Smithsonian OA | Smithsonian Institution | US | Image, 3D, data, some AV | REST (api.data.gov) | Yes (IDS) | GitHub JSON | CC0 subset | Yes (CC0 set) | Yes for CC0 | Not required for CC0 | Yes w/ key | JPEG, OBJ, IIIF | Critical | https://www.si.edu/openaccess | https://www.si.edu/openaccess/faq |
| LOC | Library of Congress | US | Image, newspaper, AV, maps | loc.gov JSON | Some collections | Selective | Mixed / UNKNOWN common | Yes (subset) | Item-dependent | Often requested | Yes polite | JPEG, TIFF, PDF, AV | High | https://www.loc.gov | https://www.loc.gov/legal/ |
| NARA Catalog | National Archives | US | Image, film, docs | Catalog API v2 | Limited | Selective | Mixed federal + restrictions | Yes (subset) | Often yes if unrestricted | Credit NARA | Yes | Varied | High archival | https://www.archives.gov | https://www.archives.gov/research/still-pictures/permissions |
| NASA Media | NASA | US | Image, video, audio, 3D | images.nasa.gov | No | 3D GitHub | Mostly free w/ caveats | Often uncopyrighted | Limited (no endorsement/logo) | Requested | Yes | JPEG, MP4, OBJ | High B-roll/space | https://www.nasa.gov | https://www.nasa.gov/nasa-brand-center/images-and-media/ |
| NOAA | NOAA | US | Image, data viz, video | Portals | No | Datasets | Mostly federal | Often | Generally yes | Credit NOAA | Case-by-case | Varied | Medium | https://www.noaa.gov | Product pages |
| USGS | USGS | US | Imagery, maps | EarthExplorer etc. | No | Yes | Federal + credit | Often | Yes | Credit USGS | Yes | GeoTIFF, JPEG | High geo docs | https://www.usgs.gov | https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits |
| NPS | National Park Service | US | Photo, audio, video | developer.nps.gov | No | Limited | Mixed employee vs other | Partial | Item-dependent | Credit NPS | Yes w/ key | Varied | Medium | https://www.nps.gov | NPS API terms |
| DVIDS / DoD | US DoD | US | Photo, video, audio | DVIDS API | No | No | Releasable military media | Partial | Often yes if cleared | Credit as marked | Yes w/ key | JPEG, MP4 | Medium newsreel-like | https://www.dvidshub.net | DVIDS terms |
| NGA Open Access | National Gallery of Art | US | Image | CSV + IIIF | Yes | GitHub CSV | OA images; dataset CC0 | Yes | Yes for OA | Encouraged | Yes | IIIF JPEG | High | https://www.nga.gov/open-access-images | NGA OA pages |
| NLM Digital | National Library of Medicine | US | Image, docs | Web service | Some | Limited | Mixed | Partial | Item-dependent | Per item | Yes | Varied | Medium medical hist. | https://www.nlm.nih.gov | Collection terms |
| Chronicling America | LOC | US | Newspapers | JSON | Some page images | Selective | Date/title dependent | Partial | Item-dependent | Credit ChronAm/LOC | Yes | JP2/JPEG, OCR | High text/overlay | https://chroniclingamerica.loc.gov | LOC copyright |
| DPLA | DPLA | US | Aggregated | REST | Partner-dependent | Partner | Aggregated RS/CC | Partial | Filter required | Per provider | Yes w/ key | Upstream | High discovery | https://dp.la | Provider rights |
| Europeana | Europeana Foundation | EU | Aggregated | Search API | Many partners | Via API | edm:rights | Partial | Filter required | Per edm:rights | Yes w/ key | Upstream/IIIF | Critical EU hub | https://www.europeana.eu | https://www.europeana.eu/rights |
| HathiTrust PD | HathiTrust | US | Books | Bib API / OAI / files | Limited | HathiFiles | Rights codes | Yes (PD subset) | PD subset yes | Per HT policy | Controlled | Images/text where allowed | High text | https://www.hathitrust.org | HT rights API docs |
| Prelinger @ IA | Prelinger / IA | US | Film | IA APIs | No | Per item | Often unrestricted ≠ always | Often claimed | Item-dependent | Per item | Polite | MPEG, MP4 | High stock film | https://archive.org/details/prelinger | Item licenseurl |
| Pexels | Canva/Pexels | Global | Photo, video | Yes | No | No | Proprietary free license | N/A | Yes w/ limits | Optional | API yes; mirror no | JPEG, MP4 | High modern B-roll | https://www.pexels.com | https://www.pexels.com/license/ |
| Pixabay | Canva/Pixabay | Global | Photo, video, vectors | Yes | No | No | Content License | N/A | Yes w/ limits | Optional | API yes; mirror no | Varied | High | https://pixabay.com | https://pixabay.com/service/terms/ |
| Unsplash | Unsplash | Global | Photo | Yes | No | Dataset separate | Unsplash License | N/A | Yes w/ limits | Optional | API yes; ML separate | JPEG | High | https://unsplash.com | https://unsplash.com/terms |
| Mixkit | Envato | Global | Video, music | Limited | No | No | Mixkit License | N/A | Yes w/ limits | Check | Restricted mass DL | MP4, audio | Medium | https://mixkit.co | Mixkit license pages |
| Coverr | Coverr | Global | Video | Limited | No | No | Free license | N/A | Yes | Often required free | Treat auto-ingest no | MP4 | Medium | https://coverr.co | https://coverr.co/license |
| Freesound | UPF / Freesound | ES/Global | Audio | API v2 | No | No | Per-sound CC | CC0 subset | If not NC | Per CC | API yes; no DB copy | WAV, MP3, FLAC | High SFX | https://freesound.org | Per-sound + API ToS |
| FMA | Free Music Archive | US | Music | Site/API varies | No | Limited | Per-track CC | CC0 rare | Filter NC out | Per CC | Cautious | MP3 | Medium music | https://freemusicarchive.org | Per track |
| Musopen | Musopen | US | Scores, recordings | Limited | No | Limited | Mixed PD/CC | Scores often | Recording-dependent | Per item | Cautious | PDF, audio | Medium classical | https://musopen.org | Per item |
| LibriVox | LibriVox | US | Spoken word | Catalog | No | IA mirrors | PD text + project recording license | Text PD | Generally yes | Credit readers/project | Via IA | MP3 | Medium VO | https://librivox.org | LibriVox/IA |
| Poly Haven | Poly Haven | Global | HDRI, tex, 3D | Yes | No | Yes | CC0 | Yes (waived) | Yes | API use: credit PH | Yes | EXR, blend, etc. | High CG | https://polyhaven.com | https://polyhaven.com/license |
| ambientCG | ambientCG | Global | Tex, HDRI, 3D | Docs/API | No | Yes | CC0 | Yes | Yes | Optional | Yes | Many | High CG | https://ambientcg.com | https://docs.ambientcg.com/license/ |
| Sketchfab Open | Sketchfab | Global | 3D | API | No | No | Per-model CC | CC0/BY subset | License-dependent | Per CC | Download if allowed | glTF, etc. | Medium | https://sketchfab.com | Per-model |
| OSM | OSMF | Global | Map data | Overpass etc. | No | Planet dumps | ODbL | Data open | Yes w/ share-alike DB | Required | Yes | PBF, etc. | High maps | https://www.openstreetmap.org | https://www.openstreetmap.org/copyright |
| Natural Earth | NACIS community | US | Cartographic | Download | No | Yes | PD-like | Yes | Yes | Optional credit | Yes | SHP, etc. | High maps | https://www.naturalearthdata.com | Site terms |
| Copernicus Sentinel | ESA/EU | EU | Satellite | SciHub/CDSE | No | Yes | Free & open + attribution | N/A (license) | Yes | Required | Yes | SAFE, GeoTIFF | High geo | https://www.copernicus.eu | Sentinel license |
| Project Gutenberg | Project Gutenberg Literary Archive Foundation | US | Text; limited visuals | Bulk mirrors | No | Yes (text) | Mostly PD US texts; visuals separate | Text often PD US | Text: usually yes | Credit encouraged | Bulk text OK; verify images | HTML, EPUB, plain | Low–medium | https://www.gutenberg.org | https://www.gutenberg.org/policy/license.html |

**Archive/media row count:** 34

## 43. MUSEUM MATRIX

*(Mandatory table — Wave C Table B + PA2_6 Met v1.1 note; 20 museums)*

| MUSEUM | API | IIIF | OPEN_ACCESS | PD_ITEMS | IMAGE_DOWNLOAD | 3D | VIDEO | METADATA_LICENSE | IMAGE_RIGHTS | COMMERCIAL_REUSE | ATTRIBUTION | RATE_LIMIT | HVS_ADAPTER_VALUE |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Smithsonian Institution | Yes (OA + EDAN) | Yes | Yes CC0 program | Large CC0 set | Yes (CC0) | Yes CC0 | Limited | CC0 portions | CC0 or restricted | CC0: yes | CC0: not required | api.data.gov norms | 10/10 |
| Met Museum | Yes REST (v1.1 search; v1 retires 2026-10-01) | No | Yes CC0 | 470k+ PD images | Yes JPEG | Rare | Rare | CC0 | PD unrestricted / else restricted | PD: yes | Encouraged | 80 rps | 10/10 |
| Art Institute of Chicago | Yes REST | Yes Image+Manifest | Yes | Filter is_public_domain | IIIF (843/1686) | Rare | API resource | CC0 (desc CC BY) | PD images reusable | PD: yes | Credit AIC | 60 rpm anon | 9/10 |
| Cleveland Museum of Art | Yes REST | No (CDN) | Yes CC0 | 37k+ OA images | Web/print/TIFF | Sketchfab links | Limited | CC0 | CC0 when share_license=CC0 | Yes | Encouraged | Generous; be polite | 10/10 |
| National Gallery of Art | CSV+IIIF | Yes | Yes | Large OA | IIIF full | Limited | Limited | CC0 dataset | OA free use | Yes | Encouraged | CDN norms | 9/10 |
| Getty | Linked Art REST | Yes | Open Content CC0 | 160k+ images | Yes / IIIF | Limited | Limited | CC0 metadata/images marked | CC0 marked | Yes | Encouraged | Be polite | 9/10 |
| Rijksmuseum | Data Services + IIIF | Yes (Image/Pres/Discovery) | Yes CC0/PDM | Majority collection online | Hi-res | Some | Limited | Open / CC0 preferred | CC0/PDM or exceptions | Yes when open | Encouraged | Documented limits | 10/10 |
| V&A | Collections API v2 | Yes | Partial OA | Substantial historic | IIIF / API | Some | Limited | Check docs | Per-object | Often yes if marked | Required when BY | API norms | 8/10 |
| Harvard Art Museums | Yes (key) | Yes | Partial | Many | Via IIIF URLs | Limited | Limited | Per API terms | Respect flags | PD/OA yes | Per terms | Key quotas | 8/10 |
| Cooper Hewitt | GraphQL / dumps | Some SI IIIF | Metadata CC0 | Design PD subset | Verify images | Some | Limited | CC0 data | Images may differ | Metadata yes; images verify | Credit CH | Polite | 7/10 |
| Walters Art Museum | Historical public API | Partial | Long OA tradition | Strong | Yes historically | Limited | Limited | CC0 tradition | Open images | Generally yes | Credit Walters | Polite | 8/10 |
| Yale (YCBA/Library) | OAI / collection APIs | Yes manifests | Strong PD push | ~70k+ PD images (YCBA-scale) | IIIF | Limited | Limited | Open data programs | PD IIIF | PD: yes | Credit Yale unit | Polite | 8/10 |
| Princeton Univ. Art Museum | Evolving digital | Verify | Partial | Historic works | Verify | Limited | Limited | Verify | Verify | Cautious | Credit | Unknown | 5/10 (verify) |
| British Museum | SPARQL/JSON data | Limited | Data open-ish | Many historic objects | Often BY-NC-SA web | Some | Limited | Mixed | NC-SA common | Commercial via BM Images | BY-NC-SA rules | N/A commercial auto | 3/10 commercial |
| Europeana partners | Europeana Search | Many | Aggregator | Millions marked | If rights allow | Some | Some | Aggregated | edm:rights | Filter CC0/PDM/BY | Per rights | API key quotas | 9/10 discovery |
| Minneapolis Institute of Art | Often cited OA | Partial | CC0 program | Strong | Yes | Limited | Limited | CC0 | CC0 | Yes | Encouraged | Polite | 8/10 |
| MFA Boston | Limited public API | Partial | Selective | Selective | Selective | Limited | Limited | Mixed | Mixed | Cautious | Credit | — | 4/10 |
| Louvre | Data/API initiatives | Partial | Conservative | Historic PD objects | Restricted practices | Some | Limited | Mixed | Often restricted reuse | Often no auto | Credit | — | 3/10 |
| Nationalmuseum (SE) | Open API tradition | Yes often | Strong EU OA | Strong | Yes | Limited | Limited | CC/PD | Open marks | Often yes | Per mark | Polite | 7/10 |
| SMK (DK) | Open | Yes | Strong | Strong | Yes | Limited | Limited | Open | Open | Often yes | Per mark | Polite | 7/10 |

**Museum row count:** 20

**Top adapters:** Met v1.1 · Cleveland · AIC · SI OA · Commons/Wikidata · IA · Rijksmuseum · NGA · Getty · Europeana.


## 44. WAR-ROOM MEDIA DENSIFY LOCKS (BRIDGE)

Inherit provenance / no silent delete / licenseClass concepts from Media densify — **without** merging Media Player into HVS. LINK-OUT scanners policy stays Media’s. Fail: `MODULE_COLLAPSE_MEDIA` · `HVS_TERRA_COLLAPSE`.

## 45. HVS PROJECT FORMAT (`.hvsproj`)

**SoT:** inspectable JSON v0→v1 (+ optional SQLite asset index). Sequences, tracks, clips, AssetRefs, ThemeSpec refs, EditLog URI, Versions, provenance, rights. Not CapCut/Premiere/Resolve/FCP files; not OTIO-only DB; not MLT XML; not IIIF Manifest.

## 46. TIMELINE MODEL — CUSTOM vs OTIO vs HYBRID

**RECOMMENDATION Hybrid:** tracks in `.hvsproj` = authoring truth; EditOps = only mutation path; OTIO import/export lossy for ThemeSpec/EditLog/provenance — disclose dropped fields. EDL/AAF/xmeml/FCPXML = adapters later (xmeml ≠ FCPXML).

## 47. TYPED FOUNDRY→HVS TOOL API (`hvs.*`)

Namespaces (Engineer): `hvs.project.*` · `timeline.*` · `ffmpeg.*` · `audio.*` · `caption.*` · `color.*` · `vfx.*` · `motion.*` · `blender.*` · `render.*` · `qc.*` · `archive.*` · `rights.*` (+ asset search/ingest).  
All: JSON Schema · idempotency · PreviewTicket|Commit · AssetRef+hash · provenance · authority_class. Tips≠ops. Foundry complements: `foundry.mission.*` · `foundry.verify.*` · `broker.fetch.*` (lawful URLs only).

## 48. VIDEO-CODING DSL OPTIONS

Primary DSL = `.hvsproj` + `hvs.edit.v1` + `hvs.*`. Secondary = OTIO. Media plane = FFmpeg graphs behind tools. Remotion/Editly/MoviePy = adapters not SoT. No free-form `eval`/`exec` from NL (`NL_TO_EXEC` fail).

## 49. FOUNDRY CODE-INTELLIGENCE GRAPH FOR `.hvsproj`

Layers: Project · Asset · Edit · Render/QC · Theme · Mission. Graphs for impact; re-read `.hvsproj` + QC as ground truth. Foundry holds Mission citations — not a second project DB.

## 50. RENDER QC (DETERMINISTIC)

ffprobe/MediaInfo · blackdetect · freezedetect · silencedetect · loudnorm/ebur128 · hash audit · caption presence · decode null sink. Fail → NEEDS_HUMAN. Never silent-delete source.

## 51. AI QUALITY REVIEW

Deterministic ≠ subjective. AI aesthetic = ASSIST + optional EditOps preview; human gate for client/STARRDOM. Beauty morph off-by-default.

## 52. EXPORT / DISTRIBUTION

Web/YouTube baseline: MP4 H.264 High + AAC, Fast Start, progressive. Vertical social: 9:16 1080×1920 class — **re-verify official tables at integrate**. Shaka Packager for HLS/DASH optional. Delivery presets cite primary URLs + retrieved_at.

## 53. LOCAL-FIRST / CLOUD

LOCAL: `.hvsproj`, EditLog, proxy/master encode, ThemeSpec. HYBRID: ASR, upscale. CLOUD-first: T2V/I2V/TTS/music via Router. Research Engine stays separate.

## 54. HARDWARE FIT

Linux+NVIDIA generally YES. Nebula exact SKU **UNKNOWN**. Inventory before locking local gen set. Methodology (Wave D): measure CPU/RAM/GPU/VRAM/driver/NVENC sessions/disk before encode matrix freeze.

## 55. SECURITY

Untrusted web/repo/gen content fenced; no NL→raw shell; policy-gate FFmpeg argv; secret denylist; preview≠head; spend governor; GPL isolate; signed/sandboxed OFX; hostile media resource limits; client agreement before ingest. Fail classes Blind Spot R1–R15.

## 56. REPO MAINTENANCE AUDIT METHOD

Official URL → LICENSE → activity → Linux → CVE skim → SPDX deps → ToS commercial → owner → deprecation watch → `last_verified_at`.

## 57. LICENSE COMPATIBILITY MATRIX

| Component | SPDX / class | Product posture |
|---|---|---|
| FFmpeg product ship | LGPL-prefer | YES ship dynamic-link; NO `--enable-nonfree` redistributable |
| OTIO | Apache-2.0 | YES integrate |
| OCIO / OpenFX / OpenEXR | BSD-3 | YES integrate |
| OIIO / Diffusers / Wan2.1 / SAM2 / OpenCV / MediaPipe | Apache-2.0 | YES (model cards still bind) |
| Whisper family / MoviePy / Manim / ByteTrack / Three.js / Lottie | MIT / ISC | YES |
| MLT framework | LGPL | Spike OK; melt GPL separate |
| GStreamer core | LGPL | Per-plugin audit |
| Blender / Natron / GPL NLEs | GPL | SUBPROCESS only — do not link into proprietary core |
| Remotion | Proprietary source-available | LICENSE GATE / Company |
| GSAP | Webflow Standard ≠ OSI | Legal review |
| Ultralytics YOLO | AGPL-3.0 | AVOID core / Enterprise |
| Rubber Band / Essentia / JUCE | GPL/AGPL | LICENSE_TRAP or commercial |
| OpenUSD | TOST 1.0 | Evaluate ≠ plain Apache |
| Stock APIs | Vendor ToS | Not CC; archive ToS PDF+date |
| Museum OA | Item-level CC0/CC/RS | OA ≠ blanket OWNABLE |

## 58. ADAPTER OPPORTUNITY QUEUE

| # | Adapter | Priority | Notes |
|---|---|---|---|
| 1 | FFmpeg probe/proxy/render | P0 | Media plane core |
| 2 | OTIO import/export | P0 | Interchange |
| 3 | `.hvsproj` + EditOps + queue receipts | P0 | SoT |
| 4 | ffprobe/MediaInfo/QC pack | P0 | Deterministic Acceptance |
| 5 | faster-whisper / whisper.cpp | P1 | Captions |
| 6 | PySceneDetect | P1 | Shots |
| 7 | Met v1.1 · Cleveland · AIC · SI OA | P1 | Museum stills |
| 8 | Commons + Wikidata | P1 | Federation |
| 9 | Internet Archive metadata | P1 | AV/Prelinger |
| 10 | ThemeSpec / title renderer | P1 | Remotion if licensed else Skia/local |
| 11 | Loudness EBU R128 | P1 | Delivery |
| 12 | OCIO look apply | P2 | Color V2 |
| 13 | OpenFX host | P2 | Effects |
| 14 | Blender headless | P2 | 3D leaf GPL isolate |
| 15 | Shaka Packager | P2 | HLS/DASH |
| 16 | C2PA preserve | P2 | Provenance |
| 17 | Gen Router (excl. Sora) | P2 | Cloud gen |
| 18 | Stock APIs (rights-gated) | P2 | No mirror/train |
| 19 | Platform upload APIs | P3 | YT/TikTok/Meta — OAuth |
| 20 | VMAF / Real-ESRGAN | P3 | Optional QC/restore |

Queue runtime: AuthZ → schema → priority (preview > QC > master > archive > cloud gen) → worker pools → receipts → Foundry CompletionTruth.

## 59. BUILD vs INTEGRATE MATRIX

| Capability | BUILD | INTEGRATE | REFUSE / HOLD |
|---|---|---|---|
| Timeline + EditOps + `.hvsproj` | **BUILD** | — | CapCut/Premiere as SoT |
| Proxy/master encode | **BUILD** graph | FFmpeg LGPL; NVENC operator | redistributable nonfree |
| Interchange | — | OTIO | OTIO-as-SoT |
| Looks / ThemeSpec | **BUILD** | OCIO configs, licensed LUTs | CapCut CDN packs |
| Captions | **BUILD** cues+style | Whisper family | CapCut caption API invent |
| OpenFX host | later **BUILD** host | OFX plugs (SPDX) | unknown license plugs |
| Blender/3D | thin **adapter** | Blender CLI | link GPL into core |
| Generative B-roll | Router adapters | Runway/Veo/… + open weights | Sora; CapCut gen API |
| Public archives | Broker+rights | IIIF/Wikidata/gov APIs | assume PD; scrape ToS-blocked |
| RightsEngine | **BUILD** | Museum APIs | listicle as authority |
| NLE remote control | — | Resolve script optional later | invented Premiere REST |
| DAM SoT | HVS AssetIndex | ResourceSpace optional vault | Immich/PhotoPrism as product SoR |

## 60. HIGHEST-VALUE INTEGRATIONS

1. FFmpeg + ffprobe · 2. OpenTimelineIO · 3. `.hvsproj` + EditCommandLayer · 4. faster-whisper / whisper.cpp · 5. PySceneDetect · 6. Met v1.1 + Cleveland + AIC + SI OA · 7. Wikimedia Commons + Wikidata · 8. Internet Archive metadata · 9. Blender headless · 10. OCIO + OIIO (V2) · (+ Shaka, C2PA, OpenFX, Gen Router as 11–14).

## 61. REFUSE / DO-NOT-USE LIST (Blind Spot)

```
REFUSE: CapCut / Adobe scrape, CDN dumps, reverse-engineer, draft-file hacking
REFUSE: Invented Premiere / FCP / Resolve / CapCut deep write APIs
REFUSE: Treating proprietary NLE UI/SDK as HVS SoR or copying vendor code
REFUSE: Rebuilding FFmpeg / OTIO / OCIO / OpenFX host as vanity forks when integrate works
REFUSE: Foundry2 · HVS2 · Media2 · Terra-as-NLE · Council-as-render SoR
REFUSE: PUBLICLY VIEWABLE → treat as PUBLIC DOMAIN / CC0 / commercial OWNABLE
REFUSE: Government-hosted → automatic US/global PD without work_of_US_Government + jurisdiction check
REFUSE: Sculpture / building / trademark photo → artwork PD (FoP / publicity traps)
REFUSE: Open Access (OA) → redistribution / commercial / training rights
REFUSE: CC BY / BY-SA / NC / ND used as “free stock” without attribution / SA / NC gates
REFUSE: Stock API bulk mirror / competing library / wallpaper-app / Standalone resale of unaltered assets
REFUSE: Stock API → ML/AI training datasets without explicit permission
REFUSE: Generative “open weights” without SPDX + training-data rights + commercial ToS archive
REFUSE: Non-redistributable FFmpeg (--enable-nonfree) in product installer
REFUSE: Unsandboxed OFX / scripts / untrusted project XML → shell
REFUSE: Listicle / Medium “best free stock” as license authority
REFUSE: Label AI-generated media as photographed reality
REFUSE: research≠shipped / demo-as-OWNABLE
REFUSE/EXCLUDE: OpenAI Sora as Router default
CAUTION: Ultralytics YOLO AGPL · Rubber Band GPL · Remotion unpaid product core · Immich/PhotoPrism as SoR
```

## 62. DUPLICATE SYSTEMS TO AVOID

Second timeline SoT · Foundry-side parallel project JSON · CapCut-in-WR · Media densify inside HVS · Terra timeline · custom codec stack replacing FFmpeg · parallel Provider Router · Auto-Engineer inside HVS · tips-only Director · vanity OTIO reimplementation.

## 63. INTEGRATION DECISION MATRIX

Cut/assemble→BUILD `.hvsproj` · Encode/QC→FFmpeg · Handoff→OTIO · MG→ThemeSpec (+Remotion if licensed) · Gen→Router · Public stills→Broker+rights · 3D→Blender subprocess · Color finish→OCIO V2 · Captions→Whisper · CV→SAM2+ByteTrack (not silent YOLO AGPL).

## 64. OPEN UNKNOWNS / THIN SECTIONS

| ID | Gap | Status |
|---|---|---|
| U-HW-1 | Nebula GPU/VRAM/NVENC measured SKU | UNKNOWN |
| U-COMPOSE-1 | MLT vs GES vs custom spike winner | OPEN |
| U-FF-1 | Redistributable NVENC product SKU posture | OPEN (operator path documented) |
| U-REMOTION-1 | Automators go/no-go commercial | COMMANDER |
| U-SORA-1 | Successor API | No verified successor |
| U-C2PA-1 | Write-path tooling | OPEN |
| U-SI-1 | SI OA FAQ live fetch timeout this session | Re-fetch; Wave C used |
| U-OLIVE-1 | Olive maintenance cadence | UNVERIFIED |
| U-RIFE-SPDX | Exact SPDX at pin | Confirm at integrate |
| U-ZEROCOPY | CUDA-GL scrub on Nebula | PRESENT_UNPROVEN |
| U-SOCIAL-1 | IG/TikTok bitrate freeze | Re-verify at integrate |
| U-THEME-1 | ThemeSpec schema freeze | COMMANDER |
| U-PUBLIC-ART | FoP jurisdiction matrix depth | PARTIAL |

## 65. TOP-LEVEL ARCHITECTURE

**Name: FHVS Programmatic Video Kernel**

```
Commander NL mission
  └─ Foundry MissionContract (acceptance, rights, budget, stop)
       ├─ Plan / tool select / replan (Engineering Core)
       ├─ hvs.* typed tool calls ──queue──► HVS Adapter Runtime
       │         │                              ├─ ProjectService (.hvsproj SoT)
       │         │                              ├─ Timeline/EditOps (hvs.edit.v1)
       │         │                              ├─ Media plane (FFmpeg LGPL + NVENC operator)
       │         │                              ├─ ThemeSpec / Look / captions / audio
       │         │                              ├─ Asset Research adapters
       │         │                              │    (IIIF / museums / Commons / IA / gov / stock-gated)
       │         │                              ├─ Optional: OpenFX / Blender / OCIO (phased)
       │         │                              └─ QC + Archive + Rights gates (fail-closed)
       ├─ CompletionTruth from HVS job receipts (hashes, renders, QC)
       └─ Handoffs OUT: Council cite · Terra deep-link · Media LINK-OUT
                        NEVER absorb those SoTs · NEVER CapCut/Adobe scrape
```

Three stacks: **assembler** (EditOps+FFmpeg) · **code-composition** (Remotion/Manim optional) · **realtime** (FUTURE) — do not collapse.

## 66. FOUNDRY ↔ HVS BOUNDARY

| Concern | Foundry | HVS |
|---|---|---|
| NL → MissionContract | YES | Consumes |
| EditCommands preview\|commit | May propose | Executes / owns |
| Timeline SoR | NO | YES `.hvsproj` |
| OTIO | Engineer adapters | Import/export only |
| FFmpeg argv | Broker policy-gated | Media plane |
| Gen video APIs | Router policy | Provider adapters |
| Museum search | May plan queries | Asset Research + RightsEngine |
| Code patches to HVS | Under Commander gate | Product tree |
| Publish/distribute | May verify gates | Export tools |
| Verdict COMPLETE | Foundry | Supplies evidence |

Capability ≠ authority. Research ≠ shipped. Builds HOLD.

## 67. PHASED ROADMAP

### Engineer H0–H10 (primary dependency order)

| Phase | Name | Ships | Exit |
|---|---|---|---|
| **H0** | Contracts | Tool schemas + queue receipts + authority | Schema tests green; tips≠ops |
| **H1** | Project kernel | `.hvsproj` + `hvs.project.*` + AssetRef | Create/open/save round-trip |
| **H2** | Timeline EditOps | `hvs.timeline.*` ↔ `hvs.edit.v1` | Cut/insert/undo; OTIO export lossy OK |
| **H3** | Media plane | `hvs.ffmpeg.*` proxy+master; LGPL path | Proxy≠master; hash audit |
| **H4** | Captions+audio thin | `hvs.caption.*` `hvs.audio.*` | SRT+duck; consent on clone |
| **H5** | Color/Theme | `hvs.color.*` ThemeSpec.grade | Beauty strength 0 default |
| **H6** | QC+archive+rights | `hvs.qc.*` `archive.*` `rights.*` | Commercial fail closed |
| **H7** | Foundry mission glue | NL→MissionContract→tools→receipts | Trailer-class E2E without CapCut |
| **H8** | Motion/VFX/OFX | `hvs.motion.*` `vfx.*` | Optional; SPDX gate |
| **H9** | Blender/gen adapters | `hvs.blender.*` + gen Router | FUTURE; subprocess isolate |
| **H10** | Eval suite | Programmatic video acceptance battery | Before PRODUCTION_PROVEN language |

### Alias map HVS-CODE-* (Wave D)

| HVS-CODE | Aligns |
|---|---|
| CODE-01 | ⊂ H0–H3 skeleton + probe + QC |
| CODE-02 | ⊂ H2 EditOps |
| CODE-03 | ⊂ H3 render presets |
| CODE-04 | ⊂ H4 captions |
| CODE-05 | ⊂ H7 Foundry broker surface |
| CODE-06 | OTIO export (H2 exit) |
| CODE-07 | ⊂ H5 ThemeSpec |
| CODE-08 | MediaProviderRouter |
| CODE-09 | Platform export packs |
| CODE-10 | Compose spike resolution |
| CODE-11–14 | OCIO · OFX · archive · AI review advisory |

## 68. FIRST IMPLEMENTATION MISSION

### Primary recommendation: `FHVS-ENG-01_HVS_TOOL_KERNEL`

**Aliases:** `HVS-CODE-01` · `HVS-CODE-KERNEL-0` · Wave D “Project Skeleton + Probe + Deterministic QC Gate”

**Scope (H0–H3):** typed `hvs.project|timeline|ffmpeg` + adapter queue + Foundry can call create project → insert two clips → proxy → one master encode receipt. Include minimal rights field (UNKNOWN blocks client-deliverable). Deterministic QC pack on artifact.

**Out:** voice product · Blender · gen-video · CapCut · Media/Terra absorb · full Theme catalog · OTIO-primary SoT · OpenFX · publishing APIs · Remotion unpaid core.

**Owner:** Foundry executes; HVS runtime owns media SoT.  
**Go required:** Commander implement authorization (research ≠ go). **Builds HOLD.**

## 69. SOURCE BIBLIOGRAPHY

### Wave stamps (this program)
`waves/WAVE_A_ENGINES.md` · `WAVE_B_CREATIVE.md` · `WAVE_C_ARCHIVES.md` · `WAVE_D_ARCHITECTURE.md` · `WAVE_SCIENCE_CODECS_COLOR_CV_PREVIEW.md` · `WAVE_BLINDSPOT.md` · `AVENGER_EVIDENCE.md` · `AVENGER_HISTORIAN.md` · `AVENGER_ENGINEER.md` · `AVENGER_SCIENCE.md` · `WAVE_6.md` · `WAVE_PA2_1`…`WAVE_PA2_8` · `FHVS_8_WAVES.md` · `FOUNDRY_HVS_PROGRAMMATIC_VIDEO_MISSION.md`

### Prior research (extend, do not contradict)
- `/home/box/higher-vision-studios/HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md`
- `/home/box/foundry-standalone-engineer/FOUNDRY_STANDALONE_ENGINEER_RESEARCH_REPORT.md`

### Primary web (selected)
ffmpeg.org/legal.html · opentimeline.io · remotion.dev LICENSE/terms · opencolorio.org · openexr.com · blender.org/about/license · openai/whisper · ASWF OpenFX/OIIO · NVIDIA Video Codec SDK / FFmpeg GPU · IIIF.io · RightsStatements.org · creativecommons.org · 17 USC §105 · Met v1.1 (metmuseum.github.io) · Cleveland openaccess-api · AIC api.artic.edu · si.edu/openaccess · archive.org · commons.wikimedia.org · Pexels/Pixabay/Unsplash license pages · Poly Haven / ambientCG licenses

## 70. FINAL FLAGS + MANDATORY TECHNOLOGY CATALOG

```
LIVE_WEB_RESEARCH=YES
RESEARCH_ONLY=YES
PRIMARY_SOURCES_USED=YES
OFFICIAL_REPOS_VERIFIED=YES
LICENSES_VERIFIED=YES (high-value; gaps UNKNOWN)
MUSEUMS_RESEARCHED=YES
PUBLIC_ARCHIVES_RESEARCHED=YES
PUBLIC_ART_RESEARCHED=PARTIAL
PUBLIC_DOMAIN_RIGHTS_DISTINGUISHED=YES
IIIF_RESEARCHED=YES
MEDIA_APIS_RESEARCHED=YES
PROGRAMMATIC_VIDEO_RESEARCHED=YES
FFMPEG_RESEARCHED=YES
GSTREAMER_RESEARCHED=YES
OTIO_RESEARCHED=YES
BLENDER_RESEARCHED=YES
OPENCOLORIO_RESEARCHED=YES
OPENIMAGEIO_RESEARCHED=YES
WHISPER_ECOSYSTEM_RESEARCHED=YES
HVS_TOOL_API_PROPOSED=YES
FOUNDRY_HVS_BOUNDARY_DEFINED=YES
IMPLEMENTATION_PERFORMED=NO
FILES_MODIFIED=0
BUILD=NO
PACKAGE=NO
INSTALL=NO
ACTIVATE=NO
COMMIT=NO
PUSH=NO
DEPLOY=NO
BUILDS_HOLD=YES
COMMANDER_DECISION_REQUIRED=YES
FOUNDRY_NE_HVS=YES
OTIO_IS_INTERCHANGE_NOT_SOT=YES
FFMPEG_LGPL_PREFER_NVENC=YES
REMOTION_NE_OSS=YES
BLENDER_SUBPROCESS_ONLY=YES
RIGHTS_URI_FAIL_CLOSED=YES
SORA_EXCLUDED=YES
VIEWABLE_NE_PD=YES
NEBULA_SPECS_INVENTED=NO
ARCHITECTURE=FHVS_Programmatic_Video_Kernel
FIRST_MISSION=FHVS-ENG-01_HVS_TOOL_KERNEL
FIRST_MISSION_ALIASES=HVS-CODE-01|HVS-CODE-KERNEL-0
```

### TECHNOLOGY CATALOG (mandatory — Wave A + B + Evidence merge, deduped by NAME)

| NAME | CATEGORY | OFFICIAL_SITE | OFFICIAL_REPO | LICENSE | LANGUAGE | LINUX | LOCAL | SELF_HOSTABLE | CLI | API | SDK | GPU | PROGRAMMATIC_CONTROL | MAINTENANCE | HVS_USE_CASE | INTEGRATION_METHOD | MAJOR_RISK | RECOMMENDATION |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Remotion | Programmatic video | https://www.remotion.dev/ | https://github.com/remotion-dev/remotion | Remotion License (SOURCE_AVAILABLE_PROPRIETARY; NOT OSI OSS; Company License above threshold) | TypeScript/React | YES | YES | YES | YES | YES | YES (npm) | Browser/Chromium GPU | Excellent | ACTIVE | Code→video / motion templates | Integrate as licensed render worker | Company/Automator fees; not free-for-all OSS | EVALUATE + LICENSE GATE |
| MoviePy | Programmatic (Python) | https://zulko.github.io/moviepy/ | https://github.com/Zulko/moviepy | MIT | Python | YES | YES | YES | NO (library) | YES | PyPI | Via FFmpeg | Excellent (scripted cuts) | MAINTAINED | Python glue over FFmpeg | Integrate | Perf at scale; v1→v2 API break | PRIORITIZE adapter |
| Manim Community | Programmatic (math) | https://www.manim.community/ | https://github.com/ManimCommunity/manim | MIT | Python | YES | YES | YES | YES | YES | PyPI | Limited OpenGL | Excellent (explainers) | ACTIVE | Educational/diagram scenes | Specialize renderer | Not a general NLE | EVALUATE niche |
| Manim (3b1b original) | Programmatic (math) | https://github.com/3b1b/manim | https://github.com/3b1b/manim | MIT-class (confirm at pin) | Python | YES | YES | YES | YES | YES | — | Limited | Excellent (explainers) | MAINTAINED (upstream) | Prefer Community unless specific feature | Prefer Community fork | Upstream drift | REFERENCE |
| FFmpeg | Media plane | https://ffmpeg.org/ · https://www.ffmpeg.org/legal.html | https://git.ffmpeg.org/ffmpeg.git · https://github.com/FFmpeg/FFmpeg | LGPL v2.1+ default; optional GPL; --enable-nonfree = unredistributable | C | YES | YES | YES | YES | YES (libav*) | C + bindings | NVENC/NVDEC/VAAPI/QSV/AMF/Vulkan | Excellent | ACTIVE | Decode/encode/proxy/filter/render CORE | INTEGRATE (do not reimplement) | Patents; GPL contamination; nonfree ship | TOP PRIORITY INTEGRATE (LGPL ship) |
| OpenTimelineIO | Interchange | https://opentimeline.io/ | https://github.com/AcademySoftwareFoundation/OpenTimelineIO | Apache-2.0 | Python/C++ | YES | YES | YES | YES | YES | YES | N/A (metadata) | Excellent (cuts) | ACTIVE (ASWF) | Editorial interchange ONLY — ≠ .hvsproj SoT | INTEGRATE adapters | Lossy for looks/OFX/provenance | TOP PRIORITY INTEGRATE (interchange) |
| MLT Framework | NLE engine | https://www.mltframework.org/ | https://github.com/mltframework/mlt | LGPLv2.1 (framework); melt/apps GPL; modules vary | C/C++ | YES | YES | YES | YES (melt) | YES | YES | Movit/VAAPI/Vulkan/OFX path | Excellent (XML compose) | ACTIVE | Multitrack compose spike | SPIKE ONE vs GES/custom | GPL melt vs LGPL lib; filter matrix | PRIORITIZE spike candidate |
| GStreamer | Media graph | https://gstreamer.freedesktop.org/ | https://gitlab.freedesktop.org/gstreamer/gstreamer | LGPL core; plugins vary GPL/proprietary | C | YES | YES | YES | YES | YES | YES | VA/CUDA/Vulkan/GL | Excellent | ACTIVE | Linux capture/stream/process; peer to FFmpeg | Integrate; per-plugin SPDX | Plugin license maze | PRIORITIZE Linux I/O |
| GStreamer Editing Services (GES) | NLE services | https://gstreamer.freedesktop.org/documentation/gst-editing-services/ | (GStreamer mono-repo) | LGPL (confirm plugins) | C | YES | YES | YES | Partial | YES | YES | Via GStreamer | Strong | ACTIVE | Compose spike vs MLT | SPIKE ONE | Complexity | EVALUATE spike |
| PyAV | Python FFmpeg bindings | https://pyav.org/ | https://github.com/PyAV-Org/PyAV | BSD-3-Clause (FFmpeg separate) | Python/Cython | YES | YES | YES | NO | YES | PyPI av | Via FFmpeg hwaccel | Excellent frame-level | ACTIVE | Python frame decode/encode | Integrate; pin FFmpeg license | Wheel/FFmpeg license mismatch | PRIORITIZE |
| OpenCV | CV + video I/O | https://opencv.org/ | https://github.com/opencv/opencv | Apache-2.0 (≥4.5) | C++/Python | YES | YES | YES | Limited | YES | YES | CUDA optional | Strong (CV) | ACTIVE | Analysis/track/transforms | Integrate vision stages | Not timeline SoT | INTEGRATE |
| Skia | 2D graphics | https://skia.org/ | https://skia.googlesource.com/skia | BSD-3-Clause | C++ | YES | YES | YES | Tools | YES | YES | GL/Vulkan/Metal/Dawn | Excellent 2D frames | ACTIVE | 2D compositor → encoder | Integrate renderer | Build complexity | EVALUATE |
| WebCodecs | Browser encode/decode | https://www.w3.org/TR/webcodecs/ | https://github.com/w3c/webcodecs | W3C standard | JS API | YES (Chromium) | YES | Via Electron/Chromium | NO | YES | Browser | Often HW-backed | Excellent offline frame encode | ACTIVE | Electron/web offline render | Integrate + muxer | Codec availability varies | PRIORITIZE web-local |
| WebGPU | GPU web compute | https://www.w3.org/TR/webgpu/ | https://github.com/gpuweb/gpuweb | W3C standard | JS/WGSL | YES (growing) | YES | YES | NO | YES | Dawn/wgpu | Native purpose | Excellent GPU effects | ACTIVE | GPU effects/preview | Integrate shaders | Driver maturity Linux | EVALUATE |
| Three.js | Web 3D/motion | https://threejs.org/ | https://github.com/mrdoob/three.js | MIT | JavaScript | YES | YES | YES | NO | YES | npm | WebGL/WebGPU | High | ACTIVE | Preview/titles capture→ingest | Browser adapter | Not editorial SoT | OPTIONAL preview |
| Editly | Declarative Node NLE | npm editly | https://github.com/mifi/editly | MIT (confirm at pin) | Node/JS | YES | YES | YES | YES | YES | npm | Via FFmpeg | Good | MAINTAINED | Thin JSON→video adapter | FUTURE adapter | Not SoT | FUTURE |
| Blender | 3D/VFX/DCC | https://www.blender.org/ | https://projects.blender.org/blender/blender | GPLv2 or later (Cycles Apache-2.0) | C/C++/Python | YES | YES | YES | YES headless | bpy | YES | Cycles/EEVEE GPU | HIGH | ACTIVE | 3D/VFX/compositor plates | SUBPROCESS isolate (GPL) | GPL infect if linked in-process | INTEGRATE leaf subprocess |
| Kdenlive | Open NLE | https://kdenlive.org/ | https://invent.kde.org/multimedia/kdenlive | GPLv3+ | C++/Qt | YES | YES | YES | Partial | — | — | Via MLT | UX prior art | ACTIVE (KDE) | Reference UX; export bridge | Reference/subprocess | GPL UI ≠ HVS SoT | REFERENCE ONLY |
| Shotcut | Open NLE | https://www.shotcut.org/ | https://github.com/mltframework/shotcut | GPLv3 | C++ | YES | YES | YES | YES | — | — | Via MLT | UX prior art | ACTIVE | MLT showcase prior art | Reference | GPL | REFERENCE ONLY |
| Olive | Open NLE | https://www.olivevideoeditor.org/ | https://github.com/olive-editor/olive | GPLv3 | C++ | YES | YES | YES | — | — | — | — | Experimental | SLOW/ALPHA (UNVERIFIED cadence) | Research only | Avoid depend | Rewrite uncertainty | REFERENCE / HOLD |
| Pitivi | Open NLE | https://www.pitivi.org/ | https://gitlab.gnome.org/GNOME/pitivi | LGPLv2+ | Python/GTK | YES (GNOME) | YES | YES | — | — | — | Via GStreamer | GES prior art | MAINTAINED | GStreamer NLE prior art | Reference | Not SoT | REFERENCE ONLY |
| Flowblade | Open NLE | https://jliljebl.github.io/flowblade/ | https://github.com/jliljebl/flowblade | GPLv3 | Python | YES | YES | YES | — | — | — | Via MLT | UX prior art | MAINTAINED | Linux-first MLT NLE | Reference | GPL | REFERENCE ONLY |
| OpenShot | Open NLE | https://www.openshot.org/ | https://github.com/OpenShot/openshot-qt | GPLv3+ | Python/C++ | YES | YES | YES | — | — | — | — | Beginner NLE prior art | MAINTAINED | Not SoT | Reference | GPL | REFERENCE ONLY |
| Natron | Compositor | https://natrongithub.github.io/ | https://github.com/NatronGitHub/Natron | GPLv2 | C++ | YES | YES | YES | YES | OpenFX host | — | GPU | MEDIUM | MAINTAINED | OFX host leaf | SUBPROCESS | Fork/maintenance | EVALUATE V2 |
| OpenColorIO | Color | https://opencolorio.org/ | https://github.com/AcademySoftwareFoundation/OpenColorIO | BSD-3-Clause | C++/Python | YES | YES | YES | YES | YES | YES | GPU path | HIGH | ACTIVE | ThemeSpec.grade / ACES looks V2 | INTEGRATE V2 | Config complexity | INTEGRATE V2 |
| ACES (ASWF) | Color standard | https://www.acescentral.com/ | https://github.com/aces-aswf/aces | Apache-2.0 (ASWF repos) | CTL/docs | YES | YES | YES | — | Via OCIO | YES | Via OCIO | HIGH | ACTIVE | Scene-referred interchange | Via OCIO configs | Academy trademarks | INTEGRATE_VIA_OCIO |
| OpenEXR | HDR image | https://openexr.com/ | https://github.com/AcademySoftwareFoundation/openexr | BSD-3-Clause | C++ | YES | YES | YES | tools | YES | YES | N/A | HIGH | ACTIVE | VFX plates/intermediates | INTEGRATE | — | INTEGRATE CORE |
| OpenImageIO | Image I/O | https://openimageio.readthedocs.io/ | https://github.com/AcademySoftwareFoundation/OpenImageIO | Apache-2.0 (+tiny BSD) | C++/Python | YES | YES | YES | YES (oiiotool) | YES | YES | N/A | HIGH | ACTIVE | Plate/image pipeline | CLI/SDK | — | INTEGRATE CORE |
| OpenFX | VFX plugin API | https://openfx.org/ | https://github.com/AcademySoftwareFoundation/openfx | BSD-3-Clause | C/C++ | YES | YES | YES | — | Plugin API | YES | Via hosts | HIGH | ACTIVE | Effect host V2 | BUILD host + SPDX plugs | Hosting burden; plug licenses vary | INTEGRATE/BUILD V2 |
| LittleCMS | ICC CMM | https://www.littlecms.com/ | https://github.com/mm2/Little-CMS | MIT | C | YES | YES | YES | tools | YES | YES | N/A | HIGH | ACTIVE | Soft-proof / ICC | Library | GPL speed plugins | INTEGRATE OPTIONAL |
| Lottie (lottie-web) | Motion JSON | https://airbnb.design/lottie/ | https://github.com/airbnb/lottie-web | MIT | JS | YES | YES | YES | — | Players | YES | — | HIGH | ACTIVE | Overlay motion packs | ThemeSpec leaf | Player mismatch | INTEGRATE OPTIONAL |
| Rive | Interactive motion | https://rive.app/ | https://github.com/rive-app | Runtimes often MIT; .riv proprietary | Multi | YES | YES | limited | — | Runtimes | YES | — | HIGH | ACTIVE | Interactive overlays | Caution | Proprietary format | EVALUATE LICENSE |
| PixiJS | 2D WebGL | https://pixijs.com/ | https://github.com/pixijs/pixijs | MIT | JS | YES | YES | YES | — | JS | YES | WebGL | HIGH | ACTIVE | 2D motion overlays | Browser | Web-only | OPTIONAL |
| GSAP | Animation lib | https://gsap.com/ | https://github.com/greensock/GSAP | Webflow Standard License (NOT OSI) | JS | YES | YES | YES | — | JS | YES | — | HIGH | ACTIVE | Web motion | Legal gate if visual builder | Compete-with-Webflow clause | EVALUATE LEGAL |
| Babylon.js | Web 3D | https://www.babylonjs.com/ | https://github.com/BabylonJS/Babylon.js | Apache-2.0 | TS/JS | YES | YES | YES | — | JS | YES | WebGL/WebGPU | HIGH | ACTIVE | Alt web 3D preview | Browser | Web-only | OPTIONAL |
| OpenUSD | 3D scene | https://openusd.org/ | https://github.com/PixarAnimationStudios/OpenUSD | TOST 1.0 (Apache-mod; trademark diffs) | C++/Python | YES | YES | YES | tools | YES | YES | Hydra | HIGH | ACTIVE | Scene interchange | USD tools | TOST ≠ plain Apache | EVALUATE V2 |
| glTF | 3D transmission | https://www.khronos.org/gltf/ | https://github.com/KhronosGroup/glTF | Spec Khronos; runtimes vary | JSON/bin | YES | YES | YES | — | Format | — | Via engines | HIGH | ACTIVE | Asset delivery | Three/Babylon/Assimp | Extension maze | INTEGRATE FORMAT |
| Assimp | 3D import | https://www.assimp.org/ | https://github.com/assimp/assimp | BSD-3-Clause | C++ | YES | YES | YES | YES | C++ | YES | N/A | HIGH | ACTIVE | Mesh ingest | Library/CLI | Format quirks | INTEGRATE OPTIONAL |
| SoX | Audio CLI | http://sox.sourceforge.net/ | https://sourceforge.net/projects/sox/ | GPL/LGPL mix | C | YES | YES | YES | YES | — | — | N/A | MEDIUM | MAINTAINED | Simple audio ops | Subprocess | GPL components | EVALUATE |
| Rubber Band | Time-stretch | https://breakfastquay.com/rubberband/ | https://github.com/breakfastquay/rubberband | GPLv2+ or commercial | C++ | YES | YES | YES | YES | C++ | YES | N/A | HIGH | ACTIVE | Pitch/tempo | Subprocess or commercial | GPL copyleft | LICENSE_TRAP / commercial |
| librosa | Audio analysis | https://librosa.org/ | https://github.com/librosa/librosa | ISC | Python | YES | YES | YES | — | Python | YES | N/A | HIGH | ACTIVE | Feature analysis | Python tool | Heavy deps | INTEGRATE OPTIONAL |
| Essentia | MIR | https://essentia.upf.edu/ | https://github.com/MTG/essentia | AGPLv3 (+ commercial) | C++/Python | YES | YES | YES | YES | YES | YES | N/A | HIGH | ACTIVE | Music analysis | AGPL gate | AGPL network | EVALUATE LEGAL |
| JUCE | Audio framework | https://juce.com/ | https://github.com/juce-framework/JUCE | AGPLv3 or commercial | C++ | YES | YES | YES | — | C++ | YES | N/A | HIGH | ACTIVE | Plugin host / DAW leaf | Commercial license likely | AGPL | EVALUATE COMMERCIAL |
| PipeWire | Linux media | https://pipewire.org/ | https://gitlab.freedesktop.org/pipewire/pipewire | MIT/LGPL mix (confirm) | C | YES | YES | YES | YES | YES | YES | N/A | HIGH | ACTIVE | Linux audio graph | System | Session policy | INTEGRATE LINUX |
| EBU R128 / loudnorm | Loudness | https://tech.ebu.ch/docs/r/r128.pdf | libebur128 / FFmpeg | Spec + impl licenses | — | YES | YES | YES | YES | filter | — | N/A | HIGH | ACTIVE | Normalize delivery | FFmpeg loudnorm | Mis-meter = QC fail | INTEGRATE CORE |
| OpenAI Whisper (OSS) | Speech ASR | https://openai.com/research/whisper | https://github.com/openai/whisper | MIT | Python | YES | YES | YES | YES | Python | YES | CUDA | HIGH | MAINTAINED | Captions V1 | Local tool | Hallucinations; human QC | INTEGRATE |
| whisper.cpp | Speech ASR | — | https://github.com/ggerganov/whisper.cpp | MIT (confirm at pin) | C/C++ | YES | YES | YES | YES | C API | YES | Various | HIGH | ACTIVE | Lightweight local ASR | Embed/CLI | Model mgmt | INTEGRATE OPTIONAL |
| faster-whisper | Speech ASR | — | https://github.com/SYSTRAN/faster-whisper | MIT | Python | YES | YES | YES | YES | Python | YES | CUDA | HIGH | ACTIVE | Fast local ASR preferred | Python tool | CTranslate2 pin | INTEGRATE PREFERRED ASR |
| Vosk | Speech ASR | https://alphacephei.com/vosk/ | https://github.com/alphacep/vosk-api | Apache-2.0 | C++/Python | YES | YES | YES | YES | YES | YES | N/A | MEDIUM | MAINTAINED | Offline ASR alt | Library | Accuracy vs Whisper | EVALUATE |
| WhisperX | ASR+align | — | https://github.com/m-bain/whisperX | BSD-2-Clause | Python | YES | YES | YES | YES | Python | YES | CUDA | HIGH | ACTIVE | Aligned captions | Tool leaf | pyannote deps | INTEGRATE OPTIONAL |
| MediaPipe | CV perception | https://ai.google.dev/edge/mediapipe | https://github.com/google/mediapipe | Apache-2.0 | C++/Python | YES | YES | YES | — | YES | YES | GPU/delegates | HIGH | ACTIVE | Pose/face/hands | Library | Model cards / consent | INTEGRATE OPTIONAL |
| Ultralytics YOLO | Detection | https://www.ultralytics.com/ | https://github.com/ultralytics/ultralytics | AGPL-3.0 (+ Enterprise) | Python | YES | YES | YES | YES | YES | YES | CUDA | HIGH | ACTIVE | Detect/track | Legal gate | AGPL infects product | CAUTION / ENTERPRISE OR AVOID |
| SAM2 | Segmentation | https://github.com/facebookresearch/sam2 | https://github.com/facebookresearch/sam2 | Apache-2.0 (confirm tag; SAM3 may differ) | Python | YES | YES | YES | — | Python | YES | CUDA | HIGH | ACTIVE | Mask mattes / TrackSubject | Opt-in CV | License drift SAM3 | INTEGRATE (pin) |
| ByteTrack | Multi-object track | — | https://github.com/ifzhang/ByteTrack | MIT | Python | YES | YES | YES | — | Python | YES | CUDA | HIGH | MAINTAINED | Tracking IDs | With detector | Detector license | INTEGRATE |
| Wan2.1 | Gen video (open weights) | Hugging Face / project | https://github.com/Wan-Video/Wan2.1 | Apache-2.0 | Python | YES | YES | YES | YES | Python | YES | CUDA heavy | HIGH | ACTIVE | Local T2V/I2V plates | Opt-in gen leaf | VRAM; identity policy | OPT-IN OPEN WEIGHTS |
| CogVideo / CogVideoX | Gen video (open weights) | — | https://github.com/THUDM/CogVideo | Apache-2.0 (2B); 5B may differ — VERIFY | Python | YES | YES | YES | YES | Python | YES | CUDA heavy | HIGH | ACTIVE | Research local gen | Opt-in | Per-size license | OPT-IN VERIFY LICENSE |
| Hugging Face Diffusers | Gen pipelines | https://huggingface.co/docs/diffusers | https://github.com/huggingface/diffusers | Apache-2.0 | Python | YES | YES | YES | — | Python | YES | CUDA | HIGH | ACTIVE | Pipeline glue | Library | Per-model card binds | INTEGRATE OPTIONAL |
| Runway | Gen video API | https://runwayml.com/ | — (API) | Proprietary API ToS | — | Client OK | NO (weights) | N/A | — | REST | YES | Cloud | HIGH | ACTIVE | VIDEO_GENERATOR adapter | Router + PreviewTicket | Spend/ToS | API OPTIONAL |
| Luma Dream Machine | Gen video API | https://lumalabs.ai/ | — | Proprietary | — | Client OK | NO | N/A | — | API | YES | Cloud | HIGH | ACTIVE | Cloud gen | Router | ToS | API OPTIONAL |
| Kling / BytePlus | Gen video API | Vendor portals | — | Proprietary | — | Client OK | NO | N/A | — | API | YES | Cloud | MEDIUM | ACTIVE | Cloud gen | Router | Regional/ToS | API OPTIONAL |
| Google Veo | Gen video API | Google AI / Vertex | — | Proprietary | — | Client OK | NO | N/A | — | API | YES | Cloud | HIGH | ACTIVE | Cloud gen | Router | Quota/ToS | API OPTIONAL |
| Adobe Firefly Video | Gen video API | Adobe Firefly Services | — | Proprietary | — | Client OK | NO | N/A | — | API | YES | Cloud | HIGH | ACTIVE | Enterprise cloud | Router | Display/ToS | API OPTIONAL |
| Pika | Gen video API | https://pika.art/ | — | Proprietary | — | Client OK | NO | N/A | — | API | YES | Cloud | HIGH | ACTIVE | Cloud gen | Router | ToS | API OPTIONAL |
| OpenAI Sora | Gen video API | — | — | — | — | — | — | — | — | — | — | — | — | UNAVAILABLE (shutdown ~2026-09-24 lineage) | Excluded from Router | Do not depend | EXCLUDE |
| Real-ESRGAN | Restoration | — | https://github.com/xinntao/Real-ESRGAN | BSD-3-Clause | Python | YES | YES | YES | YES | Python | YES | CUDA | HIGH | ACTIVE | Upscale | OFF-by-default | Artifact as master | OPT-IN OFF DEFAULT |
| VapourSynth | Frame server | https://www.vapoursynth.com/ | https://github.com/vapoursynth/vapoursynth | LGPL | C++/Python | YES | YES | YES | YES | Python | YES | Via plugins | MEDIUM | MAINTAINED | Filter/restore graph | OFF-by-default | Plugin SPDX maze | OPT-IN OFF DEFAULT |
| RIFE | Frame interp | — | https://github.com/hzwer/Practical-RIFE | MIT (confirm pin) | Python | YES | YES | YES | YES | Python | YES | CUDA | HIGH | ACTIVE | Interp/slow-mo | OFF-by-default | Soap-opera artifacts | OPT-IN OFF DEFAULT |
| ImageMagick | Image CLI | https://imagemagick.org/ | https://github.com/ImageMagick/ImageMagick | ImageMagick License (Apache-style) | C | YES | YES | YES | YES | — | — | N/A | HIGH | ACTIVE | Still convert | Subprocess | Policy.xml security | INTEGRATE OPTIONAL |
| libvips | Image lib | https://www.libvips.org/ | https://github.com/libvips/libvips | LGPL-2.1-or-later | C | YES | YES | YES | YES | C | YES | N/A | HIGH | ACTIVE | High-perf stills | Dynamic link | LGPL compliance | INTEGRATE OPTIONAL |
| Sharp | Node image | https://sharp.pixelplumbing.com/ | https://github.com/lovell/sharp | Apache-2.0 (+ libvips LGPL) | JS | YES | YES | YES | — | Node | YES | N/A | HIGH | ACTIVE | Node still pipeline | npm + notice | Bundled LGPL | INTEGRATE OPTIONAL |
| Cairo | 2D graphics | https://www.cairographics.org/ | https://gitlab.freedesktop.org/cairo/cairo | LGPL-2.1 / MPL-1.1 | C | YES | YES | YES | — | C | YES | N/A | HIGH | ACTIVE | Vector rasterize | Library | LGPL | INTEGRATE OPTIONAL |
| MediaInfo | Metadata | https://mediaarea.net/MediaInfo | https://github.com/MediaArea/MediaInfo | BSD-2-Clause (+options) | C++ | YES | YES | YES | YES | Library | YES | N/A | HIGH | ACTIVE | Media probe | CLI/lib | — | INTEGRATE CORE |
| ExifTool | Metadata | https://exiftool.org/ | https://github.com/exiftool/exiftool | Artistic / GPL dual | Perl | YES | YES | YES | YES | — | — | N/A | HIGH | ACTIVE | EXIF/XMP rights write | Subprocess | Perl dual-license | INTEGRATE OPTIONAL |
| ffprobe | Metadata | https://ffmpeg.org/ffprobe.html | (FFmpeg) | LGPL-2.1+ default | C | YES | YES | YES | YES | JSON/XML | — | N/A | HIGH | ACTIVE | Stream probe | CLI | Same as FFmpeg ship | INTEGRATE CORE |
| PySceneDetect | Scene detect | https://www.scenedetect.com/ | https://github.com/Breakthrough/PySceneDetect | BSD-3-Clause | Python | YES | YES | YES | YES | Python | YES | N/A | HIGH | ACTIVE | Cut detection | CLI/Python | FFmpeg dep | INTEGRATE CORE |
| Shaka Packager | Packaging | https://shaka-project.github.io/shaka-packager/ | https://github.com/shaka-project/shaka-packager | Apache-2.0 (confirm) | C++ | YES | YES | YES | YES | YES | YES | N/A | HIGH | ACTIVE | HLS/DASH export | CLI | — | INTEGRATE OPTIONAL |
| C2PA tooling | Provenance | https://opensource.contentauthenticity.org/ | various | Spec + tool licenses | Multi | YES | YES | YES | tools | YES | YES | N/A | HIGH | ACTIVE | Content credentials | Preserve on ingest; write path OPEN | Write tooling choice UNKNOWN | INTEGRATE preserve; write TBD |
| ElevenLabs STT/TTS | Speech API | https://elevenlabs.io/docs | — | Proprietary API ToS | — | N/A cloud | Cloud | N/A | — | API | YES | Cloud | HIGH | ACTIVE | Optional VO/STT | Router; consent_id | Consent clones | API OPTIONAL |
| OpenAI STT/TTS APIs | Speech API | https://platform.openai.com/docs/guides/speech-to-text | — | Proprietary API ToS | — | N/A cloud | Cloud | N/A | — | API | YES | Cloud | HIGH | ACTIVE | Optional cloud ASR/TTS | Router | Consent | API OPTIONAL |

**Technology catalog row count:** 79

**Media/archive row count (§42):** 34

**Museum row count (§43):** 20

---

*End FOUNDRY_HVS_PROGRAMMATIC_VIDEO_WORLD_RESEARCH_REPORT — research synthesis only — 2026-09-22 ET (America/New_York) — Builds HOLD — Commander decision required.*
