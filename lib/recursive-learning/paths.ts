import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import { LearningLog } from './store'

/**
 * Learning data lives in the per-user War Room application-data root (the same canonical root the installed desktop
 * runtime and the dev server share for Foundry missions), NOT relative to the process working directory.
 * Override with WAR_ROOM_LEARNING_DIR (tests, relocation).
 */
export function learningDir(): string {
  const raw = process.env.WAR_ROOM_LEARNING_DIR?.trim()
  return raw ? path.resolve(raw) : path.join(resolveLocalAppDataPaths().data, 'recursive-learning')
}
export const defaultLearningLog = (opts: { readOnly?: boolean } = {}) => new LearningLog(learningDir(), opts)
