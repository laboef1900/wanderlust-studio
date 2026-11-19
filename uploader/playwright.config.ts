import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  // Traces stay off unless a check fails; a failed run without its trace is unreproducible.
  use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 }, actionTimeout: 15_000, navigationTimeout: 30_000, trace: 'retain-on-failure', video: 'off', screenshot: 'only-on-failure' },
});
