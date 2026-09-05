/**
 * WR-Engineer Phase 5 startup plan for NEBULA-GENESIS.
 *
 * Reuses start-war-room.ps1 / start-war-room.bat. Never starts a second War Room (`pnpm dev` /
 * `pnpm start`) process. Never downloads a model. If Ollama is already installed, the launcher
 * may start `ollama serve` only when the local HTTP probe fails.
 */
export type LocalRuntimeStartupAction =
  | 'reuse_existing'
  | 'start_ollama_serve_if_installed'
  | 'skip_not_installed'

export type LocalEngineStartupPlan = {
  warRoomLauncher: 'start-war-room.ps1'
  startsDuplicateWarRoom: false
  downloadsModels: false
  trainsModel: false
  localRuntimeAction: LocalRuntimeStartupAction
}

export function shouldStartOllamaServe(opts: { probeAvailable: boolean; ollamaInstalled: boolean }): boolean {
  return opts.ollamaInstalled && !opts.probeAvailable
}

export function describeLocalEngineStartup(opts: {
  probeAvailable: boolean
  ollamaInstalled: boolean
}): LocalEngineStartupPlan {
  const localRuntimeAction: LocalRuntimeStartupAction = !opts.ollamaInstalled
    ? 'skip_not_installed'
    : opts.probeAvailable
      ? 'reuse_existing'
      : 'start_ollama_serve_if_installed'
  return {
    warRoomLauncher: 'start-war-room.ps1',
    startsDuplicateWarRoom: false,
    downloadsModels: false,
    trainsModel: false,
    localRuntimeAction,
  }
}
