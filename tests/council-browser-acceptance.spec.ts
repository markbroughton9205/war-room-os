/**
 * Playwright live Group acceptance. Labeled live, not a fixture.
 * Requires a running app at PLAYWRIGHT_BASE_URL (default http://localhost:3000).
 */
import { test, expect } from '@playwright/test'

const PROMPT = 'Council, give me a short status summary of War Room.'
const FAMILY = /\b(Families assigned|Family Prior Response Delivered|Family Reviewing Previous|Claude Family|ChatGPT Family|Gemini Family|Grok Family|Red Team)\b/i
const SCHEMA = /failureModes|evidencePackets|decisionOrSynthesis|evidenceIds/
const THINK = /<think>|<\/think>/
const FRONTIER_SPEAKER = /\bProvider:\s*(Anthropic|OpenAI|xAI|Google|Claude|ChatGPT)\b/i

test.describe('Nebula Council browser acceptance', () => {
  test('Group status summary streams without pop-in or legacy Family language', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/')
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
    await expect(page.getByText(/AURORA/i).first()).toBeVisible({ timeout: 120_000 })
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(FAMILY)
    expect(body).not.toMatch(SCHEMA)
    expect(body).not.toMatch(THINK)
    expect(body).not.toMatch(FRONTIER_SPEAKER)
    expect(body).not.toMatch(/Waiting For Provider/i)
  })
})
