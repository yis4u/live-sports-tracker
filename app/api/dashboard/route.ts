import {
  DashboardInputError,
  getDashboardData,
  SportsProviderError,
  validateDashboardQuery,
} from "@/lib/sports";
import { ApiError, consumeRateLimit } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    for (const name of ["sport", "date"]) {
      if (url.searchParams.getAll(name).length > 1)
        throw new DashboardInputError(`Provide only one ${name}.`);
    }
    const query = validateDashboardQuery(
      url.searchParams.get("sport"),
      url.searchParams.get("date"),
    );
    if (process.env.API_SPORTS_KEY?.trim())
      consumeRateLimit("dashboard:live", 30, 60_000);
    const data = await getDashboardData(query.sport, query.date);
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof DashboardInputError)
      return Response.json(
        { error: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    if (error instanceof ApiError && error.status === 429)
      return Response.json(
        {
          error:
            "Live dashboard refresh limit reached for this server. Please wait one minute and try again.",
        },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": "60" },
        },
      );
    if (error instanceof SportsProviderError)
      return Response.json(
        { error: error.message },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    console.error("Dashboard request failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return Response.json(
      { error: "The sports dashboard is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
