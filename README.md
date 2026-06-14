# Lấy Giá Sản Phẩm Tự Động 🏷️

Hệ thống web lấy thông tin **mã sản phẩm, tên sản phẩm, giá gốc, giá bán** từ nhiều website cùng lúc và xuất ra **file Excel đa sheet**:

- **Tab "Tổng hợp"**: cột mã sản phẩm + giá của từng web cho mỗi sản phẩm → tự đánh dấu **giá thấp nhất** và **web rẻ nhất**.
- **Mỗi web một tab riêng**: Mã / Tên / Giá gốc / Giá bán / Link.

> Dán danh sách link (mỗi dòng 1 link) → bấm **Bắt đầu** → bấm **Tải Excel**. Đơn giản vậy thôi.

## ✨ Cách hoạt động (logic lấy dữ liệu)

Với mỗi website, hệ thống thử lần lượt các chiến lược từ **chính xác nhất → tổng quát nhất**, dừng khi có dữ liệu:

1. **Shopify / Haravan / Sapo** — đọc endpoint `/products.json` (rất phổ biến ở VN). Lấy được toàn bộ sản phẩm gồm SKU, tên, `compare_at_price` (giá gốc), `price` (giá bán) chỉ với vài request.
2. **WooCommerce (WordPress)** — đọc Store API `/wp-json/wc/store/v1/products` (không cần khoá).
3. **Sitemap** — đọc `sitemap.xml` / sitemap index → thu thập URL sản phẩm → bóc tách từng trang.
4. **Quét trang chủ** — tìm các link sản phẩm ngay trên HTML trang chủ.
5. **Trang đơn** — nếu link là 1 trang sản phẩm, bóc tách trực tiếp.

Phần bóc tách HTML ưu tiên **dữ liệu có cấu trúc**: JSON-LD (`schema.org/Product`) → Microdata → thẻ meta (OpenGraph/`product:price`) → heuristic DOM (class/id chứa `price`, `gia`, ký hiệu `₫`).

### 🛡️ Chống bị chặn

- Xoay **User-Agent** + header trình duyệt thật (Accept-Language `vi-VN`, `sec-ch-ua`, Referer…).
- **Retry** với exponential backoff khi gặp 429/403/5xx.
- **Timeout** bằng `AbortController`, giới hạn concurrency.
- Sẵn chỗ cắm **proxy/render JS** qua ScraperAPI (biến môi trường `SCRAPER_API_KEY`) cho web chống bot mạnh hoặc dựng hoàn toàn bằng JS.

## 🚀 Chạy local

```bash
npm install
npm run dev
# mở http://localhost:3000
```

## ⚙️ Biến môi trường (tuỳ chọn)

| Biến | Ý nghĩa |
|------|---------|
| `SCRAPER_API_KEY` | Khoá [ScraperAPI](https://www.scraperapi.com) để render JS + xoay proxy. Để trống = fetch trực tiếp. |
| `SCRAPER_COUNTRY` | Mã quốc gia proxy (mặc định `vn`). |

Cấu hình trên Vercel: **Project → Settings → Environment Variables**.

## 📦 Triển khai

Deploy sẵn trên **Vercel** (Next.js App Router). API route chạy Node.js runtime, `maxDuration = 60s`.

## ⚠️ Giới hạn cần biết

- Các sàn lớn (Shopee, Lazada, TikTok Shop) chống bot rất mạnh và chặn IP serverless — cần `SCRAPER_API_KEY` mới ổn định.
- Web dựng **hoàn toàn bằng JavaScript** không có dữ liệu cấu trúc sẽ trả về rỗng nếu không bật render.
- So sánh giá ở tab "Tổng hợp" ghép theo **mã SKU** (hoặc tên chuẩn hoá nếu thiếu mã); SKU khác nhau giữa các web sẽ nằm ở dòng riêng.

## 🧱 Công nghệ

Next.js 14 · TypeScript · Tailwind CSS · Cheerio · ExcelJS.
