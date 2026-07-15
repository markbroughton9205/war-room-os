export type SignupFlowState = {
  status: 'idle' | 'error' | 'success'
  message: string | null
}

export const SIGNUP_FLOW_INITIAL_STATE: SignupFlowState = { status: 'idle', message: null }
