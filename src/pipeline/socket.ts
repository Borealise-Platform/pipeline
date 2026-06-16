/**
 * @file WebSocket lifecycle: opening/closing the connection, parsing and
 * dispatching incoming opcode frames, and the reconnect/backoff loop.
 */

import { CloseCodes, Opcodes } from '@borealise/shared'
import type { EventCode } from '@borealise/shared'
import {
  ConnectionFlags,
  isConnectionFlagSet,
  type ErrorPayload,
  type HelloPayload,
  type InvalidSessionPayload,
  type PipelineMessage,
  type ReadyPayload,
} from '../types'
import type { PipelineContext } from './context'
import type { EventBus } from './events'
import { createHeartbeat } from './heartbeat'

/** Native `WebSocket.readyState` value while the socket is connecting. */
const WS_CONNECTING = 0
/** Native `WebSocket.readyState` value once the socket is open. */
const WS_OPEN = 1

/** Maximum number of automatic reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10

/** Reconnect backoff ladder (ms); the last entry repeats once exhausted. */
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000] as const

/** Close codes after which the client must not attempt to reconnect. */
const NO_RECONNECT_CLOSE_CODES: ReadonlySet<number> = new Set([
  CloseCodes.AUTHENTICATION_FAILED,
  CloseCodes.NOT_AUTHENTICATED,
  CloseCodes.NORMAL,
])

export interface Socket {
  /** Opens the socket, attaching all lifecycle handlers. No-op if already connecting/open. */
  connect: () => void
  /** Closes the socket (if any) and resets session/user state. Cancels pending reconnects. */
  disconnect: () => void
  /** Serializes and sends one opcode frame; silently dropped if the socket isn't open. */
  send: <T>(op: number, data: T) => void
  /** `true` once `setState` has been told to switch to `'connected'` or `'identified'`. */
  isIdentified: () => boolean
}

/**
 * Dependencies the socket module needs from outside its own closure:
 * connection-state transitions and resolving the auth token to identify
 * with once `HELLO` arrives. Kept separate from {@link PipelineContext} so
 * the circular connect <-> identify relationship stays explicit.
 */
export interface SocketDeps {
  setState: (state: import('../types').ConnectionState) => void
  resolveToken: () => string | null
  /** Called once `READY` is received, with the freshly assigned user payload. */
  onReady: (payload: ReadyPayload) => void
  /** Called when the server reports a non-resumable invalid session. */
  onInvalidSession: () => void
  /** Called for every `DISPATCH` frame, in receipt order. */
  onDispatch: (event: EventCode, data: unknown, sequence?: number) => void
  /** Called for every `ERROR` frame from the server. */
  onServerError: (payload: ErrorPayload) => void
  /** Sends an `IDENTIFY` frame; defined in `commands.ts`, injected to avoid a cycle. */
  identify: (token: string) => void
}

