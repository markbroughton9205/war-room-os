/**
 * Operator next-steps reporting — required on engineering completions, repair packets, and phase handoffs.
 * Never embed secret values; use placeholders like `<YOUR_OPENAI_API_KEY>`.
 */

export type OperatorNextStepsReport = {
  environmentChanges: string[]
  sqlMigrations: string[]
  restartRequirements: string[]
  verificationRoutes: string[]
  expectedSuccessOutput: string[]
  featureFlags: string[]
  uiChanges: string[]
  rollbackInstructions: string[]
}

export const NO_OPERATOR_ACTION_LINE = 'No operator action required.'

export const OPERATOR_NEXT_STEPS_HEADING = 'NEXT STEPS FOR OPERATOR'

const SECTION_LABELS: Array<{ key: keyof OperatorNextStepsReport; label: string }> = [
  { key: 'environmentChanges', label: 'Required environment changes' },
  { key: 'sqlMigrations', label: 'Required SQL/migrations' },
  { key: 'restartRequirements', label: 'Restart requirements' },
  { key: 'verificationRoutes', label: 'Verification URLs/routes' },
  { key: 'expectedSuccessOutput', label: 'Expected successful output' },
  { key: 'featureFlags', label: 'Feature flags enabled/disabled' },
  { key: 'uiChanges', label: 'What should visibly change in UI' },
  { key: 'rollbackInstructions', label: 'Safe rollback instruction if needed' },
]

function normalizeLines(values: string[] | undefined): string[] {
  return (values ?? [])
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

export function emptyOperatorNextStepsReport(): OperatorNextStepsReport {
  return {
    environmentChanges: [],
    sqlMigrations: [],
    restartRequirements: [],
    verificationRoutes: [],
    expectedSuccessOutput: [],
    featureFlags: [],
    uiChanges: [],
    rollbackInstructions: [],
  }
}

export function isNoOperatorActionRequired(report: OperatorNextStepsReport): boolean {
  return SECTION_LABELS.every(({ key }) => normalizeLines(report[key]).length === 0)
}

export function noOperatorActionReport(): OperatorNextStepsReport {
  return emptyOperatorNextStepsReport()
}

function formatSection(label: string, index: number, lines: string[]): string {
  if (lines.length === 0) return `${index}. ${label}\n   ${NO_OPERATOR_ACTION_LINE}`
  const body = lines.map((line, i) => `   ${i + 1}. ${line}`).join('\n')
  return `${index}. ${label}\n${body}`
}

/** Plain-language, step-by-step markdown block for operators and Cursor handoffs. */
export function formatOperatorNextStepsMarkdown(report: OperatorNextStepsReport): string {
  if (isNoOperatorActionRequired(report)) {
    return `## ${OPERATOR_NEXT_STEPS_HEADING}\n\n${NO_OPERATOR_ACTION_LINE}`
  }

  const sections = SECTION_LABELS.map(({ key, label }, index) =>
    formatSection(label, index + 1, normalizeLines(report[key])),
  )

  return [`## ${OPERATOR_NEXT_STEPS_HEADING}`, '', ...sections].join('\n')
}

export type OperatorNextStepsContext = {
  envVarNames?: string[]
  envNotes?: string[]
  migrationFiles?: string[]
  sqlNotes?: string[]
  restartDevServer?: boolean
  restartNotes?: string[]
  verificationRoutes?: string[]
  expectedOutputs?: string[]
  featureFlags?: Array<{ name: string; enabled: boolean; note?: string }>
  uiChanges?: string[]
  rollback?: string[]
}

/** Build a report from common engineering patterns (migrations, env, routes). */
export function buildNextStepsFromContext(context: OperatorNextStepsContext): OperatorNextStepsReport {
  const report = emptyOperatorNextStepsReport()

  const envNames = context.envVarNames ?? []
  if (envNames.length) {
    report.environmentChanges.push(
      `Add or update these names in .env.local (values are secrets — do not paste into War Room UI): ${envNames.join(', ')}.`,
      ...(context.envNotes ?? []),
    )
  } else if (context.envNotes?.length) {
    report.environmentChanges.push(...context.envNotes)
  }

  const migrations = context.migrationFiles ?? []
  if (migrations.length) {
    report.sqlMigrations.push(
      ...migrations.map(file => `Review and apply repository migration ${file} via your normal Supabase migration path (SQL editor or CLI).`),
      ...(context.sqlNotes ?? []),
    )
  } else if (context.sqlNotes?.length) {
    report.sqlMigrations.push(...context.sqlNotes)
  }

  if (context.restartDevServer) {
    report.restartRequirements.push('Stop the local Next.js dev server, then run `pnpm dev` again so server env and route handlers reload.')
  }
  if (context.restartNotes?.length) {
    report.restartRequirements.push(...context.restartNotes)
  }

  if (context.verificationRoutes?.length) {
    report.verificationRoutes.push(...context.verificationRoutes)
  }

  if (context.expectedOutputs?.length) {
    report.expectedSuccessOutput.push(...context.expectedOutputs)
  }

  if (context.featureFlags?.length) {
    report.featureFlags.push(
      ...context.featureFlags.map(flag => {
        const state = flag.enabled ? 'enabled' : 'disabled'
        const note = flag.note ? ` — ${flag.note}` : ''
        return `${flag.name}: ${state}${note}`
      }),
    )
  }

  if (context.uiChanges?.length) {
    report.uiChanges.push(...context.uiChanges)
  }

  if (context.rollback?.length) {
    report.rollbackInstructions.push(...context.rollback)
  }

  return report
}

export function appendOperatorNextStepsToPrompt(prompt: string, report: OperatorNextStepsReport): string {
  const block = formatOperatorNextStepsMarkdown(report)
  if (prompt.includes(OPERATOR_NEXT_STEPS_HEADING)) return prompt
  return `${prompt.trim()}\n\n${block}`
}

export type OperatorNextStepsPayload = {
  report: OperatorNextStepsReport
  markdown: string
  noActionRequired: boolean
}

export function toOperatorNextStepsPayload(report: OperatorNextStepsReport): OperatorNextStepsPayload {
  return {
    report,
    markdown: formatOperatorNextStepsMarkdown(report),
    noActionRequired: isNoOperatorActionRequired(report),
  }
}
