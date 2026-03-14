import type { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/types/context';

export type AppRouteHandler = (request: NextRequest, context: RequestContext) => Promise<NextResponse>;
export type RouteMiddleware = (handler: AppRouteHandler) => AppRouteHandler;
