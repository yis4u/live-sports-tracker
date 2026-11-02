import { getDatabase } from "@/lib/db";
import {
  createSession,
  getAccountState,
  hashSessionToken,
  loginSchema,
  parseInput,
  verifyPassword,
} from "@/lib/auth";
import {
  ApiError,
  assertSameOrigin,
  consumeRateLimit,
  errorResponse,
  jsonResponse,
  readJson,
} from "@/lib/http";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

// A valid dummy hash makes nonexistent accounts perform the same scrypt operation.
const DUMMY_HASH =
  "scrypt$aa5fd430fe8247669f6574a6578be491$5d1c943b13b5d0c0179bc234924d0f702eb7c0eef046a0625521ac1f9b790f02";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = getDatabase();
    consumeRateLimit("login:global", 60, 60_000);
    const input = parseInput(loginSchema, await readJson(request));
    consumeRateLimit(`login:${hashSessionToken(input.email)}`, 10, 15 * 60_000);
    const result = await db.query<User & { password_hash: string }>(
      "SELECT id, email, name, password_hash FROM users WHERE email = $1",
      [input.email],
    );
    const row = result.rows[0];
    const verified = await verifyPassword(
      input.password,
      row?.password_hash || DUMMY_HASH,
    );
    if (!row || !verified)
      throw new ApiError(401, "Email or password is incorrect.");
    const user: User = { id: row.id, email: row.email, name: row.name };
    const response = jsonResponse(await getAccountState(user));
    await createSession(user.id, response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
