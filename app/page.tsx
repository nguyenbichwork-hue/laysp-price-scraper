'use client';

import { useMemo, useState } from 'react';

type Status = 'pending' | 'running' | 'done' | 'error';

interface Product {
  code: string;
  name: string;
  originalPrice: number | null;
  salePrice: number | null;
  currency: string;
  url: string;
}

interface SiteResult {
  url: string;
  siteName: string;
  platform: string;
  products: Product[];
  count: number;
  note?: string;
  error?: string;
}

interface Row extends Partial<SiteResult> {
  input: string;
  status: Status;
}

const PLATFORM_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  haravan: 'Haravan',
  sapo: 'Sapo',
  woocommerce: 'WooCommerce',
  sitemap: 'Sitemap',
  'homepage-links': 'Quét trang chủ',
  'single-page': 'Trang đơn',
  unknown: 'Không rõ',
};

const CONCURRENCY = 3;

export default function Home() {
  const [text, setText] = useState('');
  const [maxProducts, setMaxProducts] = useState(1000);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const urls = useMemo(
    () =>
      Array.from(
        new Set(
          text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean),
        ),
      ),
    [text],
  );

  const done = rows.length > 0 && rows.every((r) => r.status === 'done' || r.status === 'error');
  const totalProducts = rows.reduce((s, r) => s + (r.count || 0), 0);
  const okSites = rows.filter((r) => r.status === 'done').length;
  const progress = rows.length ? Math.round((rows.filter((r) => r.status === 'done' || r.status === 'error').length / rows.length) * 100) : 0;

  async function start() {
    if (urls.length === 0 || running) return;
    setRunning(true);
    const initial: Row[] = urls.map((u) => ({ input: u, status: 'pending' }));
    setRows(initial);

    const queue = urls.map((u, i) => ({ u, i }));
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const { u, i } = queue[cursor++];
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'running' } : r)));
        try {
          const res = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, maxProducts }),
          });
          const data: SiteResult = await res.json();
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    ...data,
                    status: data.error && (!data.products || data.products.length === 0) ? 'error' : 'done',
                  }
                : r,
            ),
          );
        } catch (e: any) {
          setRows((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: 'error', error: e?.message || 'Lỗi kết nối' } : r)),
          );
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
    setRunning(false);
  }

  async function download() {
    const sites = rows
      .filter((r) => r.siteName)
      .map((r) => ({
        url: r.url || r.input,
        siteName: r.siteName,
        platform: r.platform,
        products: r.products || [],
        count: r.count || 0,
        note: r.note,
        error: r.error,
      }));
    if (sites.length === 0) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sites }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('Lỗi tạo Excel: ' + (err.error || res.status));
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = 'bang-gia-san-pham.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloading(false);
    }
  }

  function loadSample() {
    setText(
      [
        'https://canifa.com',
        'https://www.thecoffeehouse.com',
        'https://cellphones.com.vn',
      ].join('\n'),
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Header */}
      <header className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm ring-1 ring-indigo-100">
          <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          Tự động · Đa website · Xuất Excel
        </div>
        <h1 className="bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
          Lấy Giá Sản Phẩm Tự Động
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
          Dán danh sách link website (mỗi dòng 1 link). Hệ thống tự lấy mã, tên, giá gốc, giá bán của toàn bộ
          sản phẩm rồi xuất Excel — mỗi web một tab, kèm tab tổng hợp tìm giá rẻ nhất.
        </p>
      </header>

      {/* Input card */}
      <section className="rounded-2xl bg-white p-5 shadow-xl shadow-slate-200/60 ring-1 ring-slate-100 sm:p-7">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700">Danh sách link website</label>
          <button onClick={loadSample} className="text-xs font-medium text-indigo-600 hover:underline" type="button">
            Dùng link mẫu
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'https://website-1.com\nhttps://website-2.com\nhttps://website-3.com'}
          rows={7}
          className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 p-4 font-mono text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
        />

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500">Giới hạn SP / web</label>
              <input
                type="number"
                min={10}
                max={5000}
                step={50}
                value={maxProducts}
                onChange={(e) => setMaxProducts(Math.max(10, Math.min(5000, Number(e.target.value) || 1000)))}
                className="mt-1 w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <span className="hidden text-xs text-slate-400 sm:block">
              {urls.length} link · tránh quá tải nên đặt giới hạn hợp lý
            </span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setText('');
                setRows([]);
              }}
              disabled={running}
              type="button"
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Xoá
            </button>
            <button
              onClick={start}
              disabled={running || urls.length === 0}
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:from-indigo-700 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? (
                <>
                  <Spinner /> Đang lấy dữ liệu…
                </>
              ) : (
                <>⚡ Bắt đầu lấy dữ liệu</>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Progress + results */}
      {rows.length > 0 && (
        <section className="mt-8 animate-fade-in">
          {/* Stats */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Website" value={`${okSites}/${rows.length}`} />
            <Stat label="Tổng sản phẩm" value={totalProducts.toLocaleString('vi-VN')} />
            <Stat label="Tiến độ" value={`${progress}%`} />
            <div className="flex items-center justify-center rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
              <button
                onClick={download}
                disabled={!done || downloading || totalProducts === 0}
                type="button"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-200 transition hover:from-emerald-600 hover:to-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloading ? (
                  <>
                    <Spinner /> Đang tạo…
                  </>
                ) : (
                  <>⬇ Tải Excel</>
                )}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Per-site cards */}
          <div className="space-y-3">
            {rows.map((r, i) => (
              <SiteCard key={i} row={r} />
            ))}
          </div>
        </section>
      )}

      <footer className="mt-12 text-center text-xs text-slate-400">
        Ưu tiên dữ liệu có cấu trúc (products.json / WooCommerce API / sitemap) để lấy chính xác & ít bị chặn.
        Với web dựng hoàn toàn bằng JS, hãy cấu hình biến môi trường <code>SCRAPER_API_KEY</code>.
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-100">
      <div className="text-2xl font-extrabold text-slate-800">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-400">{label}</div>
    </div>
  );
}

