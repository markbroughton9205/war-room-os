export type KpiTile = {
  id: string
  label: string
  value: string
  sublabel?: string
  trend?: string
}

export const MOCK_KPIS: KpiTile[] = [
  { id: '1', label: 'Active Channels', value: '12', sublabel: 'Encrypted', trend: '+2' },
  { id: '2', label: 'Signal Integrity', value: '99.2%', sublabel: 'Rolling 24h' },
  { id: '3', label: 'Response SLA', value: '142ms', sublabel: 'p95', trend: '−8ms' },
  { id: '4', label: 'Open Incidents', value: '0', sublabel: 'P1 / P2' },
  { id: '5', label: 'Coverage', value: '38 regions', sublabel: 'Operational' },
  { id: '6', label: 'Council Sync', value: 'OK', sublabel: 'Last 04:12 UTC' },
]
