import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const SHOTS = path.resolve(__dirname, '../../../docs/screenshots');
export const API = 'http://localhost:4000';

export async function loginAs(page: Page, userId: string) {
  await page.goto('/');
  await page.getByTestId(`persona-${userId}`).click();
  await page.waitForURL((u) => u.pathname !== '/');
}

export async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** API call as a given demo user, used only to set up what another actor would do elsewhere. */
export async function apiAs(page: Page, userId: string, method: string, url: string, body?: unknown) {
  const login = await page.request.post(`${API}/v1/dev/login`, { data: { userId } });
  const { token } = await login.json();
  const res = await page.request.fetch(`${API}${url}`, { method, data: body, headers: { authorization: `Bearer ${token}` } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('.toast')).toContainText(text);
}
