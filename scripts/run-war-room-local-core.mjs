/**
 * Start War Room Local Core on 127.0.0.1:3847 (does not touch :3000/:3001).
 * Ctrl+C to stop. Does not stop cloudflared/Ollama/production.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLocalCoreServer } from '@/lib/sovereign-runtime/localCoreServer'
import { LOCAL_CORE_ORIGIN } from '@/lib/sovereign-runtime/constants'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const core = await startLocalCoreServer({
  rendererDir: path.join(root, 'desktop', 'renderer'),
})
console.log(`War Room Local Core READY at ${LOCAL_CORE_ORIGIN}`)
console.log('Website fallback: DENIED. Production/cloudflared/Ollama untouched.')
console.log('Press Ctrl+C to stop local core only.')

const stop = async () => {
  await core.close()
  process.exit(0)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
