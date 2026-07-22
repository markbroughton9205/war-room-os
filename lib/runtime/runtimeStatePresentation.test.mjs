import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyticsRuntimePresentation,
  approvalsRuntimePresentation,
  emptySectionPresentation,
} from './runtimeStatePresentation.ts'

const now = new Date().toISOString()
const analyticsBase = {
  loading: false,
  requestFailed: false,
  hasSnapshot: true,
  configurationPresent: true,
  persistenceAvailable: true,
  migrationStatus: 'READY',
  latestScanStatus: 'completed',
  latestScanCompletedAt: now,
  resultCount: 2,
  staleResultCount: 0,
  maxAgeDays: 30,
}

test('analytics: initial loading is not UNKNOWN', () => {
  const result = analyticsRuntimePresentation({ ...analyticsBase, loading: true, hasSnapshot: false })
  assert.equal(result.state, 'loading')
})

test('analytics: healthy data is ready', () => {
  assert.equal(analyticsRuntimePresentation(analyticsBase).state, 'ready')
})

test('analytics: successful empty scan is healthy empty, not failed', () => {
  assert.equal(analyticsRuntimePresentation({ ...analyticsBase, resultCount: 0 }).state, 'healthy_empty')
})

test('analytics: missing configuration is explicit', () => {
  assert.equal(analyticsRuntimePresentation({ ...analyticsBase, configurationPresent: false }).state, 'not_configured')
})

test('analytics: unavailable persistence is not healthy empty', () => {
  assert.equal(analyticsRuntimePresentation({ ...analyticsBase, persistenceAvailable: false, migrationStatus: 'UNAVAILABLE', resultCount: 0 }).state, 'unavailable')
})

test('analytics: failed request is failed and retryable', () => {
  const result = analyticsRuntimePresentation({ ...analyticsBase, requestFailed: true })
  assert.equal(result.state, 'failed')
  assert.equal(result.retryPermitted, true)
})

test('analytics: absent response uses unknown fallback', () => {
  assert.equal(analyticsRuntimePresentation({ ...analyticsBase, hasSnapshot: false }).state, 'unknown')
})

test('analytics: old completed data is stale', () => {
  assert.equal(analyticsRuntimePresentation({ ...analyticsBase, latestScanCompletedAt: '2020-01-01T00:00:00.000Z' }).state, 'stale')
})

test('analytics: empty sections preserve truthful overall failures', () => {
  const failed = analyticsRuntimePresentation({ ...analyticsBase, requestFailed: true })
  assert.equal(emptySectionPresentation(failed, 'watchlist signals').state, 'failed')
})

const approvalsBase = {
  loading: false,
  requestFailed: false,
  hasSnapshot: true,
  configurationPresent: true,
  persistenceAvailable: true,
  actionCount: 1,
  generatedAt: now,
}

test('approvals: initial loading is not UNKNOWN', () => {
  assert.equal(approvalsRuntimePresentation({ ...approvalsBase, loading: true, hasSnapshot: false }).state, 'loading')
})

test('approvals: pending approval data is ready', () => {
  assert.equal(approvalsRuntimePresentation(approvalsBase).state, 'ready')
})

test('approvals: successful zero pending approvals is healthy empty', () => {
  assert.equal(approvalsRuntimePresentation({ ...approvalsBase, actionCount: 0 }).state, 'healthy_empty')
})

test('approvals: missing configuration is explicit', () => {
  assert.equal(approvalsRuntimePresentation({ ...approvalsBase, configurationPresent: false }).state, 'not_configured')
})

test('approvals: unavailable persistence is not healthy empty', () => {
  assert.equal(approvalsRuntimePresentation({ ...approvalsBase, persistenceAvailable: false, actionCount: 0 }).state, 'unavailable')
})

test('approvals: failed request is failed and does not claim an empty queue', () => {
  const result = approvalsRuntimePresentation({ ...approvalsBase, requestFailed: true, actionCount: 0 })
  assert.equal(result.state, 'failed')
  assert.doesNotMatch(result.explanation, /no actions are currently awaiting/i)
})

test('approvals: persisted empty activity is represented by healthy empty state', () => {
  const result = approvalsRuntimePresentation({ ...approvalsBase, actionCount: 0 })
  assert.equal(result.reasonCode, 'NO_PENDING_APPROVALS')
})

test('approvals: absent response uses unknown fallback', () => {
  assert.equal(approvalsRuntimePresentation({ ...approvalsBase, hasSnapshot: false }).state, 'unknown')
})

test('approvals: presentation model never grants approval authority', () => {
  const result = approvalsRuntimePresentation(approvalsBase)
  assert.equal('approved' in result, false)
  assert.equal('execute' in result, false)
})
