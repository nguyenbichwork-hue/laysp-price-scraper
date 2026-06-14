import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const pw = process.env.APP_PASSWORD || '';
  const given = (body?.password || '').toString();
  // Nếu chưa đặt mật khẩu -> luôn cho qua (chế độ mở)
  if (!pw || given === pw) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: false, error: 'Sai mật khẩu' }, { status: 401 });
}
