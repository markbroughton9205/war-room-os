export type CodexEngineeringAgent = {
  id: 'codex'
  name: 'Codex'
  role: 'planned/cloud_engineering_executor'
  availability: 'not_connected'
  executionModel: 'planned_cloud_executor'
  canBeInvokedByWarRoom: false
  approvalRequired: true
  missingConfiguration: string
}

export const CODEX_ENGINEERING_AGENT: CodexEngineeringAgent = {
  id: 'codex',
  name: 'Codex',
  role: 'planned/cloud_engineering_executor',
  availability: 'not_connected',
  executionModel: 'planned_cloud_executor',
  canBeInvokedByWarRoom: false,
  approvalRequired: true,
  missingConfiguration: 'Codex provider/bridge is not configured. Use Cursor task packet fallback.',
}
