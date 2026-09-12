/**
 * Packaged Core entry — bundled by esbuild into desktop/runtime/core/server.cjs
 * Keep CJS-friendly (no top-level await in the exported path).
 */
import path from 'node:path'
import { startLocalCoreServer } from '@/lib/sovereign-runtime/localCoreServer'

export async function startPackagedCore(opts = {}) {
  const rendererDir =
    opts.rendererDir ||
    path.join(__dirname, '..', 'renderer')
  return startLocalCoreServer({
    rendererDir,
    localDataDir: opts.localDataDir ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null,
  })
}

function maybeServeCli() {
  const isMain =
    typeof process !== 'undefined' &&
    process.argv[1] &&
    (String(process.argv[1]).includes('server.cjs') ||
      String(process.argv[1]).includes('start-core-entry'))
  if (!isMain || !process.argv.includes('--serve')) return
  void startPackagedCore().then(core => {
    console.log(`Packaged Local Core READY on 127.0.0.1:${core.port}`)
    const stop = async () => {
      await core.close()
      process.exit(0)
    }
    process.on('SIGINT', () => void stop())
    process.on('SIGTERM', () => void stop())
  })
}

maybeServeCli()
