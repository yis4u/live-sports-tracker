import test from "node:test";
import assert from "node:assert/strict";
import { demoDashboard } from "../lib/demo";
import {
  DashboardInputError,
  getDashboardData,
  SportsProviderError,
  validateDashboardQuery,
} from "../lib/sports";
import type { Sport } from "../lib/types";
import { GET } from "../app/api/dashboard/route";

const fixedNow = () => new Date("2026-11-02T12:30:00.000Z");
const apiTeam = (id: number, name: string) => ({ id, name });
const league = { id: 39, name: "Example league" };
const footballFixture = {
  fixture: {
    id: 500,
    date: "2026-11-02T12:00:00Z",
    status: { short: "2H", elapsed: 67 },
    venue: { name: "Example ground" },
  },
  league,
  teams: { home: apiTeam(1, "Home"), away: apiTeam(2, "Away") },
  goals: { home: 2, away: 1 },
};
const footballStandings = [
  {
    league: {
      ...league,
      standings: [
        [
          {
            rank: 1,
            team: apiTeam(1, "Home"),
            points: 25,
            form: "WWDLW",
            all: { played: 10, win: 8, draw: 1, lose: 1 },
          },
        ],
      ],
    },
  },
];
const footballPlayers = [
  {
    player: { id: 90, name: "Test scorer" },
    statistics: [
      {
        team: apiTeam(1, "Home"),
        games: { position: "Attacker" },
        goals: { total: 8, assists: 3 },
      },
    ],
  },
];

function json(response: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ errors: [], response, paging: { current: 1, total: 1 } }),
    { status, headers: { "content-type": "application/json" } },
  );
}
function environment(sport: Sport, key: string) {
  return {
    API_SPORTS_KEY: key,
    [`${sport.toUpperCase()}_LEAGUE_ID`]: "39",
    [`${sport.toUpperCase()}_SEASON`]: "2026",
  };
}
function mockFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    handler(
      new URL(input instanceof Request ? input.url : input.toString()),
      init,
    )) as typeof fetch;
}

test("dashboard query validates sport and real calendar dates, with UTC defaults", () => {
  assert.deepEqual(validateDashboardQuery(null, null, fixedNow()), {
    sport: "football",
    date: "2026-11-02",
  });
  assert.deepEqual(validateDashboardQuery("baseball", "2028-02-29"), {
    sport: "baseball",
    date: "2028-02-29",
  });
  for (const [sport, date] of [
    ["hockey", "2026-11-02"],
    ["football", "2026-02-29"],
    ["basketball", "2026-13-01"],
    ["baseball", "2026-1-2"],
    ["football", ""],
  ]) {
    assert.throws(
      () => validateDashboardQuery(sport, date),
      DashboardInputError,
    );
  }
});

test("each demo is deterministic and explicitly fictional, with complete dashboard relationships", async () => {
  for (const sport of ["football", "basketball", "baseball"] as Sport[]) {
    const data = await getDashboardData(sport, "2026-11-02", {
      env: {},
      now: fixedNow,
      fetch: mockFetch(() => {
        throw new Error("Demo must not fetch");
      }),
    });
    assert.deepEqual(data, demoDashboard(sport, "2026-11-02", fixedNow()));
    assert.equal(data.mode, "demo");
    assert.match(data.notice ?? "", /fictional/);
    assert.equal(data.matches.length, 6);
    assert.equal(data.players.length, 6);
    const ids = new Set(data.teams.map((team) => team.id));
    for (const match of data.matches) {
      assert.ok(ids.has(match.home.id) && ids.has(match.away.id));
      assert.ok(match.startsAt.startsWith(data.date));
      if (["upcoming", "postponed"].includes(match.status))
        assert.equal(match.homeScore, null);
    }
    assert.deepEqual(
      new Set(data.matches.map((match) => match.status)),
      new Set(["live", "finished", "upcoming", "postponed"]),
    );
    assert.ok(
      data.standings.every(
        (standing) =>
          standing.won + standing.lost + (standing.drawn ?? 0) ===
          standing.played,
      ),
    );
    assert.ok(
      data.standings.every(
        (standing) =>
          standing.won >= 0 && standing.lost >= 0 && (standing.drawn ?? 0) >= 0,
      ),
    );
  }
});

