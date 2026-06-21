'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { MyProduct } from '@/lib/types';
import { fmtVnd, fmtNum, Spinner, Stat, Modal, useToast } from './common';
import { parsePrice } from '@/lib/price';

const PAGE = 50;

/** Chuẩn hoá mã để khớp giá vốn với SP (bỏ khoảng trắng/gạch, viết thường). */
function normKey(s: string): string {
  return (s || '').toLowerCase().replace(/[\s\-_.]+/g, '');
}

export default function MyProducts({
  products,
  setProducts,
  password,
}: {
  products: MyProduct[];
  setProducts: React.Dispatch<React.SetStateAction<MyProduct[]>>;
  password: string;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [fType, setFType] = useState('');
  const [fVendor, setFVendor] = useState('');
  const [page, setPage] = useState(0);
  const [costOpen, setCostOpen] = useState(false);
  const [costText, setCostText] = useState('');

  /** Nạp giá vốn từ text dạng "mã[,;tab]giá vốn" mỗi dòng. Khớp theo mã/SKU đã chuẩn hoá. */
  function applyCosts(text: string) {
    const costByKey = new Map<string, number>();
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/[,;\t]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const code = parts[0];
      const cost = parsePrice(parts.slice(1).join(' '));
      if (!code || cost == null) continue;
      costByKey.set(normKey(code), cost);
    }
    if (costByKey.size === 0) {
      toast('Không đọc được dòng giá vốn nào. Định dạng: mã,giá vốn', 'error');
      return;
    }
    let matched = 0;
    setProducts((prev) =>
      prev.map((p) => {
        const c = costByKey.get(normKey(p.code)) ?? costByKey.get(normKey(p.sku));
        if (c != null) { matched++; return { ...p, cost: c }; }
        return p;
      }),
    );
    toast(`Đã nạp giá vốn: khớp ${matched}/${costByKey.size} mã`, matched ? 'success' : 'error');
    setCostOpen(false);
    setCostText('');
  }

  async function onCostFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    applyCosts(text);
    e.target.value = '';
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/my-products', { headers: { 'x-app-password': password } });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Lỗi tải sản phẩm', 'error');
        return;
      }
      setProducts(data.products || []);
      toast(`Đã tải ${data.count} sản phẩm`, 'success');
    } catch (e: any) {
      toast('Lỗi: ' + (e?.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }

  const withCost = useMemo(() => products.filter((p) => p.cost != null && p.cost > 0).length, [products]);
  const types = useMemo(() => Array.from(new Set(products.map((p) => p.productType).filter(Boolean))).sort(), [products]);
  const vendors = useMemo(() => Array.from(new Set(products.map((p) => p.vendor).filter(Boolean))).sort(), [products]);

  const filtered = useMemo(() => {
    const qq = q.toLowerCase().trim();
    return products.filter((p) => {
      if (fType && p.productType !== fType) return false;
      if (fVendor && p.vendor !== fVendor) return false;
      if (qq && !(p.name.toLowerCase().includes(qq) || (p.code || '').toLowerCase().includes(qq))) return false;
      return true;
    });
  }, [products, q, fType, fVendor]);
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const totalPages = Math.ceil(filtered.length / PAGE);

  if (products.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-100">
        <p className="mb-4 text-slate-500">Tải toàn bộ sản phẩm của store <b>Bếp Ngọc Bảo</b> (Haravan) để bắt đầu.</p>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50">
          {loading ? <><Spinner /> Đang tải…</> : <>⬇ Tải sản phẩm Haravan</>}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Tổng sản phẩm" value={fmtNum(products.length)} accent="indigo" />
        <Stat label="Đã có giá vốn" value={`${fmtNum(withCost)}/${fmtNum(products.length)}`} accent={withCost ? 'emerald' : undefined} />
        <Stat label="Thương hiệu" value={fmtNum(vendors.length)} />
        <div className="flex items-center justify-center rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
          <button onClick={() => setCostOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
            💰 Nạp giá vốn
          </button>
        </div>
        <div className="flex items-center justify-center rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
          <button onClick={load} disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {loading ? <><Spinner /> …</> : <>↻ Tải lại</>}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="🔍 Tìm mã / tên…" className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
        <select value={fType} onChange={(e) => { setFType(e.target.value); setPage(0); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <option value="">Tất cả nhóm</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={fVendor} onChange={(e) => { setFVendor(e.target.value); setPage(0); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <option value="">Tất cả hãng</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className="ml-auto text-xs text-slate-400">{fmtNum(filtered.length)} sản phẩm</span>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-3">Mã</th>
              <th className="px-2 py-3">Tên sản phẩm</th>
              <th className="px-2 py-3">Nhóm</th>
              <th className="px-2 py-3">Hãng</th>
              <th className="px-2 py-3 text-right">Giá vốn</th>
              <th className="px-2 py-3 text-right">Giá bán</th>
              <th className="px-2 py-3 text-right">Giá niêm yết</th>
              <th className="px-2 py-3 text-right">Tồn</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <motion.tr key={p.productId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{p.code || '—'}</td>
                <td className="px-2 py-2"><a href={p.url || '#'} target="_blank" rel="noreferrer" className="block max-w-[320px] truncate text-slate-700 hover:text-indigo-600">{p.name}</a></td>
                <td className="px-2 py-2 text-xs text-slate-500">{p.productType}</td>
                <td className="px-2 py-2 text-xs text-slate-500">{p.vendor}</td>
                <td className="px-2 py-2 text-right text-slate-600">{p.cost != null && p.cost > 0 ? fmtVnd(p.cost) : <span className="text-slate-300">—</span>}</td>
                <td className="px-2 py-2 text-right font-semibold text-rose-600">{fmtVnd(p.price)}</td>
                <td className="px-2 py-2 text-right text-slate-400 line-through">{p.comparePrice && p.comparePrice > p.price ? fmtVnd(p.comparePrice) : ''}</td>
                <td className="px-2 py-2 text-right text-slate-500">{p.inventory}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">←</button>
          <span className="text-slate-500">Trang {page + 1}/{totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">→</button>
        </div>
      )}

      <Modal open={costOpen} onClose={() => setCostOpen(false)} title="Nạp giá vốn cho sản phẩm">
        <div className="space-y-3 px-6 py-4">
          <p className="text-sm text-slate-600">
            Haravan không cung cấp giá vốn qua API, nên nạp tại đây. Mỗi dòng: <b>mã sản phẩm, giá vốn</b> (khớp theo mã hoặc SKU).
          </p>
          <textarea
            value={costText}
            onChange={(e) => setCostText(e.target.value)}
            placeholder={'PID651DC5E, 13500000\nDFT63AC50, 4500000'}
            rows={8}
            className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 p-3 font-mono text-sm outline-none focus:border-emerald-400 focus:bg-white"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              📄 Chọn file CSV…
              <input type="file" accept=".csv,.txt,text/csv" onChange={onCostFile} className="hidden" />
            </label>
            <span className="text-xs text-slate-400">hoặc dán trực tiếp ở trên</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={() => setCostOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Đóng</button>
          <button onClick={() => applyCosts(costText)} disabled={!costText.trim()} className="rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-2 text-sm font-bold text-white hover:from-emerald-600 hover:to-green-700 disabled:opacity-50">
            Nạp giá vốn
          </button>
        </div>
      </Modal>
    </div>
  );
}
