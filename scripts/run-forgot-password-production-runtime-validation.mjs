import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const port = Number(process.env.FORGOT_PASSWORD_RUNTIME_PORT ?? 3417)
const baseUrl = `http://127.0.0.1:${port}`
const builtPage = '.next/server/app/forgot-password/page.js'
// A syntactically valid address on the .invalid TLD, reserved by RFC 2606 to
// never resolve. NEXT_PUBLIC_* Supabase vars are inlined into the built
// output at `pnpm run build` time, so stripping them from this script's own
// spawned child's env cannot retroactively disable a real Supabase client if
// one was configured at build time. The .invalid TLD is what actually
// guarantees no email can ever be delivered to a real recipient regardless
// of build-time configuration: even if requestPasswordRecovery() reaches a
// genuinely configured Supabase project, resetPasswordForEmail() always
// returns the same generic response without confirming delivery (the same
// anti-enumeration behavior this app's own design relies on), and no MX
// record can ever exist for .invalid, so nothing is ever actually sent.
const testEmail = 'forgot-password-runtime-smoke@example.invalid'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForServer(child) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < 20_000) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early with code ${child.exitCode}`)
    }
    try {
      const response = await fetch(`${baseUrl}/forgot-password`, { redirect: 'manual' })
      return response
    } catch (error) {
      lastError = error
      await delay(250)
    }
  }
  throw new Error(`next start did not serve /forgot-password in time: ${String(lastError)}`)
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Parses the real no-JS server-action form fields out of the rendered page,
 * rather than hardcoding React/Next's internal field-naming scheme, which is
 * an implementation detail that can change across builds/versions.
 */
function parseFormFields(html) {
  const formMatch = html.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/)
  assert(formMatch, 'forgot-password page did not render a <form> element')
  const [, formAttrs, formBody] = formMatch

  const encTypeMatch = formAttrs.match(/encType="([^"]*)"/)
  const encType = encTypeMatch ? encTypeMatch[1] : 'application/x-www-form-urlencoded'

  const fields = []
  const inputPattern = /<input\b([^>]*)\/?>/g
  let match
  while ((match = inputPattern.exec(formBody)) !== null) {
    const attrs = match[1]
    const nameMatch = attrs.match(/name="([^"]*)"/)
    if (!nameMatch) continue
    const name = decodeHtmlEntities(nameMatch[1])
    const valueMatch = attrs.match(/value="([^"]*)"/)
    const value = valueMatch ? decodeHtmlEntities(valueMatch[1]) : ''
    fields.push({ name, value })
  }

  assert(
    fields.some(field => field.name.startsWith('$ACTION')),
    'no $ACTION* server-action fields were found in the rendered form — cannot exercise the real action chain'
  )
  assert(fields.some(field => field.name === 'email'), 'forgot-password form is missing its email field')

  return { encType, fields }
}

function buildMultipartBody(fields, boundary) {
  const parts = fields.map(
    ({ name, value }) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  )
  parts.push(`--${boundary}--\r\n`)
  return parts.join('')
}

async function submitForgotPasswordForm(getResponseHtml) {
  const { encType, fields } = parseFormFields(getResponseHtml)
  const submittedFields = fields.map(field => (field.name === 'email' ? { ...field, value: testEmail } : field))

  assert(
    encType.includes('multipart/form-data'),
    `expected the server-action form to use multipart/form-data, got ${encType}`
  )

  const boundary = `----ForgotPasswordRuntimeSmoke${Date.now()}`
  const body = buildMultipartBody(submittedFields, boundary)

  return fetch(`${baseUrl}/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
    redirect: 'manual',
  })
}

async function main() {
  assert(existsSync(builtPage), `${builtPage} is missing. Run pnpm run build before this validation.`)

  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', chunk => {
    output += chunk.toString()
  })
  child.stderr.on('data', chunk => {
    output += chunk.toString()
  })

  try {
    const getResponse = await waitForServer(child)
    const getBody = await getResponse.text()

    assert(getResponse.status === 200, `expected /forgot-password 200, got ${getResponse.status}`)
    assert(getBody.includes('PASSWORD RECOVERY'), 'forgot-password page did not render expected heading')
    assert(!output.includes('PasswordRecoveryRequestState is not defined'), 'production runtime emitted PasswordRecoveryRequestState ReferenceError on GET')
    assert(!getBody.includes('PasswordRecoveryRequestState is not defined'), 'GET response body exposed PasswordRecoveryRequestState ReferenceError')

    console.log('PASS forgot_password_runtime_01_built_page_serves_200')
    console.log('PASS forgot_password_runtime_02_page_renders_password_recovery')

    const postResponse = await submitForgotPasswordForm(getBody)
    const postBody = await postResponse.text()

    // This is the case the original Production incident actually hit: the
    // ReferenceError fired at server-action module evaluation time, which
    // only happens when the action is invoked via POST — a GET never
    // reaches that code path, so a GET-only check cannot catch this class
    // of bug. See docs/architecture or the 46P-R5 review notes for the
    // reproduction proof that a GET-only version of this script still
    // passes against the broken pre-fix code.
    assert(postResponse.status !== 500, `expected the forgot-password action POST to not 500, got ${postResponse.status}`)
    assert(
      !output.includes('PasswordRecoveryRequestState is not defined'),
      'production runtime emitted PasswordRecoveryRequestState ReferenceError on POST — the server-action module chain crashed at evaluation time'
    )
    assert(
      !postBody.includes('PasswordRecoveryRequestState is not defined'),
      'POST response body exposed PasswordRecoveryRequestState ReferenceError'
    )
    assert(!output.includes('ReferenceError'), `production runtime emitted an unexpected ReferenceError: ${output}`)

    // Positive proof the real action chain actually ran end to end (not
    // just "didn't crash"): the action's returned state is exactly what
    // requestPasswordRecovery() in lib/auth/recoveryFlow.ts produces on a
    // real submission, re-rendered into the form via useActionState.
    assert(
      postBody.includes('If that email can reset a War Room password'),
      'forgot-password action did not return the expected generic success state — the real action chain may not have run'
    )

    console.log('PASS forgot_password_runtime_03_no_password_recovery_request_state_reference_error')
    console.log('PASS forgot_password_runtime_04_post_action_invokes_real_server_action_chain')
    console.log('PASS forgot_password_runtime_05_post_action_returns_generic_success_state')
  } finally {
    child.kill('SIGTERM')
    await delay(250)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
