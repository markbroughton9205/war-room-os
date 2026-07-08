import {
  APPLE_REMINDERS_SHORTCUT_NAME,
  type AppleReminderActionPacket,
  type AppleShortcutBridgeUrl,
  type AppleShortcutInputPayload,
} from './types'

export class AppleShortcutBridgeUrlBuilder {
  buildManualUrl(packet: AppleReminderActionPacket): AppleShortcutBridgeUrl {
    const payload: AppleShortcutInputPayload = {
      kind: 'war_room_apple_reminder_action_packet',
      packet,
    }
    const decodedPacketText = JSON.stringify(payload)
    const encodedPacketText = this.toBase64Url(decodedPacketText)
    const url =
      `shortcuts://run-shortcut?name=${encodeURIComponent(APPLE_REMINDERS_SHORTCUT_NAME)}` +
      `&input=text&text=${encodeURIComponent(encodedPacketText)}`

    return {
      shortcutName: APPLE_REMINDERS_SHORTCUT_NAME,
      mode: 'manual_run_shortcut_url',
      url,
      encodedPacketText,
      decodedPacketText,
      packetId: packet.packetId,
      approvalId: packet.approvalId,
      actionType: packet.actionType,
      reminderId: packet.scope.reminderId,
      createdAt: packet.constraints.createdAt,
      expiresAt: packet.constraints.expiresAt,
      warnings: [
        'Packet is self-contained in the Shortcut URL.',
        'Single-use is encoded and verified by receipt, but durable replay prevention requires a future stateful ledger.',
      ],
    }
  }

  buildCallbackPreviewUrl(packet: AppleReminderActionPacket, callbacks: {
    successUrl: string
    cancelUrl: string
    errorUrl: string
  }): AppleShortcutBridgeUrl {
    const manual = this.buildManualUrl(packet)
    const url =
      `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(APPLE_REMINDERS_SHORTCUT_NAME)}` +
      `&input=text&text=${encodeURIComponent(manual.encodedPacketText)}` +
      `&x-success=${encodeURIComponent(callbacks.successUrl)}` +
      `&x-cancel=${encodeURIComponent(callbacks.cancelUrl)}` +
      `&x-error=${encodeURIComponent(callbacks.errorUrl)}`

    return {
      ...manual,
      mode: 'x_callback_url_preview',
      url,
      warnings: [
        ...manual.warnings,
        'Callback URL is preview-only in 46K. No callback endpoint is created.',
      ],
    }
  }

  decodePacketText(encodedPacketText: string): AppleShortcutInputPayload {
    return JSON.parse(this.fromBase64Url(encodedPacketText)) as AppleShortcutInputPayload
  }

  private toBase64Url(value: string): string {
    return Buffer.from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
  }

  private fromBase64Url(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return Buffer.from(padded, 'base64').toString('utf8')
  }
}
