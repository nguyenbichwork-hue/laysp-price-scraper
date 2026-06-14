# Lấy Giá Sản Phẩm Tự Động 🏷️

Hệ thống web lấy thông tin **mã sản phẩm, tên sản phẩm, giá gốc, giá bán** từ nhiều website cùng lúc và xuất ra **file Excel đa sheet**:

- **Tab "Tổng hợp"**: cột mã sản phẩm + giá của từng web cho mỗi sản phẩm → tự đánh dấu **giá thấp nhất** và **web rẻ nhất**.
- **Mỗi web một tab riêng**: Mã / Tên / Giá gốc / Giá bán / Link.

> Dán danh sách link (mỗi dòng 1 link) → bấm **Bắt đầu** → bấm **Tải Excel**. Đơn giản vậy thôi.

## ✨ Cách hoạt động (logic lấy dữ liệu)

Hệ thống **crawl nhiều vòng (resumable)**: client gọi API nhiều lần cho mỗi web, mỗi vòng làm ≤~48s rồi trả về để vòng sau tiếp tục → **vượt giới hạn 60s/lần của serverless**, lấy được hàng nghìn sản phẩm. Mỗi web thử lần lượt:

1. **Shopify / Haravan / Sapo** — `/products.json?limit=250&page=N` (phân trang). Lấy toàn bộ SKU, tên, `compare_at_price` (giá gốc), `price` (giá bán) trong vài giây. **Gộp biến thể**: mỗi sản phẩm 1 dòng, lấy giá thấp nhất.
2. **WooCommerce** — Store API `/wp-json/wc/store/v1/products` (phân trang).
3. **Auto (web tự code)** — lấy danh sách URL từ `sitemap.xml` (lấy **mẫu trải đều** để tránh phần danh mục dồn đầu sitemap), rồi với mỗi URL: trang **danh mục** → thu thêm URL sản phẩm; trang **chi tiết** → lấy giá **chính xác từ JSON-LD** (không tin giá trên trang danh mục vì hay lẫn giá cọc/trả góp).
4. **SPA** — đọc dữ liệu nhúng `__NEXT_DATA__` / `__NUXT__`; nếu không có → báo cần render.
5. **Trang đơn** — nếu link là 1 trang sản phẩm, bóc tách trực tiếp.

Bóc tách HTML ưu tiên **dữ liệu có cấu trúc**: JSON-LD (`schema.org/Product`, **tự sửa JSON hỏng**) → Microdata → meta (OpenGraph/`product:price`/`input#price`) → heuristic. Giá được chuẩn hoá đúng cả định dạng VN (`1.990.000`, `10420000.0000`) lẫn quốc tế.

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

## ⏱️ Tốc độ & độ sâu

- **Web có API** (Shopify/Haravan/Sapo/WooCommerce): lấy **toàn bộ** sản phẩm trong vài giây.
- **Web tự code có sitemap**: lấy giá chính xác từ trang chi tiết; tốc độ phụ thuộc **độ nặng & tốc độ server của chính web đó**. Web trang nhẹ → nhanh; web trang nặng (vài trăm KB/trang, server chậm) → vài trăm SP/vài phút.
- Mặc định **2.000 SP/web** (chỉnh được). Có **nút Dừng** — dừng bất cứ lúc nào vẫn tải được Excel phần đã lấy.

## ⚠️ Giới hạn cần biết

- Các sàn lớn (Shopee, Lazada, TikTok Shop) chống bot rất mạnh và chặn IP serverless — cần `SCRAPER_API_KEY` mới ổn định.
- Web dựng **hoàn toàn bằng JavaScript** không có dữ liệu cấu trúc/nhúng sẽ trả về rỗng nếu không bật render (`SCRAPER_API_KEY`).
- So sánh giá ở tab "Tổng hợp" ghép theo **mã SKU** (hoặc tên chuẩn hoá nếu thiếu mã); SKU khác nhau giữa các web sẽ nằm ở dòng riêng.

## 🧱 Công nghệ

Next.js 14 · TypeScript · Tailwind CSS · Cheerio · ExcelJS.
