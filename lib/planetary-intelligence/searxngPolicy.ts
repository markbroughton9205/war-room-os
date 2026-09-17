/**
 * SearXNG is an optional AGPL-isolated discovery adapter.
 * Existing War Room policy enables it only when SEARXNG_BASE_URL is configured
 * and the instance is already running. Council live checks probe; they do not start it.
 * There is no canonical local-service governor that auto-starts SearXNG.
 */
export function searxngStartPolicy(): {
  mayAutoStart: false
  reason: 'START_NOT_AUTHORIZED_BY_EXISTING_LOCAL_SERVICE_POLICY'
  action: 'LEAVE_OFFLINE_IF_UNREACHABLE'
} {
  return {
    mayAutoStart: false,
    reason: 'START_NOT_AUTHORIZED_BY_EXISTING_LOCAL_SERVICE_POLICY',
    action: 'LEAVE_OFFLINE_IF_UNREACHABLE',
  }
}
