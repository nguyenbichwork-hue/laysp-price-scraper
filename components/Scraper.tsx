'use client';

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Spinner, Stat, fmtNum } from './common';

export interface SProduct {
  code: string;
  name: string;
  originalPrice: number | null;
  salePrice: number | null;
  currency: string;
  url: string;
}
type Task =
  | { strategy: 'api'; kind: 'shopify' | 'woo'; page: number }
  | { strategy: 'fetchUrls'; mode: 'detail' | 'listing' | 'auto'; urls: string[] };
type Status = 'pending' | 'running' | 'done' | 'error';

export interface SRow {
  input: string;
  status: Status;
  siteName?: string;
  platform?: string;
  products: SProduct[];
  count: number;
  total?: number | null;
  note?: string;
  error?: string;
  needsRender?: boolean;
  phase?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  shopify: 'Shopify/Haravan/Sapo',
  woocommerce: 'WooCommerce',
  'listing-pages': 'Trang danh mục',
  sitemap: 'Sitemap',
  'homepage-links': 'Quét trang chủ',
  'spa-state': 'SPA',
  'single-page': 'Trang đơn',
  unknown: 'Không rõ',
};
const SITE_CONCURRENCY = 3;
const MAX_ROUNDS = 400;

function normU(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return (u || '').toLowerCase();
  }
}
function keyOf(p: SProduct): string {
  const u = p.url ? normU(p.url) : '';
  return u || 'n:' + p.name.toLowerCase() + '|' + (p.salePrice ?? '');
}
function phaseText(platform?: string): string {
  if (platform === 'shopify' || platform === 'woocommerce') return 'Đang tải sản phẩm qua API…';
  if (platform === 'listing-pages') return 'Đang lấy theo trang danh mục…';
  if (platform === 'sitemap') return 'Đang lấy theo sitemap…';
  return 'Đang lấy dữ liệu…';
}

