import type { LootOpportunity } from './types'
export const INCOME_LOOT_PERSISTENCE = 'session_only' as const
const MAX_OPPORTUNITIES = 500
const records: LootOpportunity[] = []; let nextId = 1
function key(record: Pick<LootOpportunity, 'ownerUserId' | 'provider' | 'title' | 'externalUrl'>): string { return [record.ownerUserId, record.provider, record.title.trim().toLowerCase(), (record.externalUrl ?? '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()].join('::') }
export function insertIncomeLootOpportunity(record: Omit<LootOpportunity, 'id' | 'discoveredAt' | 'updatedAt' | 'commanderApprovalRequired'>): LootOpportunity | null { if (records.some(item => key(item) === key(record))) return null; const now = new Date().toISOString(); const full: LootOpportunity = { ...record, id: `loot_session_${nextId++}`, discoveredAt: now, updatedAt: now, commanderApprovalRequired: true }; records.unshift(full); if (records.length > MAX_OPPORTUNITIES) records.splice(MAX_OPPORTUNITIES); return full }
export function getIncomeLootOpportunity(id: string): LootOpportunity | null { return records.find(record => record.id === id) ?? null }
export function listIncomeLootOpportunities(): LootOpportunity[] { return [...records] }
export function getIncomeLootOpportunityForOwner(ownerUserId: string, id: string): LootOpportunity | null { const record = getIncomeLootOpportunity(id); return record && record.ownerUserId === ownerUserId ? record : null }
export function listIncomeLootOpportunitiesForOwner(ownerUserId: string): LootOpportunity[] { return records.filter(record => record.ownerUserId === ownerUserId) }
export function updateIncomeLootOpportunity(id: string, changes: Partial<Omit<LootOpportunity, 'id' | 'ownerUserId' | 'discoveredAt' | 'commanderApprovalRequired'>>): LootOpportunity | null { const record = getIncomeLootOpportunity(id); if (!record) return null; Object.assign(record, changes, { commanderApprovalRequired: true, updatedAt: new Date().toISOString() }); return record }
export function __resetIncomeLootStore(): void { records.splice(0); nextId = 1 }
export const INCOME_LOOT_STORE_CAP = MAX_OPPORTUNITIES
