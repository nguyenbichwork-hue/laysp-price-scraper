import { NextRequest, NextResponse } from 'next/server';
import { updateVariantPrice } from '@/lib/haravan';
import { authGuard } from '@/lib/auth';
import { sendTelegram } from '@/lib/telegram';
import type { PriceUpdateResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = authGuard(req);
  if (denied) return denied;

  if (!process.env.HARAVAN_TOKEN) {
    return NextResponse.json({ error: 'Chưa cấu hình HARAVAN_TOKEN' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 });
  }

  const updates: { variantId: number; price: number }[] = Array.isArray(body?.updates) ? body.updates : [];
  if (updates.length === 0) return NextResponse.json({ error: 'Không có cập nhật' }, { status: 400 });
  if (updates.length > 200) return NextResponse.json({ error: 'Tối đa 200 SP mỗi lần' }, { status: 400 });

  const results: PriceUpdateResult[] = [];
  for (const u of updates) {
    const variantId = Number(u.variantId);
    const price = Math.round(Number(u.price));
    if (!variantId || !isFinite(price) || price <= 0) {
      results.push({ variantId, ok: false, error: 'Giá không hợp lệ' });
      continue;
    }
    const r = await updateVariantPrice(variantId, price);
    results.push({ variantId, ok: r.ok, oldPrice: r.oldPrice, newPrice: price, error: r.error });
  }

  // Thông báo Telegram (bỏ qua nếu chưa cấu hình). Không chặn phản hồi nếu lỗi.
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  if (!body?.isUndo && okCount > 0) {
    sendTelegram(
      `💰 <b>Cập nhật giá Bếp Ngọc Bảo</b>\nThành công: <b>${okCount}</b> SP${failCount ? `\nLỗi: ${failCount}` : ''}`,
    ).catch(() => {});
  }

  return NextResponse.json({ results, ok: results.every((r) => r.ok) });
}
