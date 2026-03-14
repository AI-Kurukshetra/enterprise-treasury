import { NextRequest, type NextResponse } from 'next/server';

type ResponsePayload = {
  response: NextResponse;
  status: number;
  headers: Headers;
  json: InspectableJson;
};

// Test helpers need deep property traversal for response assertions without using `any`.
type InspectableJson = {
  data: InspectableJson;
  meta: InspectableJson;
  error: InspectableJson;
  items: InspectableJson;
  requestId: InspectableJson;
  code: InspectableJson;
  id: InspectableJson;
  status: InspectableJson;
  paymentReference: InspectableJson;
  dedupe_hash: InspectableJson;
  current_balance: InspectableJson;
  forecast_type: InspectableJson;
  name: InspectableJson;
  instrument_type: InspectableJson;
  instrument_name: InspectableJson;
  reconciliation_status: InspectableJson;
  0: InspectableJson;
  [key: string]: InspectableJson;
};

type BaseRouteInput = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
};

function toRequestBody(body: unknown): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body as BodyInit;
  }

  return JSON.stringify(body);
}

type RouteContext<TParams extends Record<string, string>> = {
  params: Promise<TParams>;
};

type RouteHandlerWithoutParams = (request: NextRequest) => Promise<NextResponse>;
type RouteHandlerWithParams<TParams extends Record<string, string>> = (
  request: NextRequest,
  context: RouteContext<TParams>
) => Promise<NextResponse>;

export async function invokeRoute(
  handler: RouteHandlerWithoutParams,
  input: BaseRouteInput & { params?: undefined }
): Promise<ResponsePayload>;
export async function invokeRoute<TParams extends Record<string, string>>(
  handler: RouteHandlerWithParams<TParams>,
  input: BaseRouteInput & { params: TParams }
): Promise<ResponsePayload>;
export async function invokeRoute<TParams extends Record<string, string>>(
  handler: RouteHandlerWithoutParams | RouteHandlerWithParams<TParams>,
  input: BaseRouteInput & { params?: TParams }
): Promise<ResponsePayload> {
  const request = new NextRequest(input.url, {
    method: input.method,
    headers: input.headers,
    body: toRequestBody(input.body)
  });

  const response = input.params
    ? await (handler as RouteHandlerWithParams<TParams>)(request, {
        params: Promise.resolve(input.params)
      })
    : await (handler as RouteHandlerWithoutParams)(request);
  const payloadText = await response.text();

  return {
    response,
    status: response.status,
    headers: response.headers,
    json: (payloadText.length > 0 ? JSON.parse(payloadText) : null) as InspectableJson
  };
}
