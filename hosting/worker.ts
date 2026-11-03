import {
  DashboardInputError,
  getDashboardData,
  SportsProviderError,
  validateDashboardQuery,
} from "../lib/sports";

export type HostedAssets = {
  javascript: string;
  stylesheet: string;
  icon: string;
};
export type HostedEnvironment = Record<string, string | undefined>;

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Follow football, basketball and baseball in Sideline, your multi-sport match center."><meta name="theme-color" content="#1b2a28"><title>Sideline · Live Sports Tracker</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/app.css"></head>
<body><div id="app"></div><noscript><main><h1>Sideline · Live Sports Tracker</h1><p>Enable JavaScript to explore scores, standings, players and your favorite teams.</p></main></noscript><script type="module" src="/assets/app.js"></script></body></html>`;

function response(
  body: BodyInit | null,
  status: number,
  type: string,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      ...securityHeaders,
      "Content-Type": type,
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return response(
    JSON.stringify(body),
    status,
    "application/json; charset=utf-8",
    headers,
  );
}

function methodNotAllowed(allow: string) {
  return json({ error: "This request method is not supported." }, 405, {
    Allow: allow,
  });
}

/** The hosted adapter serves the same dashboard as the original Next.js app. */
export function createWorker(assets: HostedAssets) {
  let rateWindow = 0;
  let liveRequests = 0;

  async function handle(
    request: Request,
    env: HostedEnvironment,
  ): Promise<Response> {
    const url = new URL(request.url);
    const get = request.method === "GET" || request.method === "HEAD";
    const staticHeaders = {
      "Cache-Control": "public, max-age=0, must-revalidate",
    };

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return get
        ? response(html, 200, "text/html; charset=utf-8", staticHeaders)
        : methodNotAllowed("GET, HEAD");
    }
    const asset =
      url.pathname === "/assets/app.js"
        ? { body: assets.javascript, type: "text/javascript; charset=utf-8" }
        : url.pathname === "/assets/app.css"
          ? { body: assets.stylesheet, type: "text/css; charset=utf-8" }
          : url.pathname === "/icon.svg"
            ? { body: assets.icon, type: "image/svg+xml; charset=utf-8" }
            : null;
    if (asset)
      return get
        ? response(asset.body, 200, asset.type, staticHeaders)
        : methodNotAllowed("GET, HEAD");

    if (url.pathname === "/api/dashboard") {
      if (!get) return methodNotAllowed("GET, HEAD");
      try {
        for (const name of ["sport", "date"]) {
          if (url.searchParams.getAll(name).length > 1)
            throw new DashboardInputError(`Provide only one ${name}.`);
        }
        const query = validateDashboardQuery(
          url.searchParams.get("sport"),
          url.searchParams.get("date"),
        );
        if (env.API_SPORTS_KEY?.trim()) {
          const now = Date.now();
          if (now >= rateWindow + 60_000) {
            rateWindow = now;
            liveRequests = 0;
          }
          if (liveRequests >= 30)
            return json(
              {
                error:
                  "Live dashboard refresh limit reached. Please wait one minute and try again.",
              },
              429,
              { "Retry-After": "60" },
            );
          liveRequests += 1;
        }
        return json(await getDashboardData(query.sport, query.date, { env }));
      } catch (error) {
        if (error instanceof DashboardInputError)
          return json({ error: error.message }, 400);
        if (error instanceof SportsProviderError)
          return json({ error: error.message }, 502);
        return json(
          { error: "The sports dashboard is temporarily unavailable." },
          502,
        );
      }
    }

    if (url.pathname === "/api/auth/me") {
      return get
        ? json({
            user: null,
            favorites: [],
            notificationsEnabled: false,
            storage: "unconfigured",
          })
        : methodNotAllowed("GET, HEAD");
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
      if (!allowed.includes(request.method))
        return methodNotAllowed(allowed.join(", "));
      if (
        request.headers.get("origin") !== url.origin ||
        request.headers.get("sec-fetch-site") === "cross-site"
      ) {
        return json(
          { error: "This request must come from this application." },
          403,
        );
      }
      return json(
        {
          error:
            "Profiles are unavailable on this version. You can still save favorite teams on this device.",
        },
        503,
      );
    }

    return json({ error: "This page could not be found." }, 404);
  }

  return {
    async fetch(
      request: Request,
      env: HostedEnvironment = {},
    ): Promise<Response> {
      const result = await handle(request, env);
      return request.method === "HEAD"
        ? new Response(null, { status: result.status, headers: result.headers })
        : result;
    },
  };
}
