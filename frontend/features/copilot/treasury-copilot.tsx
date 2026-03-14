'use client';

import { Fragment, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Copy,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  Sparkles,
  WandSparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  treasuryQueryKeys,
  useCopilotSessionQuery,
  useCopilotSessionsQuery,
  useCurrentProfileQuery
} from '@/hooks/use-treasury-queries';
import { formatDate } from '@/lib/format';
import { streamCopilotResponse } from '@/lib/copilot-stream';
import { cn } from '@/lib/utils';
import type { CopilotMessage, CopilotSession, CopilotSessionSummary, CopilotTokenUsage } from '@/lib/types';

const suggestedPrompts = [
  "What's our current USD cash position?",
  'Show me payments pending approval',
  'What are our top FX risk exposures?',
  'Generate a 30-day cash flow forecast',
  'Which counterparties have the highest concentration risk?'
];

const emptyTokenUsage: CopilotTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  estimatedCostUsd: '0.000000'
};

export function TreasuryCopilot() {
  const queryClient = useQueryClient();
  const profileQuery = useCurrentProfileQuery();
  const hasCopilotAccess = useMemo(
    () => Object.values(profileQuery.data?.permissions ?? {}).some((permissions) => permissions.includes('copilot.access')),
    [profileQuery.data?.permissions]
  );
  const sessionsQuery = useCopilotSessionsQuery(hasCopilotAccess);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sessionQuery = useCopilotSessionQuery(activeSessionId, hasCopilotAccess);
  const [optimisticMessages, setOptimisticMessages] = useState<CopilotMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeSession = sessionQuery.data ?? null;
  const displayedMessages = optimisticMessages ?? activeSession?.messages ?? [];
  const usage = activeSession?.tokenUsage ?? emptyTokenUsage;

  useEffect(() => {
    if (!isStreaming && activeSession) {
      setOptimisticMessages(activeSession.messages);
    }
  }, [activeSession, isStreaming]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [displayedMessages, toolLabel]);

  useEffect(() => {
    syncTextareaHeight(textareaRef.current);
  }, [draft]);

  if (profileQuery.isLoading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <Skeleton className="h-[720px] rounded-[28px]" />
        <Skeleton className="h-[720px] rounded-[28px]" />
      </div>
    );
  }

  if (!hasCopilotAccess) {
    return (
      <Card className="overflow-hidden border-amber-200 bg-amber-50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <CardDescription>Permission required</CardDescription>
              <CardTitle>Treasury Copilot access is restricted</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-amber-900/80">
            Your current organization role does not include the `copilot.access` permission. Ask a treasury administrator
            to grant access before using Atlas Copilot.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function handleSubmit() {
    const trimmed = draft.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    const createdAt = new Date().toISOString();
    const userMessage: CopilotMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      createdAt
    };
    const assistantMessageId = crypto.randomUUID();

    setStreamError(null);
    setDraft('');
    setToolLabel(null);
    setIsStreaming(true);
    setOptimisticMessages([
      ...displayedMessages,
      userMessage,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        metadata: {
          inReplyToId: userMessage.id
        }
      }
    ]);

    try {
      const result = await streamCopilotResponse(
        trimmed,
        activeSessionId ?? undefined,
        (chunk, nextSessionId) => {
          if (nextSessionId) {
            setActiveSessionId((current) => current ?? nextSessionId);
          }
          setToolLabel(null);
          setOptimisticMessages((current) =>
            appendAssistantChunk(current, {
              id: assistantMessageId,
              content: chunk
            })
          );
        },
        (_tool, label, nextSessionId) => {
          if (nextSessionId) {
            setActiveSessionId((current) => current ?? nextSessionId);
          }
          setToolLabel(label);
        },
        (nextSessionId) => {
          setActiveSessionId(nextSessionId);
        }
      );

      const nextSessionId = result.sessionId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.copilotSessions() }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.copilotSession(nextSessionId) })
      ]);
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : 'Copilot request failed');
    } finally {
      setIsStreaming(false);
      setToolLabel(null);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  function handleNewChat() {
    startTransition(() => {
      setActiveSessionId(null);
      setOptimisticMessages([]);
      setDraft('');
      setToolLabel(null);
      setStreamError(null);
    });
  }

  function handleSelectSession(sessionId: string) {
    startTransition(() => {
      setActiveSessionId(sessionId);
      setOptimisticMessages(null);
      setToolLabel(null);
      setStreamError(null);
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-[28px] border border-slate-200/80 bg-white/80 p-4 shadow-panel shadow-slate-900/5 backdrop-blur">
        <div className="space-y-3 rounded-[24px] bg-slate-950 px-4 py-5 text-white">
          <div className="flex items-center gap-2 text-slate-300">
            <Sparkles className="h-4 w-4 text-[#d5a06a]" />
            <span className="eyebrow text-slate-300">Treasury Copilot</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">Atlas</h1>
            <p className="text-sm leading-6 text-slate-300">
              Ask across cash, approvals, FX, risk, investments, debt, and forecasts.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
            <p className="font-medium text-white">{formatUsage(usage)}</p>
            <p className="mt-1 text-xs text-slate-400">Session token usage and estimated model cost.</p>
          </div>
        </div>

        <Button className="w-full justify-center" type="button" onClick={handleNewChat}>
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Button>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Recent Sessions</p>
            <p className="text-xs text-slate-500">{sessionsQuery.data?.length ?? 0}</p>
          </div>
          <div className="space-y-2">
            {sessionsQuery.isLoading
              ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />)
              : sessionsQuery.data?.map((session) => (
                  <SessionListItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onSelect={handleSelectSession}
                  />
                ))}
            {!sessionsQuery.isLoading && !sessionsQuery.data?.length ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                New conversations will appear here once Atlas has stored them.
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="flex min-h-[760px] flex-col overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/80 shadow-panel shadow-slate-900/5 backdrop-blur">
        <div className="border-b border-slate-200/80 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-500">
                <WandSparkles className="h-4 w-4 text-[#b97844]" />
                <span className="eyebrow">Natural Language Treasury Analysis</span>
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                  {activeSession?.title ?? 'Start a new treasury conversation'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Responses cite live treasury data and use read-only tooling only.
                </p>
              </div>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              {activeSession ? `Updated ${formatSessionTimestamp(activeSession.updatedAt)}` : 'No active session yet'}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {sessionQuery.isLoading && activeSessionId ? (
            <div className="space-y-4">
              <Skeleton className="h-20 rounded-3xl" />
              <Skeleton className="ml-auto h-20 w-2/3 rounded-3xl" />
              <Skeleton className="h-48 rounded-3xl" />
            </div>
          ) : displayedMessages.length > 0 ? (
            <div className="space-y-5">
              {displayedMessages.map((message) => (
                <ChatMessage key={message.id} message={message} isStreaming={isStreaming} />
              ))}
              {toolLabel ? <ToolStatus label={toolLabel} /> : null}
              {streamError ? <StreamError message={streamError} /> : null}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[28px] border border-slate-200 bg-[#fbf8f2] p-6">
                <div className="flex items-center gap-3 text-[#a15d32]">
                  <div className="rounded-2xl bg-white p-3 shadow-sm shadow-[#d5b28d]/40">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="eyebrow text-[#a15d32]">Atlas is ready</p>
                    <p className="text-xl font-semibold text-slate-950">Ask a treasury question in plain English</p>
                  </div>
                </div>
                <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600">
                  Atlas can inspect consolidated cash, approval queues, FX rates, risk exposures, liquidity forecasts,
                  account transactions, investments, and debt utilization without initiating any write action.
                </p>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-6">
                <p className="eyebrow">Suggested Prompts</p>
                <div className="mt-4 grid gap-3">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="focus-ring rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white"
                      onClick={() => setDraft(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200/80 bg-[#f8f5ee]/80 px-6 py-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onInput={(event) => syncTextareaHeight(event.currentTarget)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Atlas about cash, approvals, forecasts, risk, investments, or debt..."
              className="min-h-[48px] w-full resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
              rows={1}
              maxLength={8_000}
            />
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 pt-3">
              <p className="text-xs text-slate-500">Enter to send. Shift+Enter for a newline.</p>
              <Button type="button" onClick={() => void handleSubmit()} disabled={isStreaming || !draft.trim()}>
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SessionListItem({
  session,
  isActive,
  onSelect
}: {
  session: CopilotSessionSummary;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={cn(
        'focus-ring w-full rounded-2xl border px-4 py-4 text-left transition',
        isActive
          ? 'border-slate-900 bg-slate-950 text-white'
          : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-white'
      )}
    >
      <p className="line-clamp-2 text-sm font-semibold">{session.title ?? 'Untitled conversation'}</p>
      <p className={cn('mt-2 line-clamp-2 text-xs leading-5', isActive ? 'text-slate-300' : 'text-slate-500')}>
        {session.lastMessagePreview ?? 'No preview available yet.'}
      </p>
      <div className={cn('mt-3 flex items-center justify-between text-[11px]', isActive ? 'text-slate-300' : 'text-slate-500')}>
        <span>{formatSessionTimestamp(session.updatedAt)}</span>
        <span>{formatUsageCompact(session.tokenUsage)}</span>
      </div>
    </button>
  );
}

function ChatMessage({ message, isStreaming }: { message: CopilotMessage; isStreaming: boolean }) {
  const isAssistant = message.role === 'assistant';
  const canCopy = message.content.trim().length > 0;

  return (
    <div className={cn('group flex gap-4', isAssistant ? 'items-start' : 'justify-end')}>
      {isAssistant ? (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <Bot className="h-4 w-4" />
        </div>
      ) : null}
      <div
        className={cn(
          'max-w-[82%] rounded-[28px] border px-5 py-4 shadow-sm shadow-slate-900/5 transition',
          isAssistant
            ? 'border-slate-200 bg-white text-slate-800'
            : 'border-[#1c4fbf] bg-[#1f5fdc] text-white'
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className={cn('text-xs uppercase tracking-[0.18em]', isAssistant ? 'text-slate-400' : 'text-blue-100')}>
            {isAssistant ? 'Atlas' : 'You'}
          </div>
          <button
            type="button"
            disabled={!canCopy}
            className={cn(
              'focus-ring rounded-full p-2 opacity-0 transition group-hover:opacity-100 disabled:cursor-default disabled:opacity-0',
              isAssistant ? 'text-slate-400 hover:bg-slate-100' : 'text-blue-100 hover:bg-white/10'
            )}
            onClick={() => {
              if (canCopy) {
                void navigator.clipboard.writeText(message.content);
              }
            }}
            aria-label="Copy message"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
        {isAssistant ? (
          <div className="mt-3 space-y-4 text-sm leading-7">{renderMarkdown(message.content, isStreaming)}</div>
        ) : (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{message.content}</p>
        )}
        <div className={cn('mt-3 text-xs', isAssistant ? 'text-slate-400' : 'text-blue-100')}>
          {formatMessageTimestamp(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

function ToolStatus({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#efe5d8] text-[#a15d32]">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
      <div className="rounded-[24px] border border-[#e6d2bc] bg-[#fbf5ed] px-5 py-4 text-sm text-[#84512f]">
        {label}
      </div>
    </div>
  );
}

function StreamError({ message }: { message: string }) {
  return (
    <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
      {message}
    </div>
  );
}

function appendAssistantChunk(
  messages: CopilotMessage[] | null,
  chunk: {
    id: string;
    content: string;
  }
) {
  if (!messages || messages.length === 0) {
    return messages;
  }

  const nextMessages = [...messages];
  const lastMessage = nextMessages[nextMessages.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.id !== chunk.id) {
    return messages;
  }

  nextMessages[nextMessages.length - 1] = {
    ...lastMessage,
    content: `${lastMessage.content}${chunk.content}`
  };
  return nextMessages;
}

function syncTextareaHeight(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  element.style.height = '0px';
  const lineHeight = 24;
  const maxHeight = lineHeight * 4;
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
}

function formatMessageTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(new Date(value));
}

function formatSessionTimestamp(value: string) {
  const date = new Date(value);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }
  return formatDate(value);
}

function formatUsage(usage: CopilotTokenUsage) {
  if (Number(usage.estimatedCostUsd) > 0) {
    return `${formatNumber(usage.inputTokens + usage.outputTokens)} tokens • $${Number(usage.estimatedCostUsd).toFixed(4)}`;
  }
  return `${formatNumber(usage.inputTokens + usage.outputTokens)} tokens`;
}

function formatUsageCompact(usage: CopilotTokenUsage) {
  return `${formatNumber(usage.inputTokens + usage.outputTokens)} tok`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(value);
}

function renderMarkdown(content: string, isStreaming: boolean) {
  if (!content.trim()) {
    return isStreaming ? <span className="inline-block h-4 w-3 animate-pulse rounded-full bg-slate-300" /> : null;
  }

  const blocks = parseMarkdownBlocks(content);
  return blocks.map((block, index) => {
    if (block.type === 'paragraph') {
      return <p key={index}>{renderInline(block.text)}</p>;
    }

    if (block.type === 'list') {
      return (
        <ul key={index} className="list-disc space-y-1 pl-5">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }

    if (block.type === 'table') {
      return (
        <div key={index} className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex} className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-700">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-slate-100 last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top text-slate-600">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <pre key={index} className="overflow-x-auto rounded-2xl bg-slate-950 px-4 py-4 text-xs text-slate-100">
        <code>{block.code}</code>
      </pre>
    );
  });
}

function renderInline(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matched = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (matched.startsWith('`')) {
      nodes.push(
        <code key={`${index}:${matched}`} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-800">
          {matched.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(
        <strong key={`${index}:${matched}`} className="font-semibold text-slate-900">
          {matched.slice(2, -2)}
        </strong>
      );
    }

    lastIndex = index + matched.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : text;
}

function parseMarkdownBlocks(content: string) {
  const normalized = content.replace(/\r\n/g, '\n');
  const blocks: Array<
    | { type: 'paragraph'; text: string }
    | { type: 'list'; items: string[] }
    | { type: 'table'; header: string[]; rows: string[][] }
    | { type: 'code'; code: string }
  > = [];

  const lines = normalized.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({
        type: 'code',
        code: codeLines.join('\n')
      });
      continue;
    }

    if (line.startsWith('|') && (lines[index + 1] ?? '').includes('---')) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({
        type: 'table',
        header,
        rows
      });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test((lines[index] ?? '').trim())) {
        items.push((lines[index] ?? '').trim().replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({
        type: 'list',
        items
      });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !(lines[index] ?? '').trim().startsWith('```') &&
      !/^[-*]\s+/.test((lines[index] ?? '').trim()) &&
      !((lines[index] ?? '').trim().startsWith('|') && (lines[index + 1] ?? '').includes('---'))
    ) {
      paragraphLines.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push({
      type: 'paragraph',
      text: paragraphLines.join(' ')
    });
  }

  return blocks;
}

function splitTableRow(row: string) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}
