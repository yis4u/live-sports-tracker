import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db";
import {
  createSession,
  getAccountState,
  hashPassword,
  hashSessionToken,
  parseInput,
  registerSchema,
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

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = getDatabase();
    consumeRateLimit("register:global", 30, 60_000);
    const input = parseInput(registerSchema, await readJson(request));
    consumeRateLimit(
      `register:${hashSessionToken(input.email)}`,
      5,
      15 * 60_000,
    );
    const passwordHash = await hashPassword(input.password);
    const user = {
      id: randomUUID(),
      email: input.email,
      name: input.name || input.email.split("@")[0].slice(0, 60),
    };
    try {
      await db.query<User>(
        "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)",
        [user.id, user.email, user.name, passwordHash],
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new ApiError(
          409,
          "An account already exists for this email. Try signing in.",
        );
      }
      throw error;
    }
    const response = jsonResponse(await getAccountState(user), 201);
    await createSession(user.id, response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
