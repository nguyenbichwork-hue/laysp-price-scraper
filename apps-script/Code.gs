/**
 * laysp — Google Apps Script Web App cho hệ thống So Giá & Định Giá.
 * Dán toàn bộ file này vào Apps Script của Google Sheet, rồi Deploy → Web app.
 * Xem hướng dẫn chi tiết trong apps-script/README.md.
 *
 * Cấu trúc Sheet (tự tạo nếu chưa có khi gọi "setup"):
 *   - Sheet "SanPham": A Mã | B Thương hiệu | C Model | D Tên | E Giá vốn | F Giá hiện tại
 *       | G Số link | H Giá thấp nhất TT | I Giá đề xuất | J Lợi nhuận | K % LN
 *       | L Cảnh báo | M Trạng thái | N Cập nhật | O Link tham khảo
 *   - Sheet "LOG": Thời gian | Thương hiệu | Model | Giá | Link
 */

// ⚠️ ĐỔI chuỗi này thành mật khẩu riêng của sếp, rồi điền y hệt vào .env.local của laysp (SHEET_SECRET).
var SECRET = 'doi-mat-khau-nay';

var SHEET_PRODUCTS = 'SanPham';
var SHEET_LOG = 'LOG';
var HEADERS = [
  'Mã', 'Thương hiệu', 'Model', 'Tên', 'Giá vốn', 'Giá hiện tại',
  'Số link', 'Giá thấp nhất TT', 'Giá đề xuất', 'Lợi nhuận', '% LN',
  'Cảnh báo', 'Trạng thái', 'Cập nhật', 'Link tham khảo',
];
var FIRST_DATA_ROW = 2;

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (String(body.secret || '') !== SECRET) return json({ error: 'Sai SHEET_SECRET' });
    switch (body.action) {
      case 'ping': return json({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
      case 'setup': return json(setup());
      case 'getProducts': return json({ products: getProducts() });
      case 'writeResults': return json(writeResults(body.items || []));
      case 'appendLog': return json(appendLog(body.rows || []));
      default: return json({ error: 'Action không hợp lệ: ' + body.action });
    }
  } catch (err) {
    return json({ error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, hint: 'Dùng POST với {secret, action}. Web app đã hoạt động.' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheetByName(name, createIfMissing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh && createIfMissing) sh = ss.insertSheet(name);
  return sh;
}

/** Tạo sheet + tiêu đề nếu chưa có. */
function setup() {
  var sh = sheetByName(SHEET_PRODUCTS, true);
  if (sh.getLastRow() === 0 || String(sh.getRange(1, 1).getValue()).trim() === '') {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var lg = sheetByName(SHEET_LOG, true);
  if (lg.getLastRow() === 0) {
    lg.getRange(1, 1, 1, 5).setValues([['Thời gian', 'Thương hiệu', 'Model', 'Giá', 'Link']]).setFontWeight('bold');
    lg.setFrozenRows(1);
  }
  return { ok: true, created: [SHEET_PRODUCTS, SHEET_LOG] };
}

/** Đọc danh sách sản phẩm nguồn (cột A..F). */
function getProducts() {
  var sh = sheetByName(SHEET_PRODUCTS, false);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < FIRST_DATA_ROW) return [];
  var vals = sh.getRange(FIRST_DATA_ROW, 1, last - FIRST_DATA_ROW + 1, 6).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var ma = String(r[0] || '').trim();
    var model = String(r[2] || '').trim();
    if (!ma && !model) continue; // bỏ dòng trống
    out.push({
      row: FIRST_DATA_ROW + i,
      ma: ma,
      brand: String(r[1] || '').trim(),
      model: model,
      ten: String(r[3] || '').trim(),
      giaVon: toNum(r[4]),
      giaHienTai: toNum(r[5]),
    });
  }
  return out;
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

/**
 * Ghi kết quả vào cột G..O cho từng dòng.
 * items: [{ row, soLink, min, deXuat, canhBao, trangThai, links }]
 * J (Lợi nhuận) & K (% LN) ghi dạng CÔNG THỨC để tự cập nhật khi giá vốn/đề xuất đổi.
 */
function writeResults(items) {
  var sh = sheetByName(SHEET_PRODUCTS, true);
  var now = new Date();
  var written = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var row = Number(it.row);
    if (!row || row < FIRST_DATA_ROW) continue;
    sh.getRange(row, 7).setValue(it.soLink == null ? '' : it.soLink);                 // G Số link
    sh.getRange(row, 8).setValue(it.min == null ? '' : it.min);                        // H Giá thấp nhất
    sh.getRange(row, 9).setValue(it.deXuat == null ? '' : it.deXuat);                  // I Giá đề xuất
    sh.getRange(row, 10).setFormula('=IF(OR($E' + row + '="",$I' + row + '=""),"",$I' + row + '-$E' + row + ')'); // J Lợi nhuận
    sh.getRange(row, 11).setFormula('=IF(OR($E' + row + '="",$I' + row + '="",$E' + row + '=0),"",($I' + row + '-$E' + row + ')/$E' + row + ')'); // K % LN
    sh.getRange(row, 11).setNumberFormat('0.0%');
    sh.getRange(row, 12).setValue(it.canhBao || '');                                   // L Cảnh báo
    sh.getRange(row, 13).setValue(it.trangThai || '');                                 // M Trạng thái
    sh.getRange(row, 14).setValue(now);                                                // N Cập nhật
    sh.getRange(row, 15).setValue(it.links || '');                                     // O Link tham khảo
    written++;
  }
  return { ok: true, written: written };
}

/** Ghi nhật ký giá vào sheet LOG. rows: [[time?, brand, model, gia, link], ...] */
function appendLog(rows) {
  if (!rows.length) return { ok: true, appended: 0 };
  var lg = sheetByName(SHEET_LOG, true);
  var now = new Date();
  var data = rows.map(function (r) {
    return [r[0] || now, r[1] || '', r[2] || '', r[3] == null ? '' : r[3], r[4] || ''];
  });
  lg.getRange(lg.getLastRow() + 1, 1, data.length, 5).setValues(data);
  return { ok: true, appended: data.length };
}
