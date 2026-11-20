import { parse } from 'csv-parse/sync';

const columns = ['ho_ten', 'ten_dang_nhap', 'lop', 'nam_hoc'];
export const isUsername = (value: string) => /^[a-z0-9_]{3,30}$/.test(value);
export type CsvRow = { line: number; name: string; username: string; className: string; year: string; error?: string };

export function csvStudents(source: string): CsvRow[] {
  if (Buffer.byteLength(source) > 1_000_000) throw new Error('CSV_SIZE');
  const header = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  const delimiter = [',', ';', '\t'].find(candidate => header.split(candidate).map(field => field.trim().replace(/^"|"$/g, '')).join(',') === columns.join(','));
  if (!delimiter) throw new Error('CSV_HEADER');
  const rows = parse(source, { delimiter, bom: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as string[][];
  if (rows.length < 2 || rows.length > 301) throw new Error('CSV_ROWS');
  const seen = new Set<string>();
  return rows.slice(1).map((row, index) => {
    const [name = '', username = '', className = '', year = ''] = row;
    let error: string | undefined;
    if (row.length !== 4 || !name || name.length > 100 || !isUsername(username) ||
        !className || className.length > 100 || !year || year.length > 30) error = 'INVALID_ROW';
    else if (seen.has(username)) error = 'DUPLICATE_ROW';
    else seen.add(username);
    return { line: index + 2, name, username, className, year, ...(error ? { error } : {}) };
  });
}
