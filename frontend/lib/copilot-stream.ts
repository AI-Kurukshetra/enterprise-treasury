import { getClientSession, getPreferredOrganizationId } from '@/lib/session';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001/api/v1';

interface StreamEventPayload {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  tool?: string;
  sessionId?: string;
  message?: string;
}

export async function streamCopilotResponse(
  message: string,
  sessionId: string | undefined,
  onChunk: (chunk: string, nextSessionId?: string) => void,
  onToolCall: (tool: string, label: string, nextSessionId?: string) => void,
  onDone: (nextSessionId: string) => void
) {
  const messageId = crypto.randomUUID();
  let resolvedSessionId = sessionId;
  let fullMessage = '';
  let retryCount = 0;

  while (retryCount < 2) {
    const headers = buildHeaders();
    const response = await fetch(`${API_BASE_URL}/copilot/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        sessionId: resolvedSessionId,
        messageId
      }),
      cache: 'no-store'
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.error?.message ?? 'Copilot stream failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    let retryAggregate = '';
    let retryEmittedBeyondPrefix = '';

    try {
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const segments = buffer.split('\n\n');
        buffer = segments.pop() ?? '';

        for (const segment of segments) {
          const payload = parseSseEvent(segment);
          if (!payload) {
            continue;
          }

          if (payload.sessionId) {
            resolvedSessionId = payload.sessionId;
          }

          if (payload.type === 'text') {
            const text = payload.content ?? '';
            if (retryCount === 0) {
              fullMessage += text;
              onChunk(text, resolvedSessionId);
              continue;
            }

            retryAggregate += text;
            if (fullMessage.startsWith(retryAggregate)) {
              continue;
            }

            if (!retryAggregate.startsWith(fullMessage)) {
              throw new Error('Copilot stream retry diverged from the original response');
            }

            const beyondPrefix = retryAggregate.slice(fullMessage.length);
            const nextText = beyondPrefix.slice(retryEmittedBeyondPrefix.length);
            if (nextText) {
              fullMessage += nextText;
              retryEmittedBeyondPrefix = beyondPrefix;
              onChunk(nextText, resolvedSessionId);
            }
            continue;
          }

          if (payload.type === 'tool_call') {
            onToolCall(payload.tool ?? 'tool', payload.content ?? 'Checking data...', resolvedSessionId);
            continue;
          }

          if (payload.type === 'done') {
            if (!resolvedSessionId) {
              throw new Error('Copilot stream completed without a session identifier');
            }
            done = true;
            onDone(resolvedSessionId);
            return {
              sessionId: resolvedSessionId,
              message: fullMessage
            };
          }

          if (payload.type === 'error') {
            throw new Error(payload.message ?? 'Copilot stream failed');
          }
        }
      }
    } catch (error) {
      if (retryCount === 0 && resolvedSessionId) {
        retryCount += 1;
        continue;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    if (done) {
      break;
    }

    if (!resolvedSessionId || retryCount > 0) {
      throw new Error('Copilot connection closed before completion');
    }

    retryCount += 1;
  }

  if (!resolvedSessionId) {
    throw new Error('Copilot did not return a session identifier');
  }

  onDone(resolvedSessionId);
  return {
    sessionId: resolvedSessionId,
    message: fullMessage
  };
}

function buildHeaders() {
  const session = getClientSession();
  const organizationId = getPreferredOrganizationId();
  const headers = new Headers({
    Accept: 'text/event-stream',
    'Content-Type': 'application/json'
  });

  if (session.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  if (organizationId) {
    headers.set('X-Organization-Id', organizationId);
  }

  return headers;
}

function parseSseEvent(segment: string): StreamEventPayload | null {
  const payloadLines = segment
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  if (payloadLines.length === 0) {
    return null;
  }

  return JSON.parse(payloadLines.join('\n')) as StreamEventPayload;
}
