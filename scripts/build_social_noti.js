// scripts/build_social_noti.js

require("dns").setDefaultResultOrder("ipv4first"); // still fine to keep
process.env.TZ = "Asia/Kuala_Lumpur";

const dns = require("dns").promises;
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

// --- helpers for MY day labels ---
function ymdInTZ(d, tz = "Asia/Kuala_Lumpur") {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function whenLabel(updatedAtIso) {
  const now = new Date();
  const today = ymdInTZ(now);
  const upd = new Date(updatedAtIso);
  const updDay = ymdInTZ(upd);
  if (updDay === today) return "Hari Ini";
  const toMs = s => Date.parse(s + "T00:00:00");
  const diffDays = Math.round((toMs(today) - toMs(updDay)) / 86400000);
  return `${diffDays} hari yang lalu`;
}

async function run() {
  const connStr = process.env.SUPABASE_DB_URL;
  if (!connStr) {
    console.error("Missing SUPABASE_DB_URL env var.");
    process.exit(1);
  }

  // Parse the DSN safely
  const u = new URL(connStr);
  const hostname = u.hostname;                 // db.xxxxxx.supabase.co
  const port = Number(u.port || 5432);
  const database = u.pathname.replace(/^\//, ""); // "postgres" etc.
  const user = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);

  // Resolve to IPv4 explicitly and use the IP as host
  // If multiple A records exist, take the first.
  const aRecords = await dns.resolve4(hostname);
  const hostIPv4 = aRecords[0];

  console.log("Resolved", hostname, "to IPv4", hostIPv4);
  const client = new Client({
    host: hostIPv4,       // <-- bypass DNS at connect time
    port,
    database,
    user,
    password,
    ssl: { rejectUnauthorized: false },
    // NOTE: no need for custom lookup now; we're dialing the IP directly.
  });

  await client.connect();

  // Keep timestamptz from DB, do TZ math in JS
  const sql = `
    SELECT 
      c.full_name AS name,
      o.product_name AS "productName",
      o.updated_at AS updated_at
    FROM public.orders o
    JOIN public.customers c ON c.customer_id = o.customer_id
    WHERE o.order_status = 'paid'
    ORDER BY o.updated_at DESC
    LIMIT 30;
  `;
  const { rows } = await client.query(sql);
  await client.end();

  const data = rows.map(r => ({
    name: r.name,
    productName: r.productName,
    when: whenLabel(r.updated_at)
  }));

  const outPath = path.join(process.cwd(), "data", "social_noti.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Wrote ${data.length} records to ${outPath}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
