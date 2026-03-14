import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { NextRequest, type NextResponse } from 'next/server';

export type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type RouteHandler = (...args: [NextRequest, { params: Promise<Record<string, string>> }?]) => Promise<NextResponse>;

export interface RouteDefinition {
  method: RouteMethod;
  pattern: string;
  handler: RouteHandler;
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (const [index, part] of patternParts.entries()) {
    const current = pathParts[index];
    if (!current) {
      return null;
    }

    if (part.startsWith(':')) {
      params[part.slice(1)] = current;
      continue;
    }

    if (part !== current) {
      return null;
    }
  }

  return params;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createRouteTestClient(routes: RouteDefinition[]) {
  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      res.statusCode = 500;
      res.end('Invalid test request');
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const route = routes.find((candidate) => candidate.method === req.method && matchPattern(candidate.pattern, url.pathname));

    if (!route) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const body = await readBody(req);
    const params = matchPattern(route.pattern, url.pathname) ?? {};
    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => headers.append(key, entry));
        return;
      }
      if (value !== undefined) {
        headers.set(key, value);
      }
    });

    const requestInit: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {
      method: req.method,
      headers
    };

    if (body.length > 0 && req.method !== 'GET' && req.method !== 'HEAD') {
      requestInit.body = body;
    }

    const nextRequest = new NextRequest(url, requestInit);
    const response = await route.handler(nextRequest, { params: Promise.resolve(params) });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const payload = Buffer.from(await response.arrayBuffer());
    res.end(payload);
  });

  return {
    request: request(server),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (!error || error.message.includes('Server is not running')) {
            resolve();
            return;
          }

          reject(error);
        })
      ),
    address: () => server.address() as AddressInfo | null
  };
}
