// Bóc tách sản phẩm từ HTML theo nhiều chiến lược, ưu tiên dữ liệu có cấu trúc:
//   1. JSON-LD (schema.org/Product)  -> chính xác nhất
//   2. Microdata (itemtype Product)
//   3. Meta tags (OpenGraph / product:price)
//   4. Heuristic DOM (class/id chứa "price", "gia", ký hiệu tiền tệ)

import * as cheerio from 'cheerio';
import type { Product } from './types';
import { parsePrice } from './price';

function codeFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() || '';
    return seg.replace(/\.html?$/i, '') || u.hostname;
  } catch {
    return '';
  }
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Lấy mọi node có @type chứa "Product" từ JSON-LD (kể cả @graph, lồng nhau)
function collectProductNodes(node: any, out: any[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectProductNodes(n, out));
    return;
  }
  const t = node['@type'];
  const types = asArray(t).map((x) => String(x).toLowerCase());
  if (types.some((x) => x.includes('product'))) out.push(node);
  if (node['@graph']) collectProductNodes(node['@graph'], out);
  // ItemList -> itemListElement
  if (node.itemListElement) collectProductNodes(node.itemListElement, out);
  if (node.item) collectProductNodes(node.item, out);
}

function pickOffer(offers: any): { sale: number | null; original: number | null; currency: string } {
  let sale: number | null = null;
  let original: number | null = null;
  let currency = '';
  const list = asArray(offers);
  for (const off of list) {
    if (!off || typeof off !== 'object') continue;
    if (off.priceCurrency) currency = String(off.priceCurrency);
    // AggregateOffer
    if (off.lowPrice != null) {
      const lp = parsePrice(off.lowPrice);
      if (lp != null && (sale == null || lp < sale)) sale = lp;
    }
    if (off.highPrice != null) {
      const hp = parsePrice(off.highPrice);
      if (hp != null && (original == null || hp > original)) original = hp;
    }
    if (off.price != null) {
      const p = parsePrice(off.price);
      if (p != null && (sale == null || p < sale)) sale = p;
    }
    // Một số site để giá gốc trong priceSpecification
    const specs = asArray(off.priceSpecification);
    for (const sp of specs) {
      const p = parsePrice(sp?.price);
      if (p != null && (original == null || p > original)) original = p;
    }
  }
  return { sale, original, currency: currency || 'VND' };
}

function fromJsonLd($: cheerio.CheerioAPI, baseUrl: string): Product[] {
  const products: Product[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    let data: any;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      // Một số site nhúng nhiều object/escape lỗi -> bỏ qua
      return;
    }
    const nodes: any[] = [];
    collectProductNodes(data, nodes);
    for (const n of nodes) {
      const name = (n.name || n.title || '').toString().trim();
      if (!name) continue;
      const offer = pickOffer(n.offers);
      const code =
        (n.sku || n.mpn || n.gtin13 || n.gtin || n.productID || '').toString().trim() ||
        codeFromUrl(n.url || baseUrl);
      products.push({
        code,
        name,
        salePrice: offer.sale,
        originalPrice: offer.original ?? offer.sale,
        currency: offer.currency,
        url: (n.url && typeof n.url === 'string' ? new URL(n.url, baseUrl).href : baseUrl) || baseUrl,
      });
    }
  });
  return products;
}

function fromMicrodata($: cheerio.CheerioAPI, baseUrl: string): Product[] {
  const products: Product[] = [];
  $('[itemtype*="schema.org/Product" i]').each((_, el) => {
    const scope = $(el);
    const name = scope.find('[itemprop="name"]').first().text().trim() || scope.attr('data-name') || '';
    if (!name) return;
    const sku = scope.find('[itemprop="sku"]').first().attr('content') || scope.find('[itemprop="sku"]').first().text().trim();
    const priceEl = scope.find('[itemprop="price"]').first();
    const sale = parsePrice(priceEl.attr('content') || priceEl.text());
    const currency =
      scope.find('[itemprop="priceCurrency"]').first().attr('content') || 'VND';
    products.push({
      code: (sku || codeFromUrl(baseUrl)).toString().trim(),
      name,
      salePrice: sale,
      originalPrice: sale,
      currency,
      url: baseUrl,
    });
  });
  return products;
}

