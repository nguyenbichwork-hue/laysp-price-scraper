import { NextRequest, NextResponse } from 'next/server';

/** So mật khẩu trong header với APP_PASSWORD. Nếu chưa đặt APP_PASSWORD -> cho qua (chế độ mở). */
export function isAuthed(req: NextRequest): boolean {
  const pw = process.env.APP_PASSWORD || '';
  if (!pw) return true;
  const given = req.headers.get('x-app-password') || '';
  return given === pw;
}

/** Trả về response 401 nếu chưa xác thực; ngược lại null. */
export function authGuard(req: NextRequest): NextResponse | null {
  if (isAuthed(req)) return null;
  return NextResponse.json({ error: 'Cần đăng nhập (sai mật khẩu).' }, { status: 401 });
}
