export type PasswordRecoveryRequestState = {
  status: 'idle' | 'sent'
  message: string | null
}

export type PasswordUpdateState = {
  status: 'idle' | 'error' | 'success'
  message: string | null
}

export const PASSWORD_RECOVERY_REQUEST_INITIAL_STATE: PasswordRecoveryRequestState = { status: 'idle', message: null }
export const PASSWORD_UPDATE_INITIAL_STATE: PasswordUpdateState = { status: 'idle', message: null }
