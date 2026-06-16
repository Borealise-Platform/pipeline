/**
 * @file Shared mutable state for one pipeline client instance.
 *
 * Every other module under `pipeline/` (`events`, `heartbeat`, `socket`,
 * `commands`) receives the same {@link PipelineContext} and reads/writes
 * `context.state` directly instead of going through `this`. This is what
 * lets the client be split across files while still sharing one source of
 * truth per instance.
 */

import type { Logger } from '../logger'
import type { EventCode } from '@borealise/shared'
import {
  ConnectionFlags,
  type ConnectionState,
  type DispatchHandler,
  type EventListener,
  type PipelineClientOptions,
  type PipelineEvents,
  type ReadyPayload,
} from '../types'

/**
 * All mutable state for one pipeline client, grouped into a single record
 * so it can be created/reset with one object literal instead of scattered
 * `let` bindings.
 */
export interface PipelineState {
  ws: WebSocket | null
  sessionId: string | null
  heartbeatInterval: number | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempts: number
  lastSequence: number
  subscriptions: Set<EventCode>
  connectionState: ConnectionState
  user: ReadyPayload['user'] | null
  eventListeners: Map<EventCode, Set<EventListener>>
  connectionListeners: Map<keyof PipelineEvents, Set<(...args: unknown[]) => void>>
  dispatchHandler: DispatchHandler | null
}

/** Builds a fresh, disconnected {@link PipelineState} record. */
export function createInitialState(): PipelineState {
  return {
    ws: null,
    sessionId: null,
    heartbeatInterval: null,
    heartbeatTimer: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    lastSequence: 0,
    subscriptions: new Set(),
    connectionState: ConnectionFlags.DISCONNECTED,
    user: null,
    eventListeners: new Map(),
    connectionListeners: new Map(),
    dispatchHandler: null,
  }
}

/**
 * Bag of dependencies threaded through every `pipeline/` module: the
 * resolved config, the mutable {@link PipelineState}, and an optional
 * logger. Modules close over this instead of importing module-level
 * singletons, so multiple independent clients never share state.
 */
export interface PipelineContext {
  readonly config: PipelineClientOptions
  readonly state: PipelineState
  readonly logger: Logger | undefined
}

/** Creates the shared context object passed to every module factory. */
export function createPipelineContext(options: PipelineClientOptions, logger: Logger | undefined): PipelineContext {
  return {
    config: { ...options },
    state: createInitialState(),
    logger,
  }
}
