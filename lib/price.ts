// Bóc tách & chuẩn hoá giá tiền từ chuỗi bất kỳ.
// Hỗ trợ cả định dạng Việt Nam (1.990.000₫) lẫn quốc tế (1,990,000.00).

export function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;

  const s = String(raw).trim();
  if (!s) return null;

  // Lấy các cụm chứa chữ số và dấu phân cách
  const tokens = s.match(/[\d][\d.,\s]*\d|\d/g);
  if (!tokens || tokens.length === 0) return null;

  // Chọn cụm có nhiều chữ số nhất (thường là con số giá)
  const token = tokens
    .map((t) => t.replace(/\s/g, ''))
    .sort((a, b) => b.replace(/[.,]/g, '').length - a.replace(/[.,]/g, '').length)[0];

  const lastDot = token.lastIndexOf('.');
  const lastComma = token.lastIndexOf(',');
  const dotCount = (token.match(/\./g) || []).length;
  const commaCount = (token.match(/,/g) || []).length;
  let decimalSep: '.' | ',' | null = null;

  if (dotCount > 0 && commaCount > 0) {
    // Cả hai dấu xuất hiện -> dấu nằm sau cùng là dấu thập phân
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (dotCount === 1) {
    // Một dấu chấm: chỉ là dấu phân cách nghìn khi theo sau đúng 3 chữ số
    // (vd "10.420"=10420). Ngược lại là thập phân (vd "10420000.0000", "10.42").
    const after = token.length - lastDot - 1;
    decimalSep = after === 3 ? null : '.';
  } else if (commaCount === 1) {
    const after = token.length - lastComma - 1;
    decimalSep = after === 3 ? null : ',';
  } else {
    // 0 dấu, hoặc nhiều dấu cùng loại (vd "1.990.000") -> tất cả là dấu nghìn
    decimalSep = null;
  }

  let intPart: string;
  let fracPart = '';
  if (decimalSep) {
    const idx = token.lastIndexOf(decimalSep);
    intPart = token.slice(0, idx).replace(/[.,\s]/g, '');
    fracPart = token.slice(idx + 1).replace(/[.,\s]/g, '');
  } else {
    intPart = token.replace(/[.,\s]/g, '');
  }

  if (!intPart) intPart = '0';
  const val = parseFloat(intPart + (fracPart ? '.' + fracPart : ''));
  if (!isFinite(val) || val <= 0) return null;
  return val;
}

/**
 * Trích "mã model" từ tên sản phẩm (vd "Máy hút mùi Canzy CZ-636PRO" -> "CZ-636PRO").
 * Mã model thường nằm cuối tên, là token có cả chữ và số. Dùng làm mã khi không có SKU.
 */
export function modelFromName(name: string): string {
  if (!name) return '';
  const s = name
    .replace(/[–—]/g, '-')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/\([^)]*\)/g, ' ') // bỏ "(2 Màu: ...)" cuối tên
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const toks = s.split(' ').map((t) => t.replace(/[,.;:]+$/, ''));
  const clean = (t: string) => /^[A-Za-z0-9][A-Za-z0-9\-/.]*$/.test(t);
  const strong = (t: string) => clean(t) && /[A-Za-z]/.test(t) && /\d/.test(t);
  let anchor = -1;
  for (let i = toks.length - 1; i >= 0; i--) if (strong(toks[i])) { anchor = i; break; }
  if (anchor === -1) for (let i = toks.length - 1; i >= 0; i--) if (/\d/.test(toks[i]) && clean(toks[i])) { anchor = i; break; }
  if (anchor === -1) return '';
  let start = anchor;
  while (start - 1 >= 0 && /^[A-Z]{2,3}$/.test(toks[start - 1])) start--;
  let end = anchor;
  const suffix = /^(PRO|PLUS|MAX|SMART|APP|WIFI|[A-Z])$/;
  while (end + 1 < toks.length && suffix.test(toks[end + 1])) end++;
  const code = toks.slice(start, end + 1).join(' ').replace(/\s*-\s*/g, '-').trim();
  if (code.length > 28 || code.length < 2) return toks[anchor];
  return code;
}

/**
 * Chọn mã sản phẩm tốt nhất: ưu tiên SKU sạch (mã thật của shop); nếu SKU trống/giống
 * tên thì trích mã model từ tên; cuối cùng mới dùng fallback (slug/id).
 */
export function bestCode(sku: string | undefined | null, name: string, fallback?: string): string {
  const s = (sku || '').trim();
  const skuClean =
    !!s &&
    s.length <= 24 &&
    s.split(/\s+/).length <= 4 &&
    !/\b(máy|may|khóa|khoa|bếp|bep|lò|lo|tủ|tu|robot|giá|gia|combo|màu|mau|mùi|mui)\b/i.test(s);
  if (skuClean) return s;
  const model = modelFromName(name);
  if (model) return model;
  if (s) return s;
  return (fallback || '').trim();
}

/** Chuẩn hoá tên sản phẩm để so khớp giữa các web (bỏ dấu, viết thường, gọn khoảng trắng) */
export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu thanh tiếng Việt
    .replace(/[đ]/g, 'd') // đ -> d
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
