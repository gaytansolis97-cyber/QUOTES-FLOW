// quick-test.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 }); // visible, lento para ver
  const page = await browser.newPage();

  await page.goto('https://example.com');
  console.log('Página cargada');

  await page.waitForTimeout(3000); // 3s
  await browser.close();
})();
