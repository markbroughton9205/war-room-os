# TERRA_FEATURE_INVENTORY

Zero-loss contract for the Mission Control UI rearchitecture.
Inspected from current source on 2026-09-19. No feature in this table may disappear.

Authoritative host map: `lib/terra/missionControl/mapping.ts`
Panel registry: `lib/terra/workspace/panelIds.ts` (23 panels)

| FEATURE_ID | FEATURE_NAME | CURRENT_UI_LOCATION | CURRENT_COMPONENT | CURRENT_HANDLER | CURRENT_API | CURRENT_RUNTIME_EFFECT | CURRENT_STATE_STORAGE | CURRENT_STATUS | TARGET_NEW_UI_LOCATION |
|---|---|---|---|---|---|---|---|---|---|
| LOC_SEARCH_GO | Search Go | Search panel | TerraLocationCommandInput | resolve(false) | GET /api/terra/resolve-location | Cinematic fly | React | live | NAVIGATE / Search |
| LOC_SEARCH_JUMP | Search Jump | Search panel | TerraLocationCommandInput | resolve(true) | GET /api/terra/resolve-location | Instant jump | React | live | NAVIGATE / Search |
| LOC_MATCH_PICK | Ambiguous match pick | Search matches | TerraLocationCommandInput | flyToTarget | — | Accept one match | React | live | NAVIGATE / Search |
| LOC_NEARBY_BTN | Nearby from search | Search panel | TerraLocationCommandInput | onNearby → focusNearbyCameras | — | Front nearby | React | live | NAVIGATE / Search → INTEL / Nearby |
| LOC_GPS_BTN | GPS from search | Search panel | TerraLocationCommandInput | gps.locateOnce | geolocation | One-shot locate | Commander GPS | live | NAVIGATE / Search |
| LOC_STREET_VIEW_CTRL | Street View open | Search panel | TerraStreetViewControl | openStreetView | GET /api/terra/street-view | Open street view | React | live | NAVIGATE / Search → TOOLS / Street View |
| GPS_LOCATE | Locate me | Location panel | TerraGpsControl | gps.locateOnce | geolocation | One fix | Commander GPS | live | NAVIGATE / Location |
| GPS_FOLLOW | Follow me | Location panel | TerraGpsControl | gps.followMe | geolocation watch | Continuous follow | Commander GPS | live | NAVIGATE / Location |
| GPS_STOP | Stop GPS | Location panel | TerraGpsControl | gps.stop | — | Stop tracking | Commander GPS | live | NAVIGATE / Location |
| GPS_FOLLOW_CAM | Follow camera | Location panel | TerraGpsControl | gps.setFollowCamera | — | Camera tracks GPS | Commander GPS | live | NAVIGATE / Location |
| GPS_RETURN | Return to me | Location panel | TerraGpsControl | returnToMe | — | Reattach view | TerraShell | live | NAVIGATE / Location |
| LOC_MAKE_ACTIVE | Make active location | Inspect card | TerraGodsEyeInspectCard | activateCoordinate | POST /api/terra/enrich-location | Sets active point | TerraActiveLocationContext | live | INTEL / Inspect |
| GE_MODE_EARTH | God's Eye Earth | God's Eye panel | TerraGodsEyeViewMode | handleGodsEyeViewModeChange | — | Default globe mode | React | live | INTEL / God's Eye |
| GE_MODE_CAMERAS | God's Eye Cameras | God's Eye panel | TerraGodsEyeViewMode | handleGodsEyeViewModeChange | /api/terra/layers/* | Camera directory | React | live | INTEL / Cameras |
| GE_MODE_AREA_LIVE | God's Eye Area Live | God's Eye panel | TerraGodsEyeViewMode | handleGodsEyeViewModeChange | — | Area Live workspace | React | live | INTEL / Area Live |
| GE_MODE_HAZARDS | God's Eye Hazards | God's Eye panel | TerraGodsEyeViewMode | handleGodsEyeViewModeChange | — | Hazard context | React | live | INTEL / Hazards |
| GE_MODE_INTEL | God's Eye Intel | God's Eye panel | TerraGodsEyeViewMode | handleGodsEyeViewModeChange | /api/terra/live-intel | Intel focus | React | live | INTEL / Live Intel |
| CAM_DISCOVER | Camera discover | Camera Discovery | TerraCameraDiscoveryControl | handleDiscoverCameras | layers | Enable covering camera layers | React | live | INTEL / Cameras |
| CAM_NEARBY_FOCUS | Nearby focus | Camera Discovery | TerraCameraDiscoveryControl | focusNearbyCameras | — | Open nearby | workspace | live | INTEL / Nearby |
| CAM_SELECT | Select camera | Nearby list | TerraNearbyCameras | handleEntityClick | /api/terra/camera-image | Inspect + player | selection | live | INTEL / Nearby |
| CAM_DIR_SELECT | Directory select | Camera Directory | TerraGodsEyeCameraDirectory | selectFederatedCamera | — | Select + fly | TerraShell | live | INTEL / Directory |
| AREA_LIVE_TOGGLE | Area Live on/off | Area Live Controls | TerraAreaLiveControl | handleAreaLiveToggle | — | Toggle mode | React | live | INTEL / Area Live |
| AREA_LIVE_CAT | Area Live category | Area Live Controls | TerraAreaLiveControl | setAreaLiveCategory | — | Filter rows | React | live | INTEL / Area Live |
| AREA_LIVE_VIEW | View Area Live row | Area Live Controls | TerraAreaLiveControl | viewAreaLiveRow | — | Open viewer | React | live | INTEL / Area Live + Media player |
| AREA_LIVE_SEND | Send Area Live to Council | Area Live rows | TerraAreaLiveControl | sendAreaLiveRowToCouncil | sessionStorage handoff | Council | war-room-terra-handoff | live | INTEL / Area Live |
| TRAFFIC_PLAYER_PREV | Previous camera | Traffic cam player | TerraTrafficCamPlayer | cycleTrafficCamera(-1) | camera-image | Cycle | React | live | Media player |
| TRAFFIC_PLAYER_NEXT | Next camera | Traffic cam player | TerraTrafficCamPlayer | cycleTrafficCamera(1) | camera-image | Cycle | React | live | Media player |
| INSPECT_STREET_VIEW | Inspect Street View | Inspect | TerraGodsEyeInspectCard | openStreetView | street-view | Open SV | React | live | INTEL / Inspect |
| INSPECT_STREET_INTEL | Inspect Street Intel | Inspect | TerraGodsEyeInspectCard | setStreetIntelOpen | — | Open street intel | React | live | INTEL / Street Intel |
| INSPECT_PIN | Pin inspect | Inspect | TerraGodsEyeInspectCard | setInspectPinned | — | Pin card | React | live | INTEL / Inspect |
| INSPECT_COUNCIL | Send inspect to Council | Inspect | TerraGodsEyeInspectCard | sendSelectedObjectToCouncil | sessionStorage | Council | war-room-terra-handoff | live | INTEL / Inspect |
| TL_GO_LIVE | Timeline Live | Timeline | TerraTimeline | clock.goLive | — | Live clock | useTerraClock | live | TIME / Timeline |
| TL_JUMP | Timeline jump | Timeline | TerraTimeline | clock.scrub | — | Historical | useTerraClock | live | TIME / Timeline |
| TL_PLAY_PAUSE | Timeline play/pause | Timeline | TerraTimeline | clock.play/pause | — | Playback | useTerraClock | live | TIME / Timeline |
| TL_RATE | Playback rate | Timeline | TerraTimeline | clock.setPlaybackRate | — | Rate | useTerraClock | live | TIME / Timeline |
| TL_WINDOW | Time window | Timeline | TerraTimeline | setSelectedWindowId | — | Feature filter | React | live | TIME / Timeline |
| WX_CLOUDS | Clouds | Layer controls | TerraWeatherAtmosphereControls | weatherPrefs + earthPulse | /api/terra/earth-pulse/clouds | Cloud imagery | localStorage | live | EARTH / Weather |
| WX_RADAR | Radar | Radar + atmosphere | useTerraRadar / TerraRadarStatus | radar.setEnabled | /api/terra/weather/radar | Radar tiles | localStorage | live | EARTH / Radar |
| WX_DEPTH | Weather depth | Atmosphere | setWeatherDepthAuto | — | Depth cue | localStorage | live | EARTH / Weather |
| LIGHT_MODE | Lighting AUTO/DAY/NIGHT | Globe Status | TerraLightingControl | handleLightingMode | — | Solar lighting | terra.lighting.mode | live | EARTH / Pulse |
| PULSE_STATUS | Earth pulse status | Globe Status | TerraEarthPulseStatus | play/frame | earth-pulse/* | Clouds/lightning/aurora/night | React | live | EARTH / Pulse |
| GOV_MASTER | Smart Governor AUTO/MANUAL | Left rail | TerraLayerGovernorPanel | governor.setMasterAuto | — | Auto layer plan | terra.layerGovernor.* | live | EARTH / Automation |
| GOV_CYCLE | Cycle layer OFF/AUTO/ON | Left rail | TerraLayerGovernorPanel | governor.cycleLayer | — | Per-layer mode | localStorage | live | EARTH / Automation + TOOLS / Layers |
| ADMIN_MASTER | Admin identity cycle | Left rail | TerraAdminIdentityPanel | governor.cycleLayer('admin_identity') | /api/terra/admin-identity | Borders/names/flags | terra.adminIdentity.v1 | live | TOOLS / Layers |
| ADMIN_SUB | Admin sublayers | Left rail | TerraAdminIdentityPanel | cycleSub | — | country/state/names/flag | localStorage | live | TOOLS / Layers |
| LAYER_TOGGLE | Catalog layer toggle | Left rail | TerraLayerRow | setEnabled | GET /api/terra/layers/{id} | Fetch+render | React | live | TOOLS / Layers |
| AC_MODE | Aircraft governor | Left rail | TerraShell | governor.cycleLayer('aircraft') | /api/terra/layers/opensky | Aircraft | governor | live | TOOLS / Layers |
| VES_MODE | Vessels governor | Left rail | TerraShell | governor.cycleLayer('vessels') | digitraffic_marine | Vessels | governor | live | TOOLS / Layers |
| TRAFFIC_LAYER | Traffic camera layers | Left rail | TerraTrafficLayer | setEnabled/refresh | /api/terra/layers/{id} | Traffic cams | React | live | TOOLS / Layers |
| URBAN_GEO | Urban geography | Left rail | TerraShell | setUrbanDetailEnabled | /api/terra/urban-tiles | Roads/buildings | React | live | TOOLS / Layers |
| BLD_EXTRUDE | Building extrusion | Left rail | TerraShell | setBuildingExtrusionEnabled | — | Extrude OSM | React | live | TOOLS / Layers |
| MAP_DETAIL | OSM map detail | Header + rail | TerraShell | setMapDetailMode | GIBS/OSM | Force OSM raster | React | live | Mission bar + TOOLS / Layers |
| ION_OSM_BLD | Cesium OSM Buildings | Left rail | TerraShell | setIonOsmBuildingsEnabled | Cesium ion | 3D buildings | React | live | TOOLS / Layers |
| HAZARD_COUNTERS | Hazard counters | Hazards panel | TerraHazardCounters | composeTerraHazardCounters | layer feeds | Counts | derived | live | INTEL / Hazards |
| INTEL_INSPECT | Live intel inspect | Live Intel | TerraLiveIntelPanel | inspectIntelItem | /api/terra/live-intel | Select | React | live | INTEL / Live Intel |
| INTEL_COUNCIL | Send intel to Council | Live Intel | TerraShell | sendSelectedObjectToCouncil | sessionStorage | Handoff | war-room-terra-handoff | live | INTEL / Live Intel |
| INTEL_ASTRA | ASTRA mission | Live Intel | TerraShell | createAstraMission/run | POST /api/astra/missions | Mission | React | live | INTEL / Live Intel |
| WX_TOAST | Weather alert toast | Weather toast | TerraWeatherAlertToast | view/dismiss/mute | NWS | Banner | LS mute | live | Alert banner |
| WX_DRAWER | Weather alert detail | Weather drawer | TerraWeatherDetailDrawer | sendWeatherToCouncil | radar API | Detail | React | live | INTEL / Alert |
| EMERG_REPORT | Emergency report | Emergency panel | TerraEmergencyReportPanel | watch/listen/source/council | Media + handoff | Media/Council | TerraMedia store | live | INTEL / Emergency |
| MEDIA_PANEL | War Room Media | Media panel | TerraMediaPanel | play/pause/volume/filters | media stack | Playback | MediaPlaybackProvider | live | Media player / MEDIA |
| WS_RESET | Reset layout | Workspace | TerraWorkspaceControl | store.reset | — | Default positions | terra-workspace-layout:v1 | live | TOOLS / Layout |
| WS_SAVE | Save layout | Workspace | TerraWorkspaceControl | persistNow | — | Persist | same | live | TOOLS / Layout |
| WS_SMART_ORG | Smart Organize | Workspace | TerraWorkspaceControl | smartOrganize | — | Reposition | same | live | TOOLS / Layout |
| WS_LOCK_ALL | Lock all | Workspace | TerraWorkspaceControl | lockAll | — | Lock | same | live | TOOLS / Layout |
| WS_UNLOCK_ALL | Unlock all | Workspace | TerraWorkspaceControl | lockAll(false) | — | Unlock | same | live | TOOLS / Layout |
| WS_MIN_FLOAT | Min float | Workspace | TerraWorkspaceControl | minimizeFloating | — | Minimize | same | live | TOOLS / Layout |
| WS_RESTORE | Restore | Workspace | TerraWorkspaceControl | restoreAll | — | Restore | same | live | TOOLS / Layout |
| WS_SMART_CLICK | Smart Click | Workspace | TerraWorkspaceControl | setSmartClickEnabled | — | Click routing | settings | live | TOOLS / Layout |
| WS_SMART_OPEN | Smart Open | Workspace | TerraWorkspaceControl | setSmartOpenEnabled | — | Auto restore | settings | live | TOOLS / Layout |
| WS_PRESET | Layout presets | Workspace | TerraWorkspaceControl | applyPreset | — | default/globe/intel | same | live | TOOLS / Layout |
| WS_RAIL | Rail dock | Workspace | TerraWorkspaceControl | setDock left_rail | — | left/right/float | same | live | TOOLS / Layout |
| WS_CHROME | Mission vs classic | Workspace | TerraWorkspaceControl | setMissionControlChrome | — | Host vs float | settings | new | TOOLS / Layout |
| WS_KEY_RESET | Alt+Shift+R | Global | TerraWorkspaceLayoutProvider | store.reset | — | Reset | same | live | preserved |
| WS_KEY_ORG | Alt+Shift+O | Global | TerraWorkspaceLayoutProvider | smartOrganize | — | Organize | same | live | preserved |
| AGENT_NAV | Navigate agent | Left rail | CommanderAgentDock | runNavigate | POST /api/ascension/navigation-agent/run | Route plan | local | live | TOOLS / Layers |
| AGENT_LEARN | Learn agent | Left rail | CommanderAgentDock | runLearn | POST /api/ascension/world-learning-agent/run | Learning | local | live | TOOLS / Layers |
| AGENT_INTEG | Integrate agent | Left rail | CommanderAgentDock | runIntegrate | POST /api/ascension/integration/run | Pipeline | local | live | TOOLS / Layers |
| MEDIA_LAUNCHER | Media launcher | Left rail | MediaLauncher | openOrFocus terra_media | — | Open media | workspace | live | MEDIA / Remote MEDIA |
| COVERAGE | Coverage badges | Many | TerraCoverageBadge | — | coverage truth | LIVE/STALE/… | derived | live | retained in hosted panels |
| PROVENANCE | Source/provenance | Inspect + players | Inspect sections | onOpenSource | source URLs | Attribution | feature | live | INTEL / Inspect + players |
| ANNOTATION | Commander annotation | Left rail | placeholder | — | — | Not wired yet | — | placeholder | TOOLS / Layers (kept) |
| CIN_DBLCLICK | Toggle cinematic | Globe | TerraShell | handleToggleCinematic | — | Living Orbit | cinematic | live | Globe (unchanged) |
| CAM_HOVER | Camera hover card | Globe hover | TerraCameraHoverWorkspace | onOpen/onDismiss | still | Overlay | React | live | Overlay (unchanged) |

Unmapped workspace panels: **none** (`unmappedWorkspacePanels()` must stay empty).
Deprecated features: **none**. Annotation remains an honest placeholder.
