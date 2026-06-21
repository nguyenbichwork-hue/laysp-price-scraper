// Khớp sản phẩm store của tôi với sản phẩm quét được từ web đối thủ.
// Ưu tiên: SKU/mã model > tên chuẩn hoá. Chạy phía client (thuần JS, không deps node).

import type { MyProduct, SiteResult, MarketPrice, ComparisonRow } from './types';
import { modelFromName, normalizeName } from './price';

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return (u || '').toLowerCase();
  }
}
function normSku(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, '').replace(/-\d+$/, ''); // bỏ hậu tố variant "-1"
}
function normModel(name: string): string {
  return modelFromName(name).toLowerCase().replace(/[\s]+/g, '');
}

function keysFor(name: string, code: string, sku: string): { codeKeys: Set<string>; nameKey: string } {
  const codeKeys = new Set<string>();
  const add = (k: string) => {
    if (k && k.length >= 3) codeKeys.add(k);
  };
  add(normModel(name));
  add(normSku(sku));
  add(normSku(code));
  return { codeKeys, nameKey: normalizeName(name) };
}

/**
 * Lọc giá ảo/outlier: bỏ các giá bất thường thấp (mồi/phụ kiện/khớp nhầm) hoặc
 * bất thường cao so với trung vị. Chỉ lọc khi đủ mẫu (>=4) và không bao giờ
 * loại sạch — luôn giữ lại ít nhất 2 giá gần trung vị nhất.
 * Trả về { kept, dropped }.
 */
export function filterOutliers(market: MarketPrice[]): { kept: MarketPrice[]; dropped: number } {
  if (market.length < 4) return { kept: market, dropped: 0 };
  const sorted = [...market].sort((a, b) => a.price - b.price);
  const vals = sorted.map((m) => m.price);
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  const lowCut = median * 0.45; // dưới 45% trung vị -> nghi giá ảo/khớp nhầm
  const highCut = median * 2.2; // trên 220% trung vị -> nghi combo/khớp nhầm
  const kept = sorted.filter((m) => m.price >= lowCut && m.price <= highCut);
  if (kept.length < 2) return { kept: sorted, dropped: 0 }; // không đủ tin cậy -> giữ nguyên
  return { kept, dropped: market.length - kept.length };
}

/** Dựng bảng đối chiếu từ sản phẩm của tôi + kết quả quét thị trường. */
export function buildComparison(myProducts: MyProduct[], sites: SiteResult[]): ComparisonRow[] {
  const codeMap = new Map<string, MarketPrice[]>();
  const nameMap = new Map<string, MarketPrice[]>();
  const add = (map: Map<string, MarketPrice[]>, k: string, mp: MarketPrice) => {
    if (!k || k.length < 3) return;
    const a = map.get(k) || [];
    a.push(mp);
    map.set(k, a);
  };

  for (const s of sites) {
    for (const p of s.products || []) {
      const price = p.salePrice ?? p.originalPrice;
      if (price == null || price < 1000) continue;
      const mp: MarketPrice = { siteName: s.siteName, price, url: p.url || '' };
      const { codeKeys, nameKey } = keysFor(p.name, p.code, '');
      for (const k of codeKeys) add(codeMap, k, mp);
      add(nameMap, nameKey, mp);
    }
  }

  const rows: ComparisonRow[] = [];
  for (const my of myProducts) {
    const { codeKeys, nameKey } = keysFor(my.name, my.code, my.sku);
    const skuKey = normSku(my.sku);
    let hits: MarketPrice[] = [];
    let by: ComparisonRow['matchedBy'] = null;
    for (const k of codeKeys) {
      const a = codeMap.get(k);
      if (a) {
        hits.push(...a);
        if (!by) by = k === skuKey ? 'sku' : 'model';
      }
    }
    if (hits.length === 0) {
      const a = nameMap.get(nameKey);
      if (a && nameKey.length >= 8) {
        hits = a;
        by = 'name';
      }
    }

    // Dedupe theo (web + url), giữ giá thấp nhất
    const seen = new Map<string, MarketPrice>();
    for (const mp of hits) {
      const key = mp.siteName + '|' + normUrl(mp.url);
      const ex = seen.get(key);
      if (!ex || mp.price < ex.price) seen.set(key, mp);
    }
    const deduped = [...seen.values()].sort((a, b) => a.price - b.price);
    // Lọc giá ảo/outlier trước khi tính min/avg -> giá đề xuất không bị kéo xuống bởi giá mồi
    const { kept: market, dropped } = filterOutliers(deduped);
    const prices = market.map((m) => m.price);
    const marketMin = prices.length ? Math.min(...prices) : null;
    const marketMax = prices.length ? Math.max(...prices) : null;
    const marketAvg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
    const siteCount = new Set(market.map((m) => m.siteName)).size;
    const pctVsMin = marketMin && my.price ? ((my.price - marketMin) / marketMin) * 100 : null;

    rows.push({
      product: my,
      market,
      marketMin,
      marketMax,
      marketAvg,
      siteCount,
      pctVsMin,
      matchedBy: market.length ? by : null,
      dropped,
    });
  }
  return rows;
}

