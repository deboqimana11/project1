import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function loadDemoBundle(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByText('Load the demo bundle to render sample pages.')).toBeVisible()
  const loadButton = page.getByRole('button', { name: 'Load demo bundle' })
  await expect(loadButton).toBeEnabled()
  await loadButton.click()
  await expect(page.getByText(/Cache: 1200 pages/)).toBeVisible()
  // Verify the active source id in the toolbar, not transient toasts.
  const nowReading = page.getByTestId('now-reading-source')
  await expect(nowReading).toHaveText(/mock-\d+/)
}

test('loads the demo bundle and surfaces stats', async ({ page }) => {
  await loadDemoBundle(page)

  await expect(page.getByText(/Cache: 1200 pages/)).toBeVisible()
  await expect(page.getByText(/Now reading/)).toBeVisible()
  // Verify the active thumb is page 1 via aria-current marker.
  const activeThumb = page.locator('[data-testid="thumb-scroll"] button[aria-current="page"]')
  await expect(activeThumb).toBeVisible()
  await expect(activeThumb).toContainText('Page 1')
})

test('supports navigation and layout toggles', async ({ page }) => {
  await loadDemoBundle(page)

  const pageCounter = page.getByLabel('Reader controls', { exact: true }).getByText('1 / 1200')
  await expect(pageCounter).toBeVisible()

  await page.getByRole('button', { name: 'Forward' }).click()
  await expect(page.getByLabel('Reader controls', { exact: true }).getByText('2 / 1200')).toBeVisible()

  const doubleLayout = page.getByRole('button', { name: 'Double page' })
  await page.keyboard.press('KeyD')
  await expect(doubleLayout).toHaveAttribute('aria-pressed', 'true')
  // Advance until a true 2-page spread shows up (mock data marks every 3rd page as double-spread single).
  const canvases = page.locator('[data-testid="reader-surface"] canvas')
  for (let i = 0; i < 4; i += 1) {
    if ((await canvases.count()) === 2) break
    await page.getByRole('button', { name: 'Forward' }).click()
  }
  await expect(canvases).toHaveCount(2)

  const verticalLayout = page.getByRole('button', { name: 'Long strip' })
  await page.keyboard.press('KeyC')
  // Instead of asserting aria-pressed (DOM re-creation can detach the button),
  // assert that vertical layout inflates canvas count beyond 2.
  await page.waitForTimeout(50)
  const canvasesAfter = page.locator('[data-testid="reader-surface"] canvas')
  await expect(await canvasesAfter.count()).toBeGreaterThan(2)
})

test('renders virtualized thumbnails for deep page counts', async ({ page }) => {
  await loadDemoBundle(page)

  const sidebarScroller = page.getByTestId('thumb-scroll')
  await expect(sidebarScroller).toBeVisible()
  await sidebarScroller.evaluate((node) => {
    node.scrollTo({ top: node.scrollHeight })
  })
  await expect(page.getByRole('button', { name: /^Page 1200\b/ })).toBeVisible()

  await page.getByPlaceholder('Filter pages').fill('page_0450')
  await expect(page.getByRole('button', { name: 'Page 450' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Page 1200' })).toHaveCount(0)
})

test('passes axe accessibility audit for the reader surface', async ({ page }) => {
  await loadDemoBundle(page)

  const axe = new AxeBuilder({ page })
    .include('[data-testid="reader-surface"]')
    .withTags(['wcag2a', 'wcag2aa'])
  const results = await axe.analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
})
