import { expect, test } from '@playwright/test'

test('Cloudflare port renders the core map workflow without Winston chat', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'

  await page.goto(baseUrl)

  await expect(
    page.getByRole('heading', {
      name: /AI-Powered Atmospheric Intelligence/i,
    }),
  ).toBeVisible()

  await page.getByRole('link', { name: /Launch Grid Map/i }).click()

  await expect(page).toHaveURL(/\/map/)
  await expect(page.getByRole('link', { name: 'Yaad Guard' })).toBeVisible()
  await expect(page.getByLabel('Search locations')).toBeVisible()
  await expect(page.getByText('Region Insights')).toBeVisible()
  await expect(
    page.getByText('Select a grid cell to enable rainfall simulation'),
  ).toBeVisible()
  await expect(page.getByText(/Ask Winston|Winston is checking/i)).toHaveCount(
    0,
  )

  await page.getByLabel('Search locations').fill('Kingston, Jamaica')
  const firstSuggestion = page.locator('.map-page__dropdown button').first()
  await expect(firstSuggestion).toBeVisible({ timeout: 20_000 })
  await firstSuggestion.click()

  const sidebar = page.locator('.map-page__sidebar')
  await expect(sidebar.getByText('Average Elevation')).toBeVisible({
    timeout: 90_000,
  })
  await expect(sidebar.getByText('Storm Surge Risk')).toBeVisible()
  await expect(sidebar.getByText('Historical Hurricane Activity')).toBeVisible()
  await expect(sidebar.getByText('Estimated Population:')).toBeVisible({
    timeout: 90_000,
  })
  await expect(sidebar.getByText('Land-Cover Context')).toBeVisible()
  await expect(sidebar.getByText('Built-up')).toBeVisible()
  await expect(sidebar.getByText('Tree Cover')).toBeVisible()
})
