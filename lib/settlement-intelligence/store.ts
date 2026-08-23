import type { NotificationRecord,SettlementRecord } from './types'
export interface SettlementStore { classification:'SESSION_ONLY';list():SettlementRecord[];upsert(record:SettlementRecord):void;listNotifications():NotificationRecord[];saveNotification(record:NotificationRecord):void }
class SessionSettlementStore implements SettlementStore{
  readonly classification='SESSION_ONLY' as const;private records=new Map<string,SettlementRecord>();private notifications=new Map<string,NotificationRecord>()
  list(){return [...this.records.values()]}upsert(record:SettlementRecord){this.records.set(record.id,record)}listNotifications(){return [...this.notifications.values()]}saveNotification(record:NotificationRecord){this.notifications.set(record.fingerprint,record)}
}
const globalState=globalThis as typeof globalThis&{__warRoomSettlementStore?:SettlementStore}
export const settlementStore=globalState.__warRoomSettlementStore??(globalState.__warRoomSettlementStore=new SessionSettlementStore())