/**
 * Dựng 1 dòng đối chiếu trực tiếp từ danh sách giá thị trường (dùng cho chế độ tự tìm giá
 * theo từng model). Dedupe theo web+url (giữ giá thấp nhất), lọc giá ảo, tính min/avg.
 */
export function rowFromPrices(product: MyProduct, prices: MarketPrice[]): ComparisonRow {
  const seen = new Map<string, MarketPrice>();
  for (const mp of prices) {
    if (mp.price == null || mp.price < 1000) continue;
    const key = mp.siteName + '|' + normUrl(mp.url);
    const ex = seen.get(key);
    if (!ex || mp.price < ex.price) seen.set(key, mp);
  }
  const deduped = [...seen.values()].sort((a, b) => a.price - b.price);
  const { kept: market, dropped } = filterOutliers(deduped);
  const vals = market.map((m) => m.price);
  const marketMin = vals.length ? Math.min(...vals) : null;
  const marketMax = vals.length ? Math.max(...vals) : null;
  const marketAvg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  const siteCount = new Set(market.map((m) => m.siteName)).size;
  const pctVsMin = marketMin && product.price ? ((product.price - marketMin) / marketMin) * 100 : null;
  return { product, market, marketMin, marketMax, marketAvg, siteCount, pctVsMin, matchedBy: market.length ? 'model' : null, dropped };
}

/**
 * Giá đề xuất: bằng giá thấp nhất TT nhưng KHÔNG dưới sàn.
 * Sàn = max(floorPct * giá hiện tại, giá vốn * (1 + % lãi tối thiểu)).
 * Khi có giá vốn, giá đề xuất luôn đảm bảo lãi tối thiểu -> không bao giờ định giá lỗ.
 */
export function suggestPrice(row: ComparisonRow, floorPct: number, minMarginPct = 0): number | null {
  if (row.marketMin == null) return null;
  const floors = [Math.round(row.product.price * floorPct)];
  const cost = row.product.cost;
  if (cost && cost > 0) floors.push(Math.round(cost * (1 + minMarginPct)));
  const floor = Math.max(...floors);
  return Math.max(row.marketMin, floor);
}

/**
 * Rủi ro lỗ: giá thấp nhất thị trường < giá vốn * (1 + % lãi tối thiểu).
 * Nghĩa là muốn bằng giá rẻ nhất thị trường thì sẽ lỗ/không đạt lãi tối thiểu.
 * Trả về false nếu chưa có giá vốn.
 */
export function lossRisk(row: ComparisonRow, minMarginPct = 0): boolean {
  const cost = row.product.cost;
  if (!cost || cost <= 0 || row.marketMin == null) return false;
  return row.marketMin < cost * (1 + minMarginPct);
}

/** Cảnh báo: 'cao' nếu giá tôi cao hơn min*(1+high); 'thap' nếu thấp hơn min*(1-low) hoặc dưới sàn. */
export function priceWarning(
  row: ComparisonRow,
  highThresh = 0.1,
  lowThresh = 0.05,
): 'cao' | 'thap' | 'ok' | null {
  if (row.marketMin == null) return null;
  const my = row.product.price;
  if (my > row.marketMin * (1 + highThresh)) return 'cao'; // cao hơn TT nhiều -> kém cạnh tranh
  if (my < row.marketMin * (1 - lowThresh)) return 'thap'; // thấp hơn TT nhiều -> có thể bán hớ
  return 'ok';
}
