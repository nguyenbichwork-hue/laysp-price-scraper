import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth';
import {
  sheetsConfigured,
  sheetPing,
  sheetSetup,
  sheetGetProducts,
  sheetWriteResults,
  sheetAppendLog,
} from '@/lib/sheets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = authGuard(req);
  if (denied) return denied;

  if (!sheetsConfigured()) {
    return NextResponse.json({ error: 'Chưa cấu hình APPS_SCRIPT_URL / SHEET_SECRET' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 });
  }

  try {
    switch (body?.action) {
      case 'ping':
        return NextResponse.json(await sheetPing());
      case 'setup':
        return NextResponse.json(await sheetSetup());
      case 'getProducts':
        return NextResponse.json({ products: await sheetGetProducts() });
      case 'writeResults':
        return NextResponse.json(await sheetWriteResults(Array.isArray(body.items) ? body.items : []));
      case 'appendLog':
        return NextResponse.json(await sheetAppendLog(Array.isArray(body.rows) ? body.rows : []));
      default:
        return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
