import { parseInput, preferencesSchema, requireUser } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import {
  assertSameOrigin,
  consumeRateLimit,
  errorResponse,
  jsonResponse,
  readJson,
} from "@/lib/http";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    consumeRateLimit(`preferences:${user.id}`, 30, 60_000);
    const input = parseInput(preferencesSchema, await readJson(request));
    await getDatabase().query(
      "UPDATE users SET notifications_enabled = $2 WHERE id = $1",
      [user.id, input.notificationsEnabled],
    );
    return jsonResponse(input);
  } catch (error) {
    return errorResponse(error);
  }
}
