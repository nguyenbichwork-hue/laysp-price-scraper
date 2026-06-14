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
    const market = [...seen.values()].sort((a, b) => a.price - b.price);
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
    });
  }
  return rows;
}

/** Giá đề xuất: bằng giá thấp nhất TT nhưng không dưới sàn (floorPct * giá hiện tại). */
export function suggestPrice(row: ComparisonRow, floorPct: number): number | null {
  if (row.marketMin == null) return null;
  const floor = Math.round(row.product.price * floorPct);
  return Math.max(row.marketMin, floor);
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
