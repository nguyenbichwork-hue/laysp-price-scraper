// Dựng file Excel: Tab "Tổng hợp" + mỗi website 1 tab riêng.

import ExcelJS from 'exceljs';
import type { SiteResult, Product } from './types';
import { normalizeName } from './price';

const HEADER_FILL = 'FF1E3A8A'; // xanh đậm
const HEADER_FONT = 'FFFFFFFF';
const MIN_FILL = 'FFD1FAE5'; // xanh nhạt đánh dấu giá thấp nhất
const PRICE_FMT = '#,##0';

function sanitizeSheetName(name: string, used: Set<string>): string {
  // Excel: tối đa 31 ký tự, không chứa : \ / ? * [ ]
  let base = name.replace(/[:\\/?*[\]]/g, '-').slice(0, 28) || 'sheet';
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    candidate = base.slice(0, 28 - suffix.length) + suffix;
    i++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });
  row.height = 24;
}

export async function buildWorkbook(sites: SiteResult[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lấy Giá SP';
  wb.created = new Date();

  const usedNames = new Set<string>();
  usedNames.add('tổng hợp');

  // ---------- Tab 1: Tổng hợp ----------
  const summary = wb.addWorksheet('Tổng hợp', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }],
  });

  const siteNames = sites.map((s) => s.siteName);
  const summaryCols: Partial<ExcelJS.Column>[] = [
    { header: 'Mã sản phẩm', key: 'code', width: 26 },
    { header: 'Tên sản phẩm', key: 'name', width: 42 },
    ...siteNames.map((n, i) => ({ header: n, key: 's' + i, width: 16 })),
    { header: 'Giá thấp nhất', key: 'min', width: 16 },
    { header: 'Web rẻ nhất', key: 'minsite', width: 18 },
  ];
  summary.columns = summaryCols;

  // Gom theo khoá: SKU nếu có, ngược lại theo tên chuẩn hoá
  interface Agg {
    code: string;
    name: string;
    prices: (number | null)[];
  }
  const map = new Map<string, Agg>();
  sites.forEach((site, si) => {
    site.products.forEach((p) => {
      const code = (p.code || '').trim();
      const key = code ? 'sku:' + code.toLowerCase() : 'name:' + normalizeName(p.name);
      if (!map.has(key)) {
        map.set(key, { code: code || '(không có mã)', name: p.name, prices: new Array(sites.length).fill(null) });
      }
      const agg = map.get(key)!;
      const price = p.salePrice ?? p.originalPrice;
      if (price != null) {
        if (agg.prices[si] == null || price < (agg.prices[si] as number)) agg.prices[si] = price;
      }
      if ((!agg.name || agg.name.length < p.name.length) && p.name) agg.name = p.name;
    });
  });

  styleHeaderRow(summary.getRow(1));

  for (const agg of map.values()) {
    const rowData: any = { code: agg.code, name: agg.name };
    let min = Infinity;
    let minSite = '';
    siteNames.forEach((n, i) => {
      const v = agg.prices[i];
      rowData['s' + i] = v != null ? v : '';
      if (v != null && v < min) {
        min = v;
        minSite = n;
      }
    });
    rowData.min = isFinite(min) ? min : '';
    rowData.minsite = minSite;
    const row = summary.addRow(rowData);

    // Định dạng số + tô đậm ô giá thấp nhất
    siteNames.forEach((n, i) => {
      const cell = row.getCell('s' + i);
      cell.numFmt = PRICE_FMT;
      if (agg.prices[i] != null && agg.prices[i] === (isFinite(min) ? min : NaN)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MIN_FILL } };
        cell.font = { bold: true, color: { argb: 'FF065F46' } };
      }
    });
    row.getCell('min').numFmt = PRICE_FMT;
    row.getCell('min').font = { bold: true };
  }
  summary.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: summaryCols.length } };

  // ---------- Mỗi web 1 tab ----------
  for (const site of sites) {
    const sheetName = sanitizeSheetName(site.siteName, usedNames);
    const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Mã sản phẩm', key: 'code', width: 26 },
      { header: 'Tên sản phẩm', key: 'name', width: 50 },
      { header: 'Giá gốc', key: 'orig', width: 16 },
      { header: 'Giá bán', key: 'sale', width: 16 },
      { header: 'Link', key: 'url', width: 48 },
    ];
    styleHeaderRow(ws.getRow(1));

    site.products.forEach((p: Product) => {
      const row = ws.addRow({
        code: p.code || '',
        name: p.name,
        orig: p.originalPrice ?? '',
        sale: p.salePrice ?? '',
        url: p.url,
      });
      row.getCell('orig').numFmt = PRICE_FMT;
      row.getCell('sale').numFmt = PRICE_FMT;
      row.getCell('sale').font = { bold: true, color: { argb: 'FFB91C1C' } };
      if (p.url) {
        row.getCell('url').value = { text: p.url, hyperlink: p.url };
        row.getCell('url').font = { color: { argb: 'FF2563EB' }, underline: true };
      }
    });

    if (site.products.length === 0) {
      const note = ws.addRow({ name: site.error || 'Không lấy được sản phẩm.' });
      note.getCell('name').font = { italic: true, color: { argb: 'FFB91C1C' } };
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
