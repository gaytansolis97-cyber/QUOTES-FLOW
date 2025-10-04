import { test, expect, Page } from '@playwright/test';

test.setTimeout(180_000);

// ===== CONFIG =====
const URL  = 'https://fariabrothers.eworkorders.com/default.asp';
const USER = 'GUADALUPEG';
const PASS = 'GAYTAN909959';

const INVENTORY_CELL_ID = '#dm0m0i7tdT'; // <td id="dm0m0i7tdT">Inventory</td>
const PO_TEXT_RX        = /purchase\s*orders?/i;

// =================== Utils ===================

async function findInAnyFrame(page: Page, selector: string, timeoutMs = 12_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const f of [page.mainFrame(), ...page.frames()]) {
      const loc = f.locator(selector).first();
      try {
        if (await loc.isVisible({ timeout: 80 }).catch(() => false)) return { frame: f, locator: loc };
        const cnt = await loc.count().catch(() => 0);
        if (cnt > 0) {
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          if (await loc.isVisible({ timeout: 80 }).catch(() => false)) return { frame: f, locator: loc };
        }
      } catch {}
    }
    await page.waitForTimeout(90);
  }
  throw new Error(`No encontré el selector en ningún frame: ${selector}`);
}

async function hoverInventoryAt(page: Page, fx = 0.16, fy = 0.62) {
  const { frame, locator: inv } = await findInAnyFrame(page, INVENTORY_CELL_ID, 8_000);
  await inv.scrollIntoViewIfNeeded().catch(() => {});
  const box = await inv.boundingBox();
  if (box) {
    const px = Math.max(6, Math.floor(box.width  * fx)); // más a la izquierda
    const py = Math.max(6, Math.floor(box.height * fy)); // algo abajo
    await inv.hover({ position: { x: px, y: py }, force: true }).catch(() => {});
    await frame.page().mouse.move(box.x + px, box.y + py);
  } else {
    await inv.hover({ force: true }).catch(() => {});
  }
  await frame.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }, INVENTORY_CELL_ID);
  await frame.waitForTimeout(70);
}

async function waitForPurchaseOrdersList(page: Page) {
  const ew = page.frameLocator('iframe[name="_ew"]');
  await ew.locator('text=Order List').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(150);
  return ew;
}

// -------- Ruta A: intentar desde _ew (más simple/rápida) --------
async function tryLeftNavInsideEw(page: Page): Promise<boolean> {
  const ew = page.frameLocator('iframe[name="_ew"]');
  try {
    const candidate = ew.getByRole('link', { name: PO_TEXT_RX }).first();
    await candidate.waitFor({ state: 'visible', timeout: 2000 });
    await candidate.click().catch(() => {});
    await waitForPurchaseOrdersList(page);
    return true;
  } catch {
    // fallback: buscar cualquier texto clicable
    try {
      const any = ew.locator('a:has-text("Purchase Orders"), td:has-text("Purchase Orders")').first();
      await any.waitFor({ state: 'visible', timeout: 2000 });
      await any.click({ trial: true }).catch(() => {});
      await any.click({ force: true }).catch(() => {});
      await waitForPurchaseOrdersList(page);
      return true;
    } catch {
      return false;
    }
  }
}

// -------- Ruta B: barra superior (multi-estrategia) --------
async function findPOCandidateGlobal(page: Page) {
  return await page.evaluate((invSel) => {
    const rx = /purchase\s*orders?/i;
    // Busca en TODO el documento un candidato visible
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('a,td,div,span'));
    let target: HTMLElement | null = null;
    for (const el of nodes) {
      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!rx.test(txt)) continue;
      // visible?
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (!el.offsetParent) continue;
      target = el;
      break;
    }
    if (!target) return null;

    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2 + window.scrollX;
    const cy = r.top  + r.height / 2 + window.scrollY;

    const a = target.closest('a') as HTMLAnchorElement | null;
    const href = a?.href ?? null;

    // Intenta encontrar un onclick heredado
    let onclick: string | null = null;
    let el: HTMLElement | null = target;
    while (el && !onclick) {
      const attr = el.getAttribute('onclick');
      if (attr) onclick = attr;
      el = el.parentElement;
    }

    return { x: Math.floor(cx), y: Math.floor(cy), href, hasOnClick: Boolean(onclick) };
  }, INVENTORY_CELL_ID);
}

