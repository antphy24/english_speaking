const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });

  try {
    await page.goto('http://localhost:5173/student/login');
    await page.waitForSelector('input[placeholder="Enter 6-character class code"]');
    await page.type('input[placeholder="Enter 6-character class code"]', 'UK5LB2');
    
    // Wait for students to load
    await page.waitForTimeout(2000);
    
    // Select student
    await page.select('select', 'aa71c87e-60ac-407a-a098-8db189328d7c'); // fatma sari
    
    // Enter password
    await page.type('input[type="password"]', '202401078');
    
    // Click submit
    await page.click('button[type="submit"]');
    
    // Wait for navigation or error
    await page.waitForTimeout(5000);
    
    console.log('Test completed.');
  } catch (err) {
    console.error('Script Error:', err);
  } finally {
    await browser.close();
  }
})();
