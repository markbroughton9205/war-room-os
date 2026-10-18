'use strict'

const FOUNDRY_WORKBENCH_HOST = '127.0.0.1'
const FOUNDRY_WORKBENCH_PORT = 3849
const FOUNDRY_WORKBENCH_FLAG = 'FOUNDRY_WORKBENCH_W0'
const PARTITION = 'persist:foundry-workbench'

function isFoundryWorkbenchW0Enabled(env) {
  const raw = String((env || process.env)[FOUNDRY_WORKBENCH_FLAG] || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

module.exports = {
  FOUNDRY_WORKBENCH_HOST,
  FOUNDRY_WORKBENCH_PORT,
  FOUNDRY_WORKBENCH_FLAG,
  PARTITION,
  isFoundryWorkbenchW0Enabled,
}
