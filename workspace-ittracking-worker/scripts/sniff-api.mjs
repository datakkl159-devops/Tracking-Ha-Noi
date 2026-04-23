import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true });
const ctxOpts = { viewport: { width: 1568, height: 900 } };
if (fs.existsSync('.auth-state.json')) ctxOpts.storageState = '.auth-state.json';
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();

const xhrRequests = [];
page.on('request', req => {
  const url = req.url();
  const rt = req.resourceType();
  // Capture all xhr/fetch (regardless of domain) + all non-GET khodi
  if (rt === 'xhr' || rt === 'fetch') {
    xhrRequests.push({ method: req.method(), url: url.slice(0, 180), type: rt, postData: req.postData()?.slice(0, 300) });
  }
});

try {
  await page.goto('https://khodi.vanchuyenkinkin.com/kho-hang/quan-ly-kien-f', { waitUntil: 'networkidle', timeout: 30000 });
  if (await page.$('input[placeholder="Tên đăng nhập"]')) {
    await page.fill('input[placeholder="Tên đăng nhập"]', process.env.KINKIN_USERNAME || '');
    await page.fill('input[placeholder="Mật khẩu"]', process.env.KINKIN_PASSWORD || '');
    await page.click('button:has-text("Đăng nhập"), a:has-text("Đăng nhập")');
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await ctx.storageState({ path: '.auth-state.json' });
  }
  for (let i=0; i<3 && !page.url().includes('quan-ly-kien-f'); i++) {
    await page.goto('https://khodi.vanchuyenkinkin.com/kho-hang/quan-ly-kien-f', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
  }
  await page.waitForSelector('input[formcontrolname="keywordSearch"]', { timeout: 20000 });
  await page.waitForTimeout(1000);

  console.log('=== All XHR on page load ===');
  for (const r of xhrRequests) console.log(`[${r.method} ${r.type}] ${r.url}`);
  console.log();

  xhrRequests.length = 0;

  await page.fill('input[formcontrolname="keywordSearch"]', 'F1050159');
  await page.click('a:has-text("Tìm kiếm")');
  await page.waitForTimeout(5000);

  console.log('=== XHR during search ===');
  for (const r of xhrRequests) {
    console.log(`\n[${r.method}] ${r.url}`);
    if (r.postData) console.log('  body:', r.postData);
  }

  // Capture full headers of the packageF search request
  const searchReq = xhrRequests.find(r => r.url.includes('packageF/get-paginated-list'));
  if (searchReq) {
    // Re-capture with headers
    const freshHeaders = {};
    page.on('request', req => {
      if (req.url().includes('packageF/get-paginated-list')) {
        Object.assign(freshHeaders, req.headers());
      }
    });
    await page.fill('input[formcontrolname="keywordSearch"]', 'F1050159');
    await page.click('a:has-text("Tìm kiếm")');
    await page.waitForTimeout(3000);
    console.log('\n=== Full headers of packageF API ===');
    for (const [k, v] of Object.entries(freshHeaders)) {
      if (!['sec-fetch-dest','sec-fetch-mode','sec-fetch-site','accept','accept-encoding','accept-language','user-agent','origin','referer'].includes(k)) {
        console.log(`  ${k}: ${String(v).slice(0, 100)}`);
      }
    }
  }
} catch (e) {
  console.log('ERR:', e.message);
} finally {
  await browser.close();
}
