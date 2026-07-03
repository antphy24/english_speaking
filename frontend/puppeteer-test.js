import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

  await page.goto('http://localhost:5174/student/login');
  
  // Wait for the class code input
  await page.waitForSelector('input[placeholder="Enter 6-digit class code"]');
  await page.type('input[placeholder="Enter 6-digit class code"]', 'UK5LB2');
  
  // Wait for the select to populate and then select the first valid option
  await page.waitForFunction(() => {
    const select = document.querySelector('select');
    return select && select.options.length > 1;
  });
  
  // Get the first student id
  const studentId = await page.evaluate(() => {
    const select = document.querySelector('select');
    return select.options[1].value; // fatma sari
  });
  
  await page.select('select', studentId);
  
  // Type password (using the known password for fatma sari: 202401078)
  await page.type('input[type="password"]', '202401078');
  
  // Click Start Practice
  await page.click('button[type="submit"]');
  
  // Wait for a few seconds to let any errors happen
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  await browser.close();
})();
