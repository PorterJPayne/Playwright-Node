import { chromium } from "playwright";
import { logger } from "./logger";

export interface Ticket {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  created_at: string | null;
  updated_at: string | null;
  description: string | null;
  priority: string | null;
  type: string | null;
  reporter: string | null;
  raw: Record<string, unknown>;
}

const OFFICERND_URL =
  "https://app.officernd.com/admin/kiln/collaboration/issues?status=open&status=new&assignedTo=null&assignedTo=69eb87d26739c665abc204d3&key=dashboard";

export async function scrapeTickets(): Promise<Ticket[]> {
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

    await page.waitForTimeout(2000);

    logger.info("Extracting ticket data from page");

    const tickets = await extractTicketsFromPage(page);
    let allTickets = [...tickets];
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      const nextBtn = page.locator(
        'button[aria-label="Next page"], button:has-text("Next"), [data-testid="next-page"], .pagination-next:not([disabled])'
      );
      const isVisible = await nextBtn.isVisible().catch(() => false);
      if (!isVisible) {
        hasNextPage = false;
        break;
      }
      const isDisabled = await nextBtn.isDisabled().catch(() => true);
      if (isDisabled) {
        hasNextPage = false;
        break;
      }

      pageNum++;
      logger.info({ page: pageNum }, "Navigating to next page of tickets");
      await nextBtn.click();
      await page.waitForTimeout(2000);
      const more = await extractTicketsFromPage(page);
      allTickets = [...allTickets, ...more];
    }

    logger.info({ count: allTickets.length }, "Scrape complete");
    return allTickets;
  } finally {
    await browser.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractTicketsFromPage(page: any): Promise<Ticket[]> {
  // page.evaluate runs inside browser context — use any to avoid DOM type conflicts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = await page.evaluate(() => {
    /* global document */
    // @ts-ignore
    const tickets: unknown[] = [];

    // @ts-ignore
    const rows = document.querySelectorAll(
      "tr[data-id], [data-issue-id], .issue-row, .ticket-row, tbody tr"
    );

    // @ts-ignore
    rows.forEach((row) => {
      // @ts-ignore
      const getText = (selector) =>
        row.querySelector(selector)?.textContent?.trim() ?? null;

      const id =
        row.getAttribute("data-id") ||
        row.getAttribute("data-issue-id") ||
        getText("[data-field='id'], .issue-id, .ticket-id, td:first-child") ||
        "";

      const title =
        getText(
          "[data-field='title'], .issue-title, .ticket-title, td:nth-child(2), .name"
        ) ||
        row.textContent?.trim().slice(0, 100) ||
        "";

      const status =
        getText(
          "[data-field='status'], .status, .badge, .chip, [class*='status']"
        ) || "";

      const assignee = getText(
        "[data-field='assignee'], .assignee, [class*='assignee']"
      );
      const priority = getText(
        "[data-field='priority'], .priority, [class*='priority']"
      );
      const type = getText("[data-field='type'], .type, [class*='type']");
      const reporter = getText(
        "[data-field='reporter'], .reporter, [class*='reporter']"
      );

      const createdAtEl = row.querySelector(
        "[data-field='createdAt'], [data-field='created'], .created-at, [datetime]"
      );
      const createdAt =
        createdAtEl?.getAttribute("datetime") ||
        getText(
          "[data-field='createdAt'], [data-field='created'], .created-at"
        ) ||
        null;

      const updatedAtEl = row.querySelector(
        "[data-field='updatedAt'], [data-field='updated'], .updated-at"
      );
      const updatedAt =
        updatedAtEl?.getAttribute("datetime") ||
        getText("[data-field='updatedAt'], [data-field='updated'], .updated-at") ||
        null;

      const description = getText(
        "[data-field='description'], .description, .issue-body"
      );

      if (!id && !title) return;

      tickets.push({
        id: id || "unknown-" + Math.random(),
        title,
        status,
        assignee,
        priority,
        type,
        reporter,
        created_at: createdAt,
        updated_at: updatedAt,
        description,
        raw: { rowHtml: row.innerHTML?.slice(0, 2000) },
      });
    });

    if (tickets.length === 0) {
      // @ts-ignore
      const cards = document.querySelectorAll(
        "[class*='issue'], [class*='ticket'], [class*='card']"
      );
      // @ts-ignore
      cards.forEach((card) => {
        const id = card.getAttribute("data-id") || card.getAttribute("id") || "";
        const title =
          card
            .querySelector("h1,h2,h3,h4,[class*='title']")
            ?.textContent?.trim() || "";
        const status =
          card
            .querySelector("[class*='status'],[class*='badge']")
            ?.textContent?.trim() || "";

        if (title) {
          tickets.push({
            id: id || "card-" + Math.random(),
            title,
            status,
            assignee: null,
            priority: null,
            type: null,
            reporter: null,
            created_at: null,
            updated_at: null,
            description: null,
            raw: { cardHtml: card.innerHTML?.slice(0, 2000) },
          });
        }
      });
    }

    return tickets;
  });

  return raw as Ticket[];
}
