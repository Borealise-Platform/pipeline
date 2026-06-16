import type { ActivityCode, EventCode, Opcode, PresenceCode, RoleCode } from '@borealise/shared'

export interface PipelineMessage<T = unknown> {
  op: Opcode
  d: T
  t?: EventCode
  s?: number
}

export interface IdentifyPayload {
  token: string
  properties?: {
    os?: number
    browser?: number
    device?: number
  }
}

export interface HeartbeatPayload {
  seq: number | null
}

export interface PresenceUpdatePayload {
  status: PresenceCode
  activity?: {
    type: ActivityCode
    name: string
    details?: string
    started_at?: number
  }
}

export interface SubscribePayload {
  events: EventCode[]
}

export interface UnsubscribePayload {
  events: EventCode[]
}

export interface ChatSendPayload {
  room_slug: string
  content: string
}

export interface WtSeekPayload {
  room_slug: string
  position: number
}

export interface WtPausePayload {
  room_slug: string
  position: number
}

export interface WtResumePayload {
  room_slug: string
  position: number
}

export interface WtStateRequestPayload {
  room_slug: string
}

export interface WtStateResponsePayload {
  room_slug: string
  target_session_id: string
  paused: boolean
  position: number
}

export interface WtHeartbeatPayload {
  room_slug: string
  position: number
}

export interface HelloPayload {
  heartbeat_interval: number
  session_id: string
}

export interface ReadyPayload {
  session_id: string
  user: {
    id: number
    username: string
    display_name: string | null
    avatar_id: string | null
    role: RoleCode
    flags: number
    xp: number
    level: number
    subscription_type: string | null
    subscription_months: number
  }
  resume_url?: string
}

export interface RoomChatMessageEvent {
  room_id: number
  room_slug: string
  message_id: string
  user_id?: number
  username?: string
  display_name?: string | null
  avatar_id?: string | null
  role?: string
  global_role?: string | null
  subscription_type?: string | null
  subscription_months?: number
  content: string
  timestamp: number
  type?: 'user' | 'system'
  edited_at?: number
  edited_by?: number
}

export interface RoomChatUpdateEvent {
  room_id: number
  room_slug: string
  message_id: string
  user_id?: number
  username?: string
  display_name?: string | null
  avatar_id?: string | null
  role?: string
  global_role?: string | null
  subscription_type?: string | null
  subscription_months?: number
  content: string
  timestamp: number
  type?: 'user' | 'system'
  edited_at?: number
  edited_by?: number
}

export interface RoomChatDeleteEvent {
  room_id: number
  room_slug: string
  message_id: string
  deleted_by: number
  deleted_at?: number
}

export interface InvalidSessionPayload {
  resumable: boolean
  code: number
}

export interface ErrorPayload {
  code: number
  message?: string
}

/**
 * Connection state as a bitfield. Exactly one phase bit
 * (`DISCONNECTED`/`CONNECTING`/`CONNECTED`/`RECONNECTING`/`IDENTIFIED`) is
 * ever set at a time — `IDENTIFIED` implies "connected", so callers that
 * want "connected or identified" use `state & ConnectionFlags.CONNECTED`
 * (see {@link isConnectionFlagSet}) rather than two equality checks.
 *
 * Transitions are plain bitwise ops:
 * ```ts
 * state = ConnectionFlags.CONNECTING                       // assign
 * state |= ConnectionFlags.IDENTIFIED                       // set a bit
 * state &= ~ConnectionFlags.IDENTIFIED                       // clear a bit
 * if (state & ConnectionFlags.CONNECTED) { ... }              // test a bit
 * ```
 */
const CONNECTING = 1 << 0
const CONNECTED = 1 << 1
const RECONNECTING = 1 << 2
const IDENTIFIED_BIT = 1 << 3

export const ConnectionFlags = {
  DISCONNECTED: 0,
  CONNECTING,
  CONNECTED,
  RECONNECTING,
  // Composite: identified sessions are always connected, so the
  // CONNECTED bit stays set — `state & ConnectionFlags.CONNECTED` matches
  // both 'connected' and 'identified' with one bitwise test.
  IDENTIFIED: CONNECTED | IDENTIFIED_BIT,
} as const

export type ConnectionFlag = typeof ConnectionFlags[keyof typeof ConnectionFlags]

/**
 * Numeric bitfield. Despite the name (kept for continuity with the
 * pre-bitfield API), this is a `number`, not a string union — compare it
 * with {@link isConnectionFlagSet} or `&`/`===` against {@link ConnectionFlags}.
 */
export type ConnectionState = number

/** `true` if every bit in `flag` is set on `state`. */
export function isConnectionFlagSet(state: ConnectionState, flag: ConnectionFlag): boolean {
  return (state & flag) === flag
}

export type EventListener<T = unknown> = (data: T) => void

export interface PipelineEvents {
  onConnect: () => void
  onDisconnect: (code: number, reason: string) => void
  onReconnect: (attempt: number) => void
  onStateChange: (state: ConnectionState) => void
  onReady: (payload: ReadyPayload) => void
  onError: (payload: ErrorPayload) => void
  onDispatch: (event: EventCode, data: unknown) => void
}

export type DispatchHandler = (action: string, payload?: unknown) => void

export interface PipelineClientOptions {
  url: string
  tokenProvider?: () => string | null | undefined
  loggerEnabled?: boolean
  webSocketFactory?: (url: string) => WebSocket
}
