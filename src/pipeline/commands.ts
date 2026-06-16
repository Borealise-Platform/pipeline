/**
 * @file Outbound commands: every opcode frame the client can voluntarily
 * send to the server (identify, presence, subscriptions, chat, watch-together
 * controls). All of them are no-ops until the session is identified, except
 * `identify` itself.
 */

import { Opcodes } from '@borealise/shared'
import type { EventCode, PresenceCode } from '@borealise/shared'
import type {
  ChatSendPayload,
  IdentifyPayload,
  PresenceUpdatePayload,
  SubscribePayload,
  UnsubscribePayload,
  WtHeartbeatPayload,
  WtPausePayload,
  WtResumePayload,
  WtSeekPayload,
  WtStateRequestPayload,
  WtStateResponsePayload,
} from '../types'
import type { PipelineContext } from './context'

export interface Commands {
  identify: (token: string) => void
  updatePresence: (status: PresenceCode, activity?: PresenceUpdatePayload['activity']) => void
  subscribe: (events: EventCode[]) => void
  unsubscribe: (events: EventCode[]) => void
  sendChatMessage: (roomSlug: string, content: string) => boolean
  sendWtSeek: (roomSlug: string, position: number) => void
  sendWtPause: (roomSlug: string, position: number) => void
  sendWtResume: (roomSlug: string, position: number) => void
  sendWtStateRequest: (roomSlug: string) => void
  sendWtHeartbeat: (roomSlug: string, position: number) => void
  sendWtStateResponse: (roomSlug: string, targetSessionId: string, paused: boolean, position: number) => void
}

/**
 * Builds the outbound command surface for one pipeline instance.
 *
 * `send` and `isIdentified` are injected from the socket module rather than
 * imported, since `socket.ts` itself needs `identify` (for the HELLO
 * handshake) — passing both ways through `client.ts` avoids a circular
 * module dependency.
 */
export function createCommands(
  context: PipelineContext,
  send: <T>(op: number, data: T) => void,
  isIdentified: () => boolean,
): Commands {
  const { state } = context

  function identify(token: string): void {
    send<IdentifyPayload>(Opcodes.IDENTIFY, { token })
  }

  function updatePresence(status: PresenceCode, activity?: PresenceUpdatePayload['activity']): void {
    send<PresenceUpdatePayload>(Opcodes.PRESENCE_UPDATE, { status, activity })
  }

  /** Tracks `events` locally and, once identified, asks the server to subscribe to them. */
  function subscribe(events: EventCode[]): void {
    for (const event of events) {
      state.subscriptions.add(event)
    }

    if (isIdentified()) {
      send<SubscribePayload>(Opcodes.SUBSCRIBE, { events })
    }
  }

  /** Stops tracking `events` locally and, once identified, asks the server to unsubscribe. */
  function unsubscribe(events: EventCode[]): void {
    for (const event of events) {
      state.subscriptions.delete(event)
    }

    if (isIdentified()) {
      send<UnsubscribePayload>(Opcodes.UNSUBSCRIBE, { events })
    }
  }

  /** @returns `true` if the message was sent, `false` if not identified yet. */
  function sendChatMessage(roomSlug: string, content: string): boolean {
    if (!isIdentified()) return false

    send<ChatSendPayload>(Opcodes.CHAT_SEND, { room_slug: roomSlug, content })
    return true
  }

  function sendWtSeek(roomSlug: string, position: number): void {
    if (!isIdentified()) return
    send<WtSeekPayload>(Opcodes.WT_SEEK, { room_slug: roomSlug, position })
  }

  function sendWtPause(roomSlug: string, position: number): void {
    if (!isIdentified()) return
    send<WtPausePayload>(Opcodes.WT_PAUSE, { room_slug: roomSlug, position })
  }

  function sendWtResume(roomSlug: string, position: number): void {
    if (!isIdentified()) return
    send<WtResumePayload>(Opcodes.WT_RESUME, { room_slug: roomSlug, position })
  }

  function sendWtStateRequest(roomSlug: string): void {
    if (!isIdentified()) return
    send<WtStateRequestPayload>(Opcodes.WT_STATE_REQUEST, { room_slug: roomSlug })
  }

  function sendWtHeartbeat(roomSlug: string, position: number): void {
    if (!isIdentified()) return
    send<WtHeartbeatPayload>(Opcodes.WT_HEARTBEAT, { room_slug: roomSlug, position })
  }

  function sendWtStateResponse(roomSlug: string, targetSessionId: string, paused: boolean, position: number): void {
    if (!isIdentified()) return
    send<WtStateResponsePayload>(Opcodes.WT_STATE_RESPONSE, {
      room_slug: roomSlug,
      target_session_id: targetSessionId,
      paused,
      position,
    })
  }

  return {
    identify,
    updatePresence,
    subscribe,
    unsubscribe,
    sendChatMessage,
    sendWtSeek,
    sendWtPause,
    sendWtResume,
    sendWtStateRequest,
    sendWtHeartbeat,
    sendWtStateResponse,
  }
}
