/**
 * @file Heartbeat scheduling: periodically sends `HEARTBEAT` frames at the
 * server-provided interval (plus jitter) to keep the session alive.
 */

import { Opcodes } from '@borealise/shared'
import type { HeartbeatPayload } from '../types'
import type { PipelineContext } from './context'

export interface Heartbeat {
  /** (Re)starts the heartbeat timer using `context.state.heartbeatInterval`. No-op if unset. */
  start: () => void
  /** Sends one heartbeat frame immediately, carrying the last received sequence number. */
  send: () => void
}

/**
 * Builds the heartbeat controller for one pipeline instance.
 *
 * `sendFrame` is injected (rather than imported) so this module doesn't
 * need to know about the socket/transport — it just asks for a way to send
 * an opcode frame.
 */
export function createHeartbeat(context: PipelineContext, sendFrame: <T>(op: number, data: T) => void): Heartbeat {
  const { state } = context

  function send(): void {
    sendFrame<HeartbeatPayload>(Opcodes.HEARTBEAT, { seq: state.lastSequence || null })
  }

  function start(): void {
    if (state.heartbeatTimer !== null) {
      clearInterval(state.heartbeatTimer)
    }

    if (!state.heartbeatInterval) return

    // Jitter avoids every client in a fleet sending heartbeats in lockstep.
    const jitter = state.heartbeatInterval * 0.1 * (Math.random() * 2 - 1)
    const interval = state.heartbeatInterval + jitter

    state.heartbeatTimer = globalThis.setInterval(send, interval)
    send()
  }

  return { start, send }
}
