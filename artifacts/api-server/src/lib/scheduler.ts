import cron from "node-cron";
import { scrapeTickets } from "./scraper";
import { supabase } from "./supabase";
import { logger } from "./logger";

async function runScrapeJob() {
  logger.info("Scheduled scrape starting");

  try {
    const issues = await scrapeTickets();

    if (issues.length === 0) {
      logger.info("Scheduled scrape found no issues on the page");
      return;
    }

    const ticketNumbers = issues.map((i) => i.ticket).filter(Boolean);

    const { data: existingRows, error: fetchError } = await supabase
      .from("tasks")
      .select("ticket")
      .in("ticket", ticketNumbers);

    if (fetchError) {
      logger.error({ error: fetchError }, "Scheduled scrape: failed to fetch existing tasks");
      return;
    }

    const existingSet = new Set(
      (existingRows ?? []).map((r: { ticket: string }) => String(r.ticket))
    );

    const newIssues = issues.filter(
      (i) => i.ticket && !existingSet.has(String(i.ticket))
    );

    logger.info(
      { total: issues.length, new: newIssues.length, existing: existingSet.size },
      "Scheduled scrape deduplication"
    );

    if (newIssues.length === 0) {
      logger.info("Scheduled scrape: no new issues to insert");
      return;
    }

    const rows = newIssues.map((issue) => ({
      title: issue.title,
      description: issue.description ?? null,
      ticket: issue.ticket || null,
      link: issue.link ?? null,
      completed: false,
      completed_at: null,
      email_added: false,
      email_category: null,
      email_report: null,
      completion_notes: null,
      priority: "normal",
      building: "Kiln",
      scheduled_day: null,
      rollover_count: 0,
      recurring: false,
      recurring_type: null,
      archived: false,
    }));

    const { data, error } = await supabase.from("tasks").insert(rows).select();

    if (error) {
      logger.error({ error }, "Scheduled scrape: Supabase insert failed");
      return;
    }

    logger.info({ inserted: data?.length ?? 0 }, "Scheduled scrape complete — tasks inserted");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "Scheduled scrape failed");
  }
}

export function startScheduler() {
  // Every 15 minutes, Monday–Sunday, 6:00am–6:45pm (last run 18:45)
  // To also catch 7:00pm on the dot, hour range is extended to 19 with minute 0 only via the expression below
  // Expression: at minutes 0,15,30,45 of hours 6 through 18 — runs 6:00 → 18:45
  const schedule = "0,15,30,45 6-18 * * *";

  cron.schedule(schedule, () => {
    void runScrapeJob();
  });

  logger.info(
    { schedule },
    "OfficerND scrape scheduler started — runs every 15 min, 6am–6:45pm"
  );
}
