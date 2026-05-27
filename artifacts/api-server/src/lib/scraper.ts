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

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_PATH ||
      "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  });
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

    // Step 1: fill email (field has type="username" in the DOM)
    await page.fill('input[name="email"]', email);

    // Step 2: click Continue — AJAX call reveals #login-next-step with auth options
    await page.click('.continue-sso-button');
    logger.info("Clicked Continue, waiting for challenge form");

    // Step 3: wait for the challenge form to appear (contains both SSO and password options)
    await page.waitForSelector('#challenge-form', { state: "visible", timeout: 15000 });

    // Step 4: fill password directly into the password field
    await page.fill('#challenge-form input[name="password"]', password);
    logger.info("Filled password");

    // Step 5: click the "Sign In" submit button (NOT the SSO button which is type="button")
    await page.click('#challenge-form button[type="submit"]');
    logger.info("Clicked Sign In submit button");

    // Step 6: wait until we land on the admin area — confirms actual auth success
    await page.waitForURL(
      (url: URL) => url.pathname.includes("/admin/"),
      { timeout: 30000 }
    );

    logger.info({ url: page.url() }, "Login successful, navigating to issues list");
    await page.goto(OFFICERND_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    logger.info("Extracting ticket list from issues page");
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

    logger.info({ count: allIssues.length }, "List scrape complete, visiting detail pages");

    // Visit each issue's detail page to get the real title and description
    let firstDetail = true;
    for (const issue of allIssues) {
      if (!issue.link) continue;
      const detail = await scrapeIssueDetail(page, issue.link, firstDetail);
      firstDetail = false;
      if (detail.title) issue.title = detail.title;
      issue.description = detail.description;
    }

    logger.info({ count: allIssues.length }, "Scrape complete with full detail");
    return allIssues;
  } finally {
    await browser.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scrapeIssueDetail(page: any, link: string, logHtml = false): Promise<{ title: string; description: string | null }> {
  await page.goto(link, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  if (logHtml) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html: string = await page.evaluate(
      // @ts-ignore — runs in browser context
      () => document.body?.innerHTML?.slice(4000, 12000) ?? ""
    );
    logger.info({ link, html }, "Issue detail page HTML — right column area");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: { title: string; description: string | null } = await page.evaluate(() => {
    // @ts-ignore
    const el = (sel: string) => document.querySelector(sel)?.textContent?.trim() || null;

    // Title: OfficerND uses h4.rnd-title for the issue title
    const title =
      el('h4.rnd-title') ||
      el('h4[class*="rnd-title"]') ||
      el('h1') ||
      el('[class*="issue-title"]') ||
      el('.panel-title') ||
      el('[data-field="title"]') ||
      "";

    // Description: look for the issue body / notes in the right column
    const description =
      el('.col-md-9 p') ||
      el('[class*="description-text"]') ||
      el('[class*="issue-description"]') ||
      el('[class*="issue-body"]') ||
      el('[data-field="description"]') ||
      el('.description') ||
      null;

    return { title, description };
  });

  return result;
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
      const anchor = row.querySelector("a[href*='issues/'], a[href*='issue/']");
      const href = anchor?.getAttribute("href") ?? null;
      const link = href ? (href.startsWith("http") ? href : base + href) : null;

      // ticket = the human-readable display number (e.g. "#711867") from the anchor text
      const ticket =
        anchor?.textContent?.trim() ||
        row.querySelector("[data-field='number'], .issue-number, .ticket-number")?.textContent?.trim() ||
        row.getAttribute("data-id") ||
        row.getAttribute("data-issue-id") ||
        "";

      // title starts empty — will be filled in by the detail page visit
      const title = "";

      const description =
        row.querySelector("[data-field='description'], .description")?.textContent?.trim() || null;

      if (!ticket && !link) return;

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
