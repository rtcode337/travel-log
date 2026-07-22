/** rows(ヘッダー行含む)をCSV文字列にする。区切り文字を含む値はダブルクォートで囲む */
export function buildCsv(
  rows: (string | number | null | undefined)[][]
): string {
  const escape = (value: string | number | null | undefined): string => {
    const s = value == null ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // 改行はExcel等での互換性が高いCRLF
  return rows.map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n";
}

/** ダブルクォート対応の簡易CSVパーサ */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 完全な空行は除外
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
