// Grateful — send-reminders (Supabase Edge Function)
//
// Every 5 minutes (via cron) it checks who wants a reminder around now in
// their own time zone, skips anyone who has already journaled today, and
// sends a gentle notification. The app can also call it with
// { test: true } to send a test notification to the signed-in person.
//
// Secrets needed (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (VAPID_SUBJECT optional)
// The scheduled run needs no password: it only ever sends reminders that are
// due, at most once per person per day, so extra calls are harmless.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "https://yongtimvenetia-wq.github.io/grateful/",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const MESSAGES = [
  "What's one good thing today? 🌿",
  "A small good thing from today — want to write it down?",
  "Take a quiet minute. What are you grateful for today?",
  "Before the day ends: one thing that made you smile?",
];
const SEND_WINDOW_MIN = 30; // send within 30 minutes after the chosen time

type Row = {
  user_id: string; endpoint: string; p256dh: string; auth: string;
  remind_time: string; timezone: string; enabled: boolean; last_sent_date: string | null;
};

function localNow(tz: string, now: Date) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return localNow("UTC", now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

async function push(row: Row, payload: Record<string, string>) {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      // The phone no longer accepts notifications for this subscription — tidy up.
      await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
    } else {
      console.error("push failed", code, e);
    }
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));

  // ----- Test notification for the signed-in person -----
  if (body && body.test) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Not signed in" }, 401);
    const { data: rows } = await admin.from("push_subscriptions").select("*").eq("user_id", user.id);
    let sent = 0;
    for (const row of (rows || []) as Row[]) {
      if (await push(row, { title: "Grateful", body: "Reminders are on 🌿 We'll nudge you gently each day.", url: "./" })) sent++;
    }
    return json({ sent });
  }

  // ----- Scheduled run (cron) -----
  const now = new Date();
  const { data: rows, error } = await admin.from("push_subscriptions").select("*").eq("enabled", true);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, skipped = 0;
  for (const row of (rows || []) as Row[]) {
    const { date, minutes } = localNow(row.timezone || "UTC", now);
    if (row.last_sent_date === date) continue;
    const [h, m] = row.remind_time.split(":").map(Number);
    const target = h * 60 + m;
    if (minutes < target || minutes > target + SEND_WINDOW_MIN) continue;

    // Already journaled today? Then no nudge needed.
    const sinceMidnight = new Date(now.getTime() - minutes * 60_000 - now.getUTCSeconds() * 1000).toISOString();
    const { count } = await admin.from("entries").select("id", { count: "exact", head: true })
      .eq("user_id", row.user_id).gte("created_at", sinceMidnight);

    if (!count) {
      const msg = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
      if (!(await push(row, { title: "Grateful", body: msg, url: "./" }))) continue;
      sent++;
    } else {
      skipped++;
    }
    await admin.from("push_subscriptions").update({ last_sent_date: date }).eq("endpoint", row.endpoint);
  }
  return json({ checked: rows?.length || 0, sent, skipped_already_journaled: skipped });
});
