export type Sport = "football" | "basketball" | "baseball";
export const SPORTS: { id: Sport; label: string; icon: string }[] = [
  { id: "football", label: "Football", icon: "⚽" },
  { id: "basketball", label: "Basketball", icon: "🏀" },
  { id: "baseball", label: "Baseball", icon: "⚾" },
];
export type Team = {
  id: string;
  name: string;
  shortName: string;
  color: string;
};
export type Match = {
  id: string;
  sport: Sport;
  league: string;
  venue: string;
  startsAt: string;
  status: "live" | "upcoming" | "finished" | "postponed";
  clock?: string;
  home: Team;
  away: Team;
  homeScore: number | null;
  awayScore: number | null;
};
export type Standing = {
  group?: string;
  rank: number;
  team: Team;
  played: number;
  won: number;
  drawn: number | null;
  lost: number;
  points: number | null;
  percentage: string | null;
  form?: string[];
};
export type Player = {
  id: string;
  name: string;
  team: Team;
  position: string;
  primary: { label: string; value: string };
  secondary: { label: string; value: string };
};
export type DashboardData = {
  sport: Sport;
  date: string;
  mode: "demo" | "live";
  provider: string;
  notice?: string;
  competition: string;
  updatedAt: string;
  matches: Match[];
  standings: Standing[];
  players: Player[];
  teams: Team[];
};
export type Favorite = { sport: Sport; teamId: string };
export type User = { id: string; email: string; name: string };
export type AccountState = {
  user: User | null;
  favorites: Favorite[];
  notificationsEnabled: boolean;
  storage: "postgres" | "unconfigured";
};
