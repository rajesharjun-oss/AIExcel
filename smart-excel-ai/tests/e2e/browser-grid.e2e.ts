import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixturePath } from '../helpers/workbook-fixtures';

type PendingCall = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

const port = Number(process.env.E2E_PORT || 5200 + Math.floor(Math.random() * 500));
const chromePort = Number(process.env.E2E_CHROME_PORT || 9300 + Math.floor(Math.random() * 500));
const appUrl = `http://127.0.0.1:${port}/`;
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean) as string[];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const killTree = (child: ChildProcessWithoutNullStreams | undefined) => {
  if (!child?.pid || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    // Kill the whole process group so grandchildren (e.g. vite under npm) exit too.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
};

const waitForHttp = async (url: string, timeoutMs = 30_000) => {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : 'no response'}`);
};

const findChrome = () => {
  const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chrome) {
    throw new Error('Chrome was not found. Set CHROME_PATH to the Chrome or Chromium executable.');
  }
  return chrome;
};

const startVite = (): ChildProcessWithoutNullStreams => {
  const devArgs = ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)];
  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'npm', ...devArgs], { cwd: process.cwd(), stdio: 'pipe', windowsHide: true })
      : spawn('npm', devArgs, { cwd: process.cwd(), stdio: 'pipe', detached: true });
  child.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  return child;
};

const startChrome = (): ChildProcessWithoutNullStreams => {
  const userDataDir = path.join(process.cwd(), 'tests-dist', 'chrome-profile');
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  return spawn(
    findChrome(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank'
    ],
    {
      stdio: 'pipe',
      windowsHide: true
    }
  );
};

class CdpPage {
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) {
        call.reject(new Error(message.error.message));
      } else {
        call.resolve(message.result);
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
    }
    return result.result?.value as T;
  }
}

const connectPage = async (): Promise<CdpPage> => {
  await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?${encodeURIComponent(appUrl)}`, { method: 'PUT' }).then((r) => r.json() as any);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools websocket')), 30_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools')), { once: true });
  });
  const page = new CdpPage(socket);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('DOM.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  return page;
};

