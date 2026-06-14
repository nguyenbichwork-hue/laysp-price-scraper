// Mô phỏng client điều phối nhiều vòng cho 1 web
const URL = process.argv[2];
const LIMIT = parseInt(process.argv[3] || '2000', 10);
const API = 'http://localhost:3000/api/scrape';

function normU(u) { try { const x = new URL(u); return (x.origin + x.pathname).replace(/\/+$/, '').toLowerCase(); } catch { return (u || '').toLowerCase(); } }
function keyOf(p) { const u = p.url ? normU(p.url) : ''; return u || 'n:' + p.name.toLowerCase() + '|' + (p.salePrice ?? ''); }
async function call(task) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: URL, maxProducts: LIMIT, task }) });
  return r.json();
}

(async () => {
  const t0 = Date.now();
  const products = []; const seen = new Set();
  const add = (arr) => { let a = 0; for (const p of arr || []) { const k = keyOf(p); if (seen.has(k)) continue; seen.add(k); products.push(p); a++; } return a; };
  const disc = await call();
  console.log('platform:', disc.platform, '| mode:', disc.mode, '| urlMode:', disc.urlMode, '| worklist:', (disc.worklist || []).length, '| total:', disc.total, '| note:', disc.note || '-', '| err:', disc.error || '-');
  add(disc.products);

  if (disc.mode === 'api') {
    let task = disc.task || null, rounds = 0;
    while (task && products.length < LIMIT && rounds < 400) { rounds++; const r = await call(task); add(r.products); task = r.task || null; }
  } else if (disc.mode === 'urls') {
    const mode = disc.urlMode === 'detail' ? 'detail' : 'listing';
    const batch = mode === 'listing' ? 14 : 40;
    const wl = []; const wlSeen = new Set();
    const enq = (us) => { for (const u of us || []) { const k = normU(u); if (wlSeen.has(k)) continue; wlSeen.add(k); wl.push(u); } };
    enq(disc.worklist);
    let pos = 0, rounds = 0, dry = 0;
    while (pos < wl.length && products.length < LIMIT && rounds < 400) {
      rounds++; const b = wl.slice(pos, pos + batch); pos += b.length;
      const r = await call({ strategy: 'fetchUrls', mode, urls: b });
      const a = add(r.products); if (r.enqueueUrls) enq(r.enqueueUrls);
      dry = a === 0 ? dry + 1 : 0;
      if (rounds % 5 === 0) console.log(`  ...round ${rounds}: ${products.length} SP, worklist ${pos}/${wl.length}`);
      if (dry >= 4 && pos >= wl.length) break;
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const bad = products.filter((p) => p.salePrice > 1e9);
  const noCode = products.filter((p) => !p.code || p.code.length > 45);
  const withOrig = products.filter((p) => p.originalPrice && p.originalPrice > p.salePrice);
  console.log(`\nTOTAL: ${products.length} SP in ${secs}s | giá>1tỷ: ${bad.length} | mã lỗi: ${noCode.length} | có giá gốc: ${withOrig.length}`);
  console.log('mẫu 3:', JSON.stringify(products.slice(0, 3), null, 1));
})();
