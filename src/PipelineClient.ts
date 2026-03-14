import { Logger } from './logger'
import {
  CloseCodes,
  Opcodes,
  type EventCode,
  type Opcode,
  type PipelineError,
  PipelineErrors,
  type PresenceCode,
  getPipelineErrorName,
} from './constants/opcodes'
import type {
  ChatSendPayload,
  ConnectionState,
  DispatchHandler,
  ErrorPayload,
  EventListener,
  HeartbeatPayload,
  HelloPayload,
  IdentifyPayload,
  InvalidSessionPayload,
  PipelineClientOptions,
  PipelineEvents,
  PipelineMessage,
  PresenceUpdatePayload,
  ReadyPayload,
  SubscribePayload,
  UnsubscribePayload,
} from './types'

export class PipelineClient {
  private readonly logger: Logger
  private readonly options: Required<Pick<PipelineClientOptions, 'url'>> & PipelineClientOptions

  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private heartbeatInterval: number | null = null
  private heartbeatTimer: number | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempts = 0
  private lastSequence = 0
  private subscriptions: Set<EventCode> = new Set()

  private _state: ConnectionState = 'disconnected'
  private _user: ReadyPayload['user'] | null = null

  private eventListeners: Map<EventCode, Set<EventListener>> = new Map()
  private connectionListeners: Map<keyof PipelineEvents, Set<(...args: unknown[]) => void>> = new Map()
  private dispatchHandler: DispatchHandler | null = null

  private readonly maxReconnectAttempts = 10
  private readonly reconnectBackoff = [1000, 2000, 5000, 10000, 30000]

  constructor(options: PipelineClientOptions) {
    this.options = { ...options }
    this.logger = Logger.create(options.loggerName || 'Pipeline')
  }

  public get state(): ConnectionState {
    return this._state
  }

  public get user(): ReadyPayload['user'] | null {
    return this._user
  }

  public get isConnected(): boolean {
    return this._state === 'connected' || this._state === 'identified'
  }

  public get isIdentified(): boolean {
    return this._state === 'identified'
  }

  public setDispatchHandler(handler: DispatchHandler): void {
    this.dispatchHandler = handler
  }

  public connect(): void {
    if (!this.options.url) {
      this.logger.error('Cannot connect: missing pipeline url')
      return
    }

    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      this.logger.warn('Already connected or connecting')
      return
    }

    this.setState('connecting')