const run = async () => {
  const vite = startVite();
  let chrome: ChildProcessWithoutNullStreams | undefined;
  try {
    await waitForHttp(appUrl);
    chrome = startChrome();
    chrome.stderr.on('data', (chunk) => process.stderr.write(`[chrome] ${chunk}`));
    chrome.stdout.on('data', (chunk) => process.stdout.write(`[chrome] ${chunk}`));
    const page = await connectPage();
    await page.send('Page.navigate', { url: appUrl });
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (document.querySelector('input[type="file"]')) {
            resolve();
          } else if (Date.now() - started > 30_000) {
            reject(new Error('app did not render file input'));
          } else {
            window.setTimeout(tick, 100);
          }
        };
        tick();
      });
    });

    await page.evaluate(async () => {
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('New Workbook')) as HTMLButtonElement | undefined;
      if (!button) throw new Error('New Workbook button not found');
      button.click();
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (document.querySelector('[data-cell="Sheet1-1-0"]')) {
            resolve();
          } else if (Date.now() - started > 30_000) {
            reject(new Error('blank workbook grid did not render'));
          } else {
            window.setTimeout(tick, 100);
          }
        };
        tick();
      });
    });
    const blankWorkbook = await page.evaluate(() => ({
      title: document.querySelector('.sheet-summary h2')?.textContent,
      columns: document.querySelectorAll('thead th').length - 1,
      renderedRows: document.querySelectorAll('tbody tr:not(.virtual-spacer)').length,
      summaryText: document.querySelector('.sheet-summary')?.textContent,
      firstHeader: document.querySelectorAll('thead th')[1]?.textContent,
      lastHeader: document.querySelectorAll('thead th')[52]?.textContent,
      rowNumbers: Array.from(document.querySelectorAll('tbody .row-number')).slice(0, 5).map((item) => item.textContent),
      firstBlank: (document.querySelector('[data-cell="Sheet1-1-0"]') as HTMLInputElement | null)?.value
    }));
    assert.equal(blankWorkbook.title, 'Sheet1');
    assert.equal(blankWorkbook.columns, 52);
    assert.ok(blankWorkbook.summaryText?.includes('500'), `expected 500 row summary: ${blankWorkbook.summaryText}`);
    assert.ok(blankWorkbook.renderedRows < 500, `expected virtualized rows, rendered ${blankWorkbook.renderedRows}`);
    assert.equal(blankWorkbook.firstHeader, 'A');
    assert.equal(blankWorkbook.lastHeader, 'AZ');
    assert.deepEqual(blankWorkbook.rowNumbers, ['1', '2', '3', '4', '5']);
    assert.equal(blankWorkbook.firstBlank, '');

    const collapsed = await page.evaluate(async () => {
      const left = document.querySelector<HTMLButtonElement>('button[title="Hide sheets"]');
      const right = document.querySelector<HTMLButtonElement>('button[title="Hide AI panel"]');
      if (!left || !right) throw new Error('collapse buttons not found');
      left.click();
      right.click();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const grid = document.querySelector('.workspace-grid');
      return {
        sheetsCollapsed: grid?.classList.contains('sheets-collapsed'),
        assistantCollapsed: grid?.classList.contains('assistant-collapsed'),
        sheetRailWidth: Math.round(document.querySelector('.sheet-rail')?.getBoundingClientRect().width ?? 0),
        assistantWidth: Math.round(document.querySelector('.assistant-pane')?.getBoundingClientRect().width ?? 0)
      };
    });
    assert.equal(collapsed.sheetsCollapsed, true);
    assert.equal(collapsed.assistantCollapsed, true);
    assert.ok(collapsed.sheetRailWidth <= 60, `sheet rail width was ${collapsed.sheetRailWidth}`);
    assert.ok(collapsed.assistantWidth <= 60, `assistant width was ${collapsed.assistantWidth}`);

    const horizontalScroll = await page.evaluate(async () => {
      const wrapper = document.querySelector<HTMLElement>('.table-wrap');
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-1-0"]');
      if (!wrapper || !cell) throw new Error('scroll test target not found');
      wrapper.scrollLeft = 0;
      cell.focus();
      cell.setSelectionRange(cell.value.length, cell.value.length);
      for (let index = 0; index < 40; index += 1) {
        const active = document.activeElement as HTMLInputElement | null;
        const before = active?.getAttribute('data-cell');
        active?.setSelectionRange(active.value.length, active.value.length);
        active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        // Wait until focus actually moves so slow headless renders do not drop presses.
        const started = Date.now();
        while (Date.now() - started < 300) {
          await new Promise((resolve) => window.setTimeout(resolve, 20));
          if ((document.activeElement as HTMLElement | null)?.getAttribute('data-cell') !== before) break;
        }
      }
      return {
        scrollLeft: wrapper.scrollLeft,
        scrollWidth: wrapper.scrollWidth,
        clientWidth: wrapper.clientWidth,
        activeCell: (document.activeElement as HTMLElement | null)?.getAttribute('data-cell')
      };
    });
    assert.ok(horizontalScroll.scrollWidth > horizontalScroll.clientWidth, `expected grid overflow: ${JSON.stringify(horizontalScroll)}`);
    assert.ok(horizontalScroll.scrollLeft > 0, `expected horizontal scroll: ${JSON.stringify(horizontalScroll)}`);
    const horizontalColumnIndex = Number(horizontalScroll.activeCell?.split('-')[2]);
    assert.ok(horizontalColumnIndex >= 38, `expected horizontal navigation to move deep into the sheet: ${JSON.stringify(horizontalScroll)}`);

    const verticalScroll = await page.evaluate(async () => {
      const wrapper = document.querySelector<HTMLElement>('.table-wrap');
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-1-0"]');
      if (!wrapper || !cell) throw new Error('vertical scroll test target not found');
      wrapper.scrollTop = 0;
      cell.focus();
      for (let index = 0; index < 120; index += 1) {
        const active = document.activeElement as HTMLInputElement | null;
        const before = active?.getAttribute('data-cell');
        active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        // Wait until focus actually moves so slow headless renders do not drop presses.
        const started = Date.now();
        while (Date.now() - started < 300) {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
          if ((document.activeElement as HTMLElement | null)?.getAttribute('data-cell') !== before) break;
        }
      }
      return {
        scrollTop: wrapper.scrollTop,
        scrollHeight: wrapper.scrollHeight,
        clientHeight: wrapper.clientHeight,
        activeCell: (document.activeElement as HTMLElement | null)?.getAttribute('data-cell')
      };
    });
    assert.ok(verticalScroll.scrollHeight > verticalScroll.clientHeight, `expected grid vertical overflow: ${JSON.stringify(verticalScroll)}`);
    assert.ok(verticalScroll.scrollTop > 0, `expected vertical scroll: ${JSON.stringify(verticalScroll)}`);
    const verticalRowIndex = Number(verticalScroll.activeCell?.split('-')[1]);
    assert.ok(verticalRowIndex >= 80, `expected vertical navigation to move deep into the sheet: ${JSON.stringify(verticalScroll)}`);

    const largeCsv = [
      'ID,Description,Amount',
      ...Array.from({ length: 750 }, (_, index) => `${index + 1},Large row ${index + 1},${(index + 1) * 10}`)
    ].join('\n');
    await page.evaluate(async (csvText: string) => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error('file input not found for large upload');
      const file = new File([csvText], 'large_upload.csv', { type: 'text/csv' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (document.querySelector('[data-cell="Sheet1-1-1"]')) {
            resolve();
          } else if (Date.now() - started > 30_000) {
            reject(new Error('large upload did not render'));
          } else {
            window.setTimeout(tick, 100);
          }
        };
        tick();
      });
    }, largeCsv);
    const largeUpload = await page.evaluate(async () => {
      const wrapper = document.querySelector<HTMLElement>('.table-wrap');
      if (!wrapper) throw new Error('large upload table wrapper not found');
      wrapper.scrollTop = wrapper.scrollHeight;
      wrapper.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (document.querySelector('[data-cell="Sheet1-750-1"]')) {
            resolve();
          } else if (Date.now() - started > 30_000) {
            reject(new Error('row 750 did not render after scrolling'));
          } else {
            window.setTimeout(tick, 100);
          }
        };
        tick();
      });
      const rowNumber = Array.from(document.querySelectorAll('tbody .row-number')).find((item) => item.textContent === '750')?.textContent;
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-750-1"]');
      if (!cell) throw new Error('row 750 editable cell not found');
      cell.focus();
      cell.value = 'Edited row 750';
      cell.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        rowNumber,
        value: cell.value,
        renderedRows: document.querySelectorAll('tbody tr:not(.virtual-spacer)').length,
        summaryText: document.querySelector('.sheet-summary')?.textContent
      };
    });
    assert.equal(largeUpload.rowNumber, '750');
    assert.equal(largeUpload.value, 'Edited row 750');
    assert.ok(largeUpload.summaryText?.includes('750'), `expected 750 row summary: ${largeUpload.summaryText}`);
    assert.ok(largeUpload.renderedRows < 750, `expected virtualized large upload rows: ${JSON.stringify(largeUpload)}`);

    const csv = await readFile(fixturePath('sample_dirty_data.csv'), 'utf8');
    await page.evaluate(async (csvText: string) => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error('file input not found');
      const file = new File([csvText], 'sample_dirty_data.csv', { type: 'text/csv' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const uploadedCell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-1-1"]');
          if (uploadedCell?.value === '  FIRS payment  ') {
            resolve();
          } else if (Date.now() - started > 30_000) {
            reject(new Error('grid did not render after upload'));
          } else {
            window.setTimeout(tick, 100);
          }
        };
        tick();
      });
    }, csv);

    const loaded = await page.evaluate(() => ({
      sheetTitle: document.querySelector('.sheet-summary h2')?.textContent,
      firstCell: (document.querySelector('[data-cell="Sheet1-1-1"]') as HTMLInputElement | null)?.value,
      rows: document.querySelectorAll('.grid-cell-input').length
    }));
    assert.equal(loaded.sheetTitle, 'Sheet1');
    assert.equal(loaded.firstCell, '  FIRS payment  ');
    assert.ok(loaded.rows > 20);

    await page.evaluate(() => {
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-1-1"]');
      if (!cell) throw new Error('editable cell not found');
      cell.focus();
      cell.select();
      cell.value = 'Edited FIRS payment';
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const edited = await page.evaluate(() => (document.querySelector('[data-cell="Sheet1-1-1"]') as HTMLInputElement).value);
    assert.equal(edited, 'Edited FIRS payment');

    await page.evaluate(() => {
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-2-1"]');
      if (!cell) throw new Error('paste target not found');
      cell.focus();
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'Alpha\t10\nBeta\t20');
      cell.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    const pasted = await page.evaluate(() => ({
      a: (document.querySelector('[data-cell="Sheet1-2-1"]') as HTMLInputElement).value,
      b: (document.querySelector('[data-cell="Sheet1-2-2"]') as HTMLInputElement).value,
      c: (document.querySelector('[data-cell="Sheet1-3-1"]') as HTMLInputElement).value,
      d: (document.querySelector('[data-cell="Sheet1-3-2"]') as HTMLInputElement).value
    }));
    assert.deepEqual(pasted, { a: 'Alpha', b: '10', c: 'Beta', d: '20' });

    await page.evaluate(async () => {
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-2-2"]');
      if (!cell) throw new Error('keyboard target not found');
      cell.focus();
      cell.setSelectionRange(cell.value.length, cell.value.length);
      cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const started = Date.now();
      while (Date.now() - started < 2_000) {
        if ((document.activeElement as HTMLElement | null)?.getAttribute('data-cell') !== 'Sheet1-2-2') break;
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
    });
    const activeAfterArrow = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-cell'));
    assert.equal(activeAfterArrow, 'Sheet1-2-3');

    await page.evaluate(async () => {
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-2-3"]');
      if (!cell) throw new Error('enter target not found');
      cell.focus();
      cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const started = Date.now();
      while (Date.now() - started < 2_000) {
        if ((document.activeElement as HTMLElement | null)?.getAttribute('data-cell') !== 'Sheet1-2-3') break;
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
    });
    const activeAfterEnter = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-cell'));
    assert.equal(activeAfterEnter, 'Sheet1-3-3');

    const ctrlAResult = await page.evaluate(() => {
      const cell = document.querySelector<HTMLInputElement>('[data-cell="Sheet1-3-3"]');
      if (!cell) throw new Error('shortcut target not found');
      cell.focus();
      cell.setSelectionRange(0, cell.value.length);
      cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
      document.execCommand('insertText', false, 'Shortcut replacement');
      return cell.value;
    });
    assert.equal(ctrlAResult, 'Shortcut replacement');

    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('Clean Data')) as HTMLButtonElement | undefined;
      if (!button) throw new Error('Clean Data button not found');
      button.click();
    });
    const cleanButtonEnabled = await page.evaluate(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('Download Cleaned')) as HTMLButtonElement | undefined;
      return Boolean(button && !button.disabled);
    });
    assert.equal(cleanButtonEnabled, true);

    await page.evaluate(async () => {
      const translateButton = Array.from(document.querySelectorAll('.translate-box button')).find((item) =>
        item.textContent?.includes('Translate')
      ) as HTMLButtonElement | undefined;
      if (!translateButton) throw new Error('Translate button not found');
      translateButton.click();
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const firstHeader = document.querySelectorAll('thead th')[1]?.textContent;
          if (firstHeader === 'Fecha') {
            resolve();
          } else if (Date.now() - started > 30_000) {
            reject(new Error(`translation did not update headers, saw: ${firstHeader}`));
          } else {
            window.setTimeout(tick, 100);
          }
        };
        tick();
      });
    });
    const translated = await page.evaluate(() => ({
      headers: Array.from(document.querySelectorAll('thead th')).slice(1, 5).map((item) => item.textContent),
      amountCell: (document.querySelector('[data-cell="Sheet1-1-3"]') as HTMLInputElement | null)?.value,
      revertVisible: Array.from(document.querySelectorAll('.translate-box button')).some((item) => item.textContent?.includes('Revert'))
    }));
    assert.deepEqual(translated.headers, ['Fecha', 'Descripción', 'Nombre', 'Importe']);
    assert.equal(translated.amountCell, '1000');
    assert.equal(translated.revertVisible, true);

    await page.evaluate(async () => {
      const revertButton = Array.from(document.querySelectorAll('.translate-box button')).find((item) =>
        item.textContent?.includes('Revert')
      ) as HTMLButtonElement | undefined;
      if (!revertButton) throw new Error('Revert button not found');
      revertButton.click();
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const firstHeader = document.querySelectorAll('thead th')[1]?.textContent;
          if (firstHeader === 'Date') {
            resolve();
          } else if (Date.now() - started > 30_000) {
            reject(new Error(`revert did not restore headers, saw: ${firstHeader}`));
          } else {
            window.setTimeout(tick, 100);
          }
        };
        tick();
      });
    });

    console.log('ok 1 - browser creates larger built-in blank workbook with row labels');
    console.log('ok 2 - browser collapses sheet and AI side panels');
    console.log('ok 3 - browser upload renders editable grid');
    console.log('ok 4 - browser cell editing updates visible value');
    console.log('ok 5 - browser multi-cell paste fills the right range');
    console.log('ok 6 - browser arrow and enter keyboard movement changes active cell');
    console.log('ok 7 - browser keyboard movement scrolls hidden rows and columns into view');
    console.log('ok 8 - browser virtual scrolling reaches and edits uploaded rows beyond 500');
    console.log('ok 9 - browser shortcut-style replacement works inside a cell input');
    console.log('ok 10 - browser clean action enables export after edits');
    console.log('ok 11 - browser live translation converts headers and status text');
    console.log('ok 12 - browser revert restores original text after translation');
    console.log('');
    console.log('tests 12');
    console.log('pass 12');
    console.log('fail 0');
  } finally {
    killTree(chrome);
    killTree(vite);
  }
};

run()
  .then(() => {
    // Exit explicitly: surviving child stdio streams must not keep the event loop alive.
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error(error);
    console.log('');
    console.log('tests 12');
    console.log('pass 0');
    console.log('fail 1');
    process.exit(1);
  });
