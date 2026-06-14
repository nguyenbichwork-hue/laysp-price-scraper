// Phát hiện nền tảng + lấy sản phẩm theo từng vòng (resumable).
// Mỗi hàm chỉ làm 1 chunk công việc (<=~45s) rồi trả về để client gọi vòng tiếp.

import * as cheerio from 'cheerio';
import type { Product } from './types';
import { smartFetch, fetchJson } from './fetcher';
import { parsePrice, bestCode } from './price';
import { extractProductsFromHtml, extractListing } from './extractor';

export function normUrlLocal(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return (u || '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

const PRODUCT_URL_HINTS = /(\/product\/|\/products\/|\/san-pham\/|\/p\/|\/sp\/|-p\d+|\/dp\/|\.html)/i;

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};
// Giải mã HTML entity trong chuỗi (tên SP từ WooCommerce hay chứa &#8211; &amp; ...)
function decodeEntity(m: string): string {
  if (NAMED_ENTITIES[m]) return NAMED_ENTITIES[m];
  const num = m.match(/^&#(\d+);$/);
  if (num) return String.fromCodePoint(parseInt(num[1], 10));
  const hex = m.match(/^&#x([0-9a-f]+);$/i);
  if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
  return m;
}

// ============ Shopify / Haravan / Sapo : /products.json ============
export async function shopifyPage(origin: string, page: number, maxProducts: number): Promise<{ products: Product[]; hasMore: boolean }> {
  const data = await fetchJson<any>(`${origin}/products.json?limit=250&page=${page}`, {
    timeoutMs: 15000,
    retries: 2,
    proxyFallback: false,
  });
  if (!data || !Array.isArray(data.products) || data.products.length === 0) return { products: [], hasMore: false };
  const products: Product[] = [];
  for (const p of data.products) {
    const variants = Array.isArray(p.variants) && p.variants.length ? p.variants : [{}];
    // Gộp biến thể: 1 sản phẩm = 1 dòng, lấy giá thấp nhất
    let sale: number | null = null;
    let original: number | null = null;
    for (const v of variants) {
      const s = parsePrice(v.price);
      if (s != null && (sale == null || s < sale)) sale = s;
      const o = parsePrice(v.compare_at_price);
      if (o != null && o > 0 && (original == null || o < original)) original = o;
    }
    const handle = p.handle || '';
    const firstSku = (variants.find((v: any) => v.sku) || {}).sku || '';
    const title = (p.title || '').toString().trim();
    products.push({
      code: bestCode(firstSku, title, handle || String(p.id || '')),
      name: title,
      salePrice: sale,
      originalPrice: original != null && original > (sale ?? 0) ? original : sale,
      currency: 'VND',
      url: handle ? `${origin}/products/${handle}` : origin,
    });
    if (products.length >= maxProducts) break;
  }
  return { products, hasMore: data.products.length >= 250 };
}

// ============ WooCommerce Store API ============
export async function wooPage(
  origin: string,
  page: number,
): Promise<{ products: Product[]; hasMore: boolean; total: number | null } | null> {
  const bases = [`${origin}/wp-json/wc/store/v1/products`, `${origin}/wp-json/wc/store/products`];
  for (const base of bases) {
    const res = await smartFetch(`${base}?per_page=100&page=${page}`, {
      accept: 'json',
      timeoutMs: 15000,
      retries: 2,
      proxyFallback: false,
    });
    if (!res.ok || !res.text) continue;
    let data: any;
    try {
      data = JSON.parse(res.text);
    } catch {
      continue;
    }
    if (!Array.isArray(data)) continue;
    const products: Product[] = [];
    for (const p of data) {
      const prices = p.prices || {};
      const minor = Number(prices.currency_minor_unit ?? 0);
      const div = Math.pow(10, minor) || 1;
      const regular = prices.regular_price ? Number(prices.regular_price) / div : null;
      const saleRaw = prices.sale_price ? Number(prices.sale_price) / div : null;
      const cur = prices.price ? Number(prices.price) / div : null;
      const sale = saleRaw && saleRaw > 0 ? saleRaw : cur;
      // Mã: ưu tiên SKU; nếu trống dùng slug từ permalink (dễ đọc hơn id số)
      let slug = '';
      try {
        slug = new URL(p.permalink).pathname.split('/').filter(Boolean).pop() || '';
      } catch {
        /* ignore */
      }
      const wname = (p.name || '').toString().trim().replace(/&#?\w+;/g, (m: string) => decodeEntity(m));
      products.push({
        code: bestCode(p.sku, wname, slug || String(p.id || '')),
        name: wname,
        salePrice: sale,
        originalPrice: regular && regular > 0 ? regular : sale,
        currency: prices.currency_code || 'VND',
        url: p.permalink || origin,
      });
    }
    return { products, hasMore: data.length >= 100, total: null };
  }
  return null;
}

// ============ Menu/danh mục từ trang chủ ============
export function getMenuLinks(html: string, origin: string, max = 400): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];
  const sel =
    'nav a[href], header a[href], footer a[href], [class*="menu" i] a[href], [class*="nav" i] a[href], [class*="danh-muc" i] a[href], [class*="category" i] a[href], [class*="collection" i] a[href]';
  $(sel).each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) return;
    try {
      const abs = new URL(href, origin);
      if (abs.origin !== origin) return;
      const key = normUrlLocal(abs.href);
      if (key === normUrlLocal(origin) || seen.has(key)) return;
      // bỏ link tài khoản/giỏ hàng/bài viết
      if (/(\/cart|\/gio-hang|\/account|\/tai-khoan|\/login|\/dang-nhap|\/blog|\/tin-tuc|\/news|\/lien-he|\/contact|\/gioi-thieu|\/about)/i.test(abs.pathname))
        return;
      seen.add(key);
      out.push(abs.href.split('#')[0]);
    } catch {
      /* ignore */
    }
  });
  return out.slice(0, max);
}

