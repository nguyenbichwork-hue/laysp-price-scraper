'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Spinner } from './common';

export default function Login({ onAuthed }: { onAuthed: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        try {
          sessionStorage.setItem('app_pw', pw);
        } catch {}
        onAuthed(pw);
      } else {
        setErr('Sai mật khẩu, thử lại.');
      }
    } catch {
      setErr('Lỗi kết nối.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl shadow-slate-200/60 ring-1 ring-slate-100"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-2xl shadow-lg shadow-indigo-200">🏷️</div>
          <h1 className="text-xl font-extrabold text-slate-800">So Giá &amp; Định Giá</h1>
          <p className="mt-1 text-sm text-slate-400">Bếp Ngọc Bảo · nhập mật khẩu để vào</p>
        </div>
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Mật khẩu"
          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-center text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
        />
        {err && <p className="mt-2 text-center text-xs text-rose-500">{err}</p>}
        <button
          onClick={submit}
          disabled={loading || !pw}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50"
        >
          {loading ? <><Spinner /> Đang kiểm tra…</> : 'Đăng nhập'}
        </button>
      </motion.div>
    </div>
  );
}
