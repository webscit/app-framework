import { expect, test } from "@playwright/test";

const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

test("renders the application shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-testid='shell-layout']").first()).toBeVisible();
});

test("renders the dashboard local component", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-testid='dashboard']")).toBeVisible();
});

test("backend health endpoint returns ok", async ({ request }) => {
  const response = await request.get(`${backendUrl}/health`);
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
