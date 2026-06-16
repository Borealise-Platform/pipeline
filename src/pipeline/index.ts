/**
 * @file Public entry point for the modular pipeline client.
 *
 * This module is written in a functional style on purpose: there is no
 * `class` and no `this` anywhere under `pipeline/`. Each client is built by
 * {@link buildPipeline} (see `client.ts`) from a set of closures sharing one
 * mutable {@link PipelineContext}, split across files by responsibility:
 *
 * - `context.ts`   — shared state shape
 * - `events.ts`    — listener registries (`on`/`onConnection`/...)
 * - `heartbeat.ts` — heartbeat scheduling
 * - `socket.ts`    — WebSocket lifecycle + reconnect
 * - `commands.ts`  — outbound opcode frames (identify, subscribe, chat, ...)
 * - `client.ts`    — wires the above into the frozen {@link Pipeline} object
 *
 * {@link createPipeline} is a **module-level singleton factory**: the first
 * call builds the client and every subsequent call returns that same
 * instance, regardless of the options passed in. This matches how the SDK
 * is actually consumed (one client per app/process).
 */

import { Logger } from '../logger'
import type { PipelineClientOptions } from '../types'
import { buildPipeline, type Pipeline } from './client'

export type { Pipeline } from './client'
export type { PipelineContext, PipelineState } from './context'
export type { EventBus } from './events'
export type { Heartbeat } from './heartbeat'
export type { Socket, SocketDeps } from './socket'
export type { Commands } from './commands'

/** Module-level singleton instance, created lazily on first {@link createPipeline} call. */
let singleton: Pipeline | null = null

/**
 * Returns the shared pipeline client, creating it on the first call.
 *
 * `createPipeline` is a singleton factory: `options` are only consulted the
 * first time it's invoked. Subsequent calls (with any options) return the
 * exact same instance, so the connection/session/listeners are shared
 * across every caller in the process.
 */
export function createPipeline(options: PipelineClientOptions): Pipeline {
  singleton ??= buildPipeline(options, options.loggerEnabled ? Logger.create('Pipeline') : undefined)
  return singleton
}

/**
 * Test-only escape hatch: drops the cached singleton so the next
 * {@link createPipeline} call builds a fresh client. Not part of the public
 * package API (not re-exported from the package's root `index.ts`).
 */
export function _resetPipelineSingleton(): void {
  singleton = null
}
