import type {
  CouncilEntityDefinition,
  CouncilEntitySummary,
  CouncilProviderBrain,
} from './types'

const normalizeSkill = (value: string) => value.trim().toLowerCase()

export class CouncilEntity {
  private state: CouncilEntityDefinition

  constructor(definition: CouncilEntityDefinition) {
    this.state = {
      ...definition,
      mission: [...definition.mission],
      specialties: [...definition.specialties],
      preferredProviders: [...definition.preferredProviders],
      fallbackProviders: [...definition.fallbackProviders],
    }
  }

  load(): CouncilEntityDefinition {
    return this.toJSON()
  }

  save(nextState?: Partial<CouncilEntityDefinition>): CouncilEntityDefinition {
    if (nextState) {
      this.state = {
        ...this.state,
        ...nextState,
        mission: nextState.mission ? [...nextState.mission] : [...this.state.mission],
        specialties: nextState.specialties ? [...nextState.specialties] : [...this.state.specialties],
        preferredProviders: nextState.preferredProviders
          ? [...nextState.preferredProviders]
          : [...this.state.preferredProviders],
        fallbackProviders: nextState.fallbackProviders
          ? [...nextState.fallbackProviders]
          : [...this.state.fallbackProviders],
        updatedAt: nextState.updatedAt ?? new Date().toISOString(),
      }
    }
    return this.toJSON()
  }

  getSummary(): CouncilEntitySummary {
    return {
      id: this.state.id,
      displayName: this.state.displayName,
      role: this.state.role,
      mission: [...this.state.mission],
      preferredProvider: this.getPreferredProvider(),
      confidence: this.state.confidence,
      experience: this.state.experience,
      status: this.state.status,
      memoryEnabled: this.state.memoryEnabled,
      learningEnabled: this.state.learningEnabled,
      personalityVersion: this.state.personalityVersion,
    }
  }

  getRole(): string {
    return this.state.role
  }

  getMission(): string[] {
    return [...this.state.mission]
  }

  getPreferredProvider(): CouncilProviderBrain | null {
    return this.state.preferredProviders[0] ?? null
  }

  supportsSkill(skill: string): boolean {
    const requested = normalizeSkill(skill)
    return this.state.specialties.some(specialty => normalizeSkill(specialty) === requested)
  }

  getConfidence(): number {
    return this.state.confidence
  }

  getExperience(): number {
    return this.state.experience
  }

  toJSON(): CouncilEntityDefinition {
    return {
      ...this.state,
      mission: [...this.state.mission],
      specialties: [...this.state.specialties],
      preferredProviders: [...this.state.preferredProviders],
      fallbackProviders: [...this.state.fallbackProviders],
    }
  }
}
