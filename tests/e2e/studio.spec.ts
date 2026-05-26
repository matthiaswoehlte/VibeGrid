import { test, expect } from '@playwright/test';

test.describe('studio shell — smoke', () => {
  test('page loads with title VibeGrid and canvas is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/VibeGrid/);
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('TopBar exposes a play control', async ({ page }) => {
    await page.goto('/');
    // useAudioEngine mounts the engine asynchronously; transport is rendered
    // immediately but its handler is a no-op until the engine resolves.
    await expect(page.getByRole('button', { name: /^Play$/ })).toBeVisible();
  });

  test('LeftPanel shows Media / FX / Layers tabs', async ({ page }) => {
    await page.goto('/');
    // Tabs render uppercase via CSS but the DOM text is lowercase ("media" etc).
    await expect(page.getByRole('button', { name: 'media' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'fx' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'layers' })).toBeVisible();
  });

  test('Inspector shows the empty-selection hint initially', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Wähle einen Clip oder Effekt aus.')).toBeVisible();
  });

  test('no uncaught JS errors during initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    // Give hooks (useAudioEngine, useRenderer, store rehydrate) a beat.
    await page.waitForTimeout(2000);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
