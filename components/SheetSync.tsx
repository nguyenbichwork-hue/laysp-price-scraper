'use client';

import { useMemo, useRef, useState } from 'react';
import type { MyProduct, SiteResult, ComparisonRow, MarketPrice } from '@/lib/types';
import { buildComparison, rowFromPrices, suggestPrice, priceWarning, lossRisk } from '@/lib/match';
import { fmtVnd, fmtNum, Spinner, Stat, useToast } from './common';
import type { SRow } from './Scraper';

function sheetToMyProduct(sp: any): MyProduct {
  return {
    productId: sp.row,
    variantIds: [],
    sku: sp.ma || '',
    code: sp.model || sp.ma || '',
    name: sp.ten || sp.model || sp.ma || '',
    price: sp.giaHienTai ?? 0,
    cost: sp.giaVon ?? null,
    comparePrice: null,
    productType: '',
    vendor: sp.brand || '',
    tags: '',
    image: '',
    handle: '',
    url: '',
    inventory: 0,
  };
}

export default function SheetSync({ scrapeRows, password }: { scrapeRows: SRow[]; password: string }) {
  const toast = useToast();
  const [conn, setConn] = useState<{ ok: boolean; sheet?: string } | null>(null);
  const [sheetProducts, setSheetProducts] = useState<any[]>([]);
  const [floorPct, setFloorPct] = useState(85);
  const [minMargin, setMinMargin] = useState(5);
  const [busy, setBusy] = useState<string>('');
  const [searchedRows, setSearchedRows] = useState<ComparisonRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0, found: 0 });
  const [maxProducts, setMaxProducts] = useState(50);
  const [maxLinks, setMaxLinks] = useState(12);
  const stopRef = useRef(false);

  const sites: SiteResult[] = useMemo(
    () =>
      scrapeRows
        .filter((r) => r.products && r.products.length)
        .map((r) => ({
          url: r.input,
          siteName: r.siteName || r.input,
          platform: (r.platform || 'unknown') as any,
          products: r.products as any,
          count: r.count || 0,
        })),
    [scrapeRows],
  );

  const myProducts = useMemo(() => sheetProducts.map(sheetToMyProduct), [sheetProducts]);
  const compareRows = useMemo(() => buildComparison(myProducts, sites), [myProducts, sites]);
  // Ưu tiên kết quả "tự tìm giá" nếu đã chạy; nếu chưa, dùng dữ liệu từ tab Quét thị trường.
  const rows = searchedRows ?? compareRows;

  const fp = floorPct / 100;
  const mm = minMargin / 100;
  const sugOf = (r: ComparisonRow) => suggestPrice(r, fp, mm);
  const lossOf = (r: ComparisonRow) => lossRisk(r, mm);

  const matched = rows.filter((r) => r.marketMin != null).length;
  const nLoss = rows.filter((r) => lossOf(r)).length;
  const noCost = sheetProducts.filter((s) => s.giaVon == null).length;

  async function api(action: string, payload: Record<string, unknown> = {}) {
    const res = await fetch('/api/sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-password': password },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi gọi Sheet');
    return data;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      toast(e?.message || String(e), 'error');
    } finally {
      setBusy('');
    }
  }

  const checkConn = () =>
    run('ping', async () => {
      const d = await api('ping');
      setConn({ ok: true, sheet: d.sheet });
      toast(`Đã kết nối Sheet: ${d.sheet || 'OK'}`, 'success');
    });

  const doSetup = () =>
    run('setup', async () => {
      await api('setup');
      toast('Đã tạo/kiểm tra cột mẫu (SanPham, LOG)', 'success');
    });

  const loadProducts = () =>
    run('load', async () => {
      const d = await api('getProducts');
      setSheetProducts(d.products || []);
      setSearchedRows(null);
      setProg({ done: 0, total: 0, found: 0 });
      toast(`Đã tải ${(d.products || []).length} sản phẩm từ Sheet`, 'success');
    });

  async function searchAll() {
    if (searching) return;
    if (myProducts.length === 0) {
      toast('Chưa có sản phẩm. Hãy "Tải SP từ Sheet" trước.', 'error');
      return;
    }
    stopRef.current = false;
    setSearching(true);
    const targets = myProducts.slice(0, maxProducts);
    setProg({ done: 0, total: targets.length, found: 0 });
    const acc: ComparisonRow[] = [];
    let found = 0;
    const CONC = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length && !stopRef.current) {
        const p = targets[cursor++];
        const query = [p.vendor, p.code, p.name].filter(Boolean).join(' ').trim();
        try {
          const res = await fetch('/api/search-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-app-password': password },
            body: JSON.stringify({ query, model: p.code, maxLinks }),
          });
          const data = await res.json();
          const prices: MarketPrice[] = res.ok ? data.prices || [] : [];
          const row = rowFromPrices(p, prices);
          acc.push(row);
          if (row.marketMin != null) found++;
        } catch {
          acc.push(rowFromPrices(p, []));
        }
        setProg({ done: acc.length, total: targets.length, found });
        setSearchedRows([...acc]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, targets.length) }, () => worker()));
    setSearching(false);
    toast(`Tự tìm giá xong: ${found}/${targets.length} SP có giá`, found ? 'success' : 'error');
  }

  const writeBack = () =>
    run('write', async () => {
      if (rows.length === 0) {
        toast('Chưa có sản phẩm. Hãy "Tải SP từ Sheet" trước.', 'error');
        return;
      }
      const items = rows.map((r) => {
        const sug = sugOf(r);
        const warn = priceWarning(r, 0.1, 0.05);
        const canhBao = r.marketMin == null ? '' : lossOf(r) ? 'Lỗ' : warn === 'cao' ? 'Cao' : warn === 'thap' ? 'Thấp' : 'OK';
        return {
          row: r.product.productId,
          soLink: r.market.length,
          min: r.marketMin,
          deXuat: sug,
          canhBao,
          trangThai: r.marketMin == null ? 'Không tìm thấy giá' : 'Đã có giá',
          links: r.market.map((m) => `${m.siteName}: ${m.url}`).join('\n'),
        };
      });
      const logRows = rows.flatMap((r) =>
        r.market.map((m) => [null, r.product.vendor, r.product.code, m.price, m.url] as [null, string, string, number, string]),
      );
      const w = await api('writeResults', { items });
      let logMsg = '';
      if (logRows.length) {
        const lg = await api('appendLog', { rows: logRows });
        logMsg = `, ${lg.appended} dòng LOG`;
      }
      toast(`Đã ghi ${w.written} sản phẩm vào Sheet${logMsg}`, 'success');
    });

  return (
    <div className="space-y-5">
      {/* Kết nối */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-700">Kết nối Google Sheet</h3>
            <p className="text-xs text-slate-400">
              {conn?.ok ? `✅ Đã kết nối: ${conn.sheet}` : 'Cấu hình APPS_SCRIPT_URL + SHEET_SECRET trong .env.local (xem apps-script/README.md).'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={checkConn} disabled={!!busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {busy === 'ping' ? <Spinner /> : '🔌'} Kiểm tra kết nối
            </button>
            <button onClick={doSetup} disabled={!!busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {busy === 'setup' ? <Spinner /> : '📋'} Tạo cột mẫu
            </button>
          </div>
        </div>
      </div>

      {/* Thống kê */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="SP trong Sheet" value={fmtNum(sheetProducts.length)} accent="indigo" />
        <Stat label="Có giá thị trường" value={fmtNum(matched)} accent="emerald" />
        <Stat label="🩸 Rủi ro lỗ" value={fmtNum(nLoss)} accent="rose" />
        <Stat label="Web đã quét" value={fmtNum(sites.length)} />
      </div>

      {/* Cài đặt + hành động */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <Field label="Sàn an toàn (% giá hiện tại)">
          <input type="number" min={50} max={100} value={floorPct} onChange={(e) => setFloorPct(Math.max(50, Math.min(100, +e.target.value || 85)))} className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </Field>
        <Field label="% lãi tối thiểu (trên giá vốn)">
          <input type="number" min={0} max={100} value={minMargin} onChange={(e) => setMinMargin(Math.max(0, Math.min(100, +e.target.value || 0)))} className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </Field>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={loadProducts} disabled={!!busy} className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-sm font-bold text-white shadow-md hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50">
            {busy === 'load' ? <><Spinner /> Đang tải…</> : '⬇ Tải SP từ Sheet'}
          </button>
          <button onClick={writeBack} disabled={!!busy || rows.length === 0} className="rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-2 text-sm font-bold text-white shadow-md hover:from-emerald-600 hover:to-green-700 disabled:opacity-50">
            {busy === 'write' ? <><Spinner /> Đang ghi…</> : '⬆ Ghi kết quả vào Sheet'}
          </button>
        </div>
      </div>

      {/* Tự tìm giá theo model */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h3 className="font-semibold text-slate-700">🔎 Tự tìm giá theo model</h3>
            <p className="text-xs text-slate-400">Tự tìm trên các sàn cho từng SP — không cần quét tay tab Quét thị trường.</p>
          </div>
          <Field label="Số SP mỗi lần">
            <input type="number" min={1} max={500} value={maxProducts} onChange={(e) => setMaxProducts(Math.max(1, Math.min(500, +e.target.value || 50)))} className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
          </Field>
          <Field label="Số trang/SP">
            <input type="number" min={4} max={20} value={maxLinks} onChange={(e) => setMaxLinks(Math.max(4, Math.min(20, +e.target.value || 12)))} className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
          </Field>
          <div className="ml-auto flex gap-2">
            {searching ? (
              <button onClick={() => (stopRef.current = true)} className="rounded-xl bg-gradient-to-r from-rose-500 to-red-600 px-5 py-2 text-sm font-bold text-white shadow-md hover:from-rose-600 hover:to-red-700">■ Dừng</button>
            ) : (
              <button onClick={searchAll} disabled={sheetProducts.length === 0} className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-5 py-2 text-sm font-bold text-white shadow-md hover:from-fuchsia-700 hover:to-purple-700 disabled:opacity-50">🔎 Tự tìm giá</button>
            )}
          </div>
        </div>
        {(searching || prog.total > 0) && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>Đã xử lý {prog.done}/{prog.total} · tìm thấy giá {prog.found}</span>
              <span>{prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-500 transition-all" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Cần SCRAPER_API_KEY để tìm ổn định (tránh Google chặn IP).</p>
          </div>
        )}
      </div>

      {searchedRows == null && sites.length === 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Chưa có dữ liệu giá. Bấm <b>🔎 Tự tìm giá</b> ở trên, hoặc sang tab <b>Quét thị trường</b> quét tay rồi quay lại.
        </p>
      )}
      {noCost > 0 && sheetProducts.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {fmtNum(noCost)} sản phẩm chưa có <b>giá vốn</b> trong Sheet → các SP này sẽ không được chặn lỗ. Điền cột E (Giá vốn) trong Sheet.
        </p>
      )}

      {/* Bảng xem trước */}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-3">Mã</th>
                <th className="px-2 py-3">Model</th>
                <th className="px-2 py-3 text-right">Giá vốn</th>
                <th className="px-2 py-3 text-center">Số link</th>
                <th className="px-2 py-3 text-right">Giá thấp nhất</th>
                <th className="px-2 py-3 text-right">Giá đề xuất</th>
                <th className="px-2 py-3 text-center">Cảnh báo</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => {
                const sug = sugOf(r);
                const loss = lossOf(r);
                return (
                  <tr key={r.product.productId} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.product.sku || '—'}</td>
                    <td className="px-2 py-2 text-slate-700">{r.product.code}</td>
                    <td className="px-2 py-2 text-right text-slate-600">{r.product.cost ? fmtVnd(r.product.cost) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2 text-center text-slate-500">{r.market.length || <span className="text-slate-300">0</span>}{r.dropped ? <span className="text-[10px] text-slate-400"> (-{r.dropped})</span> : ''}</td>
                    <td className="px-2 py-2 text-right">{r.marketMin != null ? <span className="font-semibold text-indigo-600">{fmtVnd(r.marketMin)}</span> : <span className="text-xs text-slate-300">chưa có</span>}</td>
                    <td className="px-2 py-2 text-right font-bold text-emerald-700">{sug != null ? fmtVnd(sug) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2 text-center">
                      {r.marketMin == null ? <span className="text-slate-300">—</span> : loss ? <Badge c="rose">🩸 Lỗ</Badge> : <Badge c="emerald">OK</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 200 && <p className="px-4 py-2 text-center text-xs text-slate-400">… xem trước 200/{fmtNum(rows.length)} dòng. Bấm “Ghi kết quả vào Sheet” để ghi tất cả.</p>}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function Badge({ c, children }: { c: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    rose: 'bg-rose-50 text-rose-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${map[c]}`}>{children}</span>;
}
