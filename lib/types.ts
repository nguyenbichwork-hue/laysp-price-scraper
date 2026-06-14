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
  | 'sitemap'
  | 'homepage-links'
  | 'single-page'
  | 'unknown';

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