/** Builds the socket lifecycle controller for one pipeline instance. */
export function createSocket(context: PipelineContext, bus: EventBus, deps: SocketDeps): Socket {
  const { config, state, logger } = context
  const { setState, resolveToken, onReady, onInvalidSession, onDispatch, onServerError, identify } = deps

  function send<T>(op: number, data: T): void {
    if (!state.ws || state.ws.readyState !== WS_OPEN) return

    const message: PipelineMessage<T> = { op: op as PipelineMessage['op'], d: data }
    state.ws.send(JSON.stringify(message))
  }

  const heartbeat = createHeartbeat(context, send)

  function clearTimers(): void {
    if (state.heartbeatTimer !== null) {
      clearInterval(state.heartbeatTimer)
      state.heartbeatTimer = null
    }

    if (state.reconnectTimer !== null) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
  }

  function scheduleReconnect(): void {
    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger?.error('Max reconnect attempts reached')
      setState(ConnectionFlags.DISCONNECTED)
      return
    }

    setState(ConnectionFlags.RECONNECTING)

    const backoffIndex = Math.min(state.reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)
    const delay = RECONNECT_BACKOFF_MS[backoffIndex] as number

    state.reconnectTimer = globalThis.setTimeout(() => {
      state.reconnectAttempts += 1
      bus.emitConnection('onReconnect', state.reconnectAttempts)
      connect()
    }, delay)
  }

  function handleOpen(): void {
    logger?.info('Connected')
    setState(ConnectionFlags.CONNECTED)
    state.reconnectAttempts = 0
    bus.emitConnection('onConnect')
  }

  function handleHello(payload: HelloPayload): void {
    state.sessionId = payload.session_id
    state.heartbeatInterval = payload.heartbeat_interval
    heartbeat.start()

    const token = resolveToken()
    if (token) identify(token)
  }

  function handleReady(payload: ReadyPayload): void {
    state.user = payload.user
    setState(ConnectionFlags.IDENTIFIED)
    onReady(payload)
  }

  function handleInvalidSession(payload: InvalidSessionPayload): void {
    if (payload.resumable) return

    state.user = null
    setState(ConnectionFlags.CONNECTED)
    onInvalidSession()
  }

  function handleReconnectRequest(): void {
    logger?.info('Server requested reconnect')
    disconnect()
    connect()
  }

  function handleDispatch(event: EventCode, data: unknown, sequence?: number): void {
    if (typeof sequence === 'number') {
      state.lastSequence = sequence
    }

    onDispatch(event, data, sequence)
  }

  function handleServerError(payload: ErrorPayload): void {
    logger?.error(`Server error: ${payload.code} - ${payload.message || 'unknown'}`)
    onServerError(payload)
  }

  function handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(String(event.data)) as PipelineMessage

      switch (message.op) {
        case Opcodes.HELLO:
          handleHello(message.d as HelloPayload)
          break
        case Opcodes.HEARTBEAT_ACK:
          break
        case Opcodes.READY:
          handleReady(message.d as ReadyPayload)
          break
        case Opcodes.INVALID_SESSION:
          handleInvalidSession(message.d as InvalidSessionPayload)
          break
        case Opcodes.RECONNECT:
          handleReconnectRequest()
          break
        case Opcodes.DISPATCH:
          handleDispatch(message.t as EventCode, message.d, message.s)
          break
        case Opcodes.ERROR:
          handleServerError(message.d as ErrorPayload)
          break
        default:
          logger?.warn(`Unknown opcode: ${message.op}`)
      }
    } catch (error) {
      logger?.error('Failed to parse message', error)
    }
  }

  function handleClose(event: CloseEvent): void {
    logger?.info(`Disconnected: ${event.code} - ${event.reason}`)
    clearTimers()
    state.ws = null

    bus.emitConnection('onDisconnect', event.code, event.reason)

    if (NO_RECONNECT_CLOSE_CODES.has(event.code)) {
      setState(ConnectionFlags.DISCONNECTED)
      return
    }

    scheduleReconnect()
  }

  function handleError(_event: Event): void {
    logger?.error('WebSocket error')
  }

  function connect(): void {
    if (!config.url) {
      logger?.error('Cannot connect: missing pipeline url')
      return
    }

    if (state.ws && (state.ws.readyState === WS_CONNECTING || state.ws.readyState === WS_OPEN)) {
      logger?.warn('Already connected or connecting')
      return
    }

    setState(ConnectionFlags.CONNECTING)

    try {
      const factory = config.webSocketFactory
        ?? (typeof globalThis.WebSocket !== 'undefined'
          ? (url: string) => new globalThis.WebSocket(url)
          : null)

      if (!factory) {
        setState(ConnectionFlags.DISCONNECTED)
        throw new ReferenceError('No WebSocket runtime found. In Node.js, provide webSocketFactory (for example using ws).')
      }

      const ws = factory(config.url)
      ws.onopen = handleOpen
      ws.onmessage = handleMessage
      ws.onclose = handleClose
      ws.onerror = handleError
      state.ws = ws
    } catch (error) {
      logger?.error('Connection failed', error)
      scheduleReconnect()
    }
  }

  function disconnect(): void {
    clearTimers()
    state.reconnectAttempts = 0

    if (state.ws) {
      state.ws.close(CloseCodes.NORMAL, 'client disconnect')
      state.ws = null
    }

    state.sessionId = null
    state.user = null
    setState(ConnectionFlags.DISCONNECTED)
  }

  function isIdentified(): boolean {
    return isConnectionFlagSet(state.connectionState, ConnectionFlags.IDENTIFIED)
  }

  return { connect, disconnect, send, isIdentified }
}
