import type { NextRequest } from 'next/server';
import { router } from '@/router/index';

type CatchAllParams = { params: Promise<{ route?: string[] }> };

export async function GET(req: NextRequest, { params }: CatchAllParams) {
  return router.dispatch('GET', (await params).route ?? [], req);
}
export async function POST(req: NextRequest, { params }: CatchAllParams) {
  return router.dispatch('POST', (await params).route ?? [], req);
}
export async function PATCH(req: NextRequest, { params }: CatchAllParams) {
  return router.dispatch('PATCH', (await params).route ?? [], req);
}
export async function DELETE(req: NextRequest, { params }: CatchAllParams) {
  return router.dispatch('DELETE', (await params).route ?? [], req);
}
export async function OPTIONS(req: NextRequest, { params }: CatchAllParams) {
  return router.dispatch('OPTIONS', (await params).route ?? [], req);
}
