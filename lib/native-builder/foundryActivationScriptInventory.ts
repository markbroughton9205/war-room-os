/**
 * PASS 013 inventory of every remaining activation-capable Foundry script/helper.
 * Ordinary proof/helper scripts cannot activate historical installs. The only
 * historical activation path is COMMANDER_EXPLICIT_ROLLBACK=true + exact
 * install id + maintenance rollback production lease.
 */
export const CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID = 'war-room-os-0.1.0-75f49a0-foundry-a952219a'

export const PASS013_HISTORICAL_INSTALL_IDS = [
  'war-room-os-0.1.0-75f49a0-foundry-5d4b64e1',
  'war-room-os-0.1.0-75f49a0-foundry-2013affd',
  'war-room-os-0.1.0-75f49a0-pass011r-88356e33',
  'war-room-os-0.1.0-75f49a0-foundry-544de899',
  'war-room-os-0.1.0-75f49a0-foundry-9bf8ed1f',
  'war-room-os-0.1.0-75f49a0-foundry-pass014-write-set',
  'war-room-os-0.1.0-75f49a0-foundry-2a97aa3d',
] as const

export type FoundryActivationScriptClass =
  | 'CURRENT_PRODUCTION_SAFE'
  | 'RELAUNCH_CURRENT_ONLY'
  | 'MAINTENANCE_ROLLBACK_ONLY'
  | 'HISTORICAL_PROOF_NO_ACTIVATE'
  | 'DEPRECATED_ACTIVATION_PATH'

export type FoundryActivationScriptInventoryEntry = {
  path: string
  classification: FoundryActivationScriptClass
  mechanism: string
}

export const FOUNDRY_ACTIVATION_SCRIPT_INVENTORY: readonly FoundryActivationScriptInventoryEntry[] = [
  { path: 'scripts/foundry-engineering-depth-production.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'productionActivationFromEnv' },
  { path: 'scripts/foundry-home-ui-production.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'productionActivationFromEnv' },
  { path: 'scripts/foundry-trusted-desktop-production.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'productionActivationFromEnv' },
  { path: 'scripts/foundry-relaunch-active.ts', classification: 'RELAUNCH_CURRENT_ONLY', mechanism: 'runtime.transition_to_active RELAUNCH_CURRENT' },
  { path: 'scripts/foundry-supersede-pass006.ts', classification: 'HISTORICAL_PROOF_NO_ACTIVATE', mechanism: 'installer.activate pass006-e650f093 expected refuse' },
  { path: 'lib/native-builder/foundryAutonomousEngineeringDepth.pass012.proof.ts', classification: 'HISTORICAL_PROOF_NO_ACTIVATE', mechanism: 'hard refuse foundry-5d4b64e1' },
  { path: 'lib/native-builder/foundryAutonomousEngineeringDepth.pass014.proof.ts', classification: 'HISTORICAL_PROOF_NO_ACTIVATE', mechanism: 'hard refuse foundry-2a97aa3d' },
  { path: 'lib/native-builder/foundryAutonomousEngineeringDepth.pass015.proof.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'live production owner mission' },
  { path: 'lib/native-builder/foundryActivationAcceptance.proof.ts', classification: 'DEPRECATED_ACTIVATION_PATH', mechanism: 'REFUSED_SCRIPT_BYPASS without FOUNDRY_PRODUCTION_MISSION_ID' },
  { path: 'lib/native-builder/foundryPass012.production.proof.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'live production owner mission' },
  { path: 'lib/native-builder/foundryPass013.production.proof.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'live production owner mission' },
  { path: 'lib/native-builder/foundryPass014.production.proof.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'live production owner mission' },
  { path: 'lib/native-builder/foundryPass014.rebuild.proof.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'production lease rebuild from canonical source' },
  { path: 'lib/native-builder/engineerTools.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'authorizeProductionActivation' },
  { path: 'lib/native-builder/installerTool.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'installer.activate → authorizeProductionActivation' },
  { path: 'lib/native-builder/runtimeControl.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'runtime.transition_to_active / launch_installed' },
  { path: 'lib/native-builder/foundryMissionController.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'PRODUCTION_LEASE then installer.activate' },
  { path: 'lib/native-builder/installerTool.validation.ts', classification: 'CURRENT_PRODUCTION_SAFE', mechanism: 'isolated realOptRootOverride fixtures' },
] as const
