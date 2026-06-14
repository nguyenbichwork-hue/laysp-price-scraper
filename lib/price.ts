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
