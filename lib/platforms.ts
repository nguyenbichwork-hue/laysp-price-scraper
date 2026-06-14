// Phát hiện nền tảng website và lấy TOÀN BỘ sản phẩm bằng nguồn dữ liệu có cấu trúc.
// Đây là cách chính xác & ít bị chặn nhất cho web hãng/cửa hàng tại VN.

import type { Product, Platform } from './types';
import { smartFetch, fetchJson } from './fetcher';
import { parsePrice } from './price';
import { extractProductsFromHtml } from './extractor';

export interface PlatformResult {
  platform: Platform;
  products: Product[];
  note?: string;
}

// ----- Shopify / Haravan / Sapo: endpoint /products.json -----
// Cả 3 nền tảng (rất phổ biến ở VN) đều expose /products.json?limit=250&page=N
export async function tryShopifyLike(
  origin: string,
  maxProducts: number,
  deadline: number,
): Promise<PlatformResult | null> {
  const products: Product[] = [];
  let detected: Platform = 'shopify';

  for (let page = 1; page <= 50; page++) {
    if (Date.now() > deadline || products.length >= maxProducts) break;
    const data = await fetchJson<any>(`${origin}/products.json?limit=250&page=${page}`, {
      timeoutMs: 15000,
      retries: 2,
    });
    if (!data || !Array.isArray(data.products)) {
      if (page === 1) return null; // không phải nền tảng này
      break;
    }
    if (data.products.length === 0) break;

    for (const p of data.products) {
      const variants = Array.isArray(p.variants) && p.variants.length ? p.variants : [{}];
      // Mỗi biến thể là một dòng (giá có thể khác nhau)
      for (const v of variants) {
        const sale = parsePrice(v.price);
        const original = parsePrice(v.compare_at_price);
        const handle = p.handle || '';
        const variantSuffix = variants.length > 1 && v.title && v.title !== 'Default Title' ? ` - ${v.title}` : '';
        products.push({
          code: (v.sku || handle || String(v.id || p.id || '')).toString().trim(),
          name: (p.title || '').toString().trim() + variantSuffix,
          salePrice: sale,
          originalPrice: original && original > 0 ? original : sale,
          currency: 'VND',
          url: handle ? `${origin}/products/${handle}` : origin,
        });
        if (products.length >= maxProducts) break;
      }
      if (products.length >= maxProducts) break;
    }
    if (data.products.length < 250) break;
  }

  if (products.length === 0) return null;

  // Nhận diện chi tiết nền tảng để ghi chú
  const note =
    products.length >= maxProducts ? `Đã giới hạn ${maxProducts} dòng đầu tiên.` : undefined;
  return { platform: detected, products, note };
}

// ----- WooCommerce: Store API (không cần auth) -----
export async function tryWooCommerce(
  origin: string,
  maxProducts: number,
  deadline: number,
): Promise<PlatformResult | null> {
  const endpoints = [`${origin}/wp-json/wc/store/v1/products`, `${origin}/wp-json/wc/store/products`];
  for (const base of endpoints) {
    const products: Product[] = [];
    let worked = false;
    for (let page = 1; page <= 50; page++) {
      if (Date.now() > deadline || products.length >= maxProducts) break;
      const data = await fetchJson<any[]>(`${base}?per_page=100&page=${page}`, {
        timeoutMs: 15000,
        retries: 2,
      });
      if (!Array.isArray(data)) break;
      worked = true;
      if (data.length === 0) break;
      for (const p of data) {
        const prices = p.prices || {};
        const minor = Number(prices.currency_minor_unit ?? 0);
        const div = Math.pow(10, minor) || 1;
        const regular = prices.regular_price ? Number(prices.regular_price) / div : null;
        const saleRaw = prices.sale_price ? Number(prices.sale_price) / div : null;
        const cur = prices.price ? Number(prices.price) / div : null;
        const sale = saleRaw && saleRaw > 0 ? saleRaw : cur;
        products.push({
          code: (p.sku || String(p.id || '')).toString().trim(),
          name: (p.name || '').toString().trim(),
          salePrice: sale,
          originalPrice: regular && regular > 0 ? regular : sale,
          currency: prices.currency_code || 'VND',
          url: p.permalink || origin,
        });
        if (products.length >= maxProducts) break;
      }
      if (data.length < 100) break;
    }
    if (worked && products.length > 0) {
      const note = products.length >= maxProducts ? `Đã giới hạn ${maxProducts} dòng đầu tiên.` : undefined;
      return { platform: 'woocommerce', products, note };
    }
  }
  return null;
}

