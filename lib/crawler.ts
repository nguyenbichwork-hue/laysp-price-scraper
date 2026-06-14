// Điều phối lấy sản phẩm theo từng vòng (resumable) cho MỘT website.
//   discover(url)      -> vòng đầu: dò nền tảng, trả lô SP đầu + cách đi tiếp
//   runTask(url, task) -> các vòng sau: làm 1 chunk công việc theo task

import type { DiscoverResult, TaskRoundResult, Task, Product } from './types';
import { smartFetch } from './fetcher';
import { extractProductsFromHtml, extractListing, extractSpaProducts, looksLikeSpa } from './extractor';
import {
  shopifyPage,
  wooPage,
  getMenuLinks,
  collectSitemapUrls,
  prioritizeProductUrls,
  processListingUrls,
  processDetailUrls,
  processAutoUrls,
  normUrlLocal,
} from './platforms';

export interface CrawlConfig {
  maxProducts: number;
  timeBudgetMs: number;
  concurrency: number;
}

const DEFAULTS: CrawlConfig = { maxProducts: 2000, timeBudgetMs: 48000, concurrency: 12 };

function siteNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
function normalizeInputUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// ---------------- Vòng khám phá ----------------
export async function discover(inputUrl: string, cfgPartial: Partial<CrawlConfig> = {}): Promise<DiscoverResult> {
  const cfg = { ...DEFAULTS, ...cfgPartial };
  const url = normalizeInputUrl(inputUrl);
  const siteName = siteNameFromUrl(url);
  const deadline = Date.now() + cfg.timeBudgetMs;
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    return { url: inputUrl, siteName, platform: 'unknown', mode: 'done', products: [], error: 'URL không hợp lệ' };
  }

  try {
    // 1) Shopify / Haravan / Sapo
    const shop = await shopifyPage(origin, 1, cfg.maxProducts);
    if (shop.products.length) {
      return {
        url: inputUrl, siteName, platform: 'shopify', mode: 'api',
        products: clean(shop.products),
        task: shop.hasMore ? { kind: 'shopify', page: 2 } : undefined,
        total: null,
      };
    }

    // 2) WooCommerce
    const woo = await wooPage(origin, 1);
    if (woo && woo.products.length) {
      return {
        url: inputUrl, siteName, platform: 'woocommerce', mode: 'api',
        products: clean(woo.products),
        task: woo.hasMore ? { kind: 'woo', page: 2 } : undefined,
        total: woo.total,
      };
    }

    // 3) Tải trang chủ (decode charset đúng)
    const home = await smartFetch(url, { accept: 'html', timeoutMs: 20000, retries: 2 });
    if (home.blocked) {
      return {
        url: inputUrl, siteName, platform: 'unknown', mode: 'done', products: [], needsRender: true,
        error: 'Web chặn bot (Cloudflare/CAPTCHA). Cần cấu hình SCRAPER_API_KEY để vượt qua.',
      };
    }
    if (!home.ok) {
      return {
        url: inputUrl, siteName, platform: 'unknown', mode: 'done', products: [],
        error: `Không tải được trang chủ (HTTP ${home.status}).`,
      };
    }

    const menuLinks = getMenuLinks(home.text, origin);
    const navSet = new Set(menuLinks.map(normUrlLocal));

    // 4) AUTO mode (CHÍNH): danh mục -> thu URL sản phẩm; chi tiết -> JSON-LD (giá chính xác).
    //    worklist = trang danh mục (menu) + URL sản phẩm (sitemap). Giá luôn lấy từ trang chi tiết.
    const sitemapUrls = await collectSitemapUrls(origin, deadline);
    const productUrls = sitemapUrls.length ? prioritizeProductUrls(sitemapUrls, origin, navSet, cfg.maxProducts) : [];
    // Có sitemap -> dùng URL sản phẩm trực tiếp (sản phẩm lên trước, lợi suất cao).
    // Không có sitemap -> dùng menu danh mục để "trải" ra URL sản phẩm.
    const worklist = productUrls.length >= 3 ? productUrls : dedupeUrls(menuLinks);
    if (worklist.length >= 3) {
      const totalGuess = sitemapUrls.length ? new Set(sitemapUrls.map(normUrlLocal)).size : null;
      return {
        url: inputUrl, siteName, platform: sitemapUrls.length ? 'sitemap' : 'listing-pages',
        mode: 'urls', urlMode: 'auto', worklist, products: [], total: totalGuess,
        note: totalGuess ? `Quét tối đa ${cfg.maxProducts} sản phẩm (sitemap ${totalGuess} URL, giá từ trang chi tiết).` : `Quét ${menuLinks.length} danh mục.`,
      };
    }

    // 5) SPA / state nhúng
    if (looksLikeSpa(home.text)) {
      const spa = clean(extractSpaProducts(home.text, url));
      if (spa.length) {
        return { url: inputUrl, siteName, platform: 'spa-state', mode: 'done', products: spa, note: 'Lấy từ dữ liệu nhúng (SPA).' };
      }
      return {
        url: inputUrl, siteName, platform: 'unknown', mode: 'done', products: [], needsRender: true,
        error: 'Web dựng hoàn toàn bằng JS (SPA). Cần SCRAPER_API_KEY để render.',
      };
    }

    // 6) Quét link sản phẩm trên trang chủ -> auto (chi tiết)
    const homeLinks = collectProductLinks(home.text, origin);
    if (homeLinks.length) {
      return {
        url: inputUrl, siteName, platform: 'homepage-links', mode: 'urls', urlMode: 'auto',
        worklist: homeLinks.slice(0, cfg.maxProducts), products: [], total: null,
      };
    }

    // 7) Trang đơn (người dùng dán thẳng link sản phẩm)
    const single = clean(extractProductsFromHtml(home.text, url));
    if (single.length) {
      return { url: inputUrl, siteName, platform: 'single-page', mode: 'done', products: single,
        note: 'Chỉ lấy được sản phẩm trên trang này.' };
    }
    return { url: inputUrl, siteName, platform: 'unknown', mode: 'done', products: [],
      error: 'Không tìm thấy dữ liệu sản phẩm.' };
  } catch (err: any) {
    return { url: inputUrl, siteName, platform: 'unknown', mode: 'done', products: [], error: 'Lỗi: ' + (err?.message || String(err)) };
  }
}

