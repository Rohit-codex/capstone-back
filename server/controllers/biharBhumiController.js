import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const waitForPostback = async (page, timeout = 15000) => {
  console.log('[Puppeteer] Waiting for ASP.NET AsyncPostBack to complete...');
  await page.waitForFunction(() => {
    try {
      if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
        return !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack();
      }
    } catch (e) {}
    return true;
  }, { timeout });
};

export const searchBiharBhumiRecords = async (req, res) => {
  const { jila, anchal, halka, mauja, searchType, searchValue } = req.body;

  console.log(`[Server] Received search request:`, { jila, anchal, halka, mauja, searchType, searchValue });

  if (!jila || !anchal || !halka || !mauja) {
    return res.status(400).json({ success: false, error: 'Missing required parameters: jila, anchal, halka, mauja.' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set a longer timeout
    page.setDefaultTimeout(30000);
    
    console.log('[Puppeteer] Navigating to Jamabandi page...');
    await page.goto('https://emutation.bihar.gov.in/biharBhumireport/ViewJamabandi', {
      waitUntil: 'networkidle2'
    });

    // ---- STEP 1: Select District (Jila) ----
    console.log('[Puppeteer] Selecting District:', jila);
    await page.waitForSelector('#MainContent_ddlDistrict');
    const selectedDistrict = await page.evaluate((targetJila) => {
      const normalize = (str) => (str || '').replace(/[\s\u200b-\u200d\uFEFF-]+/g, '').toLowerCase();
      const select = document.querySelector('#MainContent_ddlDistrict');
      const target = normalize(targetJila);
      for (let opt of select.options) {
        const optVal = normalize(opt.text);
        if (optVal.includes(target) || target.includes(optVal)) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return opt.text;
        }
      }
      return null;
    }, jila);

    if (!selectedDistrict) {
      throw new Error(`District "${jila}" not found in dropdown.`);
    }

    // Wait for District postback
    await waitForPostback(page);

    // ---- STEP 2: Wait for Circle (Anchal) to populate and select it ----
    console.log('[Puppeteer] Waiting for Circle dropdown to load...');
    await page.waitForFunction(() => {
      const select = document.querySelector('#MainContent_ddlCircle');
      return select && select.options.length > 1;
    }, { timeout: 15000 });

    console.log('[Puppeteer] Selecting Circle:', anchal);
    const selectedCircle = await page.evaluate((targetCircle) => {
      const normalize = (str) => (str || '').replace(/[\s\u200b-\u200d\uFEFF-]+/g, '').toLowerCase();
      const select = document.querySelector('#MainContent_ddlCircle');
      const target = normalize(targetCircle);
      for (let opt of select.options) {
        const optVal = normalize(opt.text);
        if (optVal.includes(target) || target.includes(optVal)) {
          select.value = opt.value;
          return opt.text;
        }
      }
      return null;
    }, anchal);

    if (!selectedCircle) {
      throw new Error(`Circle "${anchal}" not found in dropdown.`);
    }

    // ---- STEP 3: Click Proceed ----
    console.log('[Puppeteer] Clicking Proceed...');
    await page.click('#MainContent_btnproceed');

    // Wait for Proceed postback
    await waitForPostback(page);

    // ---- STEP 4: Wait for Halka dropdown to become active and select it ----
    console.log('[Puppeteer] Waiting for Halka dropdown to load...');
    await page.waitForFunction(() => {
      const select = document.querySelector('#MainContent_ddlHalka');
      return select && !select.disabled && select.options.length > 1;
    }, { timeout: 15000 });

    console.log('[Puppeteer] Selecting Halka:', halka);
    const selectedHalka = await page.evaluate((targetHalka) => {
      const normalize = (str) => (str || '').replace(/[\s\u200b-\u200d\uFEFF-]+/g, '').toLowerCase();
      const select = document.querySelector('#MainContent_ddlHalka');
      const target = normalize(targetHalka);
      for (let opt of select.options) {
        const optVal = normalize(opt.text);
        if (optVal.includes(target) || target.includes(optVal)) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return opt.text;
        }
      }
      return null;
    }, halka);

    if (!selectedHalka) {
      throw new Error(`Halka "${halka}" not found in dropdown.`);
    }

    // Wait for Halka postback
    await waitForPostback(page);

    // ---- STEP 5: Wait for Mauja dropdown to become active and select it ----
    console.log('[Puppeteer] Waiting for Mauja dropdown to load...');
    await page.waitForFunction(() => {
      const select = document.querySelector('#MainContent_ddlMauja');
      return select && !select.disabled && select.options.length > 1;
    }, { timeout: 15000 });

    console.log('[Puppeteer] Selecting Mauja:', mauja);
    const selectedMauja = await page.evaluate((targetMauja) => {
      const normalize = (str) => (str || '').replace(/[\s\u200b-\u200d\uFEFF-]+/g, '').toLowerCase();
      const select = document.querySelector('#MainContent_ddlMauja');
      const target = normalize(targetMauja);
      for (let opt of select.options) {
        const optVal = normalize(opt.text);
        if (optVal.includes(target) || target.includes(optVal)) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return opt.text;
        }
      }
      return null;
    }, mauja);

    if (!selectedMauja) {
      throw new Error(`Mauja "${mauja}" not found.`);
    }

    // Wait for Mauja postback
    await waitForPostback(page);

    // ---- STEP 6: Select Search Criteria and Enter Search Value ----
    console.log('[Puppeteer] Selecting search criteria:', searchType);
    let radioSelector = '';
    let inputSelector = '';

    if (searchType === 'jamabandi') {
      radioSelector = '#MainContent_rdo_JamabandiNo';
      inputSelector = '#MainContent_txt_JamabandiNo';
    } else if (searchType === 'khata') {
      radioSelector = '#MainContent_rdo_KhataNo';
      inputSelector = '#MainContent_txt_KhataNo';
    } else if (searchType === 'plot') {
      radioSelector = '#MainContent_rdo_PlotNo';
      inputSelector = '#MainContent_txt_PlotNo';
    } else if (searchType === 'rayat') {
      radioSelector = '#MainContent_rdo_Rayat';
      inputSelector = '#MainContent_txt_Rayat';
    } else if (searchType === 'ujid') {
      radioSelector = '#MainContent_rdo_ujid';
      inputSelector = '#MainContent_txtujid';
    }

    if (radioSelector && inputSelector) {
      await page.waitForSelector(radioSelector);
      const postbackArg = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.checked = true;
          const onclickFn = el.onclick ? el.onclick.toString() : '';
          const onclickAttr = el.getAttribute('onclick') || '';
          const combined = onclickFn + ' ' + onclickAttr;
          const match = combined.match(/__doPostBack\(['"\\]*([\w$]+)/);
          return match ? match[1] : null;
        }
        return null;
      }, radioSelector);

      console.log(`[Puppeteer] Executing direct __doPostBack for radio button:`, postbackArg);
      if (postbackArg) {
        await page.evaluate(`
          if (typeof __doPostBack === 'function') {
            __doPostBack("${postbackArg}", "");
          }
        `);
      } else {
        await page.click(radioSelector);
      }

      // Wait for radio button postback
      await waitForPostback(page);

      console.log(`[Puppeteer] Waiting for input field ${inputSelector} to enable...`);
      await page.waitForFunction((sel) => {
        const input = document.querySelector(sel);
        return input && !input.disabled;
      }, { timeout: 20000 }, inputSelector);

      await page.type(inputSelector, String(searchValue));
    } else {
      console.log('[Puppeteer] Selecting option to view all records...');
      await page.waitForSelector('#MainContent_rdo_All');
      await page.click('#MainContent_rdo_All');
      
      // Wait for All selection postback
      await waitForPostback(page);
    }

    // ---- STEP 7: Solve Captcha ----
    console.log('[Puppeteer] Solving security code captcha...');
    await page.waitForSelector('#MainContent_TextBox1');
    const captchaExpr = await page.$eval('#MainContent_TextBox1', el => el.value);
    
    if (!captchaExpr) {
      throw new Error('Failed to retrieve security code math expression.');
    }

    const sanitizedExpr = captchaExpr.replace(/[^0-9+\-*/\s]/g, '');
    const solution = Function(`"use strict"; return (${sanitizedExpr})`)();
    console.log(`[Puppeteer] Solved Captcha: "${captchaExpr.trim()}" = ${solution}`);

    await page.type('#MainContent_TextBox2', String(solution));

    // ---- STEP 8: Submit Search ----
    console.log('[Puppeteer] Submitting search form...');
    await page.click('#MainContent_btnSearch');

    // Wait for the results table or error label to load
    console.log('[Puppeteer] Waiting for search results to load...');
    await page.waitForFunction(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const hasResults = tables.some(t => t.innerText.includes('रैयत') || t.innerText.includes('जमाबन्दी'));
      const errorMsg = document.querySelector('#MainContent_lblError')?.innerText;
      return hasResults || (errorMsg && errorMsg.trim() !== '');
    }, { timeout: 25000 });

    // Check for error messages returned by portal
    const errorMsg = await page.evaluate(() => {
      const el = document.querySelector('#MainContent_lblError');
      return el ? el.innerText.trim() : '';
    });

    if (errorMsg) {
      console.log('[Puppeteer] Search failed with message:', errorMsg);
      return res.status(200).json({ success: false, error: errorMsg });
    }

    // ---- STEP 9: Extract Results Data ----
    console.log('[Puppeteer] Extracting results data...');
    const searchResults = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const resultTable = tables.find(t => t.innerText.includes('रैयत') || t.innerText.includes('जमाबन्दी'));
      if (!resultTable) return [];

      const rows = Array.from(resultTable.querySelectorAll('tr'));
      
      // Identify the column index for "कंप्यूटरीकृत जमाबन्दी संख्या" (ujid)
      let computerizedColIndex = -1;
      const firstRowCells = rows[0] ? Array.from(rows[0].querySelectorAll('td, th')) : [];
      firstRowCells.forEach((cell, idx) => {
        const text = cell.innerText.trim();
        if (text.includes('कंप्यूटरीकृत') || text.includes('computerized') || text.toLowerCase().includes('ujid')) {
          computerizedColIndex = idx;
        }
      });

      return rows.map((row, rIndex) => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        return cells.map((cell, cIndex) => {
          const actionLink = cell.querySelector('a, input[type="button"], input[type="image"]');
          let actionUrl = '';
          
          if (actionLink) {
            if (actionLink.tagName === 'A') {
              actionUrl = actionLink.href;
            } else if (actionLink.tagName === 'INPUT') {
              const onClickAttr = actionLink.getAttribute('onclick') || '';
              const match = onClickAttr.match(/window\.open\('([^']+)'/);
              if (match) {
                actionUrl = match[1];
              }
            }

            if (actionUrl && actionUrl.startsWith('javascript:')) {
              const match = actionUrl.match(/window\.open\('([^']+)'/);
              if (match) {
                actionUrl = match[1];
              } else {
                // If it's __doPostBack, construct print URL using computerized Jamabandi no if column exists
                if (computerizedColIndex !== -1 && cells[computerizedColIndex]) {
                  const ujidVal = cells[computerizedColIndex].innerText.trim();
                  if (ujidVal && ujidVal.match(/^\d+$/)) {
                    actionUrl = `Jamabandi_Print.aspx?ujid=${ujidVal}`;
                  }
                }
              }
            }
          }

          // Fallback check: if it is the "देखें" column and we don't have a URL, construct it from the computerized column
          const cellText = cell.innerText.trim();
          if ((cellText.includes('देखें') || cIndex === cells.length - 1) && computerizedColIndex !== -1 && cells[computerizedColIndex] && !actionUrl) {
            const ujidVal = cells[computerizedColIndex].innerText.trim();
            if (ujidVal && ujidVal.match(/^\d+$/)) {
              actionUrl = `Jamabandi_Print.aspx?ujid=${ujidVal}`;
            }
          }

          let finalUrl = null;
          if (actionUrl && !actionUrl.startsWith('javascript:')) {
            const cleanPath = actionUrl.replace(/^\.\//, '').replace(/^\//, '');
            finalUrl = `https://emutation.bihar.gov.in/biharBhumireport/${cleanPath}`;
          }

          return {
            text: cell.innerText.replace(/\s+/g, ' ').trim(),
            isHeader: row.parentNode.tagName === 'THEAD' || cell.tagName === 'TH' || rIndex === 0,
            actionUrl: finalUrl
          };
        });
      });
    });

    console.log(`[Puppeteer] Search completed successfully. Extracted ${searchResults.length} rows.`);

    // ---- STEP 10: Cache Jamabandi Print pages locally ----
    console.log('[Puppeteer] Caching print documents locally...');
    
    // Ensure public/temp exists in the backend root directory
    const tempDir = path.join(process.cwd(), 'public', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Extract all unique ujids to fetch
    const ujidsToFetch = [];
    searchResults.forEach((row) => {
      row.forEach((cell) => {
        if (cell.actionUrl) {
          const match = cell.actionUrl.match(/ujid=(\d+)/);
          if (match && !ujidsToFetch.includes(match[1])) {
            ujidsToFetch.push(match[1]);
          }
        }
      });
    });

    const cachedUrls = {};
    if (ujidsToFetch.length > 0) {
      console.log(`[Puppeteer] Downloading ${ujidsToFetch.length} record pages in parallel...`);
      await Promise.all(ujidsToFetch.map(async (ujid) => {
        const tempPage = await browser.newPage();
        try {
          await tempPage.goto(`https://emutation.bihar.gov.in/biharBhumireport/Jamabandi_Print.aspx?ujid=${ujid}`, {
            waitUntil: 'networkidle2',
            timeout: 20000
          });
          let html = await tempPage.content();
          // Inject base tag to resolve relative stylesheets, images, scripts correctly from official site
          html = html.replace('<head>', '<head><base href="https://emutation.bihar.gov.in/biharBhumireport/">');
          
          const filePath = path.join(tempDir, `${ujid}.html`);
          fs.writeFileSync(filePath, html, 'utf8');
          cachedUrls[ujid] = `/api/bihar-bhumi/temp/${ujid}.html`;
          console.log(`[Puppeteer] Cached details page for ujid: ${ujid}`);
        } catch (err) {
          console.error(`[Puppeteer Error] Failed to cache print page for ujid: ${ujid}`, err.message);
        } finally {
          await tempPage.close();
        }
      }));
    }

    // Replace actionUrl with local static URL paths
    searchResults.forEach((row) => {
      row.forEach((cell) => {
        if (cell.actionUrl) {
          const match = cell.actionUrl.match(/ujid=(\d+)/);
          if (match && cachedUrls[match[1]]) {
            cell.actionUrl = cachedUrls[match[1]];
          }
        }
      });
    });

    await browser.close();

    return res.status(200).json({
      success: true,
      data: searchResults
    });

  } catch (err) {
    console.error('[Puppeteer Error]', err);
    if (browser) {
      await browser.close();
    }
    return res.status(500).json({ success: false, error: err.message || 'An error occurred during Puppeteer search.' });
  }
};