// ============ Sitemap -> danh sách URL sản phẩm (không tự crawl) ============
function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) locs.push(m[1].trim());
  return locs;
}

export async function collectSitemapUrls(origin: string, deadline: number): Promise<string[]> {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/product-sitemap.xml`,
    `${origin}/sitemap-products.xml`,
    `${origin}/sitemap/sitemap.xml`,
  ];
  let urls: string[] = [];
  for (const sm of candidates) {
    if (Date.now() > deadline) break;
    const res = await smartFetch(sm, { accept: 'xml', timeoutMs: 15000, retries: 1, proxyFallback: false });
    if (!res.ok || !res.text.includes('<loc>')) continue;
    const locs = extractLocs(res.text);
    if (res.text.includes('<sitemapindex')) {
      const children = locs
        .filter((l) => /\.xml($|\?)/i.test(l))
        .sort((a, b) => (/(product|san-pham|sp)/i.test(a) ? 0 : 1) - (/(product|san-pham|sp)/i.test(b) ? 0 : 1));
      for (const child of children.slice(0, 20)) {
        if (Date.now() > deadline || urls.length > 20000) break;
        const cres = await smartFetch(child, { accept: 'xml', timeoutMs: 15000, retries: 1 });
        if (cres.ok) urls.push(...extractLocs(cres.text).filter((l) => !/\.xml($|\?)/i.test(l)));
      }
    } else {
      urls.push(...locs.filter((l) => !/\.xml($|\?)/i.test(l)));
    }
    if (urls.length > 0) break;
  }
  return urls;
}

/**
 * Chọn URL sản phẩm: loại trùng + loại trang menu/danh mục, ưu tiên URL có dấu hiệu
 * sản phẩm. Nếu sitemap khổng lồ -> LẤY MẪU TRẢI ĐỀU toàn danh sách (sitemap thường
 * liệt kê danh mục ở đầu, sản phẩm ở phần sau & chiếm đa số -> trải đều sẽ trúng SP).
 */
export function prioritizeProductUrls(urls: string[], origin: string, navSet: Set<string>, max: number): string[] {
  const homeNorm = normUrlLocal(origin);
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const u of urls) {
    const n = normUrlLocal(u);
    if (n === homeNorm || seen.has(n) || navSet.has(n)) continue; // bỏ trang menu/danh mục
    seen.add(n);
    uniq.push(u);
  }
  const hinted = uniq.filter((u) => PRODUCT_URL_HINTS.test(u));
  const pool = hinted.length >= Math.min(max, 50) ? hinted : uniq;
  if (pool.length <= max) return pool;
  // Lấy mẫu trải đều để tránh phần danh mục dồn ở đầu sitemap
  const stride = pool.length / max;
  const out: string[] = [];
  for (let i = 0; i < max; i++) out.push(pool[Math.floor(i * stride)]);
  return out;
}

// ============ Worker pool fetch + extract ============
async function pool<T>(items: T[], concurrency: number, deadline: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      if (Date.now() > deadline) return;
      try {
        await fn(items[i]);
      } catch {
        /* bỏ qua item lỗi */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

function nextPageUrl(url: string, html: string): string | null {
  const $ = cheerio.load(html);
  const rel = $('a[rel="next"]').attr('href') || $('link[rel="next"]').attr('href');
  if (rel) {
    try {
      return new URL(rel, url).href;
    } catch {
      /* fall through */
    }
  }
  try {
    const u = new URL(url);
    const cur = parseInt(u.searchParams.get('page') || '1', 10);
    if (cur >= 50) return null; // chặn vòng lặp vô hạn
    u.searchParams.set('page', String(cur + 1));
    return u.href;
  } catch {
    return null;
  }
}

/** Xử lý lô URL danh mục (listing): bóc nhiều SP/trang + đề xuất trang kế. */
export async function processListingUrls(
  urls: string[],
  deadline: number,
  concurrency: number,
): Promise<{ products: Product[]; enqueueUrls: string[] }> {
  const products: Product[] = [];
  const enqueue: string[] = [];
  await pool(urls, concurrency, deadline, async (url) => {
    const res = await smartFetch(url, { accept: 'html', timeoutMs: 15000, retries: 1 });
    if (!res.ok) return;
    const items = extractListing(res.text, url);
    if (items.length) products.push(...items);
    if (items.length >= 8) {
      const np = nextPageUrl(url, res.text);
      if (np) enqueue.push(np);
    }
  });
  return { products, enqueueUrls: enqueue };
}

/** Lọc bỏ sản phẩm có giá phi lý (trang danh mục lọt vào, số rác). */
function sane(p: Product): boolean {
  const s = p.salePrice ?? p.originalPrice;
  if (s == null || s < 1000 || s > 5e10) return false;
  if (p.salePrice != null && p.originalPrice != null && p.originalPrice > p.salePrice * 30) return false;
  return true;
}

/** Xử lý lô URL trang chi tiết (strict: chỉ dữ liệu có cấu trúc). */
export async function processDetailUrls(urls: string[], deadline: number, concurrency: number): Promise<Product[]> {
  const products: Product[] = [];
  await pool(urls, concurrency, deadline, async (url) => {
    const res = await smartFetch(url, { accept: 'html', timeoutMs: 15000, retries: 1 });
    if (!res.ok) return;
    for (const p of extractProductsFromHtml(res.text, url, true)) {
      if (sane(p)) products.push(p);
    }
  });
  return products;
}

/**
 * Chế độ AUTO (chính xác + nhanh):
 *  - Trang danh mục (extractListing thấy >=6 card) -> CHỈ thu thập URL sản phẩm + trang kế (KHÔNG lấy giá listing).
 *  - Trang chi tiết -> lấy giá chính xác từ JSON-LD (strict).
 * Nhờ đó giá luôn từ trang chi tiết, còn URL sản phẩm được "trải" ra từ trang danh mục.
 */
export async function processAutoUrls(
  urls: string[],
  deadline: number,
  concurrency: number,
): Promise<{ products: Product[]; enqueueUrls: string[] }> {
  const products: Product[] = [];
  const enqueue: string[] = [];
  await pool(urls, concurrency, deadline, async (url) => {
    const res = await smartFetch(url, { accept: 'html', timeoutMs: 15000, retries: 1 });
    if (!res.ok) return;
    // Lấy sản phẩm của chính trang (nếu là trang chi tiết)
    const own = extractProductsFromHtml(res.text, url, true).filter(sane);
    if (own.length > 0) {
      products.push(...own);
      return; // là trang chi tiết -> không cần parse listing (tiết kiệm CPU)
    }
    // Không phải trang chi tiết -> có thể là trang danh mục: thu URL sản phẩm + trang kế
    const listing = extractListing(res.text, url);
    if (listing.length >= 4) {
      for (const it of listing) enqueue.push(it.url);
      const np = nextPageUrl(url, res.text);
      if (np) enqueue.push(np);
    }
  });
  return { products, enqueueUrls: enqueue };
}
