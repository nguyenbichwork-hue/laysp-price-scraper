import { NextRequest, NextResponse } from 'next/server';
import { crawlSite } from '@/lib/crawler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // giây — giới hạn cho mỗi web

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 });
  }

  const url: string = (body?.url || '').toString().trim();
  if (!url) {
    return NextResponse.json({ error: 'Thiếu url' }, { status: 400 });
  }

  const maxProducts = Math.min(Number(body?.maxProducts) || 1000, 5000);

  const result = await crawlSite(url, {
    maxProducts,
    timeBudgetMs: 50000, // chừa thời gian trả về trước maxDuration
    concurrency: 6,
  });

  return NextResponse.json(result);
}
