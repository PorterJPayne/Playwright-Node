import { chromium } from "playwright";
import { logger } from "./logger";

export interface ScrapedIssue {
  title: string;
  ticket: string;
  link: string | null;
  description: string | null;
}

const OFFICERND_BASE = "https://app.officernd.com";
const OFFICERND_URL =
  "https://app.officernd.com/admin/kiln/collaboration/issues?status=open&status=new&assignedTo=null&assignedTo=69eb87d26739c665abc204d3&key=dashboard";

export async function scrapeTickets(): Promise<ScrapedIssue[]> {
  const email = process.env.OFFICERND_EMAIL;
  const password = process.env.OFFICERND_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Missing OFFICERND_EMAIL or OFFICERND_PASSWORD environment variables"
    );
  }

  logger.info("Launching browser for OfficerND scrape");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    logger.info("Navigating to OfficerND login");
    await page.goto("https://app.officernd.com/login", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await page.fill(
      'input[type="email"], input[name="email"], input[placeholder*="email" i]',
      email
    );
    await page.fill(
      'input[type="password"], input[name="password"], input[placeholder*="password" i]',
      password
    );

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }),
      page.click(
        'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), input[type="submit"]'
      ),
    ]);

    logger.info("Logged in, navigating to issues page");
    await page.goto(OFFICERND_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await page.waitForTimeout(3000);

    logger.info("Extracting ticket data from page");

    const issues = await extractIssuesFromPage(page, OFFICERND_BASE);
    let allIssues = [...issues];
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      const nextBtn = page.locator(
        'button[aria-label="Next page"], button:has-text("Next"), [data-testid="next-page"], .pagination-next:not([disabled])'
      );
      const isVisible = await nextBtn.isVisible().catch(() => false);
      if (!isVisible) { hasNextPage = false; break; }
      const isDisabled = await nextBtn.isDisabled().catch(() => true);
      if (isDisabled) { hasNextPage = false; break; }

      pageNum++;
      logger.info({ page: pageNum }, "Navigating to next page");
      await nextBtn.click();
      await page.waitForTimeout(2000);
      const more = await extractIssuesFromPage(page, OFFICERND_BASE);
      allIssues = [...allIssues, ...more];
    }

    logger.info({ count: allIssues.length }, "Scrape complete");
    return allIssues;
  } finally {
    await browser.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractIssuesFromPage(page: any, baseUrl: string): Promise<ScrapedIssue[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = await page.evaluate((base: string) => {
    // @ts-ignore
    const issues: unknown[] = [];

    // Try table rows first
    // @ts-ignore
    const rows = document.querySelectorAll("tbody tr, tr[data-id], [data-issue-id]");

    // @ts-ignore
    rows.forEach((row) => {
      // Anchor tag that links to the issue
      const anchor = row.querySelector("a[href*='issues/'], a[href*='issue/']");
      const href = anchor?.getAttribute("href") ?? null;
      const link = href ? (href.startsWith("http") ? href : base + href) : null;

      // Extract ticket number from the link or from a dedicated field
      let ticket = "";
      if (link) {
        const match = link.match(/\/issues?\/([^/?#]+)/);
        if (match) ticket = match[1];
      }
      if (!ticket) {
        ticket =
          row.getAttribute("data-id") ||
          row.getAttribute("data-issue-id") ||
          row.querySelector("[data-field='number'], [data-field='id'], .issue-number, .ticket-number")?.textContent?.trim() ||
          "";
      }

      // Title: prefer the anchor text or a title field
      const title =
        anchor?.textContent?.trim() ||
        row.querySelector("[data-field='title'], [data-field='name'], .issue-title, .title")?.textContent?.trim() ||
        row.querySelector("td:nth-child(2), td:nth-child(1)")?.textContent?.trim() ||
        "";

      const description =
        row.querySelector("[data-field='description'], .description")?.textContent?.trim() || null;

      if (!title && !ticket) return;

      issues.push({ title, ticket, link, description });
    });

    // Fallback: card-based layout
    if (issues.length === 0) {
      // @ts-ignore
      const cards = document.querySelectorAll("[class*='issue-item'], [class*='ticket-item'], [class*='issue-card'], [class*='ticket-card']");
      // @ts-ignore
      cards.forEach((card) => {
        const anchor = card.querySelector("a[href*='issues/'], a[href*='issue/']");
        const href = anchor?.getAttribute("href") ?? null;
        const link = href ? (href.startsWith("http") ? href : base + href) : null;

        let ticket = "";
        if (link) {
          const match = link.match(/\/issues?\/([^/?#]+)/);
          if (match) ticket = match[1];
        }

        const title =
          card.querySelector("h1,h2,h3,h4,[class*='title']")?.textContent?.trim() || "";

        if (!title && !ticket) return;
        issues.push({ title, ticket, link, description: null });
      });
    }

    return issues;
  }, baseUrl);

  return raw as ScrapedIssue[];
}
