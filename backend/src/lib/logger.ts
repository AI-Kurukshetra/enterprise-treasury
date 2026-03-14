import { getActiveRequestContext } from '@/lib/requestContext';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogPayload {
  level: LogLevel;
  message: string;
  requestId?: string;
  organizationId?: string;
  actorId?: string;
  domain?: string;
  eventType?: string;
  data?: Record<string, unknown>;
}

export class Logger {
  log(payload: LogPayload): void {
    const activeContext = getActiveRequestContext();
    const output = {
      requestId: payload.requestId ?? activeContext?.requestId,
      traceId: activeContext?.traceId,
      organizationId: payload.organizationId ?? activeContext?.organizationId,
      actorId: payload.actorId ?? activeContext?.actorId,
      ...payload,
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(output));
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'info', message, data });
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'warn', message, data });
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'error', message, data });
  }
}

export const logger = new Logger();
