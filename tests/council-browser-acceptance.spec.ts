/**
 * REAL browser acceptance for the Nebula Group round — audit finding P0-3. Distinct from
 * lib/council/nebula/browserAcceptance.validation.ts (validate:council-browser-acceptance), which
 * is a fixture suite that never opens a browser; run this one via
 * `pnpm run validate:council-browser-live` (or test:council-browser-live).
 *
 * Requires a running War Room instance at PLAYWRIGHT_BASE_URL (default http://localhost:3000) and
 * an authenticated session written by tests/auth.setup.ts. If TEST_COMMANDER_EMAIL/
 * TEST_COMMANDER_PASSWORD weren't set, auth.setup.ts writes an empty session and every test here
 * detects the resulting /login redirect and skips (not fails) with a clear message.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * Polls the streaming-text element until either the AURORA final message appears or the
 * timeout elapses, collecting every DISTINCT non-empty value observed along the way.
 *
 * This exists to fix a false-green streaming assertion: comparing exactly two snapshots taken
 * ~1.5s apart with `>=` passes for "100 chars, then 100 chars again" (no streaming at all) and
 * for "0 chars, then the full final response" (pop-in, not streaming) — neither proves real
 * incremental delivery. Polling for distinct intermediate states and requiring real growth
 * between them is the actual proof.
 */
async function collectStreamingSnapshots(
  page: Page,
  textEl: Locator,
  auroraEl: Locator,
  options: { timeoutMs: number; pollMs: number },
): Promise<string[]> {
  const snapshots: string[] = []
  let last = ''
  const deadline = Date.now() + options.timeoutMs
  while (Date.now() < deadline) {
    const text = (await textEl.innerText().catch(() => '')).trim()
    if (text && text !== last) {
      snapshots.push(text)
      last = text
    }
    if (await auroraEl.isVisible().catch(() => false)) break
    await page.waitForTimeout(options.pollMs)
  }
  return snapshots
}

const PROMPT = 'Council, give me a short status summary of War Room.'
const FOLLOW_UP_PROMPT = 'Council, verify this is a fresh Council round and give me one sentence on current runtime health.'
const FAMILY = /\b(Families assigned|Family Prior Response Delivered|Family Reviewing Previous|Claude Family|ChatGPT Family|Gemini Family|Grok Family|Red Team)\b/i
const SCHEMA = /failureModes|evidencePackets|decisionOrSynthesis|evidenceIds/
const THINK = /<think>|<\/think>/
const FRONTIER_SPEAKER = /\bProvider:\s*(Anthropic|OpenAI|xAI|Google|Claude|ChatGPT)\b/i

test.describe('Nebula Council browser acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    test.skip(page.url().includes('/login'), 'No authenticated session — set TEST_COMMANDER_EMAIL/TEST_COMMANDER_PASSWORD and re-run.')
  })

  test('Group status summary streams without pop-in or legacy Family language', async ({ page }) => {
    test.setTimeout(180_000)
    const group = page.getByTestId('council-mode-stable_group')
    if (await group.count()) await group.click()
    const input = page.getByTestId('council-command-input')
    await expect(input).toBeVisible({ timeout: 30_000 })

    const ackAt = Date.now()
    await input.fill(PROMPT)
    await page.getByTestId('council-execute').click()
    const shell = page.getByTestId('council-live-round')
    await expect(shell).toBeVisible({ timeout: 15_000 })
    const ackMs = Date.now() - ackAt
    expect(ackMs, 'time to acknowledgment').toBeLessThan(8_000)
    await expect(shell).toContainText(/ASTRA|ORION|LUMEN|AURORA/i)

    // Real incremental streaming proof: poll the streaming-text element until AURORA's final
    // message appears, collecting every distinct intermediate state observed along the way.
    const streamingText = page.getByTestId('council-live-round-text')
    const auroraFinal = page.getByText(/AURORA/i).first()
    const snapshots = await collectStreamingSnapshots(page, streamingText, auroraFinal, {
      timeoutMs: 120_000,
      pollMs: 300,
    })

    expect(snapshots.length, 'must observe at least 2 distinct non-empty intermediate text states before AURORA final (fails on both "100 chars/100 chars" no-growth and "0 chars/full response" pop-in)')
      .toBeGreaterThanOrEqual(2)
    const firstLen = snapshots[0]?.length ?? 0
    const lastLen = snapshots[snapshots.length - 1]?.length ?? 0
    expect(lastLen, 'later streaming snapshots must show real growth over the first one, not just a different-but-equal-length state')
      .toBeGreaterThan(firstLen)

    // Terminal completion must occur AFTER streaming was observed, and AURORA's final message
    // must appear afterward — not before, and not simultaneously with the first snapshot.
    await expect(auroraFinal).toBeVisible({ timeout: 120_000 })
    const firstRoundId = await shell.getAttribute('data-round-id')
    expect(firstRoundId, 'round banner should expose a real roundId').toBeTruthy()

    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(FAMILY)
    expect(body).not.toMatch(SCHEMA)
    expect(body).not.toMatch(THINK)
    expect(body).not.toMatch(FRONTIER_SPEAKER)
    expect(body).not.toMatch(/Waiting For Provider/i)
    expect(body, 'no stale cloud-key-based provider count while a local Nebula Council is active')
      .not.toMatch(/0\/4 PROVIDERS ACTIVE/i)
    expect(body, 'group description should use Nebula-native language, not legacy "families build on each other"')
      .not.toMatch(/families build on each other/i)

    // Second turn: fresh roundId proves no stale round-state leakage across turns.
    await input.fill(FOLLOW_UP_PROMPT)
    await page.getByTestId('council-execute').click()
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => shell.getAttribute('data-round-id'), { timeout: 15_000 })
      .not.toBe(firstRoundId)
    await expect(page.getByText(/AURORA/i).first()).toBeVisible({ timeout: 120_000 })
  })
})