test("live football normalizes fixtures, standings and scorer data, caches calls and keeps key server-side", async () => {
  let requests = 0;
  const key = "football-success-secret";
  const fetcher = mockFetch((url, init) => {
    requests++;
    assert.equal(url.hostname, "v3.football.api-sports.io");
    assert.equal(url.searchParams.get("league"), "39");
    assert.equal(
      (init?.headers as Record<string, string>)["x-apisports-key"],
      key,
    );
    assert.ok(init?.signal);
    if (url.pathname === "/fixtures") {
      assert.equal(url.searchParams.get("date"), "2026-11-02");
      assert.equal(url.searchParams.get("timezone"), "UTC");
      return json([footballFixture]);
    }
    if (url.pathname === "/standings") return json(footballStandings);
    assert.equal(url.pathname, "/players/topscorers");
    return json(footballPlayers);
  });
  const deps = {
    env: environment("football", key),
    fetch: fetcher,
    now: fixedNow,
  };
  const data = await getDashboardData("football", "2026-11-02", deps);
  assert.equal(data.mode, "live");
  assert.equal(data.matches[0].status, "live");
  assert.equal(data.matches[0].clock, "67′");
  assert.equal(data.standings[0].points, 25);
  assert.equal(data.players[0].primary.value, "8");
  assert.equal(data.players[0].secondary.value, "3");
  assert.equal(data.teams.length, 2);
  assert.ok(!JSON.stringify(data).includes(key));
  await getDashboardData("football", "2026-11-02", deps);
  assert.equal(requests, 3);
});

test("basketball and baseball normalize grouped standings without sample player statistics", async () => {
  for (const sport of ["basketball", "baseball"] as Sport[]) {
    const endpoints: string[] = [];
    const data = await getDashboardData(sport, "2026-11-02", {
      env: environment(sport, `${sport}-success-key`),
      now: fixedNow,
      fetch: mockFetch((url) => {
        endpoints.push(url.pathname);
        assert.equal(url.hostname, `v1.${sport}.api-sports.io`);
        if (url.pathname === "/games")
          return json([
            {
              id: 501,
              date: "2026-11-02T12:00:00Z",
              status: { short: "FT", long: "Finished" },
              league,
              teams: { home: apiTeam(1, "Home"), away: apiTeam(2, "Away") },
              scores: {
                home: { total: sport === "basketball" ? 100 : 4 },
                away: { total: sport === "basketball" ? 92 : 2 },
              },
            },
          ]);
        return json([
          [
            {
              position: 1,
              league,
              team: apiTeam(1, "Home"),
              games: { played: 10, win: { total: 8 }, lose: { total: 2 } },
            },
          ],
        ]);
      }),
    });
    assert.equal(data.mode, "live");
    assert.equal(data.matches[0].status, "finished");
    assert.equal(data.standings[0].percentage, "0.800");
    assert.equal(data.standings[0].drawn, null);
    assert.deepEqual(data.players, []);
    assert.match(
      data.notice ?? "",
      /Live player statistics are not integrated/,
    );
    assert.deepEqual(endpoints.sort(), ["/games", "/standings"]);
  }
});

test("missing live configuration fails visibly without falling back to demo", async () => {
  await assert.rejects(
    getDashboardData("football", "2026-11-02", {
      env: { API_SPORTS_KEY: "configured" },
    }),
    /FOOTBALL_LEAGUE_ID/,
  );
});

test("football standings preserve stage, conference, division and group labels without inventing an overall rank", async () => {
  const first = {
    rank: 1,
    team: apiTeam(1, "Home"),
    points: 25,
    all: { played: 10, win: 8, draw: 1, lose: 1 },
    stage: "Championship",
    conference: { name: "East" },
    division: "Atlantic",
    group: { name: "Group A" },
  };
  const second = {
    ...first,
    stage: { name: "Consolation" },
    conference: "West",
    division: { name: "Pacific" },
    group: "Group B",
  };
  const data = await getDashboardData("football", "2026-11-02", {
    env: environment("football", "grouped-football-key"),
    now: fixedNow,
    fetch: mockFetch((url) =>
      json(
        url.pathname === "/standings"
          ? [{ league: { ...league, standings: [[first, first], [second]] } }]
          : [],
      ),
    ),
  });
  assert.deepEqual(
    data.standings.map((row) => row.group),
    [
      "Championship · East · Atlantic · Group A",
      "Consolation · West · Pacific · Group B",
    ],
  );
  assert.deepEqual(
    data.standings.map((row) => row.rank),
    [1, 1],
  );
  assert.equal(
    data.standings[0].team.id,
    data.standings[1].team.id,
    "a team remains visible in each distinct stage/group",
  );
  assert.equal(
    data.standings.length,
    2,
    "only duplicate team entries within the same group are removed",
  );
  assert.match(data.notice ?? "", /no overall ranking across groups/);
});

test("basketball grouped standings retain provider order and repeat ranks within conferences", async () => {
  const standing = {
    position: 1,
    league,
    team: apiTeam(1, "Home"),
    games: { played: 10, win: { total: 8 }, lose: { total: 2 } },
  };
  const data = await getDashboardData("basketball", "2026-11-02", {
    env: environment("basketball", "grouped-basketball-key"),
    now: fixedNow,
    fetch: mockFetch((url) =>
      json(
        url.pathname === "/standings"
          ? [
              [{ ...standing, group: "Western Conference" }],
              [
                {
                  ...standing,
                  team: apiTeam(2, "Away"),
                  group: { name: "Eastern Conference" },
                },
              ],
            ]
          : [],
      ),
    ),
  });
  assert.deepEqual(
    data.standings.map((row) => [row.group, row.rank]),
    [
      ["Western Conference", 1],
      ["Eastern Conference", 1],
    ],
  );
  assert.match(data.notice ?? "", /within each provider group/);
});

