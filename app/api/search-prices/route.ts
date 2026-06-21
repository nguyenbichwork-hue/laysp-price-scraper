import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth';
import { searchProductPrices } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = authGuard(req);
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 });
  }

  const query = String(body?.query || '').trim();
  const model = String(body?.model || '').trim();
  const maxLinks = Math.max(4, Math.min(20, Number(body?.maxLinks) || 12));
  if (!query) return NextResponse.json({ error: 'Thiếu query' }, { status: 400 });

  try {
    const prices = await searchProductPrices(query, model, { maxLinks });
    return NextResponse.json({ prices });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
