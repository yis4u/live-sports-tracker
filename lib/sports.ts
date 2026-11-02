import { createHash } from "node:crypto";
import { demoDashboard } from "./demo";
import type {
  DashboardData,
  Match,
  Player,
  Sport,
  Standing,
  Team,
} from "./types";

type RecordValue = Record<string, unknown>;
type Environment = Record<string, string | undefined>;
type Dependencies = {
  env?: Environment;
  fetch?: typeof fetch;
  now?: () => Date;
};
type ProviderConfig = {
  sport: Sport;
  host: string;
  league: string;
  season: string;
  key: string;
};

export class DashboardInputError extends Error {}
export class SportsProviderError extends Error {}
const sports: Sport[] = ["football", "basketball", "baseball"];
const cache = new Map<string, { expiresAt: number; data: DashboardData }>();
const pending = new Map<string, Promise<DashboardData>>();
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 96;

export function validateDashboardQuery(
  sport: string | null,
  date: string | null,
  today = new Date(),
): { sport: Sport; date: string } {
  const chosenSport = sport ?? "football";
  const chosenDate = date ?? today.toISOString().slice(0, 10);
  if (!sports.includes(chosenSport as Sport))
    throw new DashboardInputError("Choose football, basketball or baseball.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenDate))
    throw new DashboardInputError("Date must use YYYY-MM-DD.");
  const parsed = new Date(`${chosenDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== chosenDate
  )
    throw new DashboardInputError("Choose a valid calendar date.");
  return { sport: chosenSport as Sport, date: chosenDate };
}

function record(value: unknown, context: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SportsProviderError(`Sports API returned an invalid ${context}.`);
  return value as RecordValue;
}
function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}
function requiredNumber(value: unknown, context: string): number {
  const parsed = number(value);
  if (parsed === null || parsed < 0)
    throw new SportsProviderError(`Sports API returned an invalid ${context}.`);
  return parsed;
}
function nested(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function team(value: unknown, sport: Sport): Team {
  const data = record(value, "team");
  const id = number(data.id);
  const name = string(data.name).trim();
  if (id === null || !Number.isInteger(id) || id <= 0 || !name)
    throw new SportsProviderError("Sports API returned an incomplete team.");
  return {
    id: `${sport}:${id}`,
    name,
    shortName:
      string(data.code) ||
      name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 3)
        .toUpperCase(),
    color: ["#d7f56b", "#9d9bff", "#75d7d0", "#ffb078", "#ec9dcc"][id % 5],
  };
}
function config(sport: Sport, env: Environment): ProviderConfig {
  const prefix = sport.toUpperCase();
  const league = env[`${prefix}_LEAGUE_ID`]?.trim();
  const season = env[`${prefix}_SEASON`]?.trim();
  if (
    !league ||
    !/^\d+$/.test(league) ||
    Number(league) <= 0 ||
    !season ||
    !/^\d{4}(?:-\d{4})?$/.test(season)
  ) {
    throw new SportsProviderError(
      `Configure ${prefix}_LEAGUE_ID and ${prefix}_SEASON for real ${sport} data. Use a league and season included in your API-Sports subscription.`,
    );
  }
  return {
    sport,
    host:
      sport === "football"
        ? "v3.football.api-sports.io"
        : `v1.${sport}.api-sports.io`,
    league,
    season,
    key: env.API_SPORTS_KEY!.trim(),
  };
}

async function request(
  config: ProviderConfig,
  endpoint: string,
  params: Record<string, string>,
  fetcher: typeof fetch,
): Promise<unknown[]> {
  const url = new URL(`https://${config.host}/${endpoint}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { "x-apisports-key": config.key, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new SportsProviderError(
      "Sports API could not be reached. Please try again shortly.",
    );
  }
  if (response.status === 429)
    throw new SportsProviderError(
      "Sports API request allowance reached. Wait before refreshing or review your subscription.",
    );
  if (response.status === 401 || response.status === 403)
    throw new SportsProviderError(
      "Sports API access was denied. Check the server API key and subscription.",
    );
  if (!response.ok)
    throw new SportsProviderError(
      "Sports API is temporarily unavailable. Please try again shortly.",
    );
  let data: RecordValue;
  try {
    data = record(await response.json(), "response");
  } catch {
    throw new SportsProviderError(
      "Sports API returned an unreadable response.",
    );
  }
  const errors = data.errors;
  if (
    errors &&
    (Array.isArray(errors)
      ? errors.length > 0
      : typeof errors === "object"
        ? Object.keys(errors).length > 0
        : Boolean(errors))
  ) {
    // Provider messages are intentionally withheld: some providers echo request details.
    throw new SportsProviderError(
      "Sports API rejected the request. Check your league, season, API key and subscription allowance.",
    );
  }
  if (!Array.isArray(data.response))
    throw new SportsProviderError(
      "Sports API returned an invalid response list.",
    );
  const paging = nested(data.paging);
  if ((number(paging.total) ?? 1) > 1)
    throw new SportsProviderError(
      "Sports API returned multiple result pages. Select a narrower league/season to avoid showing incomplete data.",
    );
  return data.response;
}

