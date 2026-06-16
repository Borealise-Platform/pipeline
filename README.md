# @borealise/pipeline

Official Borealise realtime pipeline client — a typed WebSocket client for Borealise's
gateway protocol: identify/session bootstrap, heartbeats, dispatch event subscriptions,
automatic reconnect with backoff, and watch-together transport controls.

## Runtime support

- **Browser** — works out of the box using the native `WebSocket`.
- **Node.js** — no global `WebSocket`; you must provide one via `webSocketFactory` (e.g. [`ws`](https://www.npmjs.com/package/ws)).

## Installation

```bash
npm install @borealise/pipeline
```

`@borealise/pipeline` depends on `@borealise/shared` but does **not** re-export it.
If you need protocol constants (`Opcodes`, `Events`, `Presence`, `CloseCodes`,
`getEventName`, ...), install and import them from `@borealise/shared` directly:

```bash
npm install @borealise/shared
```

If you run this in Node.js, install `ws` too:

```bash
npm install ws
```

## Quick start (browser)

```ts
import { createPipeline } from '@borealise/pipeline'
import { Events } from '@borealise/shared'

const pipeline = createPipeline({
  url: 'wss://prod.borealise.com/ws',
  tokenProvider: () => localStorage.getItem('token'),
  loggerEnabled: true,
})

pipeline.onConnection('onReady', (ready) => {
  console.log('ready session', ready.session_id)
  pipeline.subscribe([Events.USER_UPDATE, Events.ROOM_CHAT_MESSAGE])
})

pipeline.onConnection('onDisconnect', (code, reason) => {
  console.log('disconnected', code, reason)
})

pipeline.connect()
```

## Quick start (Node.js with ws)

Node has no global `WebSocket` by default — inject one via `webSocketFactory`:

```ts
import WebSocket from 'ws'
import { createPipeline } from '@borealise/pipeline'
import { Events } from '@borealise/shared'

const pipeline = createPipeline({
  url: 'wss://prod.borealise.com/ws',
  tokenProvider: () => process.env.BOREALISE_TOKEN,
  webSocketFactory: (url) => new WebSocket(url) as unknown as WebSocket,
})

pipeline.on(Events.USER_UPDATE, (payload) => {
  console.log('user update', payload)
})

pipeline.connect()
```

## `createPipeline` is a singleton

`createPipeline(options)` builds the client on its **first** call and returns that
same instance on every later call, regardless of the options passed — there is one
pipeline client per process/app. Call it once near app startup and import the
returned value everywhere else; don't expect a second call with different `options`
to produce a second, independent client.

The returned object is also `Object.freeze`d: you can call its methods and read its
getters, but you can't reassign them.

## How the pipeline works

### 1. Connect

`pipeline.connect()` opens the WebSocket and moves `state` to `CONNECTING`. Calling it
while already connecting/open is a no-op.

### 2. HELLO handshake

The server sends `HELLO` with `session_id` and `heartbeat_interval`. The client starts
its heartbeat timer (interval ± jitter) and, if `tokenProvider` returns a token, sends
`IDENTIFY` automatically.

### 3. Identify

If you don't supply `tokenProvider` (or it returns nothing), call `pipeline.identify(token)`
yourself once you have a token.

### 4. READY

On successful auth, the server sends `READY`. The client moves `state` to `IDENTIFIED`,
stores `user`/session metadata, and resubscribes any event codes you'd previously passed
to `subscribe()`.

### 5. Dispatch

The server emits `DISPATCH` frames with an event code and payload. The client fans these
out to:

- event listeners registered via `pipeline.on(event, listener)`
- the `onDispatch` connection listener
- the optional dispatch bridge set via `setDispatchHandler` (see below)

### 6. Reconnect behavior

On non-terminal disconnects, the client reconnects automatically with backoff:
`1000ms → 2000ms → 5000ms → 10000ms → 30000ms` (repeating the last step), up to
**10 attempts** before giving up and settling into `DISCONNECTED`.

No reconnect is attempted for normal or explicit-auth-failure close codes
(`CloseCodes.NORMAL`, `AUTHENTICATION_FAILED`, `NOT_AUTHENTICATED`).

## State model

`pipeline.state` is a **numeric bitfield**, not a string. Exactly one phase is active
at a time; `IDENTIFIED` also carries the `CONNECTED` bit, so "connected or identified"
is a single bitwise test instead of two string comparisons:

```ts
import { ConnectionFlags, isConnectionFlagSet } from '@borealise/pipeline'

ConnectionFlags.DISCONNECTED   // 0
ConnectionFlags.CONNECTING     // 1 << 0
ConnectionFlags.CONNECTED      // 1 << 1
ConnectionFlags.RECONNECTING   // 1 << 2
ConnectionFlags.IDENTIFIED     // CONNECTED | (1 << 3)

isConnectionFlagSet(pipeline.state, ConnectionFlags.CONNECTED) // true while connected OR identified
```

Don't compare `pipeline.state` with `===` against another raw number you computed by
hand — use `isConnectionFlagSet` (or `pipeline.isConnected`/`pipeline.isIdentified`,
which already do this for you).

> **Migrating from an older version:** `state`/`onStateChange` used to emit the strings
> `'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'identified'`. Replace
> `state === 'connected'` with `isConnectionFlagSet(state, ConnectionFlags.CONNECTED)`,
> and similarly for the other phases.

Reactive getters:

| Getter | Meaning |
| --- | --- |
| `pipeline.state` | Raw `ConnectionFlags` bitfield value |
| `pipeline.user` | `ReadyPayload['user']` once identified, else `null` |
| `pipeline.isConnected` | `true` while `CONNECTED` or `IDENTIFIED` |
| `pipeline.isIdentified` | `true` once `IDENTIFIED` |

## API surface

### Connection

- `connect()`
- `disconnect()`

### Authentication and presence

- `identify(token)`
- `updatePresence(status, activity?)`

### Subscriptions

- `subscribe(eventCodes)`
- `unsubscribe(eventCodes)`

### Chat

- `sendChatMessage(roomSlug, content)` — returns `false` (no-op) if not identified yet

### Watch-together transport

- `sendWtSeek(roomSlug, position)`
- `sendWtPause(roomSlug, position)`
- `sendWtResume(roomSlug, position)`
- `sendWtStateRequest(roomSlug)`
- `sendWtHeartbeat(roomSlug, position)`
- `sendWtStateResponse(roomSlug, targetSessionId, paused, position)`

All of the above (except `identify`) are no-ops until the session is identified.

### Event listeners

- `on(eventCode, listener)` / `off(eventCode, listener)` — dispatch events; `on` returns an unsubscribe function
- `onConnection(eventName, listener)` / `offConnection(eventName, listener)` — connection lifecycle events; `onConnection` also returns an unsubscribe function

Connection event names (`PipelineEvents`):

- `onConnect`
- `onDisconnect(code, reason)`
- `onReconnect(attempt)`
- `onStateChange(state)`
- `onReady(payload)`
- `onError(payload)`
- `onDispatch(event, data)`

## `createPipeline` options

```ts
interface PipelineClientOptions {
  url: string                                          // required pipeline endpoint
  tokenProvider?: () => string | null | undefined       // resolves the auth token for IDENTIFY
  loggerEnabled?: boolean                                // verbose console logging, default false
  webSocketFactory?: (url: string) => WebSocket          // required in Node.js / non-browser runtimes
}
```

## Typed constants and helpers (from `@borealise/shared`)

`@borealise/pipeline` only exports `createPipeline`, `Pipeline`, the payload/event
types in `src/types.ts`, and the `ConnectionFlags`/`isConnectionFlagSet` bitfield
helpers. Everything protocol-related — including error codes — comes from
`@borealise/shared` directly:

- `Opcodes`, `Events`, `Presence`, `Activity`, `Roles`, `CloseCodes`, `PipelineErrors`
- `getEventName(code)`, `getPresenceName(code)`, `getActivityName(code)`, `getRoleName(code)`, `getPipelineErrorName(code)`

```ts
import { PipelineErrors, getPipelineErrorName, type PipelineError } from '@borealise/shared'

pipeline.onConnection('onError', (error) => {
  if (error.code === PipelineErrors.CHAT_USER_MUTED) { /* ... */ }
  console.warn(getPipelineErrorName(error.code as PipelineError))
})
```

## Dispatch bridge integration

For apps with a centralized store (Redux, Pinia, Vuex, ...), use `setDispatchHandler` to
bridge the client's internal lifecycle/event actions into your store's dispatcher:

```ts
pipeline.setDispatchHandler((action, payload) => {
  store.dispatch(action, payload)
})
```

Actions emitted by the client:

- `pipeline/setConnectionState`
- `pipeline/setReady`
- `pipeline/setInvalidSession`
- `pipeline/handleDispatch`
- `pipeline/handleServerError`

`setStoreDispatch` is kept as a deprecated alias of `setDispatchHandler` for older
Pinia-store integrations; new code should call `setDispatchHandler` directly.

## Error handling notes

- Server-side protocol errors are emitted through `onError` with a numeric `code`/`message`.
- Client parse/listener failures are logged, not thrown, so one bad listener or malformed
  frame can't take down the connection.
- All `send*`/`sendWt*` methods are safe no-ops if the socket isn't open or the session
  isn't identified yet.

## Production recommendations

- Always use `wss://` in production.
- Keep `tokenProvider` fast and side-effect free — it's called synchronously on every
  `HELLO`.
- Subscribe only to the event codes your UI or worker actually consumes.
- Register listeners before `connect()` when you need a first-event guarantee.
- Call `disconnect()` on app shutdown/teardown to cancel pending reconnects.

## Package architecture (for contributors)

The client is implemented functionally — no `class`, no `this`. Each instance is a set
of closures sharing one mutable state record, split by responsibility under `src/pipeline/`:

| Module | Responsibility |
| --- | --- |
| `context.ts` | Shared state shape (`PipelineState`/`PipelineContext`) |
| `events.ts` | Listener registries: `on`/`off`/`onConnection`/`offConnection` |
| `heartbeat.ts` | Heartbeat scheduling (interval + jitter) |
| `socket.ts` | WebSocket lifecycle, frame parsing/dispatch, reconnect backoff |
| `commands.ts` | Outbound opcode frames (identify, subscribe, chat, watch-together) |
| `client.ts` | Wires the above into the frozen `Pipeline` object |
| `index.ts` | `createPipeline` singleton + barrel exports |

`src/index.ts` (the package entry point) re-exports only the public surface
(`createPipeline`, `Pipeline`, and the types in `src/types.ts`) — internal wiring types
like `PipelineContext`/`Socket`/`Commands` are intentionally not part of the public API.

## Local development

Build the package:

```bash
npm run build
```

Watch mode:

```bash
npm run dev
```

Typecheck only:

```bash
npm run lint
```
