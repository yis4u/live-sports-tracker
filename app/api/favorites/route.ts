import {
  favoriteSchema,
  getFavorites,
  parseInput,
  requireUser,
} from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import {
  ApiError,
  assertSameOrigin,
  consumeRateLimit,
  errorResponse,
  jsonResponse,
  readJson,
} from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    consumeRateLimit(`favorite:${user.id}`, 60, 60_000);
    const input = parseInput(favoriteSchema, await readJson(request));
    const db = getDatabase();
    // Lock the user row so the cap remains enforced across concurrent requests.
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
        user.id,
      ]);
      const count = await client.query<{
        count: string;
        already_saved: boolean;
      }>(
        `SELECT COUNT(*) AS count,
         EXISTS(SELECT 1 FROM favorites WHERE user_id = $1 AND sport = $2 AND team_id = $3) AS already_saved
         FROM favorites WHERE user_id = $1`,
        [user.id, input.sport, input.teamId],
      );
      if (Number(count.rows[0].count) >= 100 && !count.rows[0].already_saved)
        throw new ApiError(
          400,
          "You can save up to 100 teams. Remove a team before adding another.",
        );
      await client.query(
        "INSERT INTO favorites (user_id, sport, team_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [user.id, input.sport, input.teamId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return jsonResponse({ favorites: await getFavorites(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    consumeRateLimit(`favorite:${user.id}`, 60, 60_000);
    const search = new URL(request.url).searchParams;
    const input = parseInput(favoriteSchema, {
      sport: search.get("sport"),
      teamId: search.get("teamId"),
    });
    await getDatabase().query(
      "DELETE FROM favorites WHERE user_id = $1 AND sport = $2 AND team_id = $3",
      [user.id, input.sport, input.teamId],
    );
    return jsonResponse({ favorites: await getFavorites(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
