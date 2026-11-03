import { demoDashboard } from "../lib/demo";

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/** Local data adapter for GitHub Pages. It never makes a network request. */
export const pagesFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const signal = init?.signal ?? request?.signal;
  if (signal?.aborted)
    throw new DOMException("The request was aborted.", "AbortError");
  let url: URL;
  try {
    url = new URL(
      request?.url ?? String(input),
      "https://sideline-pages.invalid",
    );
  } catch {
    return json({ error: "This request could not be read." }, 400);
  }
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  if (url.pathname === "/api/dashboard") {
    if (method !== "GET")
      return json({ error: "This request method is not supported." }, 405, {
        Allow: "GET",
      });
    for (const name of ["sport", "date"]) {
      if (url.searchParams.getAll(name).length > 1)
        return json({ error: `Provide only one ${name}.` }, 400);
    }
    const sport = url.searchParams.get("sport") ?? "football";
    if (sport !== "football" && sport !== "basketball" && sport !== "baseball")
      return json({ error: "Choose football, basketball or baseball." }, 400);
    const date =
      url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const calendarDate = new Date(`${date}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(calendarDate.valueOf()) ||
      calendarDate.toISOString().slice(0, 10) !== date
    )
      return json(
        { error: "Choose a valid calendar date in YYYY-MM-DD format." },
        400,
      );
    return json(demoDashboard(sport, date));
  }
  if (url.pathname === "/api/auth/me") {
    if (method !== "GET")
      return json({ error: "This request method is not supported." }, 405, {
        Allow: "GET",
      });
    return json({
      user: null,
      favorites: [],
      notificationsEnabled: false,
      storage: "unconfigured",
    });
  }
  const accountMethods: Record<string, string[]> = {
    "/api/auth/register": ["POST"],
    "/api/auth/login": ["POST"],
    "/api/auth/logout": ["POST"],
    "/api/favorites": ["POST", "DELETE"],
    "/api/preferences": ["PATCH"],
  };
  const allowed = accountMethods[url.pathname];
  if (allowed) {
    if (!allowed.includes(method))
      return json({ error: "This request method is not supported." }, 405, {
        Allow: allowed.join(", "),
      });
    return json(
      {
        error:
          "Profiles are unavailable on this demo. You can still save favorite teams on this device.",
      },
      503,
    );
  }
  return json({ error: "This request could not be found." }, 404);
};
