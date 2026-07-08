import type {
  ActionRequest,
  AutoSandboxAuditEvent,
  AutoSandboxCheckpoint,
  AutoSandboxSnapshot,
  FakeGeneratedArtifact,
  FakeMemoryTagRecord,
  FakeReminderRecord,
} from './types'

export class FakeAutoActionSandbox {
  private reminders: FakeReminderRecord[] = [
    { reminderId: 'reminder_1', read: false, updatedAt: '2026-07-07T11:00:00.000Z' },
  ]
  private memoryTags: FakeMemoryTagRecord[] = [
    { memoryId: 'memory_1', tags: [], updatedAt: '2026-07-07T11:00:00.000Z' },
  ]
  private generatedArtifacts: FakeGeneratedArtifact[] = []
  private auditEvents: AutoSandboxAuditEvent[] = []

  snapshot(): AutoSandboxSnapshot {
    return {
      reminders: this.reminders.map(record => ({ ...record })),
      memoryTags: this.memoryTags.map(record => ({ ...record, tags: [...record.tags] })),
      generatedArtifacts: this.generatedArtifacts.map(record => ({ ...record })),
      auditEvents: this.auditEvents.map(event => ({ ...event })),
    }
  }

  restore(snapshot: AutoSandboxSnapshot): void {
    this.reminders = snapshot.reminders.map(record => ({ ...record }))
    this.memoryTags = snapshot.memoryTags.map(record => ({ ...record, tags: [...record.tags] }))
    this.generatedArtifacts = snapshot.generatedArtifacts.map(record => ({ ...record }))
    this.auditEvents = snapshot.auditEvents.map(event => ({ ...event }))
  }

  createCheckpoint(actionRequest: ActionRequest, createdAt: string): AutoSandboxCheckpoint {
    const checkpoint: AutoSandboxCheckpoint = {
      checkpointId: `checkpoint_${this.auditEvents.length + 1}_${actionRequest.actionType}`,
      actionType: actionRequest.actionType,
      targetId: actionRequest.targetId,
      beforeSnapshot: this.snapshot(),
      createdAt,
    }

    this.appendAuditEvent({
      eventType: 'checkpoint_created',
      actionType: actionRequest.actionType,
      targetId: actionRequest.targetId,
      message: 'Fake auto-action sandbox checkpoint created.',
      createdAt,
    })

    return checkpoint
  }

  apply(actionRequest: ActionRequest, createdAt: string): string[] {
    if (actionRequest.actionType === 'mark_reminder_read') {
      this.reminders = this.reminders.map(record =>
        record.reminderId === actionRequest.targetId
          ? { ...record, read: true, updatedAt: createdAt }
          : record
      )
      this.appendAppliedAudit(actionRequest, createdAt)
      return [`${actionRequest.actionType}:${actionRequest.targetId}`]
    }

    if (actionRequest.actionType === 'tag_memory') {
      const tag = String(actionRequest.parameters.tag)
      this.memoryTags = this.memoryTags.map(record =>
        record.memoryId === actionRequest.targetId && !record.tags.includes(tag)
          ? { ...record, tags: [...record.tags, tag], updatedAt: createdAt }
          : record
      )
      this.appendAppliedAudit(actionRequest, createdAt)
      return [`${actionRequest.actionType}:${actionRequest.targetId}:${tag}`]
    }

    if (actionRequest.actionType === 'summarize_text') {
      const content = this.summarize(String(actionRequest.parameters.text))
      this.generatedArtifacts = [
        ...this.generatedArtifacts,
        {
          artifactId: `artifact_${this.generatedArtifacts.length + 1}_summary`,
          actionType: 'summarize_text',
          targetId: actionRequest.targetId ?? 'none',
          content,
          status: 'applied',
          createdAt,
          updatedAt: createdAt,
        },
      ]
      this.appendAppliedAudit(actionRequest, createdAt)
      return [`${actionRequest.actionType}:${actionRequest.targetId}`]
    }

    if (actionRequest.actionType === 'format_text') {
      const content = this.format(String(actionRequest.parameters.text))
      this.generatedArtifacts = [
        ...this.generatedArtifacts,
        {
          artifactId: `artifact_${this.generatedArtifacts.length + 1}_format`,
          actionType: 'format_text',
          targetId: actionRequest.targetId ?? 'none',
          content,
          status: 'applied',
          createdAt,
          updatedAt: createdAt,
        },
      ]
      this.appendAppliedAudit(actionRequest, createdAt)
      return [`${actionRequest.actionType}:${actionRequest.targetId}`]
    }

    return []
  }

  appendAuditEvent(input: Omit<AutoSandboxAuditEvent, 'auditEventId'>): AutoSandboxAuditEvent {
    const event: AutoSandboxAuditEvent = {
      ...input,
      auditEventId: `auto_audit_${this.auditEvents.length + 1}_${input.eventType}`,
    }

    this.auditEvents = [...this.auditEvents, event]

    return event
  }

  private appendAppliedAudit(actionRequest: ActionRequest, createdAt: string): void {
    this.appendAuditEvent({
      eventType: 'action_applied',
      actionType: actionRequest.actionType,
      targetId: actionRequest.targetId,
      message: 'Fake sandbox action applied.',
      createdAt,
    })
  }

  private summarize(text: string): string {
    const trimmed = text.trim()
    return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}...`
  }

  private format(text: string): string {
    return text.trim().replace(/\s+/g, ' ')
  }
}