test("separate unlabeled provider groups remain distinct and disclose unavailable labels", async () => {
  const standing = {
    position: 1,
    league,
    team: apiTeam(1, "Home"),
    games: { played: 10, win: { total: 8 }, lose: { total: 2 } },
  };
  const data = await getDashboardData("baseball", "2026-11-02", {
    env: environment("baseball", "unlabeled-baseball-key"),
    now: fixedNow,
    fetch: mockFetch((url) =>
      json(url.pathname === "/standings" ? [[standing], [standing]] : []),
    ),
  });
  assert.deepEqual(
    data.standings.map((row) => row.group),
    [
      "Group 1 (provider label unavailable)",
      "Group 2 (provider label unavailable)",
    ],
  );
  assert.match(data.notice ?? "", /no overall ranking/);
});

test("upstream quota, validation and response failures never silently return demo", async () => {
  const responses: [string, () => Response][] = [
    ["quota", () => new Response("", { status: 429 })],
    ["permission", () => new Response("", { status: 403 })],
    [
      "provider-error",
      () =>
        Response.json({
          errors: { token: "private-provider-detail" },
          response: [],
        }),
    ],
    ["bad-shape", () => Response.json({ errors: [], response: {} })],
    ["bad-json", () => new Response("unexpected")],
    [
      "pagination",
      () => Response.json({ errors: [], response: [], paging: { total: 2 } }),
    ],
  ];
  for (const [label, response] of responses) {
    await assert.rejects(
      getDashboardData("football", "2026-11-02", {
        env: environment("football", label),
        fetch: mockFetch(response),
        now: fixedNow,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SportsProviderError);
        assert.ok(!error.message.includes("private-provider-detail"));
        return true;
      },
    );
  }
  await assert.rejects(
    getDashboardData("baseball", "2026-11-02", {
      env: environment("baseball", "network-failure"),
      fetch: mockFetch(() => {
        throw new TypeError("network failed");
      }),
      now: fixedNow,
    }),
    /could not be reached/,
  );
});

test("malformed fixtures fail instead of inventing scores or statuses", async () => {
  for (const [index, fixture] of [
    { ...footballFixture, goals: { home: null, away: 1 } },
    { ...footballFixture, goals: { home: -1, away: 1 } },
    {
      ...footballFixture,
      fixture: { ...footballFixture.fixture, status: { short: "UNKNOWN" } },
    },
    {
      ...footballFixture,
      fixture: { ...footballFixture.fixture, date: "invalid" },
    },
  ].entries()) {
    await assert.rejects(
      getDashboardData("football", "2026-11-02", {
        env: environment("football", `malformed-${index}`),
        now: fixedNow,
        fetch: mockFetch((url) =>
          json(
            url.pathname === "/fixtures"
              ? [fixture]
              : url.pathname === "/standings"
                ? footballStandings
                : footballPlayers,
          ),
        ),
      }),
      SportsProviderError,
    );
  }
});

test("dashboard route rejects invalid query values and duplicates with 400", async () => {
  for (const query of [
    "sport=hockey",
    "date=2026-02-30",
    "sport=football&sport=basketball",
    "date=2026-11-02&date=2026-11-03",
  ]) {
    const response = await GET(
      new Request(`https://example.test/api/dashboard?${query}`),
    );
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("live route rate limit is shared per server and returns Retry-After without blocking demo", async () => {
  const names = [
    "API_SPORTS_KEY",
    "FOOTBALL_LEAGUE_ID",
    "FOOTBALL_SEASON",
  ] as const;
  const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    process.env.API_SPORTS_KEY = "route-limiter-test";
    delete process.env.FOOTBALL_LEAGUE_ID;
    delete process.env.FOOTBALL_SEASON;
    for (let index = 0; index < 30; index++) {
      const response = await GET(
        new Request(
          "https://example.test/api/dashboard?sport=football&date=2026-11-02",
        ),
      );
      assert.equal(
        response.status,
        502,
        "configuration fails without making an upstream request",
      );
    }
    const limited = await GET(
      new Request(
        "https://example.test/api/dashboard?sport=basketball&date=2026-11-02",
      ),
    );
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.match((await limited.json()).error, /refresh limit/);
    delete process.env.API_SPORTS_KEY;
    const demo = await GET(
      new Request(
        "https://example.test/api/dashboard?sport=baseball&date=2026-11-02",
      ),
    );
    assert.equal(demo.status, 200);
    assert.equal((await demo.json()).mode, "demo");
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});
