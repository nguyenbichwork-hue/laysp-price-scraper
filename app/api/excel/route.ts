import { NextRequest, NextResponse } from 'next/server';
import { buildWorkbook } from '@/lib/excel';
import type { SiteResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 });
  }

  const sites: SiteResult[] = Array.isArray(body?.sites) ? body.sites : [];
  if (sites.length === 0) {
    return NextResponse.json({ error: 'Không có dữ liệu để xuất' }, { status: 400 });
  }

  // Bảo đảm cấu trúc tối thiểu
  const safe: SiteResult[] = sites.map((s) => ({
    url: s.url || '',
    siteName: s.siteName || 'web',
    platform: s.platform || 'unknown',
    products: Array.isArray(s.products) ? s.products : [],
    count: s.count || (Array.isArray(s.products) ? s.products.length : 0),
    note: s.note,
    error: s.error,
  }));

  try {
    const buffer = await buildWorkbook(safe);
    const body = new Uint8Array(buffer);
    const filename = `bang-gia-san-pham-${stamp()}.xlsx`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(body.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi tạo Excel: ' + (err?.message || String(err)) }, { status: 500 });
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