// ---------------- Vòng làm việc theo task ----------------
export async function runTask(inputUrl: string, task: Task, cfgPartial: Partial<CrawlConfig> = {}): Promise<TaskRoundResult> {
  const cfg = { ...DEFAULTS, ...cfgPartial };
  const url = normalizeInputUrl(inputUrl);
  const deadline = Date.now() + cfg.timeBudgetMs;
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    return { products: [], error: 'URL không hợp lệ' };
  }

  // Phòng vệ: task api có thể bị thiếu 'strategy' (chỉ có kind/page)
  const t: any = task;
  if (!t.strategy && t.kind) t.strategy = 'api';

  try {
    if (task.strategy === 'api') {
      const out: Product[] = [];
      let page = task.page;
      let hasMore = true;
      const pageCap = page + 6;
      while (hasMore && page <= pageCap && Date.now() < deadline && out.length < 1500) {
        const r = task.kind === 'shopify' ? await shopifyPage(origin, page, 1e9) : null;
        const w = task.kind === 'woo' ? await wooPage(origin, page) : null;
        const batch = r ? r.products : w ? w.products : [];
        hasMore = r ? r.hasMore : w ? w.hasMore : false;
        out.push(...batch);
        page++;
        if (batch.length === 0) {
          hasMore = false;
          break;
        }
      }
      return { products: clean(out), task: hasMore ? { kind: task.kind, page } : null };
    }

    // fetchUrls
    if (task.mode === 'auto') {
      const r = await processAutoUrls(task.urls, deadline, cfg.concurrency);
      return { products: clean(r.products), enqueueUrls: r.enqueueUrls };
    }
    if (task.mode === 'listing') {
      const r = await processListingUrls(task.urls, deadline, cfg.concurrency);
      return { products: clean(r.products), enqueueUrls: r.enqueueUrls };
    }
    const products = await processDetailUrls(task.urls, deadline, cfg.concurrency);
    return { products: clean(products) };
  } catch (err: any) {
    return { products: [], error: 'Lỗi: ' + (err?.message || String(err)) };
  }
}

// ---------------- Helpers ----------------
function clean(products: Product[]): Product[] {
  return products.filter((p) => p.name && (p.salePrice != null || p.originalPrice != null));
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const k = normUrlLocal(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

function collectProductLinks(html: string, origin: string): string[] {
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  const hints = /(\/product\/|\/products\/|\/san-pham\/|\/p\/|\/sp\/|-p\d+|\/dp\/|\.html)/i;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    try {
      const abs = new URL(href, origin);
      if (abs.origin !== origin || !hints.test(abs.href)) continue;
      const k = normUrlLocal(abs.href);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(abs.href.split('#')[0]);
    } catch {
      /* ignore */
    }
  }
  return out;
}
