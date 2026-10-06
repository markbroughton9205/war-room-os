import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { LearningLog } from './store'

/** Learning data lives beside other War Room local state; override with WAR_ROOM_LEARNING_DIR. */
export function learningDir(): string {
  const raw = process.env.WAR_ROOM_LEARNING_DIR?.trim()
  return raw ? path.resolve(raw) : path.join(resolveBaseRepoRoot(), '.war-room', 'recursive-learning')
}
export const defaultLearningLog = (opts: { readOnly?: boolean } = {}) => new LearningLog(learningDir(), opts)
