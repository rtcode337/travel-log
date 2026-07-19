import { readdir, readFile } from "fs/promises";
import path from "path";

const SEED_DIR = path.join(process.cwd(), "db", "init");

export interface SeedSpotRow {
  name: string;
  name_kana: string | null;
  prefecture: string;
  municipality: string | null;
  lat: number;
  lng: number;
  rank: string | null;
  category: string | null;
  description: string | null;
}

type SqlValue = string | number | null;

/**
 * `(v1, v2, ...), (v1, v2, ...)` 形式のSQL values列挙をパースする。
 * 文字列は''エスケープ対応のシングルクォート、それ以外はnullまたは数値として扱う
 * (db/init/*.sqlのシードは全てこの2種類のみを使う前提)。
 */
function parseValueTuples(text: string): SqlValue[][] {
  const tuples: SqlValue[][] = [];
  let i = 0;
  const n = text.length;
  const skipWhitespaceAndComments = () => {
    for (;;) {
      while (i < n && /[\s,]/.test(text[i])) i++;
      if (text[i] === "-" && text[i + 1] === "-") {
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      break;
    }
  };

  while (i < n) {
    skipWhitespaceAndComments();
    if (i >= n) break;
    if (text[i] !== "(") {
      throw new Error(`予期しない文字 (位置${i}): ${text[i]}`);
    }
    i++;
    const fields: SqlValue[] = [];
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === "'") {
        i++;
        let s = "";
        while (i < n) {
          if (text[i] === "'" && text[i + 1] === "'") {
            s += "'";
            i += 2;
          } else if (text[i] === "'") {
            i++;
            break;
          } else {
            s += text[i];
            i++;
          }
        }
        fields.push(s);
      } else {
        const start = i;
        while (i < n && text[i] !== "," && text[i] !== ")") i++;
        const raw = text.slice(start, i).trim();
        fields.push(raw.toLowerCase() === "null" ? null : Number(raw));
      }
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === ")") {
        i++;
        break;
      }
      throw new Error(`予期しない文字 (位置${i}): ${text[i]}`);
    }
    tuples.push(fields);
  }
  return tuples;
}

/**
 * db/init/*.sqlのシードファイル(`insert into spots (...) select ... from spot_types t,
 * (values (...), ...) as v(col1, col2, ...) where t.key = '<typeKey>';` 形式)を1件パースする。
 * typeKeyが一致しない、またはこの形式でないファイルはnullを返す。
 */
function parseSeedFile(sql: string, typeKey: string): SeedSpotRow[] | null {
  const whereMatch = sql.match(/where\s+t\.key\s*=\s*'([^']+)'\s*;/);
  if (!whereMatch || whereMatch[1] !== typeKey) return null;

  const valuesStart = sql.indexOf("(values");
  const asVIndex = sql.indexOf(") as v(");
  if (valuesStart === -1 || asVIndex === -1) return null;

  const columnsEnd = sql.indexOf(")", asVIndex + ") as v(".length);
  const columns = sql
    .slice(asVIndex + ") as v(".length, columnsEnd)
    .split(",")
    .map((c) => c.trim());

  const tuplesText = sql.slice(valuesStart + "(values".length, asVIndex);
  const tuples = parseValueTuples(tuplesText);

  return tuples.map((fields) => {
    const rec: Record<string, SqlValue> = {};
    columns.forEach((col, i) => {
      rec[col] = fields[i] ?? null;
    });
    return {
      name: String(rec.name),
      name_kana: (rec.name_kana as string | null) ?? null,
      prefecture: String(rec.prefecture),
      municipality: (rec.municipality as string | null) ?? null,
      lat: Number(rec.lat),
      lng: Number(rec.lng),
      rank: (rec.rank as string | null) ?? null,
      category: (rec.category as string | null) ?? null,
      description: (rec.description as string | null) ?? null,
    };
  });
}

/** db/init直下と、そのサブディレクトリ1階層分(tourist_by_prefecture/等)の*.sqlパスを列挙する */
async function listSeedSqlFiles(): Promise<string[]> {
  const entries = await readdir(SEED_DIR, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subFiles = await readdir(path.join(SEED_DIR, entry.name));
      for (const f of subFiles) {
        if (f.endsWith(".sql")) files.push(path.join(entry.name, f));
      }
    } else if (entry.name.endsWith(".sql")) {
      files.push(entry.name);
    }
  }
  return files.sort();
}

/** spot_typeキーに該当するdb/init/*.sql(サブディレクトリ1階層分を含む)シードファイルを
 * 全て読み、ファイルごとの行を返す */
export async function readSeedSpots(
  typeKey: string
): Promise<{ file: string; rows: SeedSpotRow[] }[]> {
  const files = await listSeedSqlFiles();
  const results: { file: string; rows: SeedSpotRow[] }[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(SEED_DIR, file), "utf-8");
    if (!sql.includes("insert into spots")) continue;
    const rows = parseSeedFile(sql, typeKey);
    if (rows) results.push({ file, rows });
  }
  return results;
}
