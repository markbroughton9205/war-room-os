# TERRA — EXACT ADDRESS / ROOFTOP RESOLUTION RESEARCH
# STREET-APPROXIMATE → EXACT PROPERTY TARGET → AUTOMATIC CLOSE ZOOM
# Commander: Mark
#
# MODE: DEEP RESEARCH ONLY
# DO NOT MODIFY CODE
# DO NOT BUILD
# DO NOT PACKAGE
# DO NOT INSTALL
# DO NOT COMMIT / PUSH / DEPLOY

MISSION

Research how Terra should resolve a typed specific street address to the
most exact lawful coordinate available and automatically zoom to the
correct property/building instead of stopping at an approximate street point.

CURRENT FAILURE MODE

Commander types a specific address into Terra.

Example class of query:

936 Springdale St
Akron, Ohio

Current Terra result may show:

STREET — APPROXIMATE

and place the camera at a representative point on the road/street geometry.

The actual desired property may be visibly some distance away.

Commander can manually zoom/pan afterward and find the correct building,
but Terra should do this automatically when reliable address/property evidence exists.

This research must distinguish:

1. ADDRESS RESOLUTION ACCURACY
from
2. CAMERA ZOOM / FRAMING ACCURACY

Do not assume the problem is only camera altitude.

==================================================
CORE QUESTION
==================================================

How can Terra take:

FULL STREET ADDRESS

and resolve:

COUNTRY
STATE/PROVINCE
CITY
POSTAL CODE
STREET
HOUSE NUMBER

to the highest-confidence lawful geographic target available:

ROOFTOP
BUILDING
PARCEL
ADDRESS POINT
INTERPOLATED ADDRESS
STREET SEGMENT
PLACE

and then frame the Cesium camera appropriately?

==================================================
SCREENSHOT BEHAVIOR TO EXPLAIN
==================================================

Current behavior:

typed exact address
→ Terra reports STREET / APPROXIMATE
→ camera lands in general street area

Desired behavior:

typed exact address
→ exact address candidate found
→ property/building coordinate verified
→ Terra flies directly above exact property
→ automatic close inspection zoom similar to Commander's manually adjusted view

If exact property cannot be proven:

Terra must NOT pretend.

It should retain:

INTERPOLATED
STREET
AMBIGUOUS

truth states.

==================================================
WAVE 1 — TRACE GEOCODER SEMANTICS
==================================================

Research current capabilities and response semantics for:

Nominatim
Photon
Pelias
OpenAddresses
Overture Addresses
US Census Geocoder
HERE
Mapbox
Smarty
TomTom
Esri
other strong lawful address geocoders

For each determine:

HOUSE_NUMBER_SUPPORT =
ROOFTOP_SUPPORT =
ADDRESS_POINT_SUPPORT =
INTERPOLATION =
PARCEL_SUPPORT =
CONFIDENCE_FIELD =
MATCH_TYPE =
COMMERCIAL_USE =
CACHE_RULES =
DISPLAY_RESTRICTIONS =
SELF_HOSTABLE =
GLOBAL_COVERAGE =
US_ACCURACY =
KNOWN_LIMITATIONS =

Clearly distinguish:

actual rooftop coordinate

from:

interpolated coordinate on street centerline.

==================================================
WAVE 2 — EXACT ADDRESS DATA SOURCES
==================================================

Research datasets capable of improving a street-only result.

Investigate:

OpenAddresses

Overture address theme

local/county address-point GIS

parcel centroid datasets

building footprints

municipal GIS

911/E911 address points where public

tax parcel datasets

state GIS address layers

commercial rooftop geocoders

For U.S. addresses especially determine whether Terra could use:

GEOCODER
→ ADDRESS POINT
→ PARCEL
→ BUILDING FOOTPRINT

as successive refinement.

==================================================
WAVE 3 — SUMMIT COUNTY / AKRON CASE STUDY
==================================================

Use Akron/Summit County as a test case.

