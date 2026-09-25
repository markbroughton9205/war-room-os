import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { persistFoundryRuntimeConfig } from '@/lib/native-builder/foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from '@/lib/native-builder/foundryOperationsTypes'
import {
  ensureLocalModelService,
  localOllamaBinary,
  resolveLocalModelHealth,
} from '@/lib/native-builder/localModelHealth'
import { PREFERRED_LOCAL_CODER } from '@/lib/native-builder/localCoder'

function run(bin: string, args: string[], timeoutMs: number) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>(resolve => {
    const child = spawn(bin, args, { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', HOME: os.homedir() } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: error.message, code: null })
    })
  })
}

const binary = localOllamaBinary()
if (!binary) {
  console.error('FAIL ollama binary missing')
  process.exit(1)
}

const unit = await ensureLocalModelService()
console.log(JSON.stringify({ ensure: unit, binary }))

for (let i = 0; i < 20; i += 1) {
  const health = await resolveLocalModelHealth()
  if (health.state === 'READY' || health.state === 'ERROR') {
    console.log(JSON.stringify({ wait: i, health }))
    break
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}

let health = await resolveLocalModelHealth()
if (!health.models.includes(PREFERRED_LOCAL_CODER) && !health.models.some(name => name.startsWith('qwen2.5-coder:'))) {
  console.log(`PULL ${PREFERRED_LOCAL_CODER}`)
  const pulled = await run(binary, ['pull', PREFERRED_LOCAL_CODER], 1_200_000)
  console.log(JSON.stringify({ pullOk: pulled.ok, code: pulled.code, tail: (pulled.stdout + pulled.stderr).slice(-800) }))
  if (!pulled.ok) process.exit(1)
  health = await resolveLocalModelHealth()
}

const config = persistFoundryRuntimeConfig({
  primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
  fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
  providerPolicy: 'AUTO',
  localModelId: PREFERRED_LOCAL_CODER,
  localEndpoint: 'http://127.0.0.1:11434',
})

console.log(JSON.stringify({
  health,
  config,
  modelsDir: existsSync(path.join(os.homedir(), '.ollama', 'models')),
}, null, 2))

if (health.state !== 'READY') process.exit(1)