async function clickPurchaseOrdersViaTopMenu(page: Page) {
  // Mantener INVENTORY abierto con varias coordenadas
  const HOVERS: Array<[number, number]> = [
    [0.12, 0.70],
    [0.14, 0.68],
    [0.16, 0.66],
    [0.1, 0.62],
    [0.14, 0.60],
  ];

  const DEADLINE = Date.now() + 28_000;

  let keep = true;
  const keeper = (async () => {
    let i = 0;
    while (keep && Date.now() < DEADLINE) {
      const [fx, fy] = HOVERS[i % HOVERS.length];
      await hoverInventoryAt(page, fx, fy).catch(() => {});
      i++;
      await page.waitForTimeout(75);
    }
  })();

  try {
    while (Date.now() < DEADLINE) {
      // 1) localizar cualquier “Purchase Orders” visible
      const candidate = await findPOCandidateGlobal(page);

      if (candidate) {
        // A) Click por coordenadas (rápido)
        await page.mouse.move(candidate.x, candidate.y);
        await page.mouse.down();
        await page.mouse.up();
        try {
          await waitForPurchaseOrdersList(page);
          return; // ✅
        } catch {}

        // B) Click DOM normal y forzado en cualquier frame
        let clicked = false;
        for (const f of [page.mainFrame(), ...page.frames()]) {
          const loc = f.locator('a,td').filter({ hasText: PO_TEXT_RX }).first();
          if (await loc.isVisible().catch(() => false)) {
            await loc.scrollIntoViewIfNeeded().catch(() => {});
            await loc.click({ trial: true }).catch(() => {});
            await loc.click({ force: true }).catch(() => {});
            clicked = true;
            break;
          }
        }
        if (clicked) {
          try {
            await waitForPurchaseOrdersList(page);
            return; // ✅
          } catch {}
        }

        // C) Click JS (disparando eventos por si hay onclick inline)
        for (const f of [page.mainFrame(), ...page.frames()]) {
          const handle = await f.locator('a,td,div,span').filter({ hasText: PO_TEXT_RX }).first().elementHandle().catch(() => null);
          if (handle) {
            await f.evaluate((el) => {
              const ev = (t: string) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
              ev('mouseover'); ev('mousedown'); ev('mouseup'); ev('click');
            }, handle).catch(() => {});
            try {
              await waitForPurchaseOrdersList(page);
              return; // ✅
            } catch {}
          }
        }

        // D) Fallback: si hay href válido, navega directo
        if (candidate.href) {
          await page.goto(candidate.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
          try {
            await waitForPurchaseOrdersList(page);
            return; // ✅
          } catch {}
        }
      }

      await page.waitForTimeout(110);
    }
  } finally {
    keep = false;
    await keeper;
  }

  throw new Error('No pude hacer clic en Purchase Orders (menú colapsa o no navega).');
}

// =============== TEST ===============
test('Inventory ► Purchase Orders ► Add ► llenar ► guardar', async ({ page }) => {
  // 1) Login
  await page.goto(URL);
  await page.getByRole('textbox', { name: 'USER ID' }).fill(USER);
  await page.getByRole('textbox', { name: 'PASSWORD' }).fill(PASS);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);

  // 2) Ir a Purchase Orders (Ruta A primero, si no, Ruta B)
  const okLeft = await tryLeftNavInsideEw(page);
  if (!okLeft) {
    await clickPurchaseOrdersViaTopMenu(page);
  }

  // 3) Ya dentro del listado
  const ew = await waitForPurchaseOrdersList(page);

  // 4) Add
  const addLink = ew.getByRole('link', { name: 'Add', exact: true });
  await addLink.waitFor({ state: 'visible', timeout: 15_000 });
  await addLink.click();

  // 5) Campos base
  await ew.locator('#ven_num').selectOption('10');        // Vendor
  await ew.locator('#field3').selectOption('ORDERED');    // Status
  await ew.locator('#field2').selectOption('DOLORES');    // Buyer

  await ew.getByRole('cell', { name: 'Details' }).click();
  await ew.getByRole('button', { name: 'Add Items' }).click();

  // 6) Add Item Management
  const addItem = ew.frameLocator('iframe[name="AddItemManagement"]');
  await addItem.locator('input[name="item_number_search"]').fill('H16');
  await addItem.getByRole('button', { name: 'Get Results' }).click();

  const purchaseItems = addItem.frameLocator('iframe[name="PurchaseOrderItems"]');
  const itemCell = purchaseItems.getByRole('cell', { name: /H16 HOSE CLAMP/i }).first();
  await itemCell.waitFor({ state: 'visible', timeout: 15_000 });
  await itemCell.click();

  await ew.getByRole('button', { name: 'Add Selected Items' }).click();

  // 7) Close
  await ew.locator('button:has-text("Close")').first().click();

  // 8) Cantidad
  const orders = ew.frameLocator('iframe[name="Orders"]');
  await orders.locator('input[name="n1_5"]').fill('1');

  // 9) Guardar
  await ew.getByRole('link', { name: 'Save' }).click();

  // (opcional) confirmación
  // await expect(ew.getByText(/saved|success/i)).toBeVisible({ timeout: 30_000 });
});