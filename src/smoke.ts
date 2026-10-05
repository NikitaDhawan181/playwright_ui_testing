import { chromium } from "playwright";

async function main() {
  console.log("Starting Playwright...");

  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  console.log("Opening website...");

  await page.goto("https://example.com");

  console.log("Page title:", await page.title());

  await page.waitForTimeout(5000);

  await browser.close();

  console.log("Test completed successfully.");
}

main().catch((error) => {
  console.error("Playwright test failed:", error);
  process.exit(1);
});