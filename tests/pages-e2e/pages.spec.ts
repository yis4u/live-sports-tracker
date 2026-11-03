import { expect, test, type Page } from "@playwright/test";

const basePath = "/live-sports-tracker/";

function watchBrowser(page: Page) {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return { apiRequests, errors };
}

async function openPagesApp(page: Page) {
  await page.goto(basePath);
  await expect(page.locator(".demo-notice")).toBeVisible();
  await expect(page.locator(".match-card")).toHaveCount(6);
}

test("Pages subpath renders the app, sports, filters, dates, standings and players without server requests", async ({
  page,
}) => {
  const browser = watchBrowser(page);
  await openPagesApp(page);
  await page
    .locator(".sport-tabs")
    .getByRole("button", { name: /Basketball/ })
    .click();
  await expect(page.locator(".schedule-label")).toContainText("Basketball");
  await page.getByRole("button", { name: /^Live\s*2$/ }).click();
  await expect(page.locator(".match-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  await expect(page.locator(".match-card")).toHaveCount(1);
  await page.getByRole("button", { name: "All games", exact: true }).click();
  await page.getByRole("searchbox").fill("no-such-team");
  await expect(page.getByText("No games in this view.")).toBeVisible();
  await page.getByRole("button", { name: /Clear filters/ }).click();
  await expect(page.locator(".match-card")).toHaveCount(6);
  await page.getByLabel("Match date in UTC").fill("2026-11-03");
  await expect(page.getByLabel("Match date in UTC")).toHaveValue("2026-11-03");

  const navigation = page.getByRole("navigation", {
    name: "Main navigation",
  });
  await navigation.getByRole("button", { name: "Standings" }).click();
  await expect(page.locator(".standings-table tbody tr")).toHaveCount(12);
  await expect(
    page.getByRole("columnheader", { name: "WIN %" }),
  ).toBeVisible();
  await navigation.getByRole("button", { name: "Players" }).click();
  await expect(page.locator(".player-row")).toHaveCount(6);
  await page
    .locator(".sport-tabs")
    .getByRole("button", { name: /Baseball/ })
    .click();
  await expect(page.locator(".season-label")).toContainText("Baseball");
  await expect(page.locator(".player-stat").first()).toContainText("AVG");
  expect(browser.apiRequests).toEqual([]);
  expect(browser.errors).toEqual([]);
});

test("Pages guest favorites survive reload, home remains in the repository path, and mobile drawer restores focus", async ({
  page,
}) => {
  const browser = watchBrowser(page);
  await openPagesApp(page);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /My teams/ })
    .click();
  const discovery = page.locator(".discover-team").first();
  const follow = discovery.getByRole("button");
  const teamName = (await follow.getAttribute("aria-label"))!.replace(
    /^Follow /,
    "",
  );
  await follow.click();
  await expect(
    discovery.getByRole("button", {
      name: `Unfollow ${teamName}`,
      exact: true,
    }),
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
      .getByRole("heading", { name: teamName, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sideline home" })).toHaveAttribute(
    "href",
    basePath,
  );
  await page.getByRole("link", { name: "Sideline home" }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:8788${basePath}`);
  await expect(page.locator(".match-card")).toHaveCount(6);
  await expect(page.locator(".rail-team-list")).toContainText(teamName);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const opener = page.getByRole("button", { name: "Open navigation" });
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(opener).toBeFocused();
  await expect(page.locator(".sidebar")).toBeHidden();
  expect(browser.apiRequests).toEqual([]);
  expect(browser.errors).toEqual([]);
});
