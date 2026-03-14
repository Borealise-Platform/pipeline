export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerOptions {
  minLevel?: LogLevel
}

export class Logger {
  private static loggers = new Map<string, Logger>()

  public static create(name: string, options: LoggerOptions = {}): Logger {
    const logger = new Logger(name, options)
    Logger.loggers.set(name, logger)
    return logger
  }

  private constructor(private readonly name: string, private readonly options: LoggerOptions = {}) {}

  private enabled(level: LogLevel): boolean {
    return level >= (this.options.minLevel ?? LogLevel.DEBUG)
  }

  public debug(message: string, ...args: unknown[]): void {
    if (!this.enabled(LogLevel.DEBUG)) return
    console.log(`[DEBUG] [${this.name}] ${message}`, ...args)
  }

  public info(message: string, ...args: unknown[]): void {
    if (!this.enabled(LogLevel.INFO)) return
    console.info(`[INFO] [${this.name}] ${message}`, ...args)
  }

  public warn(message: string, ...args: unknown[]): void {
    if (!this.enabled(LogLevel.WARN)) return
    console.warn(`[WARN] [${this.name}] ${message}`, ...args)
  }

  public error(message: string, ...args: unknown[]): void {
    if (!this.enabled(LogLevel.ERROR)) return
    console.error(`[ERROR] [${this.name}] ${message}`, ...args)
  }
}