export default function Scraper({
  password,
  rows,
  setRows,
}: {
  password: string;
  rows: SRow[];
  setRows: React.Dispatch<React.SetStateAction<SRow[]>>;
}) {
  const [text, setText] = useState('');
  const [maxProducts, setMaxProducts] = useState(2000);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const stopRef = useRef(false);

  const urls = useMemo(
    () => Array.from(new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))),
    [text],
  );
  const done = rows.length > 0 && rows.every((r) => r.status === 'done' || r.status === 'error');
  const totalProducts = rows.reduce((s, r) => s + (r.count || 0), 0);
  const okSites = rows.filter((r) => r.status === 'done').length;
  const finished = rows.filter((r) => r.status === 'done' || r.status === 'error').length;
  const progress = rows.length ? Math.round((finished / rows.length) * 100) : 0;

  const patchRow = (i: number, patch: Partial<SRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function callApi(url: string, task?: Task, retries = 2): Promise<any> {
    let lastErr: any = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-app-password': password },
          body: JSON.stringify({ url, maxProducts, task }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async function runSite(i: number, url: string) {
    patchRow(i, { status: 'running', phase: 'Đang dò nền tảng…' });
    const products: SProduct[] = [];
    const seen = new Set<string>();
    const addAll = (arr: SProduct[]): number => {
      let added = 0;
      for (const p of arr || []) {
        const k = keyOf(p);
        if (seen.has(k)) continue;
        seen.add(k);
        products.push(p);
        added++;
      }
      return added;
    };
    try {
      const disc = await callApi(url);
      patchRow(i, { siteName: disc.siteName, platform: disc.platform, note: disc.note, needsRender: disc.needsRender });
      addAll(disc.products);
      patchRow(i, { products: [...products], count: products.length, total: disc.total ?? undefined, phase: phaseText(disc.platform) });
      if (disc.error && products.length === 0) {
        patchRow(i, { status: 'error', error: disc.error, phase: undefined });
        return;
      }
      if (disc.mode === 'api') {
        let api: { kind: 'shopify' | 'woo'; page: number } | null = disc.task || null;
        let rounds = 0;
        while (api && !stopRef.current && products.length < maxProducts && rounds < MAX_ROUNDS) {
          rounds++;
          patchRow(i, { phase: `Đang tải sản phẩm… (${products.length})` });
          try {
            const r = await callApi(url, { strategy: 'api', kind: api.kind, page: api.page });
            addAll(r.products);
            patchRow(i, { products: [...products], count: products.length });
            api = r.task || null;
          } catch {
            break;
          }
        }
      } else if (disc.mode === 'urls' && Array.isArray(disc.worklist)) {
        const mode: 'auto' | 'listing' | 'detail' =
          disc.urlMode === 'detail' ? 'detail' : disc.urlMode === 'listing' ? 'listing' : 'auto';
        const batchSize = mode === 'listing' ? 14 : mode === 'detail' ? 56 : 50;
        const worklist: string[] = [];
        const wlSeen = new Set<string>();
        const enqueue = (us: string[]) => {
          for (const u of us || []) {
            const k = normU(u);
            if (wlSeen.has(k)) continue;
            wlSeen.add(k);
            worklist.push(u);
          }
        };
        enqueue(disc.worklist);
        let pos = 0, rounds = 0, dry = 0;
        while (pos < worklist.length && !stopRef.current && products.length < maxProducts && rounds < MAX_ROUNDS) {
          rounds++;
          const batch = worklist.slice(pos, pos + batchSize);
          pos += batch.length;
          const before = worklist.length;
          patchRow(i, { phase: `Đang lấy… ${products.length} SP (đã quét ${pos}/${worklist.length} trang)` });
          let added = 0;
          try {
            const r = await callApi(url, { strategy: 'fetchUrls', mode, urls: batch });
            added = addAll(r.products);
            if (r.enqueueUrls) enqueue(r.enqueueUrls);
            patchRow(i, { products: [...products], count: products.length });
          } catch {
            /* skip batch */
          }
          const grew = worklist.length > before;
          dry = added === 0 && !grew ? dry + 1 : 0;
          if (dry >= 6 && pos >= worklist.length) break;
        }
      }
      const capped = products.length >= maxProducts;
      let note = disc.note;
      if (capped) note = `Đã đạt giới hạn ${maxProducts} SP (tăng giới hạn để lấy thêm).`;
      else if (stopRef.current) note = `Đã dừng (${products.length} SP).`;
      patchRow(i, { status: 'done', count: products.length, products: [...products], note, phase: undefined });
    } catch (e: any) {
      patchRow(i, {
        status: products.length ? 'done' : 'error',
        count: products.length,
        products: [...products],
        error: products.length ? undefined : e?.message || 'Lỗi kết nối',
        phase: undefined,
      });
    }
  }

  async function start() {
    if (urls.length === 0 || running) return;
    stopRef.current = false;
    setRunning(true);
    setRows(urls.map((u) => ({ input: u, status: 'pending', products: [], count: 0 })));
    const queue = urls.map((u, i) => ({ u, i }));
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && !stopRef.current) {
        const { u, i } = queue[cursor++];
        await runSite(i, u);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SITE_CONCURRENCY, queue.length) }, () => worker()));
    setRows((prev) => prev.map((r) => (r.status === 'pending' || r.status === 'running' ? { ...r, status: 'done', phase: undefined } : r)));
    setRunning(false);
  }

  async function download() {
    const sites = rows.filter((r) => r.siteName || r.products.length).map((r) => ({
      url: r.input, siteName: r.siteName || r.input, platform: r.platform || 'unknown',
      products: r.products || [], count: r.count || 0, note: r.note, error: r.error,
    }));
    if (sites.length === 0) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-password': password },
        body: JSON.stringify({ sites }),
      });
      if (!res.ok) {
        alert('Lỗi tạo Excel');
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

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700">Danh sách link web đối thủ</label>
          <button
            onClick={() => setText(['https://bepngocanh.com', 'https://thienkimhome.com'].join('\n'))}
            className="text-xs font-medium text-indigo-600 hover:underline"
            type="button"
          >
            Dùng link mẫu
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'https://website-1.com\nhttps://website-2.com'}
          rows={6}
          className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 p-4 font-mono text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
        />
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500">Giới hạn SP / web</label>
              <input
                type="number"
                min={50}
                max={20000}
                step={100}
                value={maxProducts}
                onChange={(e) => setMaxProducts(Math.max(50, Math.min(20000, Number(e.target.value) || 2000)))}
                className="mt-1 w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <span className="hidden text-xs text-slate-400 sm:block">{urls.length} link</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setText(''); setRows([]); }}
              disabled={running}
              type="button"
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Xoá
            </button>
            {running ? (
              <button onClick={() => (stopRef.current = true)} type="button" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-200 transition hover:from-rose-600 hover:to-red-700">
                ■ Dừng
              </button>
            ) : (
              <button onClick={start} disabled={urls.length === 0} type="button" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:from-indigo-700 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                ⚡ Bắt đầu quét
              </button>
            )}
          </div>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Website" value={`${okSites}/${rows.length}`} />
            <Stat label="Tổng SP" value={fmtNum(totalProducts)} accent="indigo" />
            <Stat label="Tiến độ" value={`${progress}%`} />
            <div className="flex items-center justify-center rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
              <button onClick={download} disabled={downloading || totalProducts === 0} type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:from-emerald-600 hover:to-green-700 disabled:opacity-50">
                {downloading ? <><Spinner /> Đang tạo…</> : <>⬇ Excel{!done && totalProducts > 0 ? ' (đã có)' : ''}</>}
              </button>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500" animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
          </div>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <SiteCard key={i} row={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SiteCard({ row }: { row: SRow }) {
  const statusMap: Record<Status, { dot: string; text: string; label: string }> = {
    pending: { dot: 'bg-slate-300', text: 'text-slate-400', label: 'Chờ' },
    running: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-600', label: 'Đang lấy…' },
    done: { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Hoàn tất' },
    error: { dot: 'bg-rose-500', text: 'text-rose-600', label: 'Lỗi' },
  };
  const s = statusMap[row.status];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100 transition hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-700">{row.siteName || row.input}</div>
            <div className="truncate text-xs text-slate-400">{row.phase || row.input}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {row.platform && row.status !== 'pending' && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600">{PLATFORM_LABEL[row.platform] || row.platform}</span>
          )}
          {(row.count || 0) > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600">{fmtNum(row.count)} SP</span>}
          <span className={`text-xs font-semibold ${s.text}`}>{s.label}</span>
        </div>
      </div>
      {row.needsRender && <p className="mt-2 rounded-lg bg-orange-50 px-3 py-1.5 text-xs text-orange-700">⚠ Web chặn IP / dựng bằng JS — cần SCRAPER_API_KEY.</p>}
      {row.note && row.status === 'done' && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{row.note}</p>}
      {row.error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{row.error}</p>}
    </motion.div>
  );
}