// ----- Sitemap.xml -> thu thập URL sản phẩm -> bóc tách từng trang -----
function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) locs.push(m[1].trim());
  return locs;
}

const PRODUCT_URL_HINTS = /(\/product\/|\/products\/|\/san-pham\/|\/p\/|\/sp\/|-p\d+|\/dp\/)/i;

export async function trySitemap(
  origin: string,
  maxProducts: number,
  deadline: number,
  concurrency: number,
): Promise<PlatformResult | null> {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/product-sitemap.xml`,
    `${origin}/sitemap-products.xml`,
  ];
  let productUrls: string[] = [];

  for (const sm of candidates) {
    if (Date.now() > deadline) break;
    const res = await smartFetch(sm, { accept: 'xml', timeoutMs: 15000, retries: 2 });
    if (!res.ok || !res.text.includes('<loc>')) continue;
    let locs = extractLocs(res.text);

    // Nếu là sitemap index -> mở các sitemap con có vẻ chứa sản phẩm
    const childSitemaps = locs.filter((l) => /\.xml($|\?)/i.test(l));
    if (childSitemaps.length && res.text.includes('<sitemapindex')) {
      const prioritized = childSitemaps.sort((a, b) => {
        const pa = /product|san-pham|sp/i.test(a) ? 0 : 1;
        const pb = /product|san-pham|sp/i.test(b) ? 0 : 1;
        return pa - pb;
      });
      for (const child of prioritized.slice(0, 15)) {
        if (Date.now() > deadline || productUrls.length >= maxProducts) break;
        const cres = await smartFetch(child, { accept: 'xml', timeoutMs: 15000, retries: 1 });
        if (!cres.ok) continue;
        const childLocs = extractLocs(cres.text).filter((l) => !/\.xml($|\?)/i.test(l));
        productUrls.push(...childLocs);
      }
    } else {
      productUrls.push(...locs.filter((l) => !/\.xml($|\?)/i.test(l)));
    }
    if (productUrls.length > 0) break;
  }

  if (productUrls.length === 0) return null;

  // Ưu tiên URL trông giống trang sản phẩm
  const looksProduct = productUrls.filter((u) => PRODUCT_URL_HINTS.test(u));
  const chosen = (looksProduct.length ? looksProduct : productUrls).slice(0, maxProducts);

  const products = await crawlUrls(chosen, deadline, concurrency);
  if (products.length === 0) return null;
  const note =
    chosen.length < (looksProduct.length || productUrls.length)
      ? `Sitemap có ${looksProduct.length || productUrls.length} URL, đã lấy ${products.length}.`
      : undefined;
  return { platform: 'sitemap', products, note };
}

// ----- Fallback: quét link sản phẩm ngay trên trang chủ -----
export async function tryHomepageLinks(
  origin: string,
  homepageHtml: string,
  maxProducts: number,
  deadline: number,
  concurrency: number,
): Promise<PlatformResult | null> {
  const urls = new Set<string>();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(homepageHtml)) !== null) {
    let href = m[1];
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    try {
      const abs = new URL(href, origin).href;
      if (new URL(abs).origin !== origin) continue; // chỉ cùng domain
      if (PRODUCT_URL_HINTS.test(abs)) urls.add(abs.split('#')[0]);
    } catch {
      /* ignore */
    }
  }
  const chosen = Array.from(urls).slice(0, maxProducts);
  if (chosen.length === 0) return null;
  const products = await crawlUrls(chosen, deadline, concurrency);
  if (products.length === 0) return null;
  return { platform: 'homepage-links', products, note: `Lấy từ ${products.length} link sản phẩm trên trang chủ.` };
}

// Crawl nhiều URL trang sản phẩm với giới hạn concurrency + deadline
async function crawlUrls(urls: string[], deadline: number, concurrency: number): Promise<Product[]> {
  const out: Product[] = [];
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      if (Date.now() > deadline) return;
      const url = urls[i];
      const res = await smartFetch(url, { accept: 'html', timeoutMs: 15000, retries: 1 });
      if (!res.ok) continue;
      const prods = extractProductsFromHtml(res.text, url);
      out.push(...prods);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
  return out;
}
