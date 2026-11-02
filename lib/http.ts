import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.APP_ORIGIN || new URL(request.url).origin;
  // JSON mutation requests from browsers include Origin. Reject absent origins too,
  // so scripts must explicitly send the expected application origin.
  if (
    !origin ||
    origin !== expectedOrigin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new ApiError(403, "This request must come from this application.");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new ApiError(415, "Send this request as application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 16_384) {
    throw new ApiError(413, "Request body is too large.");
  }
  if (!request.body)
    throw new ApiError(400, "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16_384) {
        await reader.cancel();
        throw new ApiError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Request body must contain valid JSON.");
  } finally {
    reader.releaseLock();
  }
}

type Bucket = { count: number; expiresAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/** A bounded, process-local guard. Use a shared gateway limiter when scaling. */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const existing = buckets.get(key);
  if (existing && existing.expiresAt > now) {
    if (existing.count >= limit)
      throw new ApiError(429, "Too many requests. Please try again later.");
    existing.count += 1;
    return;
  }
  if (buckets.size >= MAX_BUCKETS) {
    for (const [bucketKey, value] of buckets) {
      if (value.expiresAt <= now) buckets.delete(bucketKey);
    }
    if (buckets.size >= MAX_BUCKETS) {
      throw new ApiError(429, "Too many requests. Please try again later.");
    }
  }
  buckets.set(key, { count: 1, expiresAt: now + windowMs });
}

export function jsonResponse(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    const response = jsonResponse({ error: error.message }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
  // Do not leak database URLs, SQL statements, provider messages, or stack traces.
  return jsonResponse(
    {
      error:
        "The account service is temporarily unavailable. Please try again later.",
    },
    503,
  );
}
