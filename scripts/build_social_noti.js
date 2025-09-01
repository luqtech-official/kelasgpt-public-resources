// scripts/build_social_noti.js
// Generates data/social_noti.json from Supabase (latest 30 PAID orders).

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

// Always use Malaysia time for "Hari Ini / Semalam"
process.env.TZ = "Asia/Kuala_Lumpur";

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

  if (diffDays === 1) return "Semalam";
  return `${diffDays} hari lalu`;
}

async function run() {
  const connStr = process.env.SUPABASE_DB_URL;
  if (!connStr) {
    console.error("Missing SUPABASE_DB_URL env var.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false } // required by Supabase managed PG
  });

  await client.connect();

  // Pull latest PAID orders (limit 30), joining customers
  const sql = `
    SELECT 
      c.full_name AS name,
      o.product_name AS "productName",
      (o.updated_at AT TIME ZONE 'Asia/Kuala_Lumpur') AS updated_my
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
    when: whenLabel(r.updated_my)   // "Hari Ini" / "Semalam" / "X hari lalu"
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
