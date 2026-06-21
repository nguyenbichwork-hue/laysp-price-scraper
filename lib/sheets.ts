// Nối với Google Apps Script Web App (đọc/ghi Google Sheet).
// URL + secret nằm ở env (server-side), KHÔNG lộ ra client.

const SCRIPT_URL = () => process.env.APPS_SCRIPT_URL || '';
const SECRET = () => process.env.SHEET_SECRET || '';

export interface SheetProduct {
  row: number;
  ma: string;
  brand: string;
  model: string;
  ten: string;
  giaVon: number | null;
  giaHienTai: number | null;
}

export interface SheetResultItem {
  row: number;
  soLink: number | null;
  min: number | null;
  deXuat: number | null;
  canhBao: string;
  trangThai: string;
  links: string;
}

export type LogRow = [string | null, string, string, number | null, string];

export function sheetsConfigured(): boolean {
  return !!SCRIPT_URL() && !!SECRET();
}

async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  if (!sheetsConfigured()) throw new Error('Chưa cấu hình APPS_SCRIPT_URL / SHEET_SECRET trong .env.local');
  const res = await fetch(SCRIPT_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET(), action, ...payload }),
    redirect: 'follow',
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Apps Script trả về không phải JSON (kiểm tra URL/deploy): ' + text.slice(0, 160));
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function sheetPing(): Promise<{ ok: boolean; sheet?: string }> {
  return call('ping');
}
export async function sheetSetup(): Promise<{ ok: boolean; created: string[] }> {
  return call('setup');
}
export async function sheetGetProducts(): Promise<SheetProduct[]> {
  const d = await call('getProducts');
  return (d.products || []) as SheetProduct[];
}
export async function sheetWriteResults(items: SheetResultItem[]): Promise<{ written: number }> {
  // Chia lô để tránh payload quá lớn / timeout Apps Script
  let written = 0;
  for (let i = 0; i < items.length; i += 200) {
    const d = await call('writeResults', { items: items.slice(i, i + 200) });
    written += d.written || 0;
  }
  return { written };
}
export async function sheetAppendLog(rows: LogRow[]): Promise<{ appended: number }> {
  let appended = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const d = await call('appendLog', { rows: rows.slice(i, i + 500) });
    appended += d.appended || 0;
  }
  return { appended };
}
