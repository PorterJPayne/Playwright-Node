import { Router } from "express";
import { scrapeTickets } from "../lib/scraper";
import { supabase } from "../lib/supabase";

const router = Router();

router.post("/scrape", async (req, res) => {
  req.log.info("Starting OfficerND ticket scrape");

  try {
    const tickets = await scrapeTickets();

    if (tickets.length === 0) {
      res.json({
        success: true,
        message: "Scrape completed but no tickets found. The page structure may have changed.",
        inserted: 0,
        tickets: [],
      });
      return;
    }

    const rows = tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assignee,
      priority: t.priority,
      type: t.type,
      reporter: t.reporter,
      description: t.description,
      created_at: t.created_at,
      updated_at: t.updated_at,
      raw: t.raw,
      scraped_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("tickets")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: false })
      .select();

    if (error) {
      req.log.error({ error }, "Supabase upsert failed");
      res.status(500).json({
        success: false,
        error: error.message,
        hint: "Make sure the 'tickets' table exists in Supabase. See /api/scrape/schema for the required SQL.",
      });
      return;
    }

    req.log.info({ count: data?.length }, "Tickets upserted to Supabase");

    res.json({
      success: true,
      inserted: data?.length ?? 0,
      total_scraped: tickets.length,
      tickets,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err: message }, "Scrape failed");
    res.status(500).json({ success: false, error: message });
  }
});

router.get("/scrape/schema", (_req, res) => {
  res.json({
    description: "Run this SQL in your Supabase SQL editor to create the required table",
    sql: `
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT,
  assignee TEXT,
  priority TEXT,
  type TEXT,
  reporter TEXT,
  description TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  raw JSONB
);
    `.trim(),
  });
});

export default router;
