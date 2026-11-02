import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { NextResponse } from "next/server";
import { getDatabase } from "./db";
import { ApiError } from "./http";
import type { AccountState, Favorite, User } from "./types";

const scrypt = promisify(nodeScrypt);
export const SESSION_COOKIE = "scoreboard_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(10).max(128);
export const loginSchema = z
  .object({ email: emailSchema, password: passwordSchema })
  .strict();
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(2).max(60).optional(),
  })
  .strict();
export const favoriteSchema = z
  .object({
    sport: z.enum(["football", "basketball", "baseball"]),
    teamId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/),
  })
  .strict();
export const preferencesSchema = z
  .object({ notificationsEnabled: z.boolean() })
  .strict();

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first.path.join(".");
    const message =
      field === "password"
        ? "Password must contain between 10 and 128 characters."
        : field === "email"
          ? "Enter a valid email address."
          : field === "name"
            ? "Name must contain between 2 and 60 characters."
            : "Check the request fields and try again.";
    throw new ApiError(400, message);
  }
  return result.data;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (
    parts.length !== 3 ||
    parts[0] !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(parts[1]) ||
    !/^[a-f0-9]{64}$/.test(parts[2])
  )
    return false;
  const expected = Buffer.from(parts[2], "hex");
  const actual = (await scrypt(password, parts[1], 32)) as Buffer;
  return timingSafeEqual(expected, actual);
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionTokenFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export async function getCurrentUser(request: Request): Promise<User | null> {
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  const result = await getDatabase().query<User>(
    `SELECT u.id, u.email, u.name FROM users u
     INNER JOIN sessions s ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashSessionToken(token)],
  );
  return result.rows[0] || null;
}

export async function requireUser(request: Request) {
  getDatabase(); // Report missing account configuration consistently.
  const user = await getCurrentUser(request);
  if (!user) throw new ApiError(401, "Sign in to save teams to your profile.");
  return user;
}

export async function getFavorites(userId: string): Promise<Favorite[]> {
  const result = await getDatabase().query<{
    sport: Favorite["sport"];
    team_id: string;
  }>(
    "SELECT sport, team_id FROM favorites WHERE user_id = $1 ORDER BY created_at, team_id",
    [userId],
  );
  return result.rows.map((row) => ({ sport: row.sport, teamId: row.team_id }));
}

export async function getAccountState(user: User): Promise<AccountState> {
  const [favorites, preferences] = await Promise.all([
    getFavorites(user.id),
    getDatabase().query<{ notifications_enabled: boolean }>(
      "SELECT notifications_enabled FROM users WHERE id = $1",
      [user.id],
    ),
  ]);
  return {
    user,
    favorites,
    notificationsEnabled: preferences.rows[0]?.notifications_enabled ?? false,
    storage: "postgres",
  };
}

export async function createSession(userId: string, response: NextResponse) {
  const token = randomBytes(32).toString("base64url");
  const db = getDatabase();
  await db.query(
    "DELETE FROM sessions WHERE user_id = $1 AND expires_at <= NOW()",
    [userId],
  );
  await db.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [
      hashSessionToken(token),
      userId,
      new Date(Date.now() + SESSION_SECONDS * 1000),
    ],
  );
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
