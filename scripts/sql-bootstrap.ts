/**
 * أداة اختبار فقط — ليست بديلًا عن `prisma migrate`.
 * تُستخدم في البيئات التي لا يتوفر فيها Prisma Schema Engine (محرك الترحيل)
 * لإنشاء الجداول مباشرة من schema.prisma لغرض الاختبار الآلي.
 * في بيئة التطوير/الإنتاج الحقيقية استخدم: npx prisma migrate dev / deploy
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { Client } from "pg";

type Field = { name: string; type: string; optional: boolean; list: boolean; attrs: string };
type Model = { name: string; fields: Field[]; block: string[] };

const src = readFileSync("prisma/schema.prisma", "utf8").replace(/\/\/.*$/gm, "");
const enums = new Map<string, string[]>();
const models: Model[] = [];
for (const m of src.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) enums.set(m[1], m[2].split(/\s+/).filter(Boolean));
for (const m of src.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
  const fields: Field[] = []; const block: string[] = [];
  for (const raw of m[2].split("\n")) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith("@@")) { block.push(line); continue; }
    const mm = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/); if (!mm) continue;
    fields.push({ name: mm[1], type: mm[2], list: !!mm[3], optional: !!mm[4], attrs: mm[5] });
  }
  models.push({ name: m[1], fields, block });
}
const modelNames = new Set(models.map((m) => m.name));
const q = (s: string) => `"${s}"`;
const listArgs = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function colType(f: Field): string {
  const dec = f.attrs.match(/@db\.Decimal\((\d+),\s*(\d+)\)/);
  let t: string;
  switch (f.type) {
    case "String": t = "TEXT"; break;
    case "Int": t = f.attrs.includes("autoincrement()") ? "SERIAL" : "INTEGER"; break;
    case "Boolean": t = "BOOLEAN"; break;
    case "DateTime": t = "TIMESTAMP(3)"; break;
    case "Json": t = "JSONB"; break;
    case "Decimal": t = dec ? `DECIMAL(${dec[1]},${dec[2]})` : "DECIMAL(65,30)"; break;
    default: t = enums.has(f.type) ? q(f.type) : "TEXT";
  }
  return f.list ? t + "[]" : t;
}
function defaultSql(f: Field): string {
  const d = f.attrs.match(/@default\(((?:[^()]|\([^)]*\))*)\)/); if (!d) return "";
  const v = d[1];
  if (v === "now()") return " DEFAULT CURRENT_TIMESTAMP";
  if (/cuid|uuid|autoincrement/.test(v)) return ""; // يولَّد من Prisma Client
  if (v.startsWith('"')) return ` DEFAULT '${v.slice(1, -1)}'`;
  if (enums.has(f.type)) return ` DEFAULT '${v}'`;
  return ` DEFAULT ${v}`;
}

const out: string[] = [];
for (const [n, vals] of enums) out.push(`CREATE TYPE ${q(n)} AS ENUM (${vals.map((v) => `'${v}'`).join(", ")});`);
const fks: string[] = [];
for (const m of models) {
  const cols: string[] = []; const extra: string[] = [];
  for (const f of m.fields) {
    if (modelNames.has(f.type)) {
      const rel = f.attrs.match(/@relation\(([^)]*fields:[^)]*)\)/);
      if (rel) {
        const fieldsA = listArgs(rel[1].match(/fields:\s*\[([^\]]*)\]/)![1]);
        const refs = listArgs(rel[1].match(/references:\s*\[([^\]]*)\]/)![1]);
        const od = rel[1].match(/onDelete:\s*(\w+)/)?.[1];
        const action = od === "Cascade" ? "CASCADE" : od === "SetNull" ? "SET NULL" : f.optional ? "SET NULL" : "RESTRICT";
        fks.push(`ALTER TABLE ${q(m.name)} ADD FOREIGN KEY (${fieldsA.map(q).join(",")}) REFERENCES ${q(f.type)}(${refs.map(q).join(",")}) ON DELETE ${action} ON UPDATE CASCADE;`);
      }
      continue;
    }
    let c = `${q(f.name)} ${colType(f)}${f.optional ? "" : " NOT NULL"}${defaultSql(f)}`;
    if (f.attrs.includes("@id")) c += " PRIMARY KEY";
    cols.push(c);
    if (/@unique\b/.test(f.attrs)) extra.push(`CREATE UNIQUE INDEX ON ${q(m.name)}(${q(f.name)});`);
  }
  for (const b of m.block) {
    const args = b.match(/\[([^\]]*)\]/); if (!args) continue;
    const cs = listArgs(args[1]).map(q).join(",");
    if (b.startsWith("@@id")) cols.push(`PRIMARY KEY (${cs})`);
    else if (b.startsWith("@@unique")) extra.push(`CREATE UNIQUE INDEX ON ${q(m.name)}(${cs});`);
    else if (b.startsWith("@@index")) extra.push(`CREATE INDEX ON ${q(m.name)}(${cs});`);
  }
  out.push(`CREATE TABLE ${q(m.name)} (\n  ${cols.join(",\n  ")}\n);`, ...extra);
}
out.push(...fks);

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.query(out.join("\n"));
  await client.end();
  console.log(`✓ SQL bootstrap: ${enums.size} enums, ${models.length} tables, ${fks.length} foreign keys`);
})().catch((e) => { console.error(e); process.exit(1); });
