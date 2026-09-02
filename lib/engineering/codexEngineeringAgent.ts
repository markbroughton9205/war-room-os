export type CodexEngineeringAgent = {
  id: 'codex'
  name: 'Codex'
  role: 'planned_cloud_executor'
  availability: 'not_connected'
  executionModel: 'planned_cloud_executor'
  canBeInvokedByWarRoom: false
  approvalRequired: true
  missingConfiguration: string
}

export const CODEX_ENGINEERING_AGENT: CodexEngineeringAgent = {
  id: 'codex',
  name: 'Codex',
  role: 'planned_cloud_executor',
  availability: 'not_connected',
  executionModel: 'planned_cloud_executor',
  canBeInvokedByWarRoom: false,
  approvalRequired: true,
  missingConfiguration:
    'No Codex provider/bridge is wired into War Room. A local `codex` CLI, if detected (see engineeringAgentRegistry.ts:detectCliEngineeringAgents), is only evidence the binary exists on this machine — it is NOT connected, authenticated, or invocable from War Room. Use the Cursor task packet fallback or the native-builder hosted-coder path.',
}
