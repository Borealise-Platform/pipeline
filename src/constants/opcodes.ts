/**
 * Pipeline Opcodes and event codes.
 */
export const Opcodes = {
  IDENTIFY: 0x00,
  HEARTBEAT: 0x01,
  PRESENCE_UPDATE: 0x02,
  SUBSCRIBE: 0x03,
  UNSUBSCRIBE: 0x04,
  REQUEST: 0x05,
  CHAT_SEND: 0x06,

  HELLO: 0x10,
  HEARTBEAT_ACK: 0x11,
  READY: 0x12,
  INVALID_SESSION: 0x13,
  RECONNECT: 0x14,
  DISPATCH: 0x15,

  ERROR: 0xFF,
} as const

export type Opcode = typeof Opcodes[keyof typeof Opcodes]

export const Events = {
  USER_UPDATE: 0x00,
  USER_PRESENCE_UPDATE: 0x01,
  USER_TYPING: 0x02,
  USER_LEVEL_UP: 0x03,

  SESSION_CREATE: 0x10,
  SESSION_DELETE: 0x11,
  SESSION_UPDATE: 0x12,

  NOTIFICATION_CREATE: 0x20,
  NOTIFICATION_DELETE: 0x21,

  ROOM_JOIN: 0x30,
  ROOM_LEAVE: 0x31,
  ROOM_UPDATE: 0x32,
  ROOM_DELETE: 0x33,

  ROOM_USER_JOIN: 0x40,
  ROOM_USER_LEAVE: 0x41,
  ROOM_USER_KICK: 0x42,
  ROOM_USER_BAN: 0x43,
  ROOM_USER_MUTE: 0x44,
  ROOM_USER_UNMUTE: 0x45,
  ROOM_USER_ROLE_UPDATE: 0x46,
  ROOM_USER_AVATAR_UPDATE: 0x47,
  ROOM_USER_SUBSCRIPTION_UPDATE: 0x48,

  ROOM_CHAT_MESSAGE: 0x50,
  ROOM_CHAT_DELETE: 0x51,

  ROOM_DJ_ADVANCE: 0x60,
  ROOM_DJ_UPDATE: 0x61,
  ROOM_WAITLIST_JOIN: 0x62,
  ROOM_WAITLIST_LEAVE: 0x63,
  ROOM_WAITLIST_UPDATE: 0x64,
  ROOM_WAITLIST_LOCK: 0x65,
  ROOM_WAITLIST_CYCLE: 0x66,
  ROOM_TIME_SYNC: 0x67,

  ROOM_VOTE: 0x70,
  ROOM_GRAB: 0x71,

  FRIEND_REQUEST: 0x80,
  FRIEND_REQUEST_CANCEL: 0x81,
  FRIEND_ACCEPT: 0x82,
  FRIEND_REMOVE: 0x83,

  SYSTEM_MESSAGE: 0xF0,
  MAINTENANCE: 0xF1,
  RATE_LIMIT: 0xF2,
} as const

export type EventCode = typeof Events[keyof typeof Events]

export const Presence = {
  ONLINE: 0x00,
  IDLE: 0x01,
  DND: 0x02,
  INVISIBLE: 0x03,
  OFFLINE: 0x04,
} as const

export type PresenceCode = typeof Presence[keyof typeof Presence]

export const Activity = {
  NONE: 0x00,
  VIEWING: 0x01,
  EDITING: 0x02,
  IDLE: 0x03,
  STREAMING: 0x04,
  LISTENING: 0x05,
  WATCHING: 0x06,
  CUSTOM: 0xFF,
} as const

export type ActivityCode = typeof Activity[keyof typeof Activity]

export const Roles = {
  USER: 0x00,
  MODERATOR: 0x01,
  ADMIN: 0x02,
  OWNER: 0xFF,
} as const

export type RoleCode = typeof Roles[keyof typeof Roles]

export const CloseCodes = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNKNOWN_ERROR: 4000,
  UNKNOWN_OPCODE: 4001,
  DECODE_ERROR: 4002,
  NOT_AUTHENTICATED: 4003,
  AUTHENTICATION_FAILED: 4004,
  ALREADY_AUTHENTICATED: 4005,
  INVALID_SESSION: 4006,
  RATE_LIMITED: 4008,
  SESSION_TIMEOUT: 4009,
  SERVER_SHUTDOWN: 4010,
} as const

export type CloseCode = typeof CloseCodes[keyof typeof CloseCodes]

export const PipelineErrors = {
  CHAT_MESSAGE_EMPTY: 4100,
  CHAT_MESSAGE_TOO_LONG: 4101,
  CHAT_ROOM_NOT_FOUND: 4102,
  CHAT_NOT_IN_ROOM: 4103,
  CHAT_USER_MUTED: 4104,

  ROOM_NOT_FOUND: 4200,
  ROOM_NOT_ACTIVE: 4201,
  ROOM_ALREADY_MEMBER: 4202,
  ROOM_NOT_MEMBER: 4203,
  ROOM_BANNED: 4204,
  ROOM_FULL: 4205,

  WAITLIST_LOCKED: 4300,
  WAITLIST_FULL: 4301,
  WAITLIST_ALREADY_IN: 4302,
  WAITLIST_NOT_IN: 4303,

  VOTE_INVALID: 4400,
  VOTE_ALREADY_VOTED: 4401,
  VOTE_NO_TRACK: 4402,
} as const

export type PipelineError = typeof PipelineErrors[keyof typeof PipelineErrors]

export function getPipelineErrorName(code: PipelineError): string {
  return Object.entries(PipelineErrors).find(([, value]) => value === code)?.[0] || 'UNKNOWN_ERROR'
}

export function getEventName(code: EventCode): string {
  return Object.entries(Events).find(([, value]) => value === code)?.[0] || 'UNKNOWN'
}