function matchStatus(value: unknown, sport: Sport): Match["status"] {
  const code = string(value).toUpperCase();
  if (
    [
      "PST",
      "POST",
      "CANC",
      "ABD",
      "AWD",
      "WO",
      "CANCELL",
      "INT",
      "SUSP",
    ].includes(code)
  )
    return "postponed";
  if (["FT", "AET", "PEN", "AOT", "AP", "F", "FINAL", "OVER"].includes(code))
    return "finished";
  if (["NS", "TBD", "NOT STARTED"].includes(code)) return "upcoming";
  const liveCodes =
    sport === "football"
      ? ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "LIVE"]
      : sport === "basketball"
        ? ["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT", "LIVE"]
        : [
            "IN1",
            "IN2",
            "IN3",
            "IN4",
            "IN5",
            "IN6",
            "IN7",
            "IN8",
            "IN9",
            "IN10",
            "IN11",
            "IN12",
            "IN13",
            "IN14",
            "IN15",
            "IN16",
            "IN17",
            "IN18",
            "IN19",
            "IN20",
            "BREAK",
            "LIVE",
          ];
  if (liveCodes.includes(code)) return "live";
  throw new SportsProviderError(
    "Sports API returned an unsupported match status. No estimated scores are shown.",
  );
}
function parseMatches(rows: unknown[], sport: Sport): Match[] {
  return rows
    .map((value) => {
      const row = record(value, "fixture");
      const fixture =
        sport === "football" ? record(row.fixture, "fixture details") : row;
      const statusData = record(fixture.status, "fixture status");
      const status = matchStatus(statusData.short, sport);
      const teams = record(row.teams, "fixture teams");
      const league = record(row.league, "fixture league");
      const id = requiredNumber(fixture.id, "fixture ID");
      const startsAt = new Date(string(fixture.date));
      if (Number.isNaN(startsAt.valueOf()))
        throw new SportsProviderError(
          "Sports API returned an invalid fixture date.",
        );
      const scoreData =
        sport === "football"
          ? record(row.goals, "score")
          : record(row.scores, "score");
      const homeScore =
        sport === "football"
          ? number(scoreData.home)
          : number(nested(scoreData.home).total);
      const awayScore =
        sport === "football"
          ? number(scoreData.away)
          : number(nested(scoreData.away).total);
      if (
        (status === "live" || status === "finished") &&
        (homeScore === null || awayScore === null)
      )
        throw new SportsProviderError(
          "Sports API returned an incomplete score.",
        );
      if (
        (homeScore !== null &&
          (homeScore < 0 || !Number.isInteger(homeScore))) ||
        (awayScore !== null && (awayScore < 0 || !Number.isInteger(awayScore)))
      )
        throw new SportsProviderError("Sports API returned an invalid score.");
      const elapsed = number(statusData.elapsed);
      const clock =
        sport === "football" && elapsed !== null
          ? `${elapsed}′`
          : [string(statusData.long), string(fixture.timer)]
              .filter(Boolean)
              .join(" · ");
      return {
        id: `${sport}:${id}`,
        sport,
        league: string(league.name, "Selected league"),
        venue:
          string(nested(fixture.venue).name) ||
          string(row.venue) ||
          "Venue unavailable",
        startsAt: startsAt.toISOString(),
        status,
        ...(status === "live" && clock ? { clock } : {}),
        home: team(teams.home, sport),
        away: team(teams.away, sport),
        homeScore:
          status === "upcoming" || status === "postponed" ? null : homeScore,
        awayScore:
          status === "upcoming" || status === "postponed" ? null : awayScore,
      };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
function standingGroups(values: unknown[]): unknown[][] {
  if (!values.some(Array.isArray)) return [values];
  return values.flatMap((value) =>
    Array.isArray(value) ? standingGroups(value) : [[value]],
  );
}
function standingGroupLabel(
  row: RecordValue,
  fallback?: string,
): string | undefined {
  const labels = [row.stage, row.conference, row.division, row.group]
    .map((value) =>
      (typeof value === "string" ? value : string(nested(value).name)).trim(),
    )
    .filter(Boolean);
  // A stage alone does not identify otherwise unlabeled parallel provider groups.
  if (
    fallback &&
    ![row.conference, row.division, row.group].some((value) =>
      (typeof value === "string" ? value : string(nested(value).name)).trim(),
    )
  )
    labels.push(fallback);
  const seen = new Set<string>();
  const unique = labels.filter((label) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length ? unique.join(" · ") : undefined;
}
function parseStandings(
  rows: unknown[],
  sport: Sport,
): { standings: Standing[]; competition: string } {
  let entries: unknown[] = rows;
  let competition = "Selected league";
  if (sport === "football") {
    if (!rows.length) return { standings: [], competition };
    const league = record(
      record(rows[0], "standings entry").league,
      "standings league",
    );
    competition = string(league.name, competition);
    if (!Array.isArray(league.standings))
      throw new SportsProviderError("Sports API returned invalid standings.");
    entries = league.standings;
  }
  const seen = new Set<string>();
  const groups = standingGroups(entries);
  const standings = groups
    .flatMap((values, groupIndex) =>
      values.map((value): Standing => {
        const row = record(value, "standing");
        const group = standingGroupLabel(
          row,
          groups.length > 1
            ? `Group ${groupIndex + 1} (provider label unavailable)`
            : undefined,
        );
        const standingTeam = team(row.team, sport);
        const games = record(
          sport === "football" ? row.all : row.games,
          "standing games",
        );
        const won = requiredNumber(
          sport === "football" ? games.win : nested(games.win).total,
          "wins",
        );
        const lost = requiredNumber(
          sport === "football" ? games.lose : nested(games.lose).total,
          "losses",
        );
        const played = requiredNumber(games.played, "games played");
        const form = string(row.form)
          .toUpperCase()
          .split("")
          .filter((item) => ["W", "D", "L"].includes(item))
          .slice(-5);
        const leagueName = string(nested(row.league).name);
        if (leagueName) competition = leagueName;
        return {
          rank: requiredNumber(row.rank ?? row.position, "standing rank"),
          team: standingTeam,
          played,
          won,
          drawn:
            sport === "football" ? requiredNumber(games.draw, "draws") : null,
          lost,
          points:
            sport === "football" ? requiredNumber(row.points, "points") : null,
          percentage:
            sport === "football"
              ? null
              : played > 0
                ? (won / played).toFixed(3)
                : ".000",
          ...(group ? { group } : {}),
          ...(form.length ? { form } : {}),
        };
      }),
    )
    .filter((row) => {
      const key = JSON.stringify([row.group ?? "", row.team.id]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { standings, competition };
}
function parseFootballPlayers(rows: unknown[]): Player[] {
  return rows.map((value) => {
    const row = record(value, "player result");
    const player = record(row.player, "player");
    if (!Array.isArray(row.statistics) || !row.statistics.length)
      throw new SportsProviderError(
        "Sports API returned incomplete player statistics.",
      );
    const stats = record(row.statistics[0], "player statistics");
    const goals = record(stats.goals, "player goals");
    const id = requiredNumber(player.id, "player ID");
    const name = string(player.name).trim();
    if (!name)
      throw new SportsProviderError("Sports API returned an unnamed player.");
    return {
      id: `football:${id}`,
      name,
      team: team(stats.team, "football"),
      position: string(nested(stats.games).position, "Player"),
      primary: {
        label: "Goals",
        value:
          goals.total == null
            ? "—"
            : String(requiredNumber(goals.total, "player goals")),
      },
      secondary: {
        label: "Assists",
        value:
          goals.assists == null
            ? "—"
            : String(requiredNumber(goals.assists, "player assists")),
      },
    };
  });
}

async function loadLive(
  config: ProviderConfig,
  date: string,
  fetcher: typeof fetch,
  now: () => Date,
): Promise<DashboardData> {
  const common = { league: config.league, season: config.season };
  const results = await Promise.all([
    request(
      config,
      config.sport === "football" ? "fixtures" : "games",
      { ...common, date, timezone: "UTC" },
      fetcher,
    ),
    request(config, "standings", common, fetcher),
    config.sport === "football"
      ? request(config, "players/topscorers", common, fetcher)
      : Promise.resolve([]),
  ]);
  const matches = parseMatches(results[0], config.sport);
  const { standings, competition } = parseStandings(results[1], config.sport);
  const players =
    config.sport === "football" ? parseFootballPlayers(results[2]) : [];
  const teams = [
    ...new Map(
      [
        ...standings.map((row) => row.team),
        ...matches.flatMap((row) => [row.home, row.away]),
        ...players.map((player) => player.team),
      ].map((value) => [value.id, value]),
    ).values(),
  ];
  const notices = [
    "API-Sports data is cached for 60 seconds. Availability and update frequency depend on your subscription; polling does not guarantee real-time coverage. Fixtures use the selected UTC date. Standings and player leaders reflect the configured season, not historical standings for that date.",
  ];
  if (config.sport !== "football")
    notices.push(
      "Live player statistics are not integrated for this sport. No sample player values are mixed into live data.",
    );
  if (!standings.length)
    notices.push(
      "The provider returned no standings for this league and season.",
    );
  if (new Set(standings.map((row) => row.group ?? "")).size > 1)
    notices.push(
      "Standings ranks are within each provider group. There is no overall ranking across groups; provider order is preserved.",
    );
  return {
    sport: config.sport,
    date,
    mode: "live",
    provider: "API-Sports",
    competition:
      competition === "Selected league"
        ? (matches[0]?.league ?? competition)
        : competition,
    updatedAt: now().toISOString(),
    notice: notices.join(" "),
    matches,
    standings,
    players,
    teams,
  };
}

/** Server entry point. This module must only be imported by server routes. API keys never enter response data. */
export async function getDashboardData(
  sport: Sport,
  date: string,
  dependencies: Dependencies = {},
): Promise<DashboardData> {
  if (typeof window !== "undefined")
    throw new Error("Sports provider credentials are server-only.");
  validateDashboardQuery(sport, date);
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  if (!env.API_SPORTS_KEY?.trim()) return demoDashboard(sport, date, now());
  const provider = config(sport, env);
  const cacheKey = [
    sport,
    date,
    provider.league,
    provider.season,
    createHash("sha256").update(provider.key).digest("hex"),
  ].join(":");
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now().valueOf()) return cached.data;
  const existing = pending.get(cacheKey);
  if (existing) return existing;
  const promise = loadLive(provider, date, dependencies.fetch ?? fetch, now)
    .then((data) => {
      if (cache.size >= MAX_CACHE_ENTRIES)
        cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { data, expiresAt: now().valueOf() + CACHE_MS });
      return data;
    })
    .finally(() => {
      pending.delete(cacheKey);
    });
  pending.set(cacheKey, promise);
  return promise;
}
