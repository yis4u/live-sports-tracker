import {
  clearSessionCookie,
  hashSessionToken,
  sessionTokenFromRequest,
} from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { assertSameOrigin, errorResponse, jsonResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = getDatabase();
    const token = sessionTokenFromRequest(request);
    if (token)
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [
        hashSessionToken(token),
      ]);
    const response = jsonResponse({ success: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
