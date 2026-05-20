import type { IntelligenceCategory } from '@/lib/signals/classification/types'

export type RibbonNewsUrgency = 'normal' | 'elevated' | 'urgent'

export type RibbonNewsHeadline = {
  id: string
  headline: string
  source: string
  publishedAt: string | null
  category: string
  intelligenceCategory: IntelligenceCategory | 'uncategorized'
  urgency: RibbonNewsUrgency
}

export type RibbonWeatherSlice = {
  status: 'available' | 'unavailable'
  tempF: number | null
  condition: string | null
  tonight: string | null
  alert: string | null
  label: string
}

export type FinancialClimateLabel =
  | 'risk-on'
  | 'risk-off'
  | 'mixed volatility'
  | 'quiet session'
  | 'unavailable'

export type RibbonMarketsSlice = {
  status: 'available' | 'unavailable'
  climate: FinancialClimateLabel
  quotes: Array<{ symbol: string; price: string; movement: string; direction: 'up' | 'down' | 'flat' | 'unknown' }>
  watchlistNote: string | null
  label: string
}

export type RibbonPersonalFinanceSlice = {
  status: 'available' | 'unavailable'
  balance: string | null
  recentEarnings: string | null
  pipeline: string | null
  missionTrigger: string | null
  debtProgress: string | null
  label: string
}

export type RibbonAiTeamSlice = {
  label: string
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
  familiesOnline: number
  familiesTotal: number
  councilNote: string | null
}

export type RibbonOpportunitiesSlice = {
  count: number
  label: string
  payoutAlert: string | null
}

export type RibbonSymbolicSlice = {
  sign: string
  guidance: string
  period: string
}

export type IntelligenceRibbonData = {
  loadedAt: string
  headlines: RibbonNewsHeadline[]
  weather: RibbonWeatherSlice
  markets: RibbonMarketsSlice
  personalFinance: RibbonPersonalFinanceSlice
  aiTeam: RibbonAiTeamSlice
  opportunities: RibbonOpportunitiesSlice
  symbolic: RibbonSymbolicSlice
  urgentWarning: string | null
}
