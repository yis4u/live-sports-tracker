import { expect, test, type Page } from "@playwright/test";
import type { DashboardData } from "../../lib/types";

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.locator(".demo-notice")).toBeVisible();
  await expect(page.locator(".match-card")).toHaveCount(6);
}

test("browse sports, filter scores, select dates and read standings and players", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /^Live\s*2$/ }).click();
  await expect(page.locator(".match-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  await expect(page.locator(".match-card")).toHaveCount(1);
  await page.getByRole("button", { name: "All games", exact: true }).click();
  await page.getByRole("searchbox").fill("no-such-team");
  await expect(page.getByText("No games in this view.")).toBeVisible();
  await page.getByRole("button", { name: /Clear filters/ }).click();
  await expect(page.locator(".match-card")).toHaveCount(6);
  const date = page.getByLabel("Match date in UTC");
  await date.fill("2026-10-18");
  await expect(date).toHaveValue("2026-10-18");
  await expect(page.locator(".match-card")).toHaveCount(6);
  await page
    .locator(".sport-tabs")
    .getByRole("button", { name: /Basketball/ })
    .click();
  await expect(page.locator(".schedule-label")).toContainText("Basketball");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Standings" })
    .click();
  await expect(page.locator(".standings-table tbody tr")).toHaveCount(12);
  await expect(page.getByRole("columnheader", { name: "WIN %" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Players" })
    .click();
  await expect(page.locator(".player-row")).toHaveCount(6);
  await page
    .locator(".sport-tabs")
    .getByRole("button", { name: /Baseball/ })
    .click();
  await expect(page.locator(".season-label")).toContainText("Baseball");
  await expect(page.locator(".player-stat").first()).toContainText("AVG");
});

test("guest favorites survive reload; updates and match dialog work with keyboard", async ({
  page,
}) => {
  await openDashboard(page);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /My teams/ })
    .click();
  const discovery = page.locator(".discover-team").first();
  const follow = discovery.getByRole("button");
  const name = (await follow.getAttribute("aria-label"))!.replace(
    /^Follow /,
    "",
  );
  await follow.click();
  await expect(
    discovery.getByRole("button", { name: `Unfollow ${name}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator(".demo-notice")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /My teams/ })
    .click();
  await expect(
    page
      .locator(".favorite-team-card")
      .getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  const updates = page.getByRole("switch", {
    name: "Enable in-app game-day updates",
  });
  await updates.click();
  await expect(updates).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".update-list button")).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Match center", exact: true })
    .click();
  const opener = page.locator(".match-main").first();
  await opener.click();
  await expect(
    page.getByRole("dialog", { name: "Inside the match" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("provider failures show an error and retry recovers", async ({ page }) => {
  await page.route("**/api/dashboard?*", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Sports provider is unavailable." }),
    }),
  );
  await page.goto("/");
  await expect(page.locator(".error-banner[role=alert]")).toContainText(
    "Sports provider is unavailable.",
  );
  await expect(page.locator(".match-card")).toHaveCount(0);
  await page.unroute("**/api/dashboard?*");
  await page.getByRole("button", { name: /Try again/ }).click();
  await expect(page.locator(".match-card")).toHaveCount(6);
  await expect(page.locator(".error-banner[role=alert]")).toHaveCount(0);
});

test("mobile layout, navigation and corrupt browser storage remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "sideline.teams.v1",
      JSON.stringify({ bad: "not-a-team" }),
    );
    localStorage.setItem(
      "sideline.favorites.v1",
      JSON.stringify([null, { sport: "hockey" }, "invalid"]),
    );
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDashboard(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Standings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "League standings" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate(
        (element) => element.getBoundingClientRect().width <= window.innerWidth,
      ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("profile favorites and update preferences persist after sign out and sign in", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_ACCOUNTS !== "1",
    "Requires a migrated disposable PostgreSQL database.",
  );
  await openDashboard(page);
  const email = `e2e-${Date.now()}@example.test`;
  const password = "local-test-password-842";
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Create a profile", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Test Fan");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".account-name")).toHaveText("Test Fan");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /My teams/ })
    .click();
  const follow = page.locator(".discover-team").first().getByRole("button");
  const team = (await follow.getAttribute("aria-label"))!.replace(
    /^Follow /,
    "",
  );
  await follow.click();
  await expect(page.locator(".favorite-team-card")).toHaveCount(1);
  await page
    .getByRole("switch", { name: "Enable in-app game-day updates" })
    .click();
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .locator(".favorite-team-card")
      .getByRole("heading", { name: team, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.reload();
  await expect(page.locator(".account-name")).toHaveText("Test Fan");
});

test("conference standings retain group labels and avoid an overall ranking claim", async ({
  page,
}) => {
  await page.route("**/api/dashboard?*", async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as DashboardData;
    data.mode = "live";
    data.standings = data.standings.slice(0, 2).map((row, i) => ({
      ...row,
      rank: 1,
      group: i ? "West Conference" : "East Conference",
    }));
    data.notice = "Ranks apply within each conference.";
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await expect(page.locator(".mini-standings")).toContainText(
    "Standings snapshot",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Standings" })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "Group", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "East Conference", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "West Conference", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".table-legend")).toContainText("within");
});

test("an open match dialog receives refreshed scores", async ({ page }) => {
  await page.clock.install();
  let fetches = 0;
  await page.route("**/api/dashboard?*", async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as DashboardData;
    if (fetches++ > 0) data.matches[0].homeScore = 9;
    await route.fulfill({ json: data });
  });
  await openDashboard(page);
  await page.locator(".match-main").first().click();
  await expect(page.locator(".detail-scoreboard > strong")).toHaveText("2:1");
  await page.clock.fastForward(61_000);
  await expect(page.locator(".detail-scoreboard > strong")).toHaveText("9:1");
});
