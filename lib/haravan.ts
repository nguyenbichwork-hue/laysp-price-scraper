// Tích hợp Haravan Admin API (store Bếp Ngọc Bảo).
// Token nằm ở env HARAVAN_TOKEN (server-side), KHÔNG lộ ra client.

import type { MyProduct } from './types';
import { bestCode } from './price';

const API = 'https://apis.haravan.com/com';

function headers(): Record<string, string> {
  return {
    Authorization: 'Bearer ' + (process.env.HARAVAN_TOKEN || ''),
    'Content-Type': 'application/json',
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getShopDomain(): Promise<string> {
  try {
    const r = await fetch(API + '/shop.json', { headers: headers() });
    if (!r.ok) return '';
    const j = await r.json();
    return j.shop?.domain || j.shop?.myharavan_domain || '';
  } catch {
    return '';
  }
}

/** Lấy toàn bộ sản phẩm store (phân trang). */
export async function fetchMyProducts(): Promise<MyProduct[]> {
  const domain = await getShopDomain();
  const out: MyProduct[] = [];
  // Haravan admin API cap 50 SP/trang -> phân trang tới khi rỗng (1760 SP ~ 36 trang)
  for (let page = 1; page <= 80; page++) {
    let j: any;
    try {
      const r = await fetch(`${API}/products.json?limit=250&page=${page}`, { headers: headers() });
      if (!r.ok) break;
      j = await r.json();
    } catch {
      break;
    }
    const products: any[] = j?.products || [];
    if (products.length === 0) break;
    for (const p of products) {
      const variants: any[] = p.variants || [];
      let price: number | null = null;
      let compare: number | null = null;
      const vids: number[] = [];
      let sku = '';
      let inv = 0;
      for (const v of variants) {
        const pr = Number(v.price);
        if (isFinite(pr) && pr > 0 && (price == null || pr < price)) price = pr;
        const cp = Number(v.compare_at_price);
        if (isFinite(cp) && cp > 0 && (compare == null || cp > compare)) compare = cp;
        if (v.id) vids.push(v.id);
        if (!sku && v.sku) sku = String(v.sku);
        inv += Number(v.inventory_quantity) || 0;
      }
      const name = (p.title || '').toString().trim();
      if (!name) continue;
      out.push({
        productId: p.id,
        variantIds: vids,
        sku,
        code: bestCode(sku, name),
        name,
        price: price ?? 0,
        comparePrice: compare,
        productType: (p.product_type || '').toString(),
        vendor: (p.vendor || '').toString(),
        tags: (p.tags || '').toString(),
        image: (p.images && p.images[0] && p.images[0].src) || '',
        handle: (p.handle || '').toString(),
        url: domain && p.handle ? `https://${domain}/products/${p.handle}` : '',
        inventory: inv,
      });
    }
  }
  return out;
}

/** Đọc giá hiện tại của 1 variant (để lưu giá cũ trước khi đổi). */
export async function getVariantPrice(variantId: number): Promise<number | null> {
  try {
    const r = await fetch(`${API}/variants/${variantId}.json`, { headers: headers() });
    if (!r.ok) return null;
    const j = await r.json();
    const p = Number(j.variant?.price);
    return isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

/** Cập nhật giá 1 variant. Trả về giá cũ (để hoàn tác) nếu thành công. */
export async function updateVariantPrice(
  variantId: number,
  price: number,
): Promise<{ ok: boolean; oldPrice?: number; error?: string }> {
  const oldPrice = await getVariantPrice(variantId);
  await sleep(120); // nhịp tránh rate-limit
  try {
    const r = await fetch(`${API}/variants/${variantId}.json`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ variant: { id: variantId, price } }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, oldPrice: oldPrice ?? undefined, error: `HTTP ${r.status} ${t.slice(0, 120)}` };
    }
    return { ok: true, oldPrice: oldPrice ?? undefined };
  } catch (e: any) {
    return { ok: false, oldPrice: oldPrice ?? undefined, error: String(e?.message || e) };
  }
}
