import { NextRequest, NextResponse } from 'next/server';
import { fetchMyProducts } from '@/lib/haravan';
import { authGuard } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = authGuard(req);
  if (denied) return denied;

  if (!process.env.HARAVAN_TOKEN) {
    return NextResponse.json({ error: 'Chưa cấu hình HARAVAN_TOKEN' }, { status: 500 });
  }
  try {
    const products = await fetchMyProducts();
    return NextResponse.json({ products, count: products.length });
  } catch (e: any) {
    return NextResponse.json({ error: 'Lỗi tải sản phẩm: ' + (e?.message || String(e)) }, { status: 500 });
  }
}