    try {
      const factory = this.options.webSocketFactory || ((url: string) => new WebSocket(url))
      this.ws = factory(this.options.url)
      this.ws.onopen = () => this.handleOpen()
      this.ws.onmessage = (event) => this.handleMessage(event)
      this.ws.onclose = (event) => this.handleClose(event)
      this.ws.onerror = (event) => this.handleError(event)
    } catch (error) {
      this.logger.error('Connection failed', error)
      this.scheduleReconnect()
    }
  }

  public disconnect(): void {
    this.clearTimers()
    this.reconnectAttempts = 0

    if (this.ws) {
      this.ws.close(CloseCodes.NORMAL, 'client disconnect')
      this.ws = null
    }

    this.sessionId = null
    this._user = null
    this.setState('disconnected')
  }

  public identify(token: string): void {
    this.send<IdentifyPayload>(Opcodes.IDENTIFY, { token })
  }

  public updatePresence(status: PresenceCode, activity?: PresenceUpdatePayload['activity']): void {
    this.send<PresenceUpdatePayload>(Opcodes.PRESENCE_UPDATE, { status, activity })
  }

  public subscribe(events: EventCode[]): void {
    for (const event of events) {
      this.subscriptions.add(event)
    }

    if (this.isIdentified) {
      this.send<SubscribePayload>(Opcodes.SUBSCRIBE, { events })
    }
  }

  public unsubscribe(events: EventCode[]): void {
    for (const event of events) {
      this.subscriptions.delete(event)
    }

    if (this.isIdentified) {
      this.send<UnsubscribePayload>(Opcodes.UNSUBSCRIBE, { events })
    }
  }

  public sendChatMessage(roomSlug: string, content: string): boolean {
    if (!this.isIdentified) {
      this.logger.warn('Cannot send chat: not identified')
      return false
    }

    this.send<ChatSendPayload>(Opcodes.CHAT_SEND, {
      room_slug: roomSlug,
      content,
    })

    return true
  }

  public on<T = unknown>(event: EventCode, listener: EventListener<T>): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(listener as EventListener)
    return () => this.off(event, listener)
  }

  public off<T = unknown>(event: EventCode, listener: EventListener<T>): void {
    this.eventListeners.get(event)?.delete(listener as EventListener)
  }

  public onConnection<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): () => void {
    if (!this.connectionListeners.has(event)) {
      this.connectionListeners.set(event, new Set())
    }
    this.connectionListeners.get(event)!.add(listener as (...args: unknown[]) => void)
    return () => this.offConnection(event, listener)
  }

  public offConnection<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): void {
    this.connectionListeners.get(event)?.delete(listener as (...args: unknown[]) => void)
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return

    this._state = state
    this.emit('onStateChange', state)
    this.dispatchHandler?.('pipeline/setConnectionState', state)
  }

  private clearTimers(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private handleOpen(): void {
    this.logger.info('Connected')
    this.setState('connected')
    this.reconnectAttempts = 0
    this.emit('onConnect')
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(String(event.data)) as PipelineMessage

      switch (message.op) {
        case Opcodes.HELLO:
          this.handleHello(message.d as HelloPayload)
          break
        case Opcodes.HEARTBEAT_ACK:
          break
        case Opcodes.READY:
          this.handleReady(message.d as ReadyPayload)
          break
        case Opcodes.INVALID_SESSION:
          this.handleInvalidSession(message.d as InvalidSessionPayload)
          break
        case Opcodes.RECONNECT:
          this.handleReconnect()
          break
        case Opcodes.DISPATCH:
          this.handleDispatch(message.t as EventCode, message.d, message.s)
          break
        case Opcodes.ERROR:
          this.handleServerError(message.d as ErrorPayload)
          break
        default:
          this.logger.warn(`Unknown opcode: ${message.op}`)
      }
    } catch (error) {
      this.logger.error('Failed to parse message', error)
    }
  }

  private handleClose(event: CloseEvent): void {
    this.logger.info(`Disconnected: ${event.code} - ${event.reason}`)
    this.clearTimers()
    this.ws = null

    this.emit('onDisconnect', event.code, event.reason)

    const noReconnectCodes: number[] = [
      CloseCodes.AUTHENTICATION_FAILED,
      CloseCodes.NOT_AUTHENTICATED,
      CloseCodes.NORMAL,
    ]

    if (!noReconnectCodes.includes(event.code as number)) {
      this.scheduleReconnect()
      return
    }

    this.setState('disconnected')
  }

  private handleError(_event: Event): void {
    this.logger.error('WebSocket error')
  }

  private handleHello(payload: HelloPayload): void {
    this.sessionId = payload.session_id
    this.heartbeatInterval = payload.heartbeat_interval
    this.startHeartbeat()

    const token = this.resolveToken()
    if (token) {
      this.identify(token)
    }
  }

  private handleReady(payload: ReadyPayload): void {
    this._user = payload.user
    this.setState('identified')
    this.emit('onReady', payload)
    this.dispatchHandler?.('pipeline/setReady', payload)

    if (this.subscriptions.size > 0) {
      this.subscribe(Array.from(this.subscriptions))
    }
  }

  private handleInvalidSession(payload: InvalidSessionPayload): void {
    if (!payload.resumable) {
      this._user = null
      this.setState('connected')
      this.dispatchHandler?.('pipeline/setInvalidSession')
    }
  }

  private handleReconnect(): void {
    this.logger.info('Server requested reconnect')
    this.disconnect()
    this.connect()
  }

  private handleDispatch(event: EventCode, data: unknown, sequence?: number): void {
    if (typeof sequence === 'number') {
      this.lastSequence = sequence
    }

    this.emitEvent(event, data)
    this.emit('onDispatch', event, data)
    this.dispatchHandler?.('pipeline/handleDispatch', { event, data })
  }

  private handleServerError(payload: ErrorPayload): void {
    this.logger.error(`Server error: ${payload.code} - ${payload.message || 'unknown'}`)
    this.emit('onError', payload)
    this.dispatchHandler?.('pipeline/handleServerError', payload)
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
    }

    if (!this.heartbeatInterval) return

    const jitter = this.heartbeatInterval * 0.1 * (Math.random() * 2 - 1)
    const interval = this.heartbeatInterval + jitter

    this.heartbeatTimer = window.setInterval(() => {
      this.sendHeartbeat()
    }, interval)

    this.sendHeartbeat()
  }

  private sendHeartbeat(): void {
    this.send<HeartbeatPayload>(Opcodes.HEARTBEAT, {
      seq: this.lastSequence || null,
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached')
      this.setState('disconnected')
      return
    }

    this.setState('reconnecting')

    const backoffIndex = Math.min(this.reconnectAttempts, this.reconnectBackoff.length - 1)
    const delay = this.reconnectBackoff[backoffIndex] as number

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectAttempts += 1
      this.emit('onReconnect', this.reconnectAttempts)
      this.connect()
    }, delay)
  }

  private send<T>(op: Opcode, data: T): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('Cannot send: not connected')
      return
    }

    const message: PipelineMessage<T> = { op, d: data }
    this.ws.send(JSON.stringify(message))
  }

  private emitEvent(event: EventCode, data: unknown): void {
    const listeners = this.eventListeners.get(event)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        listener(data)
      } catch (error) {
        this.logger.error(`Event listener error for ${event}`, error)
      }
    }
  }

  private emit<K extends keyof PipelineEvents>(event: K, ...args: Parameters<PipelineEvents[K]>): void {
    const listeners = this.connectionListeners.get(event)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        ;(listener as (...listenerArgs: unknown[]) => void)(...args)
      } catch (error) {
        this.logger.error(`Connection listener error for ${event}`, error)
      }
    }
  }

  private resolveToken(): string | null {
    const fromProvider = this.options.tokenProvider?.()
    if (!fromProvider) return null
    return fromProvider
  }
}

export function createPipeline(options: PipelineClientOptions): PipelineClient {
  return new PipelineClient(options)
}

export { PipelineErrors, getPipelineErrorName }
export type { PipelineError }
