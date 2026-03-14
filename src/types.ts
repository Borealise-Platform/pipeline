import type { ActivityCode, EventCode, Opcode, PresenceCode, RoleCode } from './constants/opcodes'

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
    role: RoleCode
    flags: number
  }
  resume_url?: string
}

export interface InvalidSessionPayload {
  resumable: boolean
  code: number
}

export interface ErrorPayload {
  code: number
  message?: string
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'identified'

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
  loggerName?: string
  webSocketFactory?: (url: string) => WebSocket
}
