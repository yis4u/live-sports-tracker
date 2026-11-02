import { databaseConfigured } from "@/lib/db";
import { getAccountState, getCurrentUser } from "@/lib/auth";
import { errorResponse, jsonResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!databaseConfigured())
      return jsonResponse({
        user: null,
        favorites: [],
        notificationsEnabled: false,
        storage: "unconfigured",
      });
    const user = await getCurrentUser(request);
    return jsonResponse(
      user
        ? await getAccountState(user)
        : {
            user: null,
            favorites: [],
            notificationsEnabled: false,
            storage: "postgres",
          },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
