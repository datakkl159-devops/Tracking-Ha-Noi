import { chromium } from 'playwright';

const TRACKING = 'F1050159';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1568, height: 900 } });
const page = await ctx.newPage();

const imageUrls = [];
page.on('response', (resp) => {
  const u = resp.url();
  if (u.includes('image.vanchuyenkinkin.com') && /\.(jpg|jpeg|png)/i.test(u)) {
    imageUrls.push(u);
  }
});

try {
  await page.goto('https://khodi.vanchuyenkinkin.com/kho-hang/quan-ly-kien-f', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);
  if (await page.$('input[placeholder="Tên đăng nhập"]')) {
    await page.fill('input[placeholder="Tên đăng nhập"]', 'aitool01');
    await page.fill('input[placeholder="Mật khẩu"]', '123456aA@');
    await page.click('button:has-text("Đăng nhập"), a:has-text("Đăng nhập")');
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 }).catch(() => null);
    await page.waitForLoadState('networkidle').catch(() => null);
  }
  for (let i = 0; i < 3 && !page.url().includes('quan-ly-kien-f'); i++) {
    await page.goto('https://khodi.vanchuyenkinkin.com/kho-hang/quan-ly-kien-f', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape').catch(() => null);

  console.log('URL:', page.url());
  await page.fill('input[formcontrolname="keywordSearch"]', TRACKING);
  await page.click('a:has-text("Tìm kiếm")');
  await page.waitForTimeout(4000);
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(500);

  // Find image button in result row
  console.log('Looking for image button...');
  // Try multiple selectors
  const imgBtnSelectors = [
    'button:has(img[src*="image-icon"])',
    'button[class*="image-preview"]',
    'a[mattooltip="Xem ảnh"]',
    '[mattooltip="Xem ảnh"]',
  ];
  let clicked = false;
  for (const s of imgBtnSelectors) {
    const btn = await page.$(s);
    if (btn) {
      console.log('Found btn with selector:', s);
      await btn.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    console.log('No image button found directly. Trying all buttons in results:');
    // Check actions column buttons
    const btns = await page.$$('tbody tr:first-child button');
    console.log(`${btns.length} buttons in first row`);
    for (let i = 0; i < btns.length; i++) {
      const html = await btns[i].evaluate(e => e.outerHTML.slice(0, 200));
      console.log(`  btn[${i}]:`, html);
    }
    if (btns[0]) {
      console.log('Clicking first button (assume image)...');
      await btns[0].click();
      clicked = true;
    }
  }

  if (clicked) {
    await page.waitForTimeout(3000);
    // Find preview img
    const previewSrc = await page.$eval('img.p-image-preview, img[class*="p-image-preview"]', el => el.src).catch(() => null);
    console.log('Preview img src:', previewSrc);
    console.log('Network image URLs captured:', imageUrls);
  }

} catch (e) {
  console.log('ERR:', e.message);
} finally {
  await browser.close();
}
