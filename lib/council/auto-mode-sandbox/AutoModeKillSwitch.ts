import type { AutoSandboxKillSwitchState } from './types'

const DEFAULT_TIME = '2026-07-07T12:00:00.000Z'

export class AutoModeKillSwitch {
  private state: AutoSandboxKillSwitchState = {
    killSwitchId: 'auto_mode_sandbox_kill_switch',
    engaged: false,
    reason: null,
    updatedAt: DEFAULT_TIME,
  }

  getState(): AutoSandboxKillSwitchState {
    return { ...this.state }
  }

  engage(reason: string, updatedAt = DEFAULT_TIME): AutoSandboxKillSwitchState {
    this.state = {
      ...this.state,
      engaged: true,
      reason,
      updatedAt,
    }

    return this.getState()
  }

  release(updatedAt = DEFAULT_TIME): AutoSandboxKillSwitchState {
    this.state = {
      ...this.state,
      engaged: false,
      reason: null,
      updatedAt,
    }

    return this.getState()
  }
}
