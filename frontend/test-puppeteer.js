import puppeteer from 'puppeteer';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    } else {
      console.log('BROWSER LOG:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });

  try {
    console.log('Navigating...');
    await page.goto('http://localhost:5173/student/login', { waitUntil: 'networkidle0' });
    
    console.log('Typing class code...');
    await page.waitForSelector('input[placeholder="Enter 6-character class code"]');
    await page.type('input[placeholder="Enter 6-character class code"]', 'UK5LB2');
    
    console.log('Waiting for network...');
    await wait(2000);
    
    console.log('Selecting student...');
    await page.select('select', 'aa71c87e-60ac-407a-a098-8db189328d7c'); // fatma sari
    
    console.log('Entering password...');
    await page.type('input[type="password"]', '202401078');
    
    console.log('Clicking submit...');
    await page.click('button[type="submit"]');
    
    console.log('Waiting for navigation...');
    await wait(5000);
    
    console.log('Test completed.');
  } catch (err) {
    console.error('Script Error:', err);
  } finally {
    await browser.close();
  }
})();
