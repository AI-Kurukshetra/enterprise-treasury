import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody } from '@/api/validation';
import { TreasuryCopilotService } from '@/services/copilot/copilot-service';

const CopilotChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  sessionId: z.string().uuid().optional(),
  messageId: z.string().min(1).max(128).optional()
});

function encodeEvent(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: NextRequest) {
  return executeRoute(
    request,
    {
      requiredPermission: 'copilot.access',
      rateLimit: 'copilot.chat'
    },
    async (_req, context) => {
      const body = await parseJsonBody(request, CopilotChatRequestSchema);
      const copilotService = new TreasuryCopilotService();
      const prepared = await copilotService.prepareSession({
        organizationId: context.organizationId!,
        userId: context.user!.id,
        sessionId: body.sessionId,
        message: body.message,
        messageId: body.messageId
      });
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            try {
              if (prepared.replayMessage) {
                for (const chunk of copilotService.replayAssistantMessage(prepared.replayMessage)) {
                  controller.enqueue(
                    encoder.encode(
                      encodeEvent({
                        ...chunk,
                        sessionId: prepared.session.id
                      })
                    )
                  );
                }
              } else {
                const responseStream = await copilotService.chat(
                  context.organizationId!,
                  context.user!.id,
                  prepared.session.messages,
                  prepared.session.id
                );

                for await (const chunk of responseStream) {
                  controller.enqueue(
                    encoder.encode(
                      encodeEvent({
                        ...chunk,
                        sessionId: prepared.session.id
                      })
                    )
                  );
                }
              }

              controller.enqueue(
                encoder.encode(
                  encodeEvent({
                    type: 'done',
                    sessionId: prepared.session.id
                  })
                )
              );
            } catch (error) {
              controller.enqueue(
                encoder.encode(
                  encodeEvent({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Copilot stream failed',
                    sessionId: prepared.session.id
                  })
                )
              );
            } finally {
              controller.close();
            }
          })();
        }
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        }
      });
    }
  );
}

export const OPTIONS = buildOptionsHandler();
