/**
 * Explicit Phase-2 capability table. UI hiding is not authorization.
 */
import type { BrowserOwner } from './types'

export type BrowserCapability =
  | 'profile.create'
  | 'profile.delete'
  | 'profile.lock'
  | 'profile.unlock'
  | 'profile.disable'
  | 'profile.list'
  | 'secureStorage.rotate'
  | 'ephemeral.create'
  | 'trusted_profile.use'
  | 'takeover.start'
  | 'takeover.return'
  | 'navigate'
  | 'read'
  | 'submit'
  | 'purchase'

const TABLE: Record<BrowserCapability, Record<'commander' | 'council' | 'foundry' | 'broker', 'YES' | 'NO' | 'POLICY' | 'APPROVAL'>> = {
  'profile.create': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  'profile.delete': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  'profile.lock': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  'profile.unlock': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  'profile.disable': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  'profile.list': { commander: 'YES', council: 'POLICY', foundry: 'POLICY', broker: 'YES' },
  'secureStorage.rotate': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  'ephemeral.create': { commander: 'YES', council: 'YES', foundry: 'YES', broker: 'YES' },
  'trusted_profile.use': { commander: 'YES', council: 'POLICY', foundry: 'POLICY', broker: 'NO' },
  'takeover.start': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  'takeover.return': { commander: 'YES', council: 'NO', foundry: 'NO', broker: 'NO' },
  navigate: { commander: 'YES', council: 'YES', foundry: 'YES', broker: 'YES' },
  read: { commander: 'YES', council: 'YES', foundry: 'YES', broker: 'YES' },
  submit: { commander: 'APPROVAL', council: 'APPROVAL', foundry: 'APPROVAL', broker: 'APPROVAL' },
  purchase: { commander: 'APPROVAL', council: 'APPROVAL', foundry: 'APPROVAL', broker: 'APPROVAL' },
}

export function capabilityFor(owner: BrowserOwner, capability: BrowserCapability): 'YES' | 'NO' | 'POLICY' | 'APPROVAL' {
  return TABLE[capability][owner]
}

export function commanderOnlyDenied(owner: BrowserOwner, capability: BrowserCapability): boolean {
  return capabilityFor(owner, capability) === 'NO'
}