Research lawful/public data sources that could resolve an exact property such as:

936 Springdale St
Akron, Ohio

DO NOT publish private resident identity information.

We only need geographic/property targeting capability.

Investigate:

Summit County GIS
Summit County parcel viewer/services
Summit County address point datasets
Akron GIS
Ohio statewide address datasets
Ohio Location Based Response System if relevant/public
ODOT / state GIS where relevant

Determine:

Is there a public machine-readable endpoint?

ArcGIS REST?
WFS?
GeoJSON?
FeatureServer?
MapServer?

Does it contain:

house number
street
parcel geometry
parcel centroid
building footprint
address point

What are the:

terms
license
commercial-use restrictions
rate limits

Do not scrape an HTML parcel website if no authorized API exists.

==================================================
WAVE 4 — WORLDWIDE ARCHITECTURE
==================================================

Do NOT design Terra around Summit County alone.

Research how a WORLDWIDE resolver should work.

Potential architecture:

QUERY
↓
COUNTRY-AWARE ADDRESS PARSER
↓
GLOBAL GEOCODER
↓
ADDRESS CONFIDENCE
↓
REGIONAL PRECISION ENRICHMENT
↓
PARCEL / BUILDING / ADDRESS POINT when available
↓
FINAL TARGET

Examples:

United States:
parcel/address-point enhancement

Europe:
national/open address registries where lawful

Canada:
provincial/municipal address sources

other countries:
country-specific sources where available

If precision enhancement unavailable:

fall back honestly.

==================================================
WAVE 5 — MATCH QUALITY MODEL
==================================================

Design evidence-backed Terra match classifications.

Research whether this hierarchy is appropriate:

ROOFTOP

BUILDING

PARCEL

ADDRESS_POINT

INTERPOLATED

STREET

PLACE

AMBIGUOUS

COORDINATE

Define exactly what evidence qualifies for each.

Example:

ROOFTOP =
provider explicitly states rooftop precision
OR coordinate verified inside corresponding building footprint with strong address match

PARCEL =
verified target parcel geometry but no building-level coordinate

INTERPOLATED =
number mathematically placed along street range

STREET =
provider resolved street only

Do NOT promote STREET to ROOFTOP.

==================================================
WAVE 6 — MULTI-PROVIDER CONSENSUS
==================================================

Research whether Terra should compare multiple candidate providers.

Example:

Nominatim:
Springdale Street

OpenAddresses:
936 Springdale St coordinate X

Parcel GIS:
parcel contains coordinate X

Building footprint:
building inside parcel

Potential result:

ROOFTOP / HIGH CONFIDENCE

Research safe scoring methods.

Possible signals:

house number exact equality

normalized street-name equality

street suffix equality

ZIP/postcode equality

city equality

state equality

coordinate agreement

parcel containment

building containment

provider confidence

Do NOT simply average coordinates.

==================================================
WAVE 7 — STREET NAME COLLISION DEFENSE
==================================================

Research exact-name validation.

Terra previously encountered cases like:

Springdale Street
vs
Springdale Drive

These must NOT be treated as equivalent.

Research normalization that preserves meaningful distinctions:

STREET vs DRIVE
ROAD vs LANE
NORTH/SOUTH/EAST/WEST
unit numbers
house numbers
ZIP/postcode

Determine appropriate fuzzy matching threshold.

==================================================
WAVE 8 — ADDRESS CANDIDATE PICKER
==================================================

Research UX for uncertain results.

If Terra finds:

936 Springdale Street
936 Springdale Drive
Springdale Street approximate

it should not silently select the wrong one.

Potential UI:

WE FOUND MULTIPLE MATCHES

1.
936 Springdale St
Akron, OH 44310
ADDRESS POINT

2.
Springdale Street
Akron, OH
STREET APPROXIMATE

Research best practices.

==================================================
WAVE 9 — CAMERA FRAMING
==================================================

