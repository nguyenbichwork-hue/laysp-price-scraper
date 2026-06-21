# Cài đặt Google Sheet + Apps Script cho laysp

Làm 1 lần, ~5 phút. Sau khi xong, tab **Google Sheet** trong laysp sẽ đọc/ghi được sheet.

## 1. Tạo Google Sheet
1. Vào https://sheets.google.com → tạo bảng tính mới (ví dụ đặt tên **So Giá**).
2. Chưa cần tạo cột gì — script sẽ tự tạo sheet `SanPham` và `LOG` ở bước 4.

## 2. Mở Apps Script
- Trong Google Sheet: menu **Tiện ích mở rộng (Extensions) → Apps Script**.
- Xóa hết code mẫu, **dán toàn bộ nội dung file `Code.gs`** vào.

## 3. Đặt mật khẩu
- Ở đầu file, đổi dòng:
  ```js
  var SECRET = 'doi-mat-khau-nay';
  ```
  thành một chuỗi bí mật của riêng sếp (ví dụ `bnb-sogia-2026-x7k`). **Nhớ chuỗi này.**
- Bấm 💾 **Lưu**.

## 4. Deploy thành Web app
1. Bấm **Triển khai (Deploy) → Lần triển khai mới (New deployment)**.
2. Chọn loại: **Ứng dụng web (Web app)**.
3. Thiết lập:
   - **Execute as / Thực thi với tư cách:** *Tôi (chính sếp)*
   - **Who has access / Ai có quyền truy cập:** *Bất kỳ ai (Anyone)*
4. Bấm **Triển khai**, cấp quyền khi Google hỏi (chọn tài khoản → Nâng cao → Vẫn tiếp tục).
5. Copy **URL Web app** (dạng `https://script.google.com/macros/s/AKfy…/exec`).

## 5. Nối vào laysp
Mở `.env.local` (cùng thư mục dự án) thêm 2 dòng:
```
APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfy…/exec
SHEET_SECRET=bnb-sogia-2026-x7k   # đúng chuỗi đã đặt ở bước 3
```
Khởi động lại `npm run dev`.

## 6. Dùng
- Vào tab **Google Sheet** trong laysp → bấm **Kiểm tra kết nối**.
- Bấm **Tạo cột mẫu** (chạy `setup`) → sheet `SanPham` + `LOG` có tiêu đề.
- Điền sản phẩm vào `SanPham`: **Mã, Thương hiệu, Model, Tên, Giá vốn, Giá hiện tại** (cột A–F).
- Quay lại laysp: **Quét thị trường** (lấy giá đối thủ) → tab **Google Sheet** → **Tải SP từ Sheet** → **Ghi kết quả vào Sheet**.

## Lưu ý khi đổi code
Mỗi lần sửa `Code.gs`, phải **Deploy → Quản lý triển khai → ✏️ (Edit) → Phiên bản: Mới → Triển khai** để URL cũ chạy code mới (không tạo deployment mới kẻo đổi URL).
