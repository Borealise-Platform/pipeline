/**
 * @file Listener registries: dispatch events (`on`/`off`) and connection
 * lifecycle events (`onConnection`/`offConnection`), plus the matching
 * `emit*` functions used internally by the socket/command modules.
 */

import type { EventCode } from '@borealise/shared'
import type { EventListener, PipelineEvents } from '../types'
import type { PipelineContext } from './context'

/** Adds `listener` to the `Set` stored at `map.get(key)`, creating it on demand. */
function addListener<K, L>(map: Map<K, Set<L>>, key: K, listener: L): void {
  let bucket = map.get(key)
  if (!bucket) {
    bucket = new Set()
    map.set(key, bucket)
  }
  bucket.add(listener)
}

/** Public event-subscription surface returned by {@link createEventBus}. */
export interface EventBus {
  on: <T = unknown>(event: EventCode, listener: EventListener<T>) => () => void
  off: <T = unknown>(event: EventCode, listener: EventListener<T>) => void
  onConnection: <K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]) => () => void
  offConnection: <K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]) => void
  /** Internal: fans `data` out to every listener subscribed to `event`. */
  emitEvent: (event: EventCode, data: unknown) => void
  /** Internal: fans connection-lifecycle args out to every subscribed listener. */
  emitConnection: <K extends keyof PipelineEvents>(event: K, ...args: Parameters<PipelineEvents[K]>) => void
}

/**
 * Builds the listener registries for one pipeline instance, scoped to
 * `context.state`. Errors thrown by individual listeners are caught and
 * logged so one bad listener can't break delivery to the others.
 */
export function createEventBus(context: PipelineContext): EventBus {
  const { state, logger } = context

  function on<T = unknown>(event: EventCode, listener: EventListener<T>): () => void {
    addListener(state.eventListeners, event, listener as EventListener)
    return () => off(event, listener)
  }

  function off<T = unknown>(event: EventCode, listener: EventListener<T>): void {
    state.eventListeners.get(event)?.delete(listener as EventListener)
  }

  function onConnection<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): () => void {
    addListener(state.connectionListeners, event, listener as (...args: unknown[]) => void)
    return () => offConnection(event, listener)
  }

  function offConnection<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): void {
    state.connectionListeners.get(event)?.delete(listener as (...args: unknown[]) => void)
  }

  function emitEvent(event: EventCode, data: unknown): void {
    const listeners = state.eventListeners.get(event)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        listener(data)
      } catch (error) {
        logger?.error(`Event listener error for ${event}`, error)
      }
    }
  }

  function emitConnection<K extends keyof PipelineEvents>(event: K, ...args: Parameters<PipelineEvents[K]>): void {
    const listeners = state.connectionListeners.get(event)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        ;(listener as (...listenerArgs: unknown[]) => void)(...args)
      } catch (error) {
        logger?.error(`Connection listener error for ${event}`, error)
      }
    }
  }

  return { on, off, onConnection, offConnection, emitEvent, emitConnection }
}
