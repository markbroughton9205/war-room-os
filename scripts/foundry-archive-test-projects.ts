import { archiveConfirmedTestProjects } from '@/lib/native-builder/workspaceRegistry'

const result = await archiveConfirmedTestProjects()
console.log(JSON.stringify({
  counts: result.counts,
  archived: result.archived.length,
  preserved: result.preserved.length,
  archivedLabels: [...new Set(result.archived.map(item => item.label))],
  preservedLabels: [...new Set(result.preserved.map(item => item.label))],
}, null, 2))
