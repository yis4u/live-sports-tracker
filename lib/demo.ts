import type {
  DashboardData,
  Match,
  Player,
  Sport,
  Standing,
  Team,
} from "./types";

const palettes = [
  "#d7f56b",
  "#9d9bff",
  "#ff9e78",
  "#75d7d0",
  "#ffc16b",
  "#ec9dcc",
  "#7eaff3",
  "#9acc84",
  "#d0b08a",
  "#91bbce",
  "#c5a6dd",
  "#dfb26e",
];
const names: Record<Sport, string[]> = {
  football: [
    "Northbridge FC",
    "Riverside Athletic",
    "Harbor United",
    "Kingswell City",
    "Westhaven Rovers",
    "Oakfield FC",
    "Summit Town",
    "Eastport Athletic",
    "Lakeside United",
    "Redwood City",
    "Meadowvale FC",
    "Stonebridge Town",
  ],
  basketball: [
    "Harbor Falcons",
    "Metro Comets",
    "Summit Owls",
    "Riverside Sparks",
    "Eastport Waves",
    "Northbridge Foxes",
    "Oakfield Arrows",
    "Westhaven Bears",
    "Lakeside Stars",
    "Redwood Ravens",
    "Meadowvale Lynx",
    "Stonebridge Suns",
  ],
  baseball: [
    "Brookfield Bats",
    "Harbor Captains",
    "Metro Rockets",
    "Riverside Oaks",
    "Summit Foxes",
    "Eastport Sailors",
    "Northbridge Bears",
    "Oakfield Hawks",
    "Lakeside Otters",
    "Redwood Pines",
    "Meadowvale Bees",
    "Stonebridge Miners",
  ],
};
const competitions: Record<Sport, string> = {
  football: "Sample Premier Division",
  basketball: "Sample Basketball League",
  baseball: "Sample Baseball League",
};
const scores: Record<Sport, [number, number][]> = {
  football: [
    [2, 1],
    [0, 0],
    [3, 2],
    [1, 2],
  ],
  basketball: [
    [82, 77],
    [43, 39],
    [108, 101],
    [94, 99],
  ],
  baseball: [
    [3, 2],
    [1, 0],
    [6, 4],
    [2, 5],
  ],
};

/** Fictional fixtures: deterministic for the selected UTC date, never advertised as real results. */
export function demoDashboard(
  sport: Sport,
  date: string,
  now = new Date(),
): DashboardData {
  const teams: Team[] = names[sport].map((name, index) => ({
    id: `demo:${sport}:${index + 1}`,
    name,
    shortName: name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 3)
      .toUpperCase(),
    color: palettes[index],
  }));
  const statuses: Match["status"][] = [
    "live",
    "live",
    "finished",
    "finished",
    "upcoming",
    "postponed",
  ];
  const matches: Match[] = statuses.map((status, index) => ({
    id: `demo:${sport}:${date}:${index + 1}`,
    sport,
    league: competitions[sport],
    venue: `${teams[index * 2].name.split(" ")[0]} ${sport === "baseball" ? "Park" : "Arena"}`,
    startsAt: `${date}T${String(12 + index * 2).padStart(2, "0")}:00:00.000Z`,
    status,
    ...(status === "live"
      ? {
          clock:
            sport === "football"
              ? index
                ? "28′"
                : "67′"
              : sport === "basketball"
                ? index
                  ? "Q2 · 04:18"
                  : "Q4 · 06:42"
                : index
                  ? "Top 3"
                  : "Bottom 7",
        }
      : {}),
    home: teams[index * 2],
    away: teams[index * 2 + 1],
    homeScore: index < 4 ? scores[sport][index][0] : null,
    awayScore: index < 4 ? scores[sport][index][1] : null,
  }));
  const standings: Standing[] = teams.map((team, index) => {
    const played = sport === "football" ? 12 : sport === "basketball" ? 18 : 30;
    const won =
      (sport === "football" ? 11 : sport === "basketball" ? 15 : 24) - index;
    const drawn = sport === "football" ? index % 3 : null;
    return {
      rank: index + 1,
      team,
      played,
      won,
      drawn,
      lost: played - won - (drawn ?? 0),
      points: sport === "football" ? won * 3 + (drawn ?? 0) : null,
      percentage: sport === "football" ? null : (won / played).toFixed(3),
      form: index < 3 ? ["W", "W", "L", "W", "W"] : ["L", "W", "L", "W", "L"],
    };
  });
  const playerNames = [
    "Alex Morganfield",
    "Jordan Vale",
    "Jamie Brooks",
    "Riley Chen",
    "Casey Rivera",
    "Sam Okafor",
  ];
  const players: Player[] = playerNames.map((name, index) => ({
    id: `demo:${sport}:player:${index + 1}`,
    name,
    team: teams[index],
    position:
      sport === "football"
        ? [
            "Forward",
            "Midfielder",
            "Forward",
            "Winger",
            "Forward",
            "Midfielder",
          ][index]
        : sport === "basketball"
          ? ["Guard", "Forward", "Center", "Guard", "Forward", "Guard"][index]
          : [
              "Outfielder",
              "First base",
              "Shortstop",
              "Outfielder",
              "Catcher",
              "Second base",
            ][index],
    primary: {
      label:
        sport === "football" ? "Goals" : sport === "basketball" ? "PPG" : "AVG",
      value:
        sport === "football"
          ? String(14 - index)
          : sport === "basketball"
            ? (29.8 - index * 1.3).toFixed(1)
            : (0.342 - index * 0.007).toFixed(3),
    },
    secondary: {
      label:
        sport === "football"
          ? "Assists"
          : sport === "basketball"
            ? "APG"
            : "HR",
      value:
        sport === "football"
          ? String(7 - index)
          : sport === "basketball"
            ? (7.6 - index * 0.6).toFixed(1)
            : String(22 - index * 2),
    },
  }));
  return {
    sport,
    date,
    mode: "demo",
    provider: "Fictional sample data",
    competition: competitions[sport],
    updatedAt: now.toISOString(),
    notice:
      "Demo mode: all teams, players, fixtures, scores and standings are fictional samples. Connect API-Sports and configure a league and season to load real data. Times are fixtures on the selected UTC date; sample statuses do not track the clock.",
    matches,
    standings,
    players,
    teams,
  };
}
