'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { MyProduct, SiteResult, ComparisonRow } from '@/lib/types';
import { buildComparison, suggestPrice, priceWarning, lossRisk } from '@/lib/match';
import { fmtVnd, fmtNum, Stat, Modal, Spinner, useToast } from './common';
import type { SRow } from './Scraper';

const PAGE = 40;

export default function Dashboard({
  myProducts,
  setMyProducts,
  scrapeRows,
  password,
}: {
  myProducts: MyProduct[];
  setMyProducts: React.Dispatch<React.SetStateAction<MyProduct[]>>;
  scrapeRows: SRow[];
  password: string;
}) {
  const toast = useToast();
  const [floorPct, setFloorPct] = useState(85);
  const [minMargin, setMinMargin] = useState(5); // % lãi tối thiểu trên giá vốn
  const [highT, setHighT] = useState(10);
  const [lowT, setLowT] = useState(5);
  const [q, setQ] = useState('');
  const [fType, setFType] = useState('');
  const [fVendor, setFVendor] = useState('');
  const [fWarn, setFWarn] = useState('');
  const [onlyMatched, setOnlyMatched] = useState(true);
  const [page, setPage] = useState(0);
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [lastUndo, setLastUndo] = useState<{ variantId: number; price: number }[] | null>(null);

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

  const rows = useMemo(() => buildComparison(myProducts, sites), [myProducts, sites]);

  const types = useMemo(() => Array.from(new Set(myProducts.map((p) => p.productType).filter(Boolean))).sort(), [myProducts]);
  const vendors = useMemo(() => Array.from(new Set(myProducts.map((p) => p.vendor).filter(Boolean))).sort(), [myProducts]);

  const fp = floorPct / 100;
  const mm = minMargin / 100;
  const warnOf = (r: ComparisonRow) => priceWarning(r, highT / 100, lowT / 100);
  const sugOf = (r: ComparisonRow) => suggestPrice(r, fp, mm);
  const lossOf = (r: ComparisonRow) => lossRisk(r, mm);
  const priceFor = (r: ComparisonRow) => edits[r.product.productId] ?? sugOf(r) ?? r.product.price;

  // Thống kê
  const matched = rows.filter((r) => r.marketMin != null);
  const nCao = matched.filter((r) => warnOf(r) === 'cao').length;
  const nThap = matched.filter((r) => warnOf(r) === 'thap').length;
  const nLo = matched.filter((r) => lossOf(r)).length;
  const hasCost = myProducts.some((p) => p.cost != null && p.cost > 0);

  // Lọc
  const filtered = useMemo(() => {
    const qq = q.toLowerCase().trim();
    return rows.filter((r) => {
      const p = r.product;
      if (onlyMatched && r.marketMin == null) return false;
      if (fType && p.productType !== fType) return false;
      if (fVendor && p.vendor !== fVendor) return false;
      if (fWarn === 'lo') { if (!lossOf(r)) return false; }
      else if (fWarn && warnOf(r) !== fWarn) return false;
      if (qq && !(p.name.toLowerCase().includes(qq) || (p.code || '').toLowerCase().includes(qq))) return false;
      return true;
    });
  }, [rows, q, fType, fVendor, fWarn, onlyMatched, highT, lowT, mm]);

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const totalPages = Math.ceil(filtered.length / PAGE);

  const selectableOnPage = pageRows.filter((r) => r.marketMin != null);
  const toggleAllPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSel = selectableOnPage.every((r) => next.has(r.product.productId));
      for (const r of selectableOnPage) {
        if (allSel) next.delete(r.product.productId);
        else next.add(r.product.productId);
      }
      return next;
    });
  };

  const selectedRows = rows.filter((r) => selected.has(r.product.productId) && r.marketMin != null);

  function buildUpdates() {
    const ups: { variantId: number; price: number; productId: number }[] = [];
    for (const r of selectedRows) {
      const price = Math.round(priceFor(r));
      for (const vid of r.product.variantIds) ups.push({ variantId: vid, price, productId: r.product.productId });
    }
    return ups;
  }

  async function doUpdate(ups: { variantId: number; price: number }[], isUndo = false) {
    setUpdating(true);
    try {
      const res = await fetch('/api/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-password': password },
        body: JSON.stringify({ updates: ups.map((u) => ({ variantId: u.variantId, price: u.price })), isUndo }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Lỗi cập nhật', 'error');
        return;
      }
      const okCount = (data.results || []).filter((x: any) => x.ok).length;
      const failCount = (data.results || []).length - okCount;
      // Cập nhật giá local + lưu undo (giá cũ)
      const undo: { variantId: number; price: number }[] = [];
      const newPriceByPid = new Map<number, number>();
      for (const u of ups as any[]) newPriceByPid.set(u.productId ?? -1, u.price);
      for (const x of data.results || []) {
        if (x.ok && x.oldPrice != null) undo.push({ variantId: x.variantId, price: x.oldPrice });
      }
      // map variant->productId để cập nhật local
      const vidToPid = new Map<number, number>();
      for (const r of rows) for (const vid of r.product.variantIds) vidToPid.set(vid, r.product.productId);
      const pidNewPrice = new Map<number, number>();
      for (const x of data.results || []) if (x.ok && x.newPrice != null) { const pid = vidToPid.get(x.variantId); if (pid != null) pidNewPrice.set(pid, x.newPrice); }
      setMyProducts((prev) => prev.map((p) => (pidNewPrice.has(p.productId) ? { ...p, price: pidNewPrice.get(p.productId)! } : p)));

      if (!isUndo) {
        setLastUndo(undo.length ? undo : null);
        setSelected(new Set());
        setEdits({});
      }
      toast(`${isUndo ? 'Hoàn tác' : 'Cập nhật'} xong: ${okCount} thành công${failCount ? ', ' + failCount + ' lỗi' : ''}`, failCount ? 'error' : 'success');
    } catch (e: any) {
      toast('Lỗi: ' + (e?.message || e), 'error');
    } finally {
      setUpdating(false);
      setConfirmOpen(false);
    }
  }

  if (myProducts.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-slate-500 shadow-sm ring-1 ring-slate-100">
        Hãy vào tab <b>Sản phẩm của tôi</b> bấm “Tải sản phẩm Haravan” trước, rồi <b>Quét thị trường</b> để đối chiếu.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Thống kê */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Stat label="SP của tôi" value={fmtNum(myProducts.length)} />
        <Stat label="Có giá thị trường" value={fmtNum(matched.length)} accent="indigo" />
        <Stat label="Giá đang CAO" value={fmtNum(nCao)} accent="rose" />
        <Stat label="Giá đang THẤP" value={fmtNum(nThap)} accent="amber" />
        <Stat label="🩸 Rủi ro lỗ" value={hasCost ? fmtNum(nLo) : '—'} accent="rose" />
        <Stat label="Web đã quét" value={fmtNum(sites.length)} accent="emerald" />
      </div>

      {/* Cài đặt định giá */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <Field label="Sàn an toàn (% giá hiện tại)">
          <input type="number" min={50} max={100} value={floorPct} onChange={(e) => setFloorPct(Math.max(50, Math.min(100, +e.target.value || 85)))} className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </Field>
        <Field label="% lãi tối thiểu (trên giá vốn)">
          <input type="number" min={0} max={100} value={minMargin} onChange={(e) => setMinMargin(Math.max(0, Math.min(100, +e.target.value || 0)))} className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </Field>
        <Field label="Cảnh báo CAO khi vượt %">
          <input type="number" min={0} max={100} value={highT} onChange={(e) => setHighT(+e.target.value || 0)} className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </Field>
        <Field label="Cảnh báo THẤP khi dưới %">
          <input type="number" min={0} max={100} value={lowT} onChange={(e) => setLowT(+e.target.value || 0)} className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </Field>
        <p className="text-xs text-slate-400">Giá đề xuất = giá thấp nhất thị trường, không dưới sàn {hasCost ? 'và luôn đảm bảo lãi tối thiểu trên giá vốn.' : '. (Nạp giá vốn để bật chặn lỗ.)'}</p>
      </div>

      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="🔍 Tìm mã / tên…" className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
        <Select value={fType} onChange={(v) => { setFType(v); setPage(0); }} placeholder="Tất cả nhóm" options={types} />
        <Select value={fVendor} onChange={(v) => { setFVendor(v); setPage(0); }} placeholder="Tất cả hãng" options={vendors} />
        <Select value={fWarn} onChange={(v) => { setFWarn(v); setPage(0); }} placeholder="Mọi cảnh báo" options={[{ v: 'cao', t: '🔴 Giá cao' }, { v: 'thap', t: '🟡 Giá thấp' }, { v: 'ok', t: '🟢 Hợp lý' }, { v: 'lo', t: '🩸 Rủi ro lỗ' }]} />
        <label className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyMatched} onChange={(e) => { setOnlyMatched(e.target.checked); setPage(0); }} /> chỉ SP có giá TT
        </label>
        <span className="ml-auto text-xs text-slate-400">{fmtNum(filtered.length)} sản phẩm</span>
      </div>

      {/* Bảng */}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={selectableOnPage.length > 0 && selectableOnPage.every((r) => selected.has(r.product.productId))} onChange={toggleAllPage} /></th>
              <th className="px-2 py-3">Mã</th>
              <th className="px-2 py-3">Tên sản phẩm</th>
              <th className="px-2 py-3 text-right">Giá của tôi</th>
              <th className="px-2 py-3 text-right">Giá thị trường</th>
              <th className="px-2 py-3 text-center">% vs thấp nhất</th>
              <th className="px-2 py-3 text-center">Cảnh báo</th>
              <th className="px-2 py-3 text-right">Giá mới</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <Row key={r.product.productId} r={r} warn={warnOf(r)} loss={lossOf(r)} suggested={sugOf(r)} priceVal={priceFor(r)}
                selected={selected.has(r.product.productId)}
                onSelect={() => setSelected((p) => { const n = new Set(p); n.has(r.product.productId) ? n.delete(r.product.productId) : n.add(r.product.productId); return n; })}
                onPrice={(v) => setEdits((e) => ({ ...e, [r.product.productId]: v }))} />
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Không có sản phẩm khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">←</button>
          <span className="text-slate-500">Trang {page + 1}/{totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">→</button>
        </div>
      )}

      {/* Thanh hành động + undo */}
      <AnimatePresence>
        {(selected.size > 0 || lastUndo) && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="sticky bottom-4 z-30 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 px-5 py-3 text-white shadow-2xl">
            <span className="text-sm font-medium">{selected.size > 0 ? `Đã chọn ${selected.size} sản phẩm để cập nhật giá` : 'Đã cập nhật giá'}</span>
            <div className="flex gap-2">
              {lastUndo && <button onClick={() => doUpdate(lastUndo, true)} disabled={updating} className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25">↶ Hoàn tác</button>}
              {selected.size > 0 && (
                <button onClick={() => setConfirmOpen(true)} disabled={updating} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-2 text-sm font-bold shadow-lg hover:from-emerald-600 hover:to-green-700">
                  ⬆ Cập nhật giá lên store
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal xác nhận */}
      <Modal open={confirmOpen} onClose={() => !updating && setConfirmOpen(false)} title="Xác nhận cập nhật giá lên store Haravan">
        <div className="px-6 py-4">
          <p className="mb-3 text-sm text-slate-600">Sẽ ghi đè giá bán <b>{selectedRows.length}</b> sản phẩm trên store <b>Bếp Ngọc Bảo</b>. Kiểm tra kỹ trước/sau:</p>
          <div className="max-h-72 overflow-y-auto rounded-xl ring-1 ring-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-400"><tr><th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2 text-right">Giá cũ</th><th className="px-3 py-2 text-right">Giá mới</th></tr></thead>
              <tbody>
                {selectedRows.map((r) => {
                  const np = Math.round(priceFor(r));
                  const up = np > r.product.price;
                  return (
                    <tr key={r.product.productId} className="border-t border-slate-100">
                      <td className="px-3 py-2"><div className="max-w-[260px] truncate">{r.product.name}</div></td>
                      <td className="px-3 py-2 text-right text-slate-400">{fmtVnd(r.product.price)}</td>
                      <td className={`px-3 py-2 text-right font-bold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtVnd(np)} {up ? '▲' : '▼'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={() => setConfirmOpen(false)} disabled={updating} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Huỷ</button>
          <button onClick={() => doUpdate(buildUpdates())} disabled={updating} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-2 text-sm font-bold text-white hover:from-emerald-600 hover:to-green-700">
            {updating ? <><Spinner /> Đang cập nhật…</> : <>Xác nhận cập nhật {selectedRows.length} SP</>}
          </button>
        </div>
      </Modal>
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

function Select({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: (string | { v: string; t: string })[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400">
      <option value="">{placeholder}</option>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.v;
        const t = typeof o === 'string' ? o : o.t;
        return <option key={v} value={v}>{t}</option>;
      })}
    </select>
  );
}

function Row({ r, warn, loss, suggested, priceVal, selected, onSelect, onPrice }: {
  r: ComparisonRow; warn: 'cao' | 'thap' | 'ok' | null; loss: boolean; suggested: number | null; priceVal: number;
  selected: boolean; onSelect: () => void; onPrice: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const pct = r.pctVsMin;
  const pctColor = pct == null ? 'text-slate-400' : pct > 0 ? 'text-rose-600' : pct < 0 ? 'text-emerald-600' : 'text-slate-500';
  const warnBadge = warn === 'cao' ? <Badge c="rose">Cao</Badge> : warn === 'thap' ? <Badge c="amber">Thấp</Badge> : warn === 'ok' ? <Badge c="emerald">Hợp lý</Badge> : <span className="text-xs text-slate-300">—</span>;
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50/50">
        <td className="px-3 py-2"><input type="checkbox" checked={selected} disabled={r.marketMin == null} onChange={onSelect} /></td>
        <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{r.product.code || '—'}</td>
        <td className="px-2 py-2">
          <button onClick={() => r.market.length && setOpen((o) => !o)} className="max-w-[280px] truncate text-left text-slate-700 hover:text-indigo-600">{r.product.name}</button>
          <div className="text-[10px] text-slate-400">{r.product.vendor} · {r.product.productType}</div>
        </td>
        <td className="px-2 py-2 text-right font-semibold text-slate-700">{fmtVnd(r.product.price)}</td>
        <td className="px-2 py-2 text-right">
          {r.marketMin != null ? (
            <div>
              <div className="font-semibold text-indigo-600">{fmtVnd(r.marketMin)}</div>
              <div className="text-[10px] text-slate-400">tb {fmtNum(r.marketAvg)} · {r.siteCount} web{r.dropped ? ` · loại ${r.dropped} giá ảo` : ''}</div>
            </div>
          ) : <span className="text-xs text-slate-300">chưa có</span>}
        </td>
        <td className={`px-2 py-2 text-center font-bold ${pctColor}`}>{pct == null ? '—' : (pct > 0 ? '+' : '') + pct.toFixed(0) + '%'}</td>
        <td className="px-2 py-2 text-center">
          <div className="flex flex-col items-center gap-1">
            {warnBadge}
            {loss && <Badge c="rose">🩸 Lỗ</Badge>}
          </div>
        </td>
        <td className="px-2 py-2 text-right">
          {r.marketMin != null ? (
            <input type="number" value={Math.round(priceVal)} onChange={(e) => onPrice(Math.max(0, +e.target.value || 0))}
              className={`w-28 rounded-lg border px-2 py-1 text-right text-sm font-semibold outline-none focus:border-indigo-400 ${suggested != null && Math.round(priceVal) !== Math.round(suggested) ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`} />
          ) : <span className="text-xs text-slate-300">—</span>}
        </td>
      </tr>
      <AnimatePresence>
        {open && r.market.length > 0 && (
          <tr>
            <td colSpan={8} className="bg-slate-50/70 px-4 py-0">
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden py-3">
                <div className="flex flex-wrap gap-2">
                  {r.market.map((m, i) => (
                    <a key={i} href={m.url} target="_blank" rel="noreferrer" className="rounded-lg bg-white px-3 py-1.5 text-xs shadow-sm ring-1 ring-slate-100 hover:ring-indigo-200">
                      <span className="text-slate-500">{m.siteName}:</span> <b className="text-indigo-600">{fmtVnd(m.price)}</b>
                    </a>
                  ))}
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

function Badge({ c, children }: { c: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${map[c]}`}>{children}</span>;
}