function SiteCard({ row }: { row: Row }) {
  const statusMap: Record<Status, { dot: string; text: string; label: string }> = {
    pending: { dot: 'bg-slate-300', text: 'text-slate-400', label: 'Chờ' },
    running: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-600', label: 'Đang lấy…' },
    done: { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Hoàn tất' },
    error: { dot: 'bg-rose-500', text: 'text-rose-600', label: 'Lỗi' },
  };
  const s = statusMap[row.status];

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100 transition hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-700">{row.siteName || row.input}</div>
            <div className="truncate text-xs text-slate-400">{row.input}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {row.platform && row.status === 'done' && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600">
              {PLATFORM_LABEL[row.platform] || row.platform}
            </span>
          )}
          {row.status === 'done' && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600">
              {(row.count || 0).toLocaleString('vi-VN')} SP
            </span>
          )}
          <span className={`text-xs font-semibold ${s.text}`}>{s.label}</span>
        </div>
      </div>

      {row.note && row.status === 'done' && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{row.note}</p>
      )}
      {row.error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{row.error}</p>
      )}

      {/* Preview vài sản phẩm đầu */}
      {row.status === 'done' && row.products && row.products.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
            Xem trước {Math.min(5, row.products.length)} sản phẩm
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Mã</th>
                  <th className="py-1 pr-3 font-medium">Tên</th>
                  <th className="py-1 pr-3 font-medium text-right">Giá gốc</th>
                  <th className="py-1 font-medium text-right">Giá bán</th>
                </tr>
              </thead>
              <tbody className="text-slate-600">
                {row.products.slice(0, 5).map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 pr-3 font-mono text-[11px] text-slate-400">{p.code || '—'}</td>
                    <td className="max-w-xs truncate py-1 pr-3">{p.name}</td>
                    <td className="py-1 pr-3 text-right text-slate-400 line-through">
                      {p.originalPrice ? p.originalPrice.toLocaleString('vi-VN') : ''}
                    </td>
                    <td className="py-1 text-right font-semibold text-rose-600">
                      {p.salePrice ? p.salePrice.toLocaleString('vi-VN') : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}
