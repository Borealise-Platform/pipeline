# @borealise/pipeline

Official Borealise realtime pipeline client.

This package provides a typed WebSocket client for Borealise pipeline events, including:

- identify and session bootstrap
- heartbeat management
- dispatch event subscriptions
- reconnect with backoff
- strongly typed opcodes and payloads

## Runtime support

- Browser: works out of the box using native WebSocket.
- Node.js: you must provide a WebSocket implementation, usually ws.

## Installation

Install the package:

```bash
npm install @borealise/pipeline
```

If you run this in Node.js, install ws too:

```bash
npm install ws
```

## Quick start (browser)

```ts
import { createPipeline, Events } from '@borealise/pipeline'

const pipeline = createPipeline({
  url: 'wss://prod.borealise.com/ws',
  tokenProvider: () => localStorage.getItem('token'),
  loggerName: 'Pipeline',
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

Node has no global WebSocket by default. Inject one via webSocketFactory.

```ts
import WebSocket from 'ws'
import { createPipeline, Events } from '@borealise/pipeline'

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

## How the pipeline works

### 1. Connect

When you call connect(), the client opens the WebSocket and moves state to connecting.

### 2. HELLO handshake

Server sends HELLO with:

- session_id
- heartbeat_interval

Client starts heartbeat timer with jitter and resolves auth token from tokenProvider.

### 3. Identify

If tokenProvider returns a token, the client sends IDENTIFY.

### 4. READY

On successful auth, server sends READY.

Client:

- moves state to identified
- stores user/session metadata
- resubscribes previous event subscriptions

### 5. Dispatch

Server emits DISPATCH frames with event code and payload.

Client fan-outs events to:

- event listeners registered via on(event, listener)
- connection listener onDispatch
- optional dispatch bridge set via setDispatchHandler

### 6. Reconnect behavior

On non-terminal disconnects, client reconnects automatically with backoff:

- 1000ms
- 2000ms
- 5000ms
- 10000ms
- 30000ms

Max attempts: 10.

No reconnect for normal/explicit auth close codes.

## State model

Possible connection states:

- disconnected
- connecting
- connected
- reconnecting
- identified

Useful getters:

- pipeline.state
- pipeline.user
- pipeline.isConnected
- pipeline.isIdentified

## API surface

### Connection

- connect()
- disconnect()

### Authentication and presence

- identify(token)
- updatePresence(status, activity?)

### Subscriptions

- subscribe(eventCodes)
- unsubscribe(eventCodes)

### Chat

- sendChatMessage(roomSlug, content)

### Event listeners

- on(eventCode, listener)
- off(eventCode, listener)
- onConnection(eventName, listener)
- offConnection(eventName, listener)

Connection event names:

- onConnect
- onDisconnect
- onReconnect
- onStateChange
- onReady
- onError
- onDispatch

## Important options

createPipeline options:

- url: required pipeline endpoint
- tokenProvider: optional callback returning auth token
- loggerName: optional logger scope
- webSocketFactory: required for Node.js and custom environments

## Typed constants and helpers

The package exports protocol constants and helper functions:

- Opcodes
- Events
- Presence
- Activity
- Roles
- CloseCodes
- PipelineErrors
- getEventName(code)
- getPipelineErrorName(code)

## Dispatch bridge integration

For frameworks with centralized stores, use setDispatchHandler to bridge incoming lifecycle and event actions:

```ts
pipeline.setDispatchHandler((action, payload) => {
  // Example: forward to your store dispatcher
  store.dispatch(action, payload)
})
```

Actions emitted by the client:

- pipeline/setConnectionState
- pipeline/setReady
- pipeline/setInvalidSession
- pipeline/handleDispatch
- pipeline/handleServerError

## Error handling notes

- Server-side protocol errors are emitted through onError with numeric code/message.
- Client parse/listener failures are logged, not thrown, to keep the connection alive.
- send methods are safe no-ops if socket is not open.

## Production recommendations

- Always use wss in production.
- Keep tokenProvider fast and side-effect free.
- Subscribe only to events your UI or worker actually consumes.
- Register listeners before connect() when you need first-event guarantees.
- Call disconnect() on app shutdown or teardown.

## Local development

Build package:

```bash
npm run build
```

Watch mode:

```bash
npm run dev
```
