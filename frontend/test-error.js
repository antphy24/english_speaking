import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    console.log('Navigating to test-qa...');
    await page.goto('http://127.0.0.1:5173/test-qa');
    await new Promise(r => setTimeout(r, 2000));
    
    const errorText = await page.evaluate(() => {
      const el = document.querySelector('.bg-red-900\\/50');
      return el ? el.innerText : 'NO ERROR BOUNDARY SHOWN';
    });
    console.log('QA Error output:', errorText);

    await browser.close();
  } catch (e) {
    console.error('SCRIPT ERROR:', e);
  }
})();
