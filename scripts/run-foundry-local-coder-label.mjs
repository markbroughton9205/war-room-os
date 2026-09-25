import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const testFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'foundry/local-coder-label/app.test.mjs')
const child = spawn(process.execPath, ['--test', testFile], { stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))
