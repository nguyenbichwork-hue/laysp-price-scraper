// Kiểu dữ liệu dùng chung toàn hệ thống

export interface Product {
  /** Mã sản phẩm (SKU / mã hàng / handle) */
  code: string;
  /** Tên sản phẩm */
  name: string;
  /** Giá gốc (giá niêm yết / gạch ngang). null nếu không tìm thấy */
  originalPrice: number | null;
  /** Giá bán (giá hiện tại sau khuyến mãi). null nếu không tìm thấy */
  salePrice: number | null;
  /** Đơn vị tiền tệ, ví dụ VND, USD */
  currency: string;
  /** Link tới trang sản phẩm */
  url: string;
}

export type Platform =
  | 'shopify'
  | 'haravan'
  | 'sapo'
  | 'woocommerce'
  | 'listing-pages'
  | 'sitemap'
  | 'homepage-links'
  | 'spa-state'
  | 'single-page'
  | 'unknown';

// ----- Cơ chế crawl nhiều vòng (resumable) -----

/** Công việc cho vòng tiếp theo, client gửi lại server. */
export type Task =
  | { strategy: 'api'; kind: 'shopify' | 'woo'; page: number }
  | { strategy: 'fetchUrls'; mode: 'detail' | 'listing' | 'auto'; urls: string[] };

/** Kết quả vòng khám phá (request không có task). */
export interface DiscoverResult {
  url: string;
  siteName: string;
  platform: Platform;
  /** 'api' = phân trang API; 'urls' = client giữ worklist URL; 'done' = xong luôn */
  mode: 'api' | 'urls' | 'done';
  products: Product[];
  task?: { kind: 'shopify' | 'woo'; page: number }; // khi mode='api'
  worklist?: string[]; // khi mode='urls'
  urlMode?: 'detail' | 'listing' | 'auto'; // cách xử lý worklist
  total?: number | null; // ước lượng tổng SP nếu biết
  note?: string;
  error?: string;
  needsRender?: boolean; // web SPA/chặn bot, cần SCRAPER_API_KEY
}

/** Kết quả một vòng làm việc (request có task). */
export interface TaskRoundResult {
  products: Product[];
  task?: { kind: 'shopify' | 'woo'; page: number } | null; // api: trang kế, null=hết
  enqueueUrls?: string[]; // listing: các trang/URL cần thêm vào worklist
  note?: string;
  error?: string;
}

// ----- Store của tôi (Haravan) & đối chiếu giá -----

export interface MyProduct {
  productId: number;
  variantIds: number[]; // các variant để cập nhật giá
  sku: string;
  code: string; // mã model (bestCode) dùng để khớp
  name: string;
  price: number; // giá bán hiện tại (đại diện)
  cost?: number | null; // giá vốn (lấy từ Google Sheet / nhập tay) – để chặn định giá lỗ
  comparePrice: number | null; // giá niêm yết (compare_at_price)
  productType: string; // nhóm sản phẩm
  vendor: string; // hãng
  tags: string;
  image: string;
  handle: string;
  url: string;
  inventory: number;
}

export interface MarketPrice {
  siteName: string;
  price: number;
  url: string;
}

export interface ComparisonRow {
  product: MyProduct;
  market: MarketPrice[];
  marketMin: number | null;
  marketMax: number | null;
  marketAvg: number | null;
  siteCount: number;
  /** % giá của tôi so với giá thấp nhất thị trường: (myPrice-min)/min*100 */
  pctVsMin: number | null;
  /** khớp theo: sku | model | name */
  matchedBy: 'sku' | 'model' | 'name' | null;
  /** Số giá bị loại vì nghi giá ảo/outlier (để hiển thị minh bạch) */
  dropped?: number;
}

export interface PriceUpdateResult {
  variantId: number;
  ok: boolean;
  oldPrice?: number;
  newPrice?: number;
  error?: string;
}

export interface SiteResult {
  /** URL gốc người dùng nhập */
  url: string;
  /** Tên hiển thị (domain) dùng đặt tên tab Excel */
  siteName: string;
  /** Nền tảng phát hiện được */
  platform: Platform;
  /** Danh sách sản phẩm lấy được */
  products: Product[];
  /** Số sản phẩm */
  count: number;
  /** Ghi chú (giới hạn, cảnh báo...) */
  note?: string;
  /** Lỗi nếu có */
  error?: string;
}
