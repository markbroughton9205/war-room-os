# TERRA_FEATURE_PARITY_MATRIX

Permanent validation artifact for Mission Control zero-loss rearchitecture.
Machine-readable companion: `docs/terra/terra-feature-parity.json`

Statuses: PASS | FAIL | BLOCKED | UNAVAILABLE_BY_PROVIDER | AUTH_REQUIRED | NO_COVERAGE | CODE_PRESENT

CODE_PRESENT means the control is mounted and wired; runtime proof is filled after installed :3848 testing.

| FEATURE | OLD_UI | NEW_UI | HANDLER | API | BASELINE_STATUS | POST_REFACTOR_STATUS | INSTALLED_RUNTIME_STATUS | PROOF |
|---|---|---|---|---|---|---|---|---|
| SEARCH | Search panel | NAVIGATE / Search | resolve(false) | /api/terra/resolve-location | CODE_PRESENT | CODE_PRESENT | PENDING | mapping search_command |
| JUMP | Search panel | NAVIGATE / Search | resolve(true) | /api/terra/resolve-location | CODE_PRESENT | CODE_PRESENT | PENDING | Jump button unchanged |
| GPS | Search + Location | NAVIGATE / Location | gps.locateOnce | geolocation | CODE_PRESENT | CODE_PRESENT | PENDING | TerraGpsControl hosted |
| NEARBY | Search + Nearby panel | INTEL / Nearby | focusNearbyCameras | layers | CODE_PRESENT | CODE_PRESENT | PENDING | openDrawer nearby |
| INSPECT | Inspect panel | INTEL / Inspect | TerraGodsEyeInspectCard | — | CODE_PRESENT | CODE_PRESENT | PENDING | Smart Click opens inspect |
| STREET_VIEW | Search + Inspect + panel | TOOLS / Street View | openStreetView | /api/terra/street-view | CODE_PRESENT | CODE_PRESENT | PENDING | street_view host |
| TIMELINE | Timeline panel | TIME / Timeline | useTerraClock | — | CODE_PRESENT | CODE_PRESENT | PENDING | timeline host |
| RADAR | Radar panel | EARTH / Radar | useTerraRadar | /api/terra/weather/radar | CODE_PRESENT | CODE_PRESENT | PENDING | radar host |
| CLOUDS | Atmosphere + pulse | EARTH / Weather | earthPulse | /api/terra/earth-pulse/clouds | CODE_PRESENT | CODE_PRESENT | PENDING | globe_status+left_rail |
| LIGHTNING | Earth pulse | EARTH / Pulse | TerraLightningLayer | /api/terra/earth-pulse/lightning | CODE_PRESENT | CODE_PRESENT | PENDING | layer still mounted |
| EARTHQUAKES | Default layer + pulse | INTEL / Hazards + globe | usgs feed | /api/terra/layers/usgs_earthquake_feed | CODE_PRESENT | CODE_PRESENT | PENDING | TerraLayerRow hideControls |
| AURORA | Earth pulse | EARTH / Pulse | TerraAuroraLayer | /api/terra/earth-pulse/aurora | CODE_PRESENT | CODE_PRESENT | PENDING | layer still mounted |
| HAZARDS | Hazards panel | INTEL / Hazards | TerraHazardCounters | layer feeds | CODE_PRESENT | CODE_PRESENT | PENDING | hazard_counters host |
| CAMERAS | Discovery + Nearby + Directory | INTEL / Cameras | discovery/select | layers + camera-image | CODE_PRESENT | CODE_PRESENT | PENDING | camera_discovery host |
| CAMERA_NEXT_PREVIOUS | Traffic cam player | Media player | cycleTrafficCamera | camera-image | CODE_PRESENT | CODE_PRESENT | PENDING | area_live_viewer player |
| AIRCRAFT | Left rail live movement | TOOLS / Layers | governor.cycleLayer aircraft | opensky | CODE_PRESENT | CODE_PRESENT | PENDING | left_rail hosted |
| VESSELS | Left rail maritime | TOOLS / Layers | governor.cycleLayer vessels | digitraffic_marine | CODE_PRESENT | CODE_PRESENT | PENDING | left_rail hosted |
| ADMIN_IDENTITY | Left rail | TOOLS / Layers | TerraAdminIdentityPanel | /api/terra/admin-identity | CODE_PRESENT | CODE_PRESENT | PENDING | left_rail hosted |
| GODS_EYE | God's Eye panel | INTEL / God's Eye | handleGodsEyeViewModeChange | — | CODE_PRESENT | CODE_PRESENT | PENDING | gods_eye_controls |
| AREA_LIVE | Area Live controls | INTEL / Area Live | TerraAreaLiveControl | — | CODE_PRESENT | CODE_PRESENT | PENDING | area_live_controls |
| SMART_GOVERNOR | Left rail | EARTH / Automation | useTerraLayerGovernor | — | CODE_PRESENT | CODE_PRESENT | PENDING | left_rail earth/automation |
| MEDIA | Media panel | Media player / MEDIA | TerraMediaPanel | media stack | CODE_PRESENT | CODE_PRESENT | PENDING | player + drawer |
| COUNCIL_HANDOFF | Inspect/intel/weather/camera/SV | same hosted panels | send*ToCouncil | sessionStorage | CODE_PRESENT | CODE_PRESENT | PENDING | handlers unchanged |
| WORKSPACE_LAYOUT | Workspace panel | TOOLS / Layout | TerraWorkspaceControl | localStorage | CODE_PRESENT | CODE_PRESENT | PENDING | workspace_control |
| PROVENANCE | Inspect provenance | INTEL / Inspect | inspect sections | source URLs | CODE_PRESENT | CODE_PRESENT | PENDING | card unchanged |
| PROVIDER_STATES | Coverage badges | hosted panels | TerraCoverageBadge | coverage truth | CODE_PRESENT | CODE_PRESENT | PENDING | badges still render |
| ALERTS | Weather toast | Alert banner | TerraWeatherAlertToast | NWS | CODE_PRESENT | CODE_PRESENT | PENDING | banner slot |
| EMERGENCY_REPORT | Emergency panel | INTEL / Emergency | TerraEmergencyReportPanel | media | CODE_PRESENT | CODE_PRESENT | PENDING | emergency host |
| MAKE_ACTIVE_LOCATION | Inspect | INTEL / Inspect | activateCoordinate | enrich-location | CODE_PRESENT | CODE_PRESENT | PENDING | button unchanged |
| LIVE_INTEL | Live Intel dock | INTEL / Live Intel | TerraRightIntelDock | /api/terra/live-intel | CODE_PRESENT | CODE_PRESENT | PENDING | live_intel host |
| STREET_INTEL | Street intel panel | INTEL / Street Intel | TerraStreetIntelligence | street providers | CODE_PRESENT | CODE_PRESENT | PENDING | street_intel host |
| NIGHT_LIGHTS | Globe + pulse | EARTH / Pulse | TerraNightLights | night-lights | CODE_PRESENT | CODE_PRESENT | PENDING | globe layer |
| DAY_NIGHT | Globe Status | EARTH / Pulse | TerraLightingControl | — | CODE_PRESENT | CODE_PRESENT | PENDING | globe_status |
| CAMERA_HOVER | Hover overlay | Overlay | TerraCameraHoverWorkspace | — | CODE_PRESENT | CODE_PRESENT | PENDING | overlay host |
| SHORTCUT_RESET | Alt+Shift+R | preserved | store.reset | — | CODE_PRESENT | CODE_PRESENT | PENDING | LayoutProvider |
| SHORTCUT_ORGANIZE | Alt+Shift+O | preserved | smartOrganize | — | CODE_PRESENT | CODE_PRESENT | PENDING | LayoutProvider |
| REMOTE | n/a | Terra Remote | toggleDrawer | — | n/a | CODE_PRESENT | PENDING | same drawers as dock |
