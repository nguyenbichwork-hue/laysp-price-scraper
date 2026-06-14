'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ToastProvider } from '@/components/common';
import Login from '@/components/Login';
import Scraper, { type SRow } from '@/components/Scraper';
import MyProducts from '@/components/MyProducts';
import Dashboard from '@/components/Dashboard';
import type { MyProduct } from '@/lib/types';

type Tab = 'mine' | 'scan' | 'compare';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'mine', label: 'Sản phẩm của tôi', icon: '🏬' },
  { id: 'scan', label: 'Quét thị trường', icon: '🔎' },
  { id: 'compare', label: 'Đối chiếu & Định giá', icon: '⚖️' },
];

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<Tab>('mine');
  const [myProducts, setMyProducts] = useState<MyProduct[]>([]);
  const [scrapeRows, setScrapeRows] = useState<SRow[]>([]);

  useEffect(() => {
    try {
      const pw = sessionStorage.getItem('app_pw');
      if (pw) {
        setPassword(pw);
        setAuthed(true);
      }
    } catch {}
  }, []);

  if (!authed) return <Login onAuthed={(pw) => { setPassword(pw); setAuthed(true); }} />;

  const matchedHint = myProducts.length > 0 && scrapeRows.some((r) => r.products?.length);

  return (
    <ToastProvider>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-xl shadow-lg shadow-indigo-200">🏷️</div>
            <div>
              <h1 className="bg-gradient-to-r from-indigo-600 to-cyan-500 bg-clip-text text-xl font-extrabold text-transparent sm:text-2xl">So Giá &amp; Định Giá Tự Động</h1>
              <p className="text-xs text-slate-400">Bếp Ngọc Bảo · đối chiếu giá thị trường &amp; cập nhật giá lên store</p>
            </div>
          </div>
          <button
            onClick={() => { try { sessionStorage.removeItem('app_pw'); } catch {}; setAuthed(false); }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
          >
            Đăng xuất
          </button>
        </header>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-100">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${tab === t.id ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab === t.id && (
                <motion.div layoutId="tabbg" className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 shadow" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
              )}
              <span className="relative z-10">
                <span className="mr-1.5">{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
                {t.id === 'compare' && matchedHint && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" />}
              </span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {tab === 'mine' && <MyProducts products={myProducts} setProducts={setMyProducts} password={password} />}
            {tab === 'scan' && <Scraper password={password} rows={scrapeRows} setRows={setScrapeRows} />}
            {tab === 'compare' && <Dashboard myProducts={myProducts} setMyProducts={setMyProducts} scrapeRows={scrapeRows} password={password} />}
          </motion.div>
        </AnimatePresence>

        <footer className="mt-10 text-center text-xs text-slate-400">
          Giá đối chiếu tự khớp theo mã/model/tên · Cập nhật giá ghi thẳng lên Haravan (có xác nhận &amp; hoàn tác).
        </footer>
      </main>
    </ToastProvider>
  );
}
