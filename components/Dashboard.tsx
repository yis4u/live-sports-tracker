"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Goal,
  LayoutGrid,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  Star,
  Trophy,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import {
  SPORTS,
  type AccountState,
  type DashboardData,
  type Favorite,
  type Match,
  type Sport,
  type Team,
} from "@/lib/types";

type View = "matches" | "standings" | "players" | "favorites";
type Filter = "all" | "live" | "upcoming" | "finished";
const GUEST_KEY = "sideline.favorites.v1";
const PREF_KEY = "sideline.updates.v1";
const TEAM_KEY = "sideline.teams.v1";
const nav = [
  { id: "matches", label: "Match center", icon: LayoutGrid },
  { id: "standings", label: "Standings", icon: Trophy },
  { id: "players", label: "Players", icon: UsersRound },
  { id: "favorites", label: "My teams", icon: Star },
] as const;
const emptyAccount: AccountState = {
  user: null,
  favorites: [],
  notificationsEnabled: false,
  storage: "unconfigured",
};

function safeRead<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function readFavorites(): Favorite[] {
  const stored = safeRead<unknown>(GUEST_KEY, []);
  return Array.isArray(stored)
    ? stored.filter((v): v is Favorite =>
        Boolean(
          v &&
          typeof v === "object" &&
          typeof v.teamId === "string" &&
          v.teamId.length > 0 &&
          v.teamId.length <= 100 &&
          SPORTS.some((s) => s.id === v.sport),
        ),
      )
    : [];
}
function readKnownTeams(): Record<string, Team> {
  const stored = safeRead<unknown>(TEAM_KEY, {});
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(([key, value]) => {
      if (!value || typeof value !== "object") return false;
      const team = value as Partial<Team>;
      return (
        typeof team.id === "string" &&
        typeof team.name === "string" &&
        team.name.length > 0 &&
        typeof team.shortName === "string" &&
        typeof team.color === "string" &&
        /^#[0-9a-f]{3,8}$/i.test(team.color) &&
        SPORTS.some((s) => key === `${s.id}:${team.id}`)
      );
    }),
  ) as Record<string, Team>;
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(body.error || "Something went wrong. Please try again.");
  return body as T;
}
function shiftDate(date: string, offset: number) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}
function readableDate(date: string, long = false) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en", {
    timeZone: "UTC",
    weekday: long ? "long" : "short",
    month: "short",
    day: "numeric",
  });
}
function time(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function TeamBadge({ team, small = false }: { team: Team; small?: boolean }) {
  return (
    <span
      className={`team-badge ${small ? "small" : ""}`}
      style={{ "--team-color": team.color } as React.CSSProperties}
      aria-hidden="true"
    >
      <Shield size={small ? 27 : 44} fill="currentColor" strokeWidth={1.3} />
      <span>{team.shortName.slice(0, 3)}</span>
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            onClose();
        }
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-header">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function Dashboard() {
  const [sport, setSport] = useState<Sport>("football");
  const [date, setDate] = useState("");
  const [view, setView] = useState<View>("matches");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountState>(emptyAccount);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [guestStorageAvailable, setGuestStorageAvailable] = useState(true);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [knownTeams, setKnownTeams] = useState<Record<string, Team>>({});
  const [updates, setUpdates] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [busyTeam, setBusyTeam] = useState("");
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [detail, setDetail] = useState<Match | null>(null);
  const [help, setHelp] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const loadedKey = useRef("");
  const activeKey = `${sport}:${date}`;

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    setNow(new Date());
    setFavorites(readFavorites());
    try {
      localStorage.setItem("sideline.storage-check", "1");
      localStorage.removeItem("sideline.storage-check");
    } catch {
      setGuestStorageAvailable(false);
    }
    setUpdates(safeRead<boolean>(PREF_KEY, false) === true);
    setKnownTeams(readKnownTeams());
    let mounted = true;
    api<AccountState>("/api/auth/me")
      .then((result) => {
        if (!mounted) return;
        setAccount(result);
        if (result.user) {
          setFavorites(result.favorites);
          setUpdates(result.notificationsEnabled);
        }
      })
      .catch((e: Error) => {
        if (mounted) setToast(`Account service: ${e.message}`);
      })
      .finally(() => {
        if (mounted) setAccountLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!mobileMenu) return;
    const drawer = sidebarRef.current;
    const previousFocus =
      menuButtonRef.current ?? (document.activeElement as HTMLElement | null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    function handleKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenu(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const targets = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !drawer.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !drawer.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeys);
      (previousFocus ?? menuButtonRef.current)?.focus();
    };
  }, [mobileMenu]);

  const refresh = useCallback(
    async (background = false) => {
      if (!date) return;
      if (requestRef.current) {
        if (background) return;
        requestRef.current.abort();
      }
      const controller = new AbortController();
      requestRef.current = controller;
      const key = `${sport}:${date}`;
      setRefreshing(true);
      if (loadedKey.current !== key) setLoading(true);
      try {
        const result = await api<DashboardData>(
          `/api/dashboard?sport=${sport}&date=${date}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setData(result);
        setDetail((previous) =>
          previous
            ? (result.matches.find(
                (match) =>
                  match.id === previous.id && match.sport === previous.sport,
              ) ?? previous)
            : null,
        );
        loadedKey.current = key;
        setError("");
        setKnownTeams((previous) => {
          const next = { ...previous };
          result.teams.forEach((team) => {
            next[`${sport}:${team.id}`] = team;
          });
          safeWrite(TEAM_KEY, next);
          return next;
        });
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load scores.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
          requestRef.current = null;
        }
      }
    },
    [sport, date],
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh(true);
    }, 60000);
    return () => {
      clearInterval(timer);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  const isFavorite = (teamId: string, teamSport = sport) =>
    favorites.some(
      (item) => item.sport === teamSport && item.teamId === teamId,
    );
  async function toggleFavorite(team: Team, teamSport = sport) {
    if (busyTeam || !accountLoaded) return;
    const key = `${teamSport}:${team.id}`;
    setBusyTeam(key);
    const saved = isFavorite(team.id, teamSport);
    try {
      if (account.user) {
        const result = await api<{ favorites: Favorite[] }>(
          saved
            ? `/api/favorites?sport=${teamSport}&teamId=${encodeURIComponent(team.id)}`
            : "/api/favorites",
          {
            method: saved ? "DELETE" : "POST",
            ...(saved
              ? {}
              : {
                  body: JSON.stringify({ sport: teamSport, teamId: team.id }),
                }),
          },
        );
        setFavorites(result.favorites);
      } else {
        const next = saved
          ? favorites.filter(
              (item) => !(item.sport === teamSport && item.teamId === team.id),
            )
          : [...favorites, { sport: teamSport, teamId: team.id }];
        setFavorites(next);
        if (!safeWrite(GUEST_KEY, next)) setGuestStorageAvailable(false);
      }
      setToast(
        saved
          ? `${team.name} removed from your teams.`
          : `${team.name} added to your teams.`,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not save team.");
    } finally {
      setBusyTeam("");
    }
  }
  async function toggleUpdates() {
    if (preferenceBusy || !accountLoaded) return;
    setPreferenceBusy(true);
    try {
      const next = !updates;
      if (account.user)
        await api("/api/preferences", {
          method: "PATCH",
          body: JSON.stringify({ notificationsEnabled: next }),
        });
      else safeWrite(PREF_KEY, next);
      setUpdates(next);
      setToast(
        next
          ? "Game-day updates are on in this dashboard."
          : "Game-day updates are off.",
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not save preference.");
    } finally {
      setPreferenceBusy(false);
    }
  }
  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthError("");
    setAuthBusy(true);
    const fields = new FormData(e.currentTarget);
    try {
      const result = await api<AccountState>(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify({
          email: fields.get("email"),
          password: fields.get("password"),
          ...(authMode === "register" ? { name: fields.get("name") } : {}),
        }),
      });
      setAccount(result);
      setFavorites(result.favorites);
      setUpdates(result.notificationsEnabled);
      setAuthMode(null);
      setToast(`Welcome, ${result.user?.name || "sports fan"}.`);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setAuthBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setAccount({ ...account, user: null, favorites: [] });
      setFavorites(readFavorites());
      setUpdates(safeRead<boolean>(PREF_KEY, false) === true);
      setToast("You’re signed out.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Unable to sign out.");
    }
  }
  function navigate(next: View) {
    setView(next);
    setMobileMenu(false);
    setQuery("");
  }
  function chooseSport(next: Sport) {
    setMobileMenu(false);
    setSport(next);
    setFilter("all");
    setQuery("");
  }
  const current = loadedKey.current === activeKey ? data : null;
  const filteredMatches = (current?.matches ?? []).filter(
    (match) =>
      (filter === "all" || match.status === filter) &&
      `${match.home.name} ${match.away.name} ${match.league}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const featured =
    current?.matches.find((match) => match.status === "live") ??
    current?.matches.find((match) => match.status === "upcoming") ??
    current?.matches[0];
  const savedTeams = favorites.filter((item) => item.sport === sport);
  const favoriteMatches = (current?.matches ?? []).filter(
    (match) => isFavorite(match.home.id) || isFavorite(match.away.id),
  );
  const matchingStandings = (current?.standings ?? []).filter((row) =>
    row.team.name.toLowerCase().includes(query.toLowerCase()),
  );
  const matchingPlayers = (current?.players ?? []).filter((player) =>
    `${player.name} ${player.team.name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const matchingTeams = (current?.teams ?? []).filter((team) =>
    team.name.toLowerCase().includes(query.toLowerCase()),
  );
  const groupedStandings =
    current?.standings.some((row) => Boolean(row.group)) ?? false;
  const liveCount =
    current?.matches.filter((match) => match.status === "live").length ?? 0;
  const searchLabel =
    view === "players"
      ? "Search players or teams"
      : view === "standings"
        ? "Search teams"
        : "Search teams or competitions";
  const title = {
    matches: "Every game. One place.",
    standings: "The race to the top.",
    players: "The names making noise.",
    favorites: "Your teams. Your game.",
  }[view];
  const subtitle = {
    matches: "All the action, without missing a beat.",
    standings: "Keep an eye on the table and follow the form.",
    players: "See who is leading the way this season.",
    favorites: "Keep your favorites close, wherever they play.",
  }[view];

  function renderSaveButton({
    team,
    teamSport = sport,
    label = false,
  }: {
    team: Team;
    teamSport?: Sport;
    label?: boolean;
  }) {
    const saved = isFavorite(team.id, teamSport);
    return (
      <button
        className={`save-button ${saved ? "saved" : ""} ${label ? "with-label" : ""}`}
        disabled={Boolean(busyTeam) || !accountLoaded}
        aria-pressed={saved}
        aria-label={`${saved ? "Unfollow" : "Follow"} ${team.name}`}
        onClick={() => void toggleFavorite(team, teamSport)}
      >
        <Star size={17} fill={saved ? "currentColor" : "none"} />
        {label && (saved ? "Following" : "Follow team")}
      </button>
    );
  }

  function renderMatchCard(match: Match) {
    return (
      <article className="match-card" key={match.id}>
        <div className="match-top">
          <span className={`match-status ${match.status}`}>
            <span />
            {match.status === "live"
              ? `LIVE ${match.clock ?? ""}`
              : match.status === "finished"
                ? "FULL TIME"
                : match.status === "postponed"
                  ? "POSTPONED"
                  : time(match.startsAt)}
          </span>
          <span className="match-league">{match.league}</span>
        </div>
        <button
          className="match-main"
          onClick={() => setDetail(match)}
          aria-label={`View ${match.home.name} versus ${match.away.name}`}
        >
          <span className="match-team">
            <TeamBadge team={match.home} />
            <span>{match.home.name}</span>
          </span>
          <span className="card-score">
            {match.homeScore ?? "–"}
            <span>:</span>
            {match.awayScore ?? "–"}
            <small>
              {match.status === "upcoming"
                ? "UPCOMING"
                : match.status === "postponed"
                  ? "TBC"
                  : match.status === "finished"
                    ? "FT"
                    : match.clock || "IN PLAY"}
            </small>
          </span>
          <span className="match-team">
            <TeamBadge team={match.away} />
            <span>{match.away.name}</span>
          </span>
        </button>
        <div className="match-bottom">
          <span>
            <Goal size={13} />
            {match.venue || "Venue to be confirmed"}
          </span>
          <button onClick={() => setDetail(match)}>
            Match details <ArrowUpRight size={14} />
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="app-shell">
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileMenu ? "open" : ""}`}
        role={mobileMenu ? "dialog" : undefined}
        aria-modal={mobileMenu ? true : undefined}
        aria-label="Site navigation"
      >
        <a className="brand" href="/" aria-label="Sideline home">
          <span className="brand-mark">
            <Zap size={25} fill="currentColor" />
          </span>
          sideline<span className="brand-dot">.</span>
        </a>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobileMenu(false)}
          aria-label="Close navigation"
        >
          <X size={21} />
        </button>
        <div className="sidebar-label">YOUR PLAYBOOK</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={view === item.id ? "nav-item active" : "nav-item"}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === "favorites" && favorites.length > 0 && (
                <span className="nav-count">{favorites.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-favorites">
          <span className="sidebar-label">YOUR SPORTS</span>
          {SPORTS.map((item) => (
            <button
              key={item.id}
              className={`sport-nav ${sport === item.id ? "selected" : ""}`}
              onClick={() => chooseSport(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
              <span className="sport-nav-dot" />
            </button>
          ))}
        </div>
        <div className="sidebar-tip">
          <span className="tip-icon">
            <Zap size={18} />
          </span>
          <h3>A little closer to the game.</h3>
          <p>Follow your teams and make match day yours.</p>
          <button onClick={() => navigate("favorites")}>
            Find your teams <ArrowRight size={15} />
          </button>
        </div>
        <button
          className="help-link"
          onClick={() => {
            setMobileMenu(false);
            setHelp(true);
          }}
        >
          <CircleHelp size={18} />
          How Sideline works
          <ArrowUpRight size={15} />
        </button>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Made for the fans.<span>EST. 2026</span>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <div className="main-shell" inert={mobileMenu}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={menuButtonRef}
              className="mobile-menu icon-button"
              onClick={() => setMobileMenu(true)}
              aria-label="Open navigation"
              aria-expanded={mobileMenu}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">YOUR DAILY DOSE OF SPORT</span>
            <span className="top-date">
              <CalendarDays size={15} />
              {now?.toLocaleDateString("en", {
                month: "long",
                day: "numeric",
                year: "numeric",
              }) ?? "Today"}
            </span>
          </div>
          <div className="account-actions">
            <button
              className={`notification-button icon-button ${updates ? "enabled" : ""}`}
              aria-label="Open game-day updates"
              onClick={() => {
                navigate("favorites");
              }}
            >
              <Bell size={19} />
              {updates && <span />}
            </button>
            <span className="topbar-divider" />
            {account.user ? (
              <>
                <div className="avatar">
                  {account.user.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="account-name">{account.user.name}</span>
                <button
                  className="icon-button"
                  onClick={() => void logout()}
                  aria-label="Sign out"
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button
                className="sign-in"
                disabled={!accountLoaded}
                onClick={() => {
                  setAuthError("");
                  setAuthMode("login");
                }}
              >
                Sign in <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        </header>
        <main id="main-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                THE GAME IS ALWAYS ON
              </div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <div className="heading-stat">
              <Activity size={18} />
              <strong>{liveCount.toString().padStart(2, "0")}</strong>
              <span>
                {current?.mode === "demo"
                  ? "sample games in play"
                  : "games in play"}
              </span>
            </div>
          </section>
          <div className="sport-toolbar">
            <div className="sport-tabs" aria-label="Choose sport">
              {SPORTS.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={sport === item.id}
                  className={sport === item.id ? "active" : ""}
                  onClick={() => chooseSport(item.id)}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="refresh-state">
              <span
                className={current?.mode === "live" ? "live-dot" : "demo-dot"}
              />
              {current?.mode === "live" ? "Live data" : "Demo experience"}
              <button
                className={`icon-button ${refreshing ? "spinning" : ""}`}
                disabled={refreshing}
                onClick={() => void refresh()}
                aria-label="Refresh scores"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>
          {current?.mode === "demo" && (
            <div className="demo-notice">
              <span className="demo-label">DEMO</span>
              <span>
                Explore with sample scores and stats. Connect a Sports API key
                to follow real games.
              </span>
              <button
                onClick={() => setHelp(true)}
                aria-label="About demo mode"
              >
                <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          {current?.mode === "live" && current.notice && (
            <div className="service-notice">{current.notice}</div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>We couldn’t update the scoreboard.</strong>
                <span>
                  {error}
                  {current && " Previously loaded scores are still shown."}
                </span>
              </div>
              <button onClick={() => void refresh()}>
                Try again <RefreshCw size={14} />
              </button>
            </div>
          )}
          <div className="dashboard-grid">
            <div className="primary-column">
              {view === "matches" && featured && (
                <section className="featured-match">
                  <div className="pitch-lines" aria-hidden="true">
                    <span />
                  </div>
                  <div className="feature-heading">
                    <span className="feature-tag">
                      <Zap size={12} fill="currentColor" />
                      {featured.status === "live"
                        ? "IN THE SPOTLIGHT"
                        : "MATCH SPOTLIGHT"}
                    </span>
                    <span>
                      {featured.league}
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                  <div className="featured-scoreboard">
                    <div className="featured-team">
                      <TeamBadge team={featured.home} />
                      <strong>{featured.home.name}</strong>
                      <span>HOME</span>
                    </div>
                    <div className="featured-score">
                      <span
                        className={`featured-status ${featured.status === "live" ? "is-live" : ""}`}
                      >
                        <span />
                        {featured.status === "live"
                          ? `LIVE · ${featured.clock || "IN PLAY"}`
                          : featured.status === "upcoming"
                            ? time(featured.startsAt)
                            : featured.status === "finished"
                              ? "FULL TIME"
                              : "POSTPONED"}
                      </span>
                      <strong>
                        {featured.homeScore ?? "–"}
                        <span>:</span>
                        {featured.awayScore ?? "–"}
                      </strong>
                      <small>{featured.venue}</small>
                    </div>
                    <div className="featured-team">
                      <TeamBadge team={featured.away} />
                      <strong>{featured.away.name}</strong>
                      <span>AWAY</span>
                    </div>
                  </div>
                  <div className="feature-footer">
                    <span>
                      <span className="pulse-dot" />
                      {current?.mode === "demo"
                        ? "Sample match · demo data"
                        : "Updates every 60 seconds"}
                    </span>
                    <button onClick={() => setDetail(featured)}>
                      Inside the match <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              )}
              <section className="content-section">
                <div className="section-title">
                  <div>
                    <h2>
                      {view === "matches"
                        ? "Match center"
                        : view === "standings"
                          ? "League standings"
                          : view === "players"
                            ? "Player leaderboard"
                            : "Your clubs, all together"}
                    </h2>
                    <span>
                      {view === "matches"
                        ? `${current?.matches.length ?? 0} games on the schedule`
                        : (current?.competition ??
                          SPORTS.find((item) => item.id === sport)?.label)}
                    </span>
                  </div>
                  {view === "matches" && (
                    <div className="date-control">
                      <button
                        className="icon-button"
                        aria-label="Previous day"
                        onClick={() => date && setDate(shiftDate(date, -1))}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <label>
                        <CalendarDays size={15} />
                        <span>{date ? readableDate(date) : "Loading"}</span>
                        <input
                          type="date"
                          aria-label="Match date in UTC"
                          value={date}
                          onChange={(e) => {
                            if (e.target.value) setDate(e.target.value);
                          }}
                        />
                      </label>
                      <button
                        className="icon-button"
                        aria-label="Next day"
                        onClick={() => date && setDate(shiftDate(date, 1))}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="content-controls">
                  {view === "matches" ? (
                    <div
                      className="filter-tabs"
                      aria-label="Filter match status"
                    >
                      {(
                        ["all", "live", "upcoming", "finished"] as Filter[]
                      ).map((item) => (
                        <button
                          key={item}
                          className={filter === item ? "active" : ""}
                          onClick={() => setFilter(item)}
                          aria-pressed={filter === item}
                        >
                          {item === "all" ? (
                            "All games"
                          ) : item === "live" ? (
                            <>
                              <span className="live-dot" />
                              Live
                              <span className="filter-count">{liveCount}</span>
                            </>
                          ) : (
                            item[0].toUpperCase() + item.slice(1)
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="season-label">
                      <Trophy size={14} />
                      {current?.competition || "Selected competition"}
                    </span>
                  )}
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      type="search"
                      aria-label={searchLabel}
                      placeholder={searchLabel}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                {loading ? (
                  <div className="loading-state" aria-live="polite">
                    <RefreshCw size={22} className="spinning" />
                    <strong>Getting the latest from the game…</strong>
                    <p>
                      Loading{" "}
                      {SPORTS.find(
                        (item) => item.id === sport,
                      )?.label.toLowerCase()}{" "}
                      scores and stats.
                    </p>
                  </div>
                ) : !current ? (
                  <div className="empty-state">
                    <Activity size={32} />
                    <h3>Your scoreboard is taking a breather.</h3>
                    <p>{error || "Scores are unavailable right now."}</p>
                    <button
                      className="primary-button"
                      onClick={() => void refresh()}
                    >
                      Reload scoreboard
                    </button>
                  </div>
                ) : (
                  <>
                    {view === "matches" && (
                      <>
                        <div className="schedule-label">
                          <span>
                            <span className="competition-icon">
                              <Trophy size={13} />
                            </span>
                            {current.competition}
                            <span className="muted-count">
                              {filteredMatches.length}
                            </span>
                          </span>
                          <small>Dates in UTC · times in your timezone</small>
                        </div>
                        {filteredMatches.length > 0 ? (
                          <div className="matches-grid">
                            {filteredMatches.map(renderMatchCard)}
                          </div>
                        ) : (
                          <div className="empty-state">
                            <CalendarDays size={30} />
                            <h3>No games in this view.</h3>
                            <p>Try another date, search, or match status.</p>
                            <button
                              className="text-button"
                              onClick={() => {
                                setFilter("all");
                                setQuery("");
                              }}
                            >
                              Clear filters <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                        <div className="data-footnote">
                          <Shield size={12} />
                          <span>
                            {current.mode === "demo"
                              ? "Sample data for demonstration"
                              : current.provider}{" "}
                            · Updated {time(current.updatedAt)}
                          </span>
                          <span>Automatic refresh every 60s</span>
                        </div>
                      </>
                    )}
                    {view === "standings" && (
                      <>
                        <div className="table-scroll">
                          <table className="standings-table">
                            <thead>
                              <tr>
                                <th scope="col">#</th>
                                <th scope="col">Team</th>
                                {groupedStandings && <th scope="col">Group</th>}
                                <th scope="col">P</th>
                                <th scope="col">W</th>
                                {sport === "football" && <th scope="col">D</th>}
                                <th scope="col">L</th>
                                <th scope="col">
                                  {sport === "football" ? "PTS" : "WIN %"}
                                </th>
                                <th scope="col">Follow</th>
                              </tr>
                            </thead>
                            <tbody>
                              {matchingStandings.map((row) => (
                                <tr
                                  key={`${row.group ?? "overall"}:${row.team.id}`}
                                >
                                  <td>
                                    <span
                                      className={
                                        !groupedStandings && row.rank <= 4
                                          ? "rank top-rank"
                                          : "rank"
                                      }
                                    >
                                      {row.rank}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="table-team">
                                      <TeamBadge team={row.team} small />
                                      <strong>{row.team.name}</strong>
                                    </span>
                                  </td>
                                  {groupedStandings && (
                                    <td className="table-group">
                                      {row.group || "Overall"}
                                    </td>
                                  )}
                                  <td>{row.played}</td>
                                  <td>{row.won}</td>
                                  {sport === "football" && (
                                    <td>{row.drawn ?? "–"}</td>
                                  )}
                                  <td>{row.lost}</td>
                                  <td>
                                    <strong>
                                      {sport === "football"
                                        ? (row.points ?? "–")
                                        : (row.percentage ?? "–")}
                                    </strong>
                                  </td>
                                  <td>
                                    {renderSaveButton({ team: row.team })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {matchingStandings.length === 0 && (
                          <div className="empty-state">
                            <Trophy size={30} />
                            <h3>
                              {query
                                ? "No teams match your search."
                                : "No table available yet."}
                            </h3>
                            <p>
                              {query
                                ? "Try another team name or clear your search."
                                : "The provider has no standings for this competition."}
                            </p>
                          </div>
                        )}
                        <p className="table-legend">
                          {!groupedStandings && <span />}
                          {groupedStandings
                            ? "Ranks are within each provider group. "
                            : "Top four positions highlighted. "}
                          P: played · W: wins ·{" "}
                          {sport === "football" && "D: draws · "}L: losses.
                        </p>
                      </>
                    )}
                    {view === "players" && (
                      <>
                        <div className="players-list">
                          {matchingPlayers.map((player, index) => (
                            <article key={player.id} className="player-row">
                              <span
                                className={`player-rank ${index === 0 ? "first" : ""}`}
                              >
                                {index === 0 ? (
                                  <Trophy size={17} />
                                ) : (
                                  String(index + 1).padStart(2, "0")
                                )}
                              </span>
                              <div
                                className="player-avatar"
                                style={
                                  {
                                    "--team-color": player.team.color,
                                  } as React.CSSProperties
                                }
                              >
                                {player.name
                                  .split(" ")
                                  .map((part) => part[0])
                                  .slice(0, 2)
                                  .join("")}
                              </div>
                              <div className="player-info">
                                <h3>{player.name}</h3>
                                <p>
                                  {player.team.name} <span>·</span>{" "}
                                  {player.position}
                                </p>
                              </div>
                              <div className="player-stat">
                                <strong>{player.primary.value}</strong>
                                <span>{player.primary.label}</span>
                              </div>
                              <div className="player-stat secondary-stat">
                                <strong>{player.secondary.value}</strong>
                                <span>{player.secondary.label}</span>
                              </div>
                            </article>
                          ))}
                        </div>
                        {matchingPlayers.length === 0 && (
                          <div className="empty-state">
                            <UsersRound size={30} />
                            <h3>
                              {query
                                ? "No players match your search."
                                : "Player stats aren’t available."}
                            </h3>
                            <p>
                              {query
                                ? "Try another player or team name."
                                : "Player statistics depend on your sport and provider plan."}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {view === "favorites" && (
                      <>
                        <div className="favorites-heading">
                          <p>
                            <Star size={15} />
                            {account.user
                              ? `Synced to ${account.user.name}’s profile`
                              : guestStorageAvailable
                                ? "Saved on this device"
                                : "Saved for this session"}
                          </p>
                          <span>{savedTeams.length} following</span>
                        </div>
                        {savedTeams.length > 0 ? (
                          <div className="favorite-team-grid">
                            {savedTeams.map((item) => {
                              const team = current.teams.find(
                                (t) => t.id === item.teamId,
                              ) ||
                                knownTeams[`${sport}:${item.teamId}`] || {
                                  id: item.teamId,
                                  name: `Team ${item.teamId}`,
                                  shortName: "TM",
                                  color: "#526858",
                                };
                              const nextMatch = current.matches.find(
                                (m) =>
                                  m.home.id === team.id ||
                                  m.away.id === team.id,
                              );
                              return (
                                <article
                                  className="favorite-team-card"
                                  key={team.id}
                                >
                                  {renderSaveButton({ team })}
                                  <TeamBadge team={team} />
                                  <h3>{team.name}</h3>
                                  <p>
                                    {SPORTS.find((s) => s.id === sport)?.label}
                                  </p>
                                  <div>
                                    {nextMatch ? (
                                      <button
                                        className="text-button"
                                        onClick={() => setDetail(nextMatch)}
                                      >
                                        {nextMatch.status === "live"
                                          ? "In action now"
                                          : "View game today"}
                                        <ArrowUpRight size={14} />
                                      </button>
                                    ) : (
                                      <span>
                                        No game on {readableDate(date)}
                                      </span>
                                    )}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="empty-state favorite-empty">
                            <Star size={31} />
                            <h3>Every fan has a favorite.</h3>
                            <p>
                              Follow a team below to build your personal
                              match-day lineup.
                            </p>
                          </div>
                        )}
                        <div className="team-discovery-title">
                          <h3>
                            Find your{" "}
                            {SPORTS.find(
                              (s) => s.id === sport,
                            )?.label.toLowerCase()}{" "}
                            teams
                          </h3>
                          <span>{current.teams.length} teams</span>
                        </div>
                        <div className="team-discovery">
                          {matchingTeams.map((team) => (
                            <div className="discover-team" key={team.id}>
                              <TeamBadge team={team} small />
                              <span>{team.name}</span>
                              {renderSaveButton({ team })}
                            </div>
                          ))}
                        </div>
                        {matchingTeams.length === 0 && (
                          <div className="empty-state">
                            <Search size={28} />
                            <h3>
                              {query
                                ? "No teams match your search."
                                : "No teams available yet."}
                            </h3>
                            <p>
                              {query
                                ? "Try another name or clear your search."
                                : "Teams will appear when the provider has competition data."}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </section>
              {view === "matches" &&
                current &&
                current.standings.length > 0 && (
                  <section className="mini-standings">
                    <div className="section-title">
                      <div>
                        <h2>
                          {groupedStandings
                            ? "Standings snapshot"
                            : "The top of the table"}
                        </h2>
                        <span>{current.competition}</span>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("standings")}
                      >
                        Full standings <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="top-teams">
                      {current.standings.slice(0, 4).map((row) => (
                        <div
                          className="top-team"
                          key={`${row.group ?? "overall"}:${row.team.id}`}
                        >
                          <span>{String(row.rank).padStart(2, "0")}</span>
                          <TeamBadge team={row.team} small />
                          <strong>
                            {row.team.name}
                            {row.group && <small>{row.group}</small>}
                          </strong>
                          <span className="top-team-points">
                            {sport === "football" ? row.points : row.percentage}
                            <small>
                              {sport === "football" ? "PTS" : "WIN %"}
                            </small>
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
            </div>
            <aside className="right-column">
              <section className="rail-panel your-teams">
                <div className="rail-heading">
                  <h2>
                    <Star size={17} />
                    My teams
                  </h2>
                  <button
                    className="icon-button"
                    aria-label="Manage your teams"
                    onClick={() => navigate("favorites")}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
                <p className="rail-subtitle">
                  Your favorites. Front and center.
                </p>
                {savedTeams.length > 0 ? (
                  <div className="rail-team-list">
                    {savedTeams.slice(0, 4).map((item) => {
                      const team = current?.teams.find(
                        (t) => t.id === item.teamId,
                      ) ||
                        knownTeams[`${sport}:${item.teamId}`] || {
                          id: item.teamId,
                          name: `Team ${item.teamId}`,
                          shortName: "TM",
                          color: "#526858",
                        };
                      return (
                        <div key={team.id}>
                          <TeamBadge team={team} small />
                          <span>{team.name}</span>
                          {renderSaveButton({ team })}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rail-empty">
                    <div>
                      <Star size={22} />
                      <span>+</span>
                    </div>
                    <strong>Your lineup starts here.</strong>
                    <p>Follow your teams to keep their games one tap away.</p>
                    <button
                      className="dark-button"
                      onClick={() => navigate("favorites")}
                    >
                      Explore teams <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                <div className="saved-location">
                  <span className="status-dot" />
                  {account.user
                    ? "Synced to your profile"
                    : guestStorageAvailable
                      ? "Saved on this device"
                      : "Saved for this session"}
                </div>
              </section>
              <section className="rail-panel updates-panel">
                <div className="rail-heading">
                  <h2>
                    <Bell size={17} />
                    Game-day updates
                  </h2>
                  <button
                    className={`toggle ${updates ? "on" : ""}`}
                    role="switch"
                    aria-checked={updates}
                    aria-label="Enable in-app game-day updates"
                    disabled={preferenceBusy || !accountLoaded}
                    onClick={() => void toggleUpdates()}
                  >
                    <span />
                  </button>
                </div>
                <p className="rail-subtitle">
                  A quick check on the teams you follow.
                </p>
                {updates && favoriteMatches.length > 0 ? (
                  <div className="update-list">
                    {favoriteMatches.slice(0, 3).map((match) => (
                      <button key={match.id} onClick={() => setDetail(match)}>
                        <span
                          className={`update-icon ${match.status === "live" ? "live" : ""}`}
                        >
                          <Activity size={15} />
                        </span>
                        <span>
                          <strong>
                            {match.home.shortName} vs {match.away.shortName}
                          </strong>
                          <small>
                            {match.status === "live"
                              ? `In play · ${match.homeScore ?? 0} – ${match.awayScore ?? 0}`
                              : match.status === "upcoming"
                                ? `Starts ${time(match.startsAt)}`
                                : match.status === "finished"
                                  ? `Final · ${match.homeScore} – ${match.awayScore}`
                                  : "Postponed"}
                          </small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="update-placeholder">
                    <span>
                      <Clock3 size={21} />
                    </span>
                    <p>
                      {updates
                        ? "Follow a team to see its games and scores here."
                        : "Turn on updates to see your teams’ match-day activity here."}
                    </p>
                  </div>
                )}
                <p className="rail-footnote">
                  In-app updates while Sideline is open.
                </p>
              </section>
              <section className="fan-note">
                <span className="fan-note-icon">
                  <Goal size={23} />
                </span>
                <span className="eyebrow">FOR THE LOVE OF THE GAME</span>
                <h3>
                  Different sports.
                  <br />
                  Same obsession.
                </h3>
                <p>
                  From the first whistle to the final out, find your next
                  favorite moment.
                </p>
                <div className="sports-dots">
                  <span>⚽</span>
                  <span>🏀</span>
                  <span>⚾</span>
                  <span>ONE SIDELINE.</span>
                </div>
              </section>
              {!account.user && (
                <button
                  className="profile-prompt"
                  disabled={!accountLoaded}
                  onClick={() => {
                    setAuthError("");
                    setAuthMode("register");
                  }}
                >
                  <span className="profile-prompt-icon">
                    <UsersRound size={18} />
                  </span>
                  <span>
                    <strong>Make it your Sideline.</strong>
                    <small>Create a profile to sync your teams.</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              )}
            </aside>
          </div>
          <footer className="main-footer">
            <span>
              sideline<span>·</span>A better seat for every fan.
            </span>
            <button onClick={() => setHelp(true)}>
              Data &amp; how it works <ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {authMode && (
        <Modal
          title={
            authMode === "login"
              ? "Welcome back to Sideline."
              : "A profile for your game."
          }
          onClose={() => !authBusy && setAuthMode(null)}
        >
          <p className="modal-intro">
            {authMode === "login"
              ? "Sign in to bring your favorite teams with you."
              : "Save your teams and keep your match day in sync."}
          </p>
          {account.storage === "unconfigured" && (
            <div className="auth-setup-note">
              <Shield size={17} />
              <span>
                Profiles need a configured PostgreSQL database. You can explore
                and save teams on this device now.
              </span>
            </div>
          )}
          <form onSubmit={authenticate} className="auth-form">
            {authMode === "register" && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  authMode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={authMode === "register" ? 10 : 1}
                maxLength={128}
                placeholder={
                  authMode === "register"
                    ? "At least 10 characters"
                    : "Your password"
                }
              />
            </label>
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
            <button
              className="primary-button"
              disabled={authBusy}
              type="submit"
            >
              {authBusy
                ? "One moment…"
                : authMode === "login"
                  ? "Sign in"
                  : "Create profile"}
              {!authBusy && <ArrowRight size={16} />}
            </button>
          </form>
          <p className="auth-switch">
            {authMode === "login"
              ? "New to the sideline?"
              : "Already have a profile?"}{" "}
            <button
              disabled={authBusy}
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
            >
              {authMode === "login" ? "Create a profile" : "Sign in"}
            </button>
          </p>
          <p className="modal-smallprint">
            Guest favorites stay on this device. Your profile has its own saved
            teams.
          </p>
        </Modal>
      )}
      {detail && (
        <Modal title="Inside the match" onClose={() => setDetail(null)} wide>
          <div className="detail-competition">
            <Trophy size={15} />
            {detail.league}
            <span className={`match-status ${detail.status}`}>
              {detail.status === "live"
                ? `LIVE ${detail.clock || ""}`
                : detail.status.toUpperCase()}
            </span>
          </div>
          <div className="detail-scoreboard">
            <div>
              <TeamBadge team={detail.home} />
              <h3>{detail.home.name}</h3>
              {renderSaveButton({ team: detail.home, label: true })}
            </div>
            <strong>
              {detail.homeScore ?? "–"}
              <span>:</span>
              {detail.awayScore ?? "–"}
            </strong>
            <div>
              <TeamBadge team={detail.away} />
              <h3>{detail.away.name}</h3>
              {renderSaveButton({ team: detail.away, label: true })}
            </div>
          </div>
          <div className="detail-info">
            <div>
              <CalendarDays size={18} />
              <span>
                Date
                <strong>
                  {new Date(detail.startsAt).toLocaleDateString([], {
                    weekday: "short",
                    month: "long",
                    day: "numeric",
                  })}
                </strong>
              </span>
            </div>
            <div>
              <Clock3 size={18} />
              <span>
                Start time<strong>{time(detail.startsAt)} (your time)</strong>
              </span>
            </div>
            <div>
              <Goal size={18} />
              <span>
                Venue<strong>{detail.venue || "To be confirmed"}</strong>
              </span>
            </div>
          </div>
          <div className="detail-note">
            <Activity size={17} />
            <p>
              {current?.mode === "demo"
                ? "This is a sample game. Scores and statistics are for demonstration."
                : "Scores are supplied by API-Sports and refresh every 60 seconds. Coverage and delays depend on your provider plan."}
            </p>
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title="Your seat on the Sideline."
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <div>
              <span className="help-number">01</span>
              <h3>Three sports. One match center.</h3>
              <p>
                Switch between football, basketball, and baseball. Match dates
                use UTC; start times appear in your device’s timezone.
              </p>
            </div>
            <div>
              <span className="help-number">02</span>
              <h3>Know where the data comes from.</h3>
              <p>
                Demo mode uses sample games and season statistics. An API-Sports
                key enables real data for configured competitions. Provider
                coverage and plan limits apply.
              </p>
            </div>
            <div>
              <span className="help-number">03</span>
              <h3>Keep your teams close.</h3>
              <p>
                Guest favorites are stored on this device. Sign in with a
                PostgreSQL-backed profile to sync them across devices. In-app
                game-day updates refresh while you keep Sideline open.
              </p>
            </div>
          </div>
          <button className="primary-button" onClick={() => setHelp(false)}>
            Back to the action <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}
