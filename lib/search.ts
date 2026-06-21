// Tự tìm giá theo từng sản phẩm: tìm trên Google (qua ScraperAPI nếu có), mở các trang
// kết quả của các sàn bán lẻ, bóc giá, xác minh đúng model, gom giá thấp nhất mỗi sàn.

import { smartFetch } from './fetcher';
import { extractProductsFromHtml } from './extractor';
import type { MarketPrice } from './types';

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

// Bỏ qua các domain không phải trang bán hàng / nhiễu.
const SKIP_DOMAINS = /(google\.|gstatic\.|youtube\.|facebook\.|tiktok\.|instagram\.|wikipedia\.|webcache\.|translate\.|maps\.|blogspot\.|news\.)/i;

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** Lấy link kết quả tìm kiếm. Ưu tiên ScraperAPI structured Google; fallback parse HTML. */
async function searchLinks(query: string, num: number): Promise<string[]> {
  const key = process.env.SCRAPER_API_KEY || '';
  if (key) {
    try {
      const u =
        'https://api.scraperapi.com/structured/google/search?' +
        new URLSearchParams({ api_key: key, query, country_code: process.env.SCRAPER_COUNTRY || 'vn', num: String(num) });
      const res = await fetch(u, { signal: AbortSignal.timeout(45000) });
      if (res.ok) {
        const j: any = await res.json();
        const links = (j.organic_results || []).map((r: any) => r.link).filter(Boolean);
        if (links.length) return links;
      }
    } catch {
      /* fallback */
    }
  }
  try {
    const r = await smartFetch(
      'https://www.google.com/search?hl=vi&gl=vn&num=' + num + '&q=' + encodeURIComponent(query),
      { timeoutMs: 30000, retries: 2 },
    );
    if (r.text) return parseGoogleHtml(r.text);
  } catch {
    /* ignore */
  }
  return [];
}

function parseGoogleHtml(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (!u || seen.has(u) || SKIP_DOMAINS.test(u) || !/^https?:\/\//.test(u)) return;
    seen.add(u);
    out.push(u);
  };
  // dạng /url?q=<thật>&...
  for (const m of html.matchAll(/\/url\?q=([^&"]+)/g)) {
    try {
      push(decodeURIComponent(m[1]));
    } catch {
      /* ignore */
    }
  }
  // dạng href="https://..." trực tiếp
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) push(m[1]);
  return out;
}

export interface SearchOptions {
  maxLinks?: number; // số trang mở tối đa mỗi sản phẩm
  concurrency?: number;
}

const cache = new Map<string, { t: number; v: MarketPrice[] }>();
const TTL_MS = 1000 * 60 * 60 * 12; // 12 giờ — tăng tốc khi quét lại trong ngày

/** Tìm giá thị trường cho 1 sản phẩm. Trả về 1 giá thấp nhất / mỗi sàn (đã xác minh đúng model). */
export async function searchProductPrices(query: string, modelCode: string, opts: SearchOptions = {}): Promise<MarketPrice[]> {
  const maxLinks = opts.maxLinks ?? 12;
  const cacheKey = norm(query) + '#' + norm(modelCode) + '#' + maxLinks;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;

  const mc = norm(modelCode);
  // Gom link, bỏ domain nhiễu, giữ tối đa 1 link đầu / domain để đa dạng cửa hàng
  const rawLinks = await searchLinks(query, Math.max(maxLinks + 6, 15));
  const byDomain = new Map<string, string>();
  for (const l of rawLinks) {
    if (SKIP_DOMAINS.test(l)) continue;
    const d = domainOf(l);
    if (!byDomain.has(d)) byDomain.set(d, l);
    if (byDomain.size >= maxLinks) break;
  }
  const links = [...byDomain.values()];

  const results = await mapLimit(links, opts.concurrency ?? 5, async (link) => {
    try {
      const r = await smartFetch(link, { timeoutMs: 20000, retries: 1 });
      if (!r.ok || !r.text) return null;
      const prods = extractProductsFromHtml(r.text, r.url);
      let best: number | null = null;
      for (const p of prods) {
        const price = p.salePrice ?? p.originalPrice;
        if (price == null || price < 10000) continue;
        // Xác minh đúng model: tên trang phải chứa mã model (đã chuẩn hoá)
        if (mc.length >= 4 && !norm(p.name).includes(mc)) continue;
        if (best == null || price < best) best = price;
      }
      if (best == null) return null;
      return { siteName: domainOf(r.url), price: best, url: r.url } as MarketPrice;
    } catch {
      return null;
    }
  });

  const perDomain = new Map<string, MarketPrice>();
  for (const m of results) {
    if (!m) continue;
    const ex = perDomain.get(m.siteName);
    if (!ex || m.price < ex.price) perDomain.set(m.siteName, m);
  }
  const out = [...perDomain.values()].sort((a, b) => a.price - b.price);
  cache.set(cacheKey, { t: Date.now(), v: out });
  return out;
}
