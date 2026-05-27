import { Router } from "express";
import { scrapeTickets } from "../lib/scraper";
import { supabase } from "../lib/supabase";

const router = Router();

router.post("/scrape", async (req, res) => {
  req.log.info("Starting OfficerND ticket scrape");

  try {
    const issues = await scrapeTickets();

    if (issues.length === 0) {
      res.json({
        success: true,
        message: "Scrape completed but no issues found. The page structure may need selector updates.",
        inserted: 0,
        issues: [],
      });
      return;
    }

    // Fetch existing ticket numbers from tasks table to avoid duplicates
    const existingTicketNumbers = issues
      .map((i) => i.ticket)
      .filter(Boolean);

    const { data: existingRows, error: fetchError } = await supabase
      .from("tasks")
      .select("ticket")
      .in("ticket", existingTicketNumbers);

    if (fetchError) {
      req.log.error({ error: fetchError }, "Failed to fetch existing tasks");
      res.status(500).json({ success: false, error: fetchError.message });
      return;
    }

    const existingSet = new Set(
      (existingRows ?? []).map((r: { ticket: string }) => String(r.ticket))
    );

    // Only insert issues not already in the table
    const newIssues = issues.filter(
      (i) => i.ticket && !existingSet.has(String(i.ticket))
    );

    req.log.info(
      { total: issues.length, new: newIssues.length, existing: existingSet.size },
      "Deduplication complete"
    );

    if (newIssues.length === 0) {
      res.json({
        success: true,
        message: "All scraped issues already exist in the tasks table.",
        inserted: 0,
        skipped: issues.length,
        issues,
      });
      return;
    }

    // Map to tasks table schema — id is omitted, Supabase auto-generates it
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

    const { data, error } = await supabase
      .from("tasks")
      .insert(rows)
      .select();

    if (error) {
      req.log.error({ error }, "Supabase insert failed");
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    req.log.info({ count: data?.length }, "Tasks inserted to Supabase");

    res.json({
      success: true,
      inserted: data?.length ?? 0,
      skipped: issues.length - newIssues.length,
      total_scraped: issues.length,
      tasks: data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err: message }, "Scrape failed");
    res.status(500).json({ success: false, error: message });
  }
});

router.post("/scrape/test", async (req, res) => {
  req.log.info("Starting dry-run OfficerND ticket scrape");

  try {
    const issues = await scrapeTickets();

    if (issues.length === 0) {
      res.json({
        success: true,
        dry_run: true,
        message: "Scrape completed but no issues found. The page structure may need selector updates.",
        would_insert: 0,
        issues: [],
      });
      return;
    }

    const ticketNumbers = issues.map((i) => i.ticket).filter(Boolean);

    const { data: existingRows, error: fetchError } = await supabase
      .from("tasks")
      .select("ticket")
      .in("ticket", ticketNumbers);

    if (fetchError) {
      req.log.error({ error: fetchError }, "Dry-run: failed to fetch existing tasks");
      res.status(500).json({ success: false, error: fetchError.message });
      return;
    }

    const existingSet = new Set(
      (existingRows ?? []).map((r: { ticket: string }) => String(r.ticket))
    );

    const newIssues = issues.filter(
      (i) => i.ticket && !existingSet.has(String(i.ticket))
    );

    res.json({
      success: true,
      dry_run: true,
      message: "Nothing was written. This is a preview of what would be inserted.",
      total_scraped: issues.length,
      would_insert: newIssues.length,
      would_skip: issues.length - newIssues.length,
      new_issues: newIssues,
      existing_ticket_numbers: Array.from(existingSet),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err: message }, "Dry-run scrape failed");
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
