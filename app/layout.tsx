import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lấy Giá Sản Phẩm Tự Động',
  description: 'Lấy thông tin sản phẩm & giá từ nhiều website, xuất Excel đa sheet',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans text-slate-800 antialiased">{children}</body>
    </html>
  );
}