Research CesiumJS camera behavior separately from geocoding.

Question:

Once Terra has a precision target, what camera altitude/framing should it use?

Design view presets based on match quality.

Potential concept:

ROOFTOP / BUILDING
→ very close property inspection

PARCEL
→ frame parcel bounds

ADDRESS_POINT
→ close address inspection

INTERPOLATED
→ moderately close with approximate badge

STREET
→ street-context view, NOT fake property close-up

CITY
→ city bounds

STATE
→ state bounds

COUNTRY
→ country bounds

Research:

Cesium Camera.flyTo

destination Cartesian3

Rectangle framing

HeadingPitchRange

BoundingSphere

terrain-aware target height

building footprint bounding box

parcel polygon bounding box

camera pitch

minimum/maximum altitude

Do not pick arbitrary values without visual testing guidance.

==================================================
WAVE 10 — PROPERTY-AWARE ZOOM
==================================================

Research whether Terra can use:

PARCEL POLYGON

or

BUILDING FOOTPRINT

to compute automatic framing.

Desired:

exact building/property fills useful portion of viewport

rather than:

fixed arbitrary altitude for every address.

Possible:

bounding sphere
rectangle
camera range calculated from footprint size

Determine best Cesium method.

==================================================
WAVE 11 — TERRAIN / 3D CORRECTION
==================================================

Research how terrain elevation affects precise targeting.

Terra should not:

target coordinate correctly

but point camera below terrain / wrong elevation.

Research:

sampleTerrainMostDetailed
Globe.getHeight
Cesium terrain sampling
building elevation considerations

Determine whether terrain correction should happen:

before flight
during refinement
after initial flight

==================================================
WAVE 12 — TWO-STAGE FLIGHT
==================================================

Research whether exact-address navigation should use:

STAGE 1
fast initial fly to approximate geocode

then

STAGE 2
precision refinement once parcel/building evidence arrives

OR

wait for precision lookup before flying.

Consider UX latency.

Potential approach:

QUERY

→ immediate candidate resolution

→ PREPARING EXACT LOCATION...

→ refined coordinate

→ final close fly

Research which feels best.

==================================================
WAVE 13 — CACHE / PERFORMANCE
==================================================

Exact-address lookup should not make Terra slow.

Research caching:

normalized address → result

address → precision enrichment

parcel geometry

building footprint

Respect each provider's terms.

Determine what may safely be cached.

==================================================
WAVE 14 — PRIVACY
==================================================

This is geographic navigation.

Research any privacy concerns from:

parcel datasets
residential addresses
property records

Terra should display geographic location without unnecessarily exposing:

resident names
owner names
taxpayer identities

unless separately and lawfully requested.

Address targeting does NOT require resident identity.

==================================================
WAVE 15 — OFFLINE / SOVEREIGN FUTURE
==================================================

Research self-hosted path.

Commander eventually wants Terra/War Room sovereign.

Compare:

Pelias + OpenAddresses + OSM + Who's On First

Nominatim + TIGER/address augmentation

Overture

local parcel/address datasets

PostGIS

Photon autocomplete

Determine whether Terra can eventually maintain:

WR-GEOCODER

or equivalent sovereign address-resolution stack.

==================================================
WAVE 16 — FAILURE STATES
==================================================

Define truthful outcomes:

EXACT
ROOFTOP

BUILDING MATCH

PARCEL MATCH

ADDRESS POINT

INTERPOLATED

STREET APPROXIMATE

AMBIGUOUS

NO MATCH

PROVIDER UNAVAILABLE

PRECISION ENRICHMENT UNAVAILABLE

Never silently downgrade an exact typed address into street-only while making
the UI appear exact.

==================================================
WAVE 17 — TEST MATRIX
==================================================

Research should propose test cases for:

1. exact detached house
2. apartment building
3. business
4. large campus
5. rural address
6. new construction
7. missing house number dataset
8. duplicate street name
9. Street vs Drive collision
10. same address in multiple states
11. non-U.S. exact address
12. parcel without building footprint
13. building footprint without address tag
14. interpolated-only address

