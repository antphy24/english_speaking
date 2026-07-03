const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    await page.goto('http://localhost:5174/student/login');
    
    await page.type('input[type="text"]', 'st001');
    await page.type('input[type="password"]', 'st001');
    await page.click('button[type="submit"]');
    
    await new Promise(r => setTimeout(r, 2000));
    
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const qaBtn = buttons.find(b => b.textContent.includes('Q&A Mock'));
      if(qaBtn) qaBtn.click();
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const convBtn = buttons.find(b => b.textContent.includes('AI Conversation'));
      if(convBtn) convBtn.click();
    });
    
    await new Promise(r => setTimeout(r, 1000));
    await browser.close();
  } catch (e) {
    console.error('SCRIPT ERROR:', e);
  }
})();
