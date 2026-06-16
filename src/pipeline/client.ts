/**
 * @file Wires `context`, `events`, `socket`, and `commands` together into
 * one frozen {@link Pipeline} object — the only thing consumers ever touch.
 *
 * This is the one place that knows about every module, which is also why
 * the `socket` <-> `commands` circular need (socket calls `identify` on
 * HELLO; commands need socket's `send`/`isIdentified`) is resolved here via
 * a small forward-reference trick instead of in either module.
 */

import type { EventCode, PresenceCode } from '@borealise/shared'
import type { Logger } from '../logger'
import {
  ConnectionFlags,
  isConnectionFlagSet,
  type ConnectionState,
  type DispatchHandler,
  type ErrorPayload,
  type EventListener,
  type PipelineClientOptions,
  type PipelineEvents,
  type PresenceUpdatePayload,
  type ReadyPayload,
} from '../types'
import { createPipelineContext } from './context'
import { createEventBus } from './events'
import { createSocket } from './socket'
import { createCommands } from './commands'

/**
 * Public shape returned by {@link createPipeline}. Plain data + functions,
 * frozen at creation time so consumers can't accidentally reassign methods.
 */
export interface Pipeline {
  readonly state: ConnectionState
  readonly user: ReadyPayload['user'] | null
  readonly isConnected: boolean
  readonly isIdentified: boolean
  setDispatchHandler: (handler: DispatchHandler) => void
  /** @deprecated Alias for {@link setDispatchHandler}, kept for older Pinia-store consumers. */
  setStoreDispatch: (handler: DispatchHandler) => void
  connect: () => void
  disconnect: () => void
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
  on: <T = unknown>(event: EventCode, listener: EventListener<T>) => () => void
  off: <T = unknown>(event: EventCode, listener: EventListener<T>) => void
  onConnection: <K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]) => () => void
  offConnection: <K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]) => void
}

/**
 * Builds one pipeline client instance from its constituent modules. All
 * state lives in `context.state`; every returned function reads/mutates it
 * directly instead of going through `this`.
 */
export function buildPipeline(options: PipelineClientOptions, logger: Logger | undefined): Pipeline {
  const context = createPipelineContext(options, logger)
  const bus = createEventBus(context)

  function setState(next: ConnectionState): void {
    if (context.state.connectionState === next) return

    context.state.connectionState = next
    bus.emitConnection('onStateChange', next)
    context.state.dispatchHandler?.('pipeline/setConnectionState', next)
  }

  function resolveToken(): string | null {
    return context.config.tokenProvider?.() ?? null
  }

  function onReady(payload: ReadyPayload): void {
    bus.emitConnection('onReady', payload)
    context.state.dispatchHandler?.('pipeline/setReady', payload)

    if (context.state.subscriptions.size > 0) {
      commands.subscribe(Array.from(context.state.subscriptions))
    }
  }

  function onInvalidSession(): void {
    context.state.dispatchHandler?.('pipeline/setInvalidSession')
  }

  function onDispatch(event: EventCode, data: unknown): void {
    bus.emitEvent(event, data)
    bus.emitConnection('onDispatch', event, data)
    context.state.dispatchHandler?.('pipeline/handleDispatch', { event, data })
  }

  function onServerError(payload: ErrorPayload): void {
    bus.emitConnection('onError', payload)
    context.state.dispatchHandler?.('pipeline/handleServerError', payload)
  }

  // `socket` needs `commands.identify` for the HELLO handshake, and
  // `commands` needs `socket.send`/`socket.isIdentified`. Break the cycle
  // by handing socket a thin forward-reference that's only ever called
  // after both are fully constructed (i.e. never during this function).
  let commands: ReturnType<typeof createCommands>
  const socket = createSocket(context, bus, {
    setState,
    resolveToken,
    onReady,
    onInvalidSession,
    onDispatch,
    onServerError,
    identify: (token) => commands.identify(token),
  })
  commands = createCommands(context, socket.send, socket.isIdentified)

  function setDispatchHandler(handler: DispatchHandler): void {
    context.state.dispatchHandler = handler
  }

  // IDENTIFIED implies CONNECTED (see ConnectionFlags docs), so a single
  // bit test covers both "connected" and "connected and identified".
  function isConnected(): boolean {
    return isConnectionFlagSet(context.state.connectionState, ConnectionFlags.CONNECTED)
  }

  // The public API is a plain object of bound functions plus live getters
  // for the bits of state callers read reactively (state/user/isConnected/
  // ...). `Reflect.defineProperty` is used instead of object-literal
  // getters so the descriptor is explicit (enumerable, not
  // writable/configurable) and consistent for every reflected field.
  const pipeline = {
    setDispatchHandler,
    /** @deprecated Alias for {@link setDispatchHandler}, kept for older Pinia-store consumers. */
    setStoreDispatch: setDispatchHandler,
    connect: socket.connect,
    disconnect: socket.disconnect,
    ...commands,
    on: bus.on,
    off: bus.off,
    onConnection: bus.onConnection,
    offConnection: bus.offConnection,
  } as Pipeline

  const reflectedGetters: Record<'state' | 'user' | 'isConnected' | 'isIdentified', () => unknown> = {
    state: () => context.state.connectionState,
    user: () => context.state.user,
    isConnected,
    isIdentified: socket.isIdentified,
  }

  for (const key of Reflect.ownKeys(reflectedGetters) as Array<keyof typeof reflectedGetters>) {
    Reflect.defineProperty(pipeline, key, {
      get: reflectedGetters[key],
      enumerable: true,
      configurable: false,
    })
  }

  return Object.freeze(pipeline)
}