function fromMeta($: cheerio.CheerioAPI, baseUrl: string): Product | null {
  const get = (sel: string) => $(sel).first().attr('content')?.trim() || '';
  const name = get('meta[property="og:title"]') || get('meta[name="twitter:title"]') || $('title').first().text().trim();
  const priceStr =
    get('meta[property="product:price:amount"]') ||
    get('meta[property="og:price:amount"]') ||
    get('meta[itemprop="price"]') ||
    get('meta[name="twitter:data1"]');
  const sale = parsePrice(priceStr);
  if (!name || sale == null) return null;
  const currency =
    get('meta[property="product:price:currency"]') ||
    get('meta[property="og:price:currency"]') ||
    'VND';
  return {
    code: codeFromUrl(baseUrl),
    name,
    salePrice: sale,
    originalPrice: sale,
    currency,
    url: baseUrl,
  };
}

// Heuristic: tìm trong DOM phần tử mang ý nghĩa giá.
function fromHeuristic($: cheerio.CheerioAPI, baseUrl: string): Product | null {
  const name =
    $('h1').first().text().trim() ||
    $('[class*="product" i][class*="name" i], [class*="product" i][class*="title" i]').first().text().trim();
  if (!name) return null;

  const priceSelectors = [
    '[class*="price" i]',
    '[id*="price" i]',
    '[class*="gia" i]',
    '[class*="amount" i]',
    '[data-price]',
  ];
  let sale: number | null = null;
  let original: number | null = null;

  const candidates: { val: number; isOld: boolean }[] = [];
  $(priceSelectors.join(',')).each((_, el) => {
    const node = $(el);
    const txt = (node.attr('data-price') || node.text() || '').trim();
    if (!/[\d]/.test(txt)) return;
    if (!/(₫|đ|vnd|\$|đồng)/i.test(txt) && !node.attr('data-price')) return; // cần dấu hiệu tiền tệ
    const val = parsePrice(txt);
    if (val == null) return;
    const cls = (node.attr('class') || '').toLowerCase();
    const isOld = /old|original|regular|truoc|cu|del|strike|through/.test(cls) || node.is('del, s, strike');
    candidates.push({ val, isOld });
  });

  for (const c of candidates) {
    if (c.isOld) {
      if (original == null || c.val > original) original = c.val;
    } else {
      if (sale == null || c.val < sale) sale = c.val;
    }
  }
  // Nếu chỉ có 1 loại
  if (sale == null && original != null) sale = original;
  if (sale == null) return null;
  if (original == null) original = sale;

  return {
    code: codeFromUrl(baseUrl),
    name,
    salePrice: sale,
    originalPrice: original,
    currency: 'VND',
    url: baseUrl,
  };
}

/** Bóc tách sản phẩm từ một trang HTML. Trả về mảng (thường 1 với trang chi tiết). */
export function extractProductsFromHtml(html: string, baseUrl: string): Product[] {
  if (!html) return [];
  const $ = cheerio.load(html);

  // 1. JSON-LD
  const jsonld = fromJsonLd($, baseUrl);
  if (jsonld.length > 0) return dedupe(jsonld);

  // 2. Microdata
  const micro = fromMicrodata($, baseUrl);
  if (micro.length > 0) return dedupe(micro);

  // 3. Meta tags
  const meta = fromMeta($, baseUrl);
  if (meta) return [meta];

  // 4. Heuristic
  const heur = fromHeuristic($, baseUrl);
  if (heur) return [heur];

  return [];
}

function dedupe(products: Product[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    const key = (p.code || '') + '|' + p.name + '|' + (p.salePrice ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
