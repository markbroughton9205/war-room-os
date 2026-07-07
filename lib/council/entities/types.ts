export type CouncilEntityId =
  | 'architect'
  | 'strategist'
  | 'librarian'
  | 'scout'
  | 'engineer'
  | 'skeptic'

export type CouncilProviderBrain =
  | 'Claude'
  | 'ChatGPT'
  | 'Gemini'
  | 'Grok'
  | 'Kimi'
  | 'RedTeam'

export type CouncilEntityStatus =
  | 'foundation'
  | 'standby'
  | 'active'
  | 'paused'
  | 'retired'

export type CouncilEntityDefinition = {
  id: CouncilEntityId
  displayName: string
  role: string
  mission: string[]
  description: string
  specialties: string[]
  preferredProviders: CouncilProviderBrain[]
  fallbackProviders: CouncilProviderBrain[]
  confidence: number
  experience: number
  status: CouncilEntityStatus
  createdAt: string
  updatedAt: string
  memoryEnabled: boolean
  learningEnabled: boolean
  personalityVersion: string
}

export type CouncilEntitySummary = {
  id: CouncilEntityId
  displayName: string
  role: string
  mission: string[]
  preferredProvider: CouncilProviderBrain | null
  confidence: number
  experience: number
  status: CouncilEntityStatus
  memoryEnabled: boolean
  learningEnabled: boolean
  personalityVersion: string
}

export type CouncilProviderFamilyAlias =
  | 'Claude Family'
  | 'ChatGPT Family'
  | 'Gemini Family'
  | 'Grok Family'
  | 'Kimi Family'
  | 'Red Team'
  | 'claude'
  | 'chatgpt'
  | 'gemini'
  | 'grok'
  | 'kimi'
  | 'red_team'
  | 'red team'
