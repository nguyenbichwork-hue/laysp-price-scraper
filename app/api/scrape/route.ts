import { NextRequest, NextResponse } from 'next/server';
import { discover, runTask } from '@/lib/crawler';
import { authGuard } from '@/lib/auth';
import type { Task } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // giây

export async function POST(req: NextRequest) {
  const denied = authGuard(req);
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 });
  }

  const url: string = (body?.url || '').toString().trim();
  if (!url) return NextResponse.json({ error: 'Thiếu url' }, { status: 400 });

  const maxProducts = Math.min(Number(body?.maxProducts) || 2000, 20000);
  const cfg = { maxProducts, timeBudgetMs: 48000, concurrency: 12 };

  // Có task -> vòng làm việc tiếp; không -> vòng khám phá
  if (body?.task) {
    const result = await runTask(url, body.task as Task, cfg);
    return NextResponse.json(result);
  }

  const result = await discover(url, cfg);
  return NextResponse.json(result);
}
