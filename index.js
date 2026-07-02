#!/usr/bin/env node
/**
 * 抖音搜索 API
 *
 * 用法:
 *   node index.js <关键词>                  # 综合搜索
 *   node index.js <关键词> video            # 视频搜索
 *   node index.js <关键词> user             # 用户搜索
 *
 * 首次运行需要:
 *   1. 准备 cookie.txt（从浏览器 F12 → Application → Cookies 复制）
 *   2. 首次会弹出浏览器过滑块验证码，之后自动复用会话
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const keyword = process.argv[2] || '薛之谦';
const rawType = (process.argv[3] || '').replace('--type=', '');
const searchType = ['video', 'user'].includes(rawType) ? rawType : 'general';

const BASE = __dirname;
const COOKIE_FILE = path.join(BASE, 'cookie.txt');
const STATE_FILE = path.join(BASE, 'douyin_state.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const SEARCH_TYPES = {
  general: { label: '综合', urlSuffix: '' },
  video:   { label: '视频', urlSuffix: '?type=video' },
  user:    { label: '用户', urlSuffix: '?type=user' },
};

const API_PATHS = {
  general: '/aweme/v1/web/general/search/stream/',
  video:   '/aweme/v1/web/search/item/',
  user:    '/aweme/v1/web/discover/search/',
};

function parseResponse(body) {
  if (!body) return { status_code: -1, data: [] };
  let raw = body.trim();
  let start = 0;
  const nl = raw.indexOf('\n');
  if (nl > 0 && nl < 20 && /^[0-9a-f]+$/i.test(raw.slice(0, nl).trim())) start = nl + 1;
  let content = raw.slice(start);
  const fb = content.indexOf('{');
  if (fb < 0) return { status_code: -1, data: [] };
  content = content.slice(fb);
  const merged = {};
  let idx = 0;
  while (idx < content.length) {
    if (content[idx] !== '{') { idx++; continue; }
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = idx; i < content.length; i++) {
      const c = content[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
    }
    if (end > 0) {
      try {
        const obj = JSON.parse(content.slice(idx, end));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          for (const [k, v] of Object.entries(obj)) {
            if (k in merged) {
              if (Array.isArray(merged[k]) && Array.isArray(v)) merged[k].push(...v);
              else if (typeof merged[k] === 'object' && typeof v === 'object') Object.assign(merged[k], v);
              else merged[k] = v;
            } else merged[k] = v;
          }
        } else if (Array.isArray(obj)) {
          merged.data = [...(merged.data || []), ...obj];
        }
      } catch (_) {}
      idx = end;
    } else idx = content.length;
  }
  merged.status_code ??= 0;
  merged.data ??= [];
  return merged;
}

function isSessionExpired(data) {
  if (data.status_code !== 0 && data.status_code !== undefined) return true;
  const nil = data.search_nil_info;
  if (nil && (nil.search_nil_type === 'login' || nil.search_nil_item === 'invalid_login')) return true;
  return false;
}

async function main() {
  const typeInfo = SEARCH_TYPES[searchType];
  const targetPath = API_PATHS[searchType];
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}${typeInfo.urlSuffix}`;
  const hasState = fs.existsSync(STATE_FILE);
  const hasCookies = fs.existsSync(COOKIE_FILE);

  // ── 前置检查 ──
  if (!hasCookies) {
    process.stderr.write('错误: 缺少 cookie.txt\n');
    process.stderr.write('请从浏览器 F12 → Application → Cookies → www.douyin.com 复制所有 Cookie 到 cookie.txt\n');
    process.exit(1);
  }

  // ── 需要过验证码 / 登录的场景 ──
  const needsSetup = !hasState || (() => {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8').trim();
      if (!raw || !raw.startsWith('{')) return true;
      JSON.parse(raw);
      return false;
    } catch (_) { return true; }
  })();

  if (needsSetup) {
    if (hasState) {
      process.stderr.write('登录状态无效，重新设置...\n');
      try { fs.unlinkSync(STATE_FILE); } catch (_) {}
    }

    process.stderr.write('打开浏览器...\n');
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // 注入 cookie.txt 中的基础 cookie（反爬必备）
    const cookieRaw = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
    const cookies = cookieRaw.split(';').map(p => {
      p = p.trim();
      const eq = p.indexOf('=');
      if (eq < 0) return null;
      return { name: p.slice(0, eq).trim(), value: p.slice(eq + 1).trim(), domain: '.douyin.com', path: '/' };
    }).filter(Boolean);
    await ctx.addCookies(cookies);

    let apiResult = null;
    page.on('response', async resp => {
      const url = resp.url();
      if (!url.includes(targetPath)) return;
      if (apiResult) return;
      try {
        const body = await resp.text();
        const parsed = parseResponse(body);
        if (parsed.data && parsed.data.length > 0) {
          apiResult = { status: resp.status(), data: parsed };
        }
      } catch (_) {}
    });

    // 导航到搜索页
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

    // 处理验证码 / 登录
    const title = await page.title();
    if (title.includes('验证码') || page.url().includes('captcha')) {
      process.stderr.write('需要手动过滑块验证码，请在浏览器中完成\n');
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const t = await page.title();
        if (!t.includes('验证码') && !page.url().includes('captcha')) {
          process.stderr.write(`✓ 验证码已通过（${i + 1}秒）\n`);
          break;
        }
        if (i % 15 === 14) process.stderr.write(`  等待中... ${i + 1}秒\n`);
      }
    }

    // 等待 API 响应
    process.stderr.write('等待搜索结果...\n');
    for (let i = 0; i < 30 && !apiResult; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (i % 10 === 9) process.stderr.write(`  等待中... ${i + 1}秒\n`);
    }

    await ctx.storageState({ path: STATE_FILE }).catch(() => {});
    await browser.close();

    if (!apiResult) {
      process.stderr.write('错误: 未获取到搜索结果\n');
      process.exit(1);
    }

    // 输出结果
    const d = apiResult.data;
    const json = JSON.stringify(d);
    process.stderr.write(`HTTP ${apiResult.status} | status=${d.status_code} | has_more=${d.has_more} | 结果数=${d.data.length}\n`);
    process.stdout.write(json);
    const safeName = keyword.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 50);
    const ts = Date.now();
    const outFile = path.join(BASE, `${searchType}_${safeName}_${ts}.json`);
    fs.writeFileSync(outFile, json, 'utf-8');
    process.stderr.write(`已保存: ${outFile}\n`);
    return;
  }

  // ── 有有效状态 → 无界面搜索 ──
  process.stderr.write(`[${typeInfo.label}] 搜索: ${keyword}\n`);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    storageState: STATE_FILE,
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // 也补上 cookie.txt 中的基础 cookie
  if (hasCookies) {
    const cookieRaw = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
    const cookies = cookieRaw.split(';').map(p => {
      p = p.trim();
      const eq = p.indexOf('=');
      if (eq < 0) return null;
      return { name: p.slice(0, eq).trim(), value: p.slice(eq + 1).trim(), domain: '.douyin.com', path: '/' };
    }).filter(Boolean);
    await ctx.addCookies(cookies);
  }

  let apiResult = null;
  page.on('response', async resp => {
    const url = resp.url();
    if (!url.includes(targetPath)) return;
    if (apiResult) return;
    try {
      const body = await resp.text();
      apiResult = { status: resp.status(), data: parseResponse(body) };
    } catch (_) {}
  });

  try { await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (_) {}

  for (let i = 0; i < 30 && !apiResult; i++) {
    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  if (!apiResult) {
    process.stderr.write('错误: 未捕获到搜索 API 响应（会话可能已过期）\n');
    try { fs.unlinkSync(STATE_FILE); } catch (_) {}
    process.exit(1);
  }

  const d = apiResult.data;
  if (isSessionExpired(d)) {
    process.stderr.write('登录会话已过期，请删除 douyin_state.json 后重新运行\n');
    try { fs.unlinkSync(STATE_FILE); } catch (_) {}
    process.exit(1);
  }

  const json = JSON.stringify(d);
  process.stderr.write(`HTTP ${apiResult.status} | status=${d.status_code} | has_more=${d.has_more} | 结果数=${d.data.length}\n`);
  process.stdout.write(json);

  const safeName = keyword.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 50);
  const ts = Date.now();
  const outFile = path.join(BASE, `${searchType}_${safeName}_${ts}.json`);
  fs.writeFileSync(outFile, json, 'utf-8');
  process.stderr.write(`已保存: ${outFile}\n`);
}

main().catch(e => {
  process.stderr.write(`错误: ${e.message}\n`);
  process.exit(1);
});
