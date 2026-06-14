// Điều phối lấy sản phẩm cho MỘT website (1 link người dùng nhập).
// Thử lần lượt các chiến lược từ chính xác -> tổng quát, dừng khi có dữ liệu.

import type { SiteResult, Product } from './types';
import { smartFetch } from './fetcher';
import {
  tryShopifyLike,
  tryWooCommerce,
  trySitemap,
  tryHomepageLinks,
} from './platforms';
import { extractProductsFromHtml } from './extractor';

export interface CrawlConfig {
  maxProducts: number;
  timeBudgetMs: number;
  concurrency: number;
}

const DEFAULTS: CrawlConfig = {
  maxProducts: 1000,
  timeBudgetMs: 50000,
  concurrency: 6,
};

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

export async function crawlSite(inputUrl: string, cfgPartial: Partial<CrawlConfig> = {}): Promise<SiteResult> {
  const cfg = { ...DEFAULTS, ...cfgPartial };
  const url = normalizeInputUrl(inputUrl);
  const siteName = siteNameFromUrl(url);
  const deadline = Date.now() + cfg.timeBudgetMs;

  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    return { url: inputUrl, siteName, platform: 'unknown', products: [], count: 0, error: 'URL không hợp lệ' };
  }

  try {
    // 1) Shopify / Haravan / Sapo (/products.json) — nhanh & đầy đủ nhất
    const shop = await tryShopifyLike(origin, cfg.maxProducts, deadline);
    if (shop && shop.products.length) return finalize(inputUrl, siteName, shop.platform, shop.products, shop.note);

    // 2) WooCommerce Store API
    const woo = await tryWooCommerce(origin, cfg.maxProducts, deadline);
    if (woo && woo.products.length) return finalize(inputUrl, siteName, woo.platform, woo.products, woo.note);

    // 3) Sitemap.xml -> trang sản phẩm
    if (Date.now() < deadline) {
      const sm = await trySitemap(origin, cfg.maxProducts, deadline, cfg.concurrency);
      if (sm && sm.products.length) return finalize(inputUrl, siteName, sm.platform, sm.products, sm.note);
    }

    // Lấy HTML trang chủ (dùng cho bước 4 và 5)
    const home = await smartFetch(url, { accept: 'html', timeoutMs: 20000, retries: 2 });

    // 4) Quét link sản phẩm trên trang chủ
    if (home.ok && Date.now() < deadline) {
      const hp = await tryHomepageLinks(origin, home.text, cfg.maxProducts, deadline, cfg.concurrency);
      if (hp && hp.products.length) return finalize(inputUrl, siteName, hp.platform, hp.products, hp.note);
    }

    // 5) Coi chính trang đã tải là một trang sản phẩm đơn lẻ
    if (home.ok) {
      const single = extractProductsFromHtml(home.text, url);
      if (single.length) {
        return finalize(
          inputUrl,
          siteName,
          'single-page',
          single,
          'Không phát hiện danh sách sản phẩm; chỉ lấy được sản phẩm trên trang này. Hãy thử dán link trang danh mục/cửa hàng.',
        );
      }
    }

    if (!home.ok) {
      return {
        url: inputUrl,
        siteName,
        platform: 'unknown',
        products: [],
        count: 0,
        error: `Không tải được trang (HTTP ${home.status}). Web có thể chặn bot hoặc cần render JS — cân nhắc cấu hình SCRAPER_API_KEY.`,
      };
    }

    return {
      url: inputUrl,
      siteName,
      platform: 'unknown',
      products: [],
      count: 0,
      error: 'Không tìm thấy dữ liệu sản phẩm. Trang có thể dựng bằng JS hoàn toàn — cân nhắc bật render qua SCRAPER_API_KEY.',
    };
  } catch (err: any) {
    return {
      url: inputUrl,
      siteName,
      platform: 'unknown',
      products: [],
      count: 0,
      error: 'Lỗi: ' + (err?.message || String(err)),
    };
  }
}

function finalize(
  url: string,
  siteName: string,
  platform: SiteResult['platform'],
  products: Product[],
  note?: string,
): SiteResult {
  // Bỏ sản phẩm không có cả tên lẫn giá
  const cleaned = products.filter((p) => p.name && (p.salePrice != null || p.originalPrice != null));
  return { url, siteName, platform, products: cleaned, count: cleaned.length, note };
}
