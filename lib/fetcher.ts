// Fetch chống chặn: xoay User-Agent, header trình duyệt thật, retry backoff,
// timeout, và (tuỳ chọn) đi qua proxy/ScraperAPI nếu có biến môi trường.

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function pickUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildHeaders(targetUrl: string, accept: string): Record<string, string> {
  let origin = '';
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    /* ignore */
  }
  const ua = pickUA();
  const isChrome = ua.includes('Chrome');
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Accept: accept.includes('json')
      ? 'application/json, text/plain, */*'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    DNT: '1',
    Referer: origin ? origin + '/' : 'https://www.google.com/',
  };
  if (isChrome) {
    headers['sec-ch-ua'] = '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"';
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
    headers['Sec-Fetch-Dest'] = accept.includes('json') ? 'empty' : 'document';
    headers['Sec-Fetch-Mode'] = accept.includes('json') ? 'cors' : 'navigate';
    headers['Sec-Fetch-Site'] = 'same-origin';
    headers['Sec-Fetch-User'] = '?1';
  }
  return headers;
}

// Cho phép đi qua ScraperAPI (render JS + xoay proxy) nếu cấu hình SCRAPER_API_KEY.
function wrapProxyUrl(url: string, render: boolean): string {
  const key = process.env.SCRAPER_API_KEY;
  if (key) {
    const params = new URLSearchParams({
      api_key: key,
      url,
      country_code: process.env.SCRAPER_COUNTRY || 'vn',
    });
    if (render) params.set('render', 'true');
    return 'https://api.scraperapi.com/?' + params.toString();
  }
  return url;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions {
  accept?: 'html' | 'json' | 'xml';
  timeoutMs?: number;
  retries?: number;
  render?: boolean;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
  url: string;
  blocked?: boolean; // trang chặn bot / CAPTCHA / Cloudflare challenge
}

// Decode buffer theo charset thật (sửa lỗi font với web không dùng UTF-8).
function decodeBuffer(buf: ArrayBuffer, charset?: string): string {
  const tryDecode = (label: string) => {
    try {
      return new TextDecoder(label as any).decode(buf);
    } catch {
      return null;
    }
  };
  let cs = (charset || '').toLowerCase().trim().replace(/^['"]|['"]$/g, '');
  let text = cs && !/utf-?8/.test(cs) ? tryDecode(cs) : null;
  if (text == null) text = tryDecode('utf-8') ?? '';
  // Nếu header không khai báo nhưng meta trong HTML khác UTF-8 -> decode lại
  if (!cs) {
    const meta = text.slice(0, 3000).match(/charset\s*=\s*["']?\s*([\w-]+)/i);
    const metaCs = meta?.[1]?.toLowerCase();
    if (metaCs && !/utf-?8/.test(metaCs)) {
      const redo = tryDecode(metaCs);
      if (redo != null) text = redo;
    }
  }
  return text;
}

const BLOCK_MARKERS =
  /(just a moment|attention required|cf-browser-verification|cf-challenge|captcha|access denied|請稍候|verifying you are human|enable javascript and cookies)/i;

function looksBlocked(status: number, text: string): boolean {
  if (status === 403 || status === 503 || status === 429) {
    if (BLOCK_MARKERS.test(text.slice(0, 4000))) return true;
  }
  return BLOCK_MARKERS.test(text.slice(0, 1500));
}

export async function smartFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const accept = opts.accept === 'json' ? 'application/json' : opts.accept === 'xml' ? 'application/xml' : 'text/html';
  const timeoutMs = opts.timeoutMs ?? 20000;
  const retries = opts.retries ?? 3;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const target = wrapProxyUrl(url, !!opts.render);
      const res = await fetch(target, {
        method: 'GET',
        headers: buildHeaders(url, accept),
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Bị chặn / lỗi tạm thời -> retry
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        lastErr = new Error('HTTP ' + res.status);
        if (attempt < retries - 1) {
          await sleep(800 * Math.pow(2, attempt) + Math.floor(Math.random() * 400));
          continue;
        }
      }

      const charset = (res.headers.get('content-type') || '').match(/charset=([^;]+)/i)?.[1];
      const buf = await res.arrayBuffer();
      const text = decodeBuffer(buf, charset);
      const blocked = looksBlocked(res.status, text);
      return { ok: res.ok, status: res.status, text, url: res.url || url, blocked };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries - 1) {
        await sleep(700 * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
      }
    }
  }
  return {
    ok: false,
    status: 0,
    text: '',
    url,
  };
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const res = await smartFetch(url, { ...opts, accept: 'json' });
  if (!res.ok || !res.text) return null;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}