==================================================
KEY PRODUCT RULE
==================================================

TERRA MUST SEPARATE:

WHERE THE GEOCODER THINKS THE ADDRESS IS

from:

HOW PRECISE THAT ANSWER ACTUALLY IS.

A typed house number does NOT automatically mean Terra has rooftop precision.

==================================================
DESIRED END STATE
==================================================

When Commander types a specific address:

936 Springdale St, Akron, OH

Terra should attempt:

ADDRESS PARSE
↓
EXACT ADDRESS LOOKUP
↓
PRECISION CLASSIFICATION
↓
OPTIONAL REGIONAL/PARCEL REFINEMENT
↓
BUILDING/PARCEL VALIDATION
↓
FINAL COORDINATE
↓
PRECISION-AWARE CAMERA FRAMING

If proven exact:

ROOFTOP / BUILDING / PARCEL

and automatically zoom to the actual property like the Commander's manually
adjusted second screenshot.

If only street-level evidence exists:

STREET — APPROXIMATE

and do NOT pretend the exact property is known.

==================================================
PRIMARY RESEARCH QUESTIONS
==================================================

1. Why do open geocoders often return street geometry instead of exact houses?

2. What is the strongest lawful path for exact U.S. property targeting?

3. Can OpenAddresses / Overture materially improve Terra?

4. How valuable are county parcel/address APIs?

5. Which commercial non-Google providers provide true rooftop precision?

6. Can Terra verify an address coordinate against a parcel or building footprint?

7. How should confidence be calculated?

8. How should camera framing change based on precision?

9. Should Terra use a two-stage approximate → precision-refined flight?

10. What architecture scales worldwide rather than becoming Ohio-specific?

11. What components could eventually become sovereign/self-hosted?

12. What licensing restrictions affect caching and redistribution?

==================================================
SOURCE QUALITY
==================================================

Prioritize:

official API documentation
official GIS documentation
official government datasets
provider technical docs
academic benchmarks
Cesium documentation
open-source project documentation

Separate:

VERIFIED FACT

VENDOR CLAIM

INFERENCE

RECOMMENDATION

Do not treat marketing as proof.

==================================================
RETURN
==================================================

TERRA_EXACT_ADDRESS_RESEARCH_REPORT

CURRENT_FAILURE_CLASS =

WHY_STREET_APPROXIMATE_HAPPENS =

BEST_GLOBAL_GEOCODER_ARCHITECTURE =

BEST_US_PRECISION_ARCHITECTURE =

OPENADDRESSES =
OVERTURE =
PELIAS =
NOMINATIM =
CENSUS =
COUNTY_PARCELS =
BUILDING_FOOTPRINTS =

COMMERCIAL_OPTIONS =

SUMMIT_COUNTY_AKRON_FINDINGS =
PUBLIC_MACHINE_READABLE_SOURCE =
LICENSE =

MATCH_QUALITY_MODEL =

MULTI_PROVIDER_SCORING =

STREET_NAME_COLLISION_DEFENSE =

PARCEL_VALIDATION =
BUILDING_VALIDATION =

CAMERA_FRAMING_RECOMMENDATION =
CESIUM_FRAMING_METHOD =

TWO_STAGE_FLIGHT =

TERRAIN_CORRECTION =

CACHE_MODEL =
PRIVACY_MODEL =

WORLDWIDE_SCALING_MODEL =

SOVEREIGN_GEOCODER_PATH =

TOP_5_RECOMMENDED_IMPLEMENTATION_PATHS =

BEST_RECOMMENDED_PATH =

WHY =

RISKS =

OPEN_QUESTIONS =

CURSOR_IMPLEMENTATION_REQUIREMENTS =

STOP.

RESEARCH ONLY.
DO NOT MODIFY THE REPOSITORY.
