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

async function waitForPurchaseOrdersList(page: Page, timeoutMs = 20_000) {
  const ew = page.frameLocator('iframe[name="_ew"]');
  await ew.locator('text=Order List').first().waitFor({ state: 'visible', timeout: timeoutMs });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(150);
  return ew;
}

async function hasPurchaseOrdersList(page: Page, timeoutMs = 2_000) {
  const ew = page.frameLocator('iframe[name="_ew"]');
  try {
    await ew.locator('text=Order List').first().waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function findPurchaseOrdersCandidate(page: Page) {
  for (const frame of [page.mainFrame(), ...page.frames()]) {
    const loc = frame.locator('a, td').filter({ hasText: PO_TEXT_RX }).first();
    const count = await loc.count().catch(() => 0);
    if (!count) continue;
    const visible = await loc.isVisible({ timeout: 80 }).catch(() => false);
    if (!visible) continue;
    const info = await loc.evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      const anchor = el.closest('a') as HTMLAnchorElement | null;
      let href: string | null = null;
      if (anchor) {
        const attrHref = anchor.getAttribute('href');
        href = attrHref && attrHref.trim() !== '' ? attrHref : anchor.href ?? null;
      }
      if (tag === 'a' && !href) {
        const self = el as HTMLAnchorElement;
        const attrHref = self.getAttribute('href');
        href = attrHref && attrHref.trim() !== '' ? attrHref : self.href ?? null;
      }
      return { tag, href };
    }).catch(() => null);
    if (!info) continue;
    return { frame, locator: loc, href: info.href ?? null, tagName: info.tag };
  }
  return null;
}

async function openPurchaseOrders(page: Page) {
  console.log('[Inventory] Iniciando flujo robusto para abrir Purchase Orders.');
  const hoverPoints: Array<[number, number]> = [
    [0.14, 0.64],
    [0.16, 0.62],
    [0.12, 0.66],
  ];
  const deadline = Date.now() + 24_000;
  let hoverAttempt = 0;
  let hoverIndex = 0;
  let nextHover = 0;
  let inventoryInfo: Awaited<ReturnType<typeof findInAnyFrame>> | null = null;

  while (Date.now() < deadline) {
    const now = Date.now();

    if (now >= nextHover) {
      hoverAttempt++;
      if (!inventoryInfo) {
        try {
          inventoryInfo = await findInAnyFrame(page, INVENTORY_CELL_ID, 1_500);
          console.log('[Inventory] Inventory localizado.');
        } catch (error) {
          inventoryInfo = null;
          console.log(`[Inventory] No se pudo localizar Inventory en intento ${hoverAttempt}: ${(error as Error).message ?? error}`);
        }
      }

      if (inventoryInfo) {
        const [fx, fy] = hoverPoints[hoverIndex % hoverPoints.length];
        hoverIndex++;
        console.log(`[Inventory] Hover intento ${hoverAttempt} en coordenadas relativas (${fx.toFixed(2)}, ${fy.toFixed(2)}).`);
        try {
          await inventoryInfo.locator.scrollIntoViewIfNeeded().catch(() => {});
          const box = await inventoryInfo.locator.boundingBox();
          if (box) {
            const px = Math.max(4, Math.floor(box.width * fx));
            const py = Math.max(4, Math.floor(box.height * fy));
            await inventoryInfo.locator.hover({ position: { x: px, y: py }, force: true });
            await page.mouse.move(box.x + px, box.y + py).catch(() => {});
          } else {
            await inventoryInfo.locator.hover({ force: true });
          }
          await inventoryInfo.frame.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          }, INVENTORY_CELL_ID).catch(() => {});
        } catch (error) {
          console.log(`[Inventory] Error al hacer hover: ${(error as Error).message ?? error}`);
          inventoryInfo = null;
        }
      }

      nextHover = now + 250;
      await page.waitForTimeout(140);
    }

    const candidate = await findPurchaseOrdersCandidate(page);
    if (candidate) {
      console.log(`[Inventory] Candidato "Purchase Orders" visible (${candidate.tagName}).`);
      await candidate.locator.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(120);

      try {
        await candidate.locator.click({ timeout: 2_000 });
        console.log('[Inventory] Click directo sobre el candidato ejecutado.');
      } catch (error) {
        console.log(`[Inventory] Error en click directo: ${(error as Error).message ?? error}`);
      }

      await page.waitForTimeout(260);
      if (await hasPurchaseOrdersList(page, 2_500)) {
        console.log('[Inventory] "Order List" visible tras el click directo.');
        return await waitForPurchaseOrdersList(page);
      }

      if (candidate.href) {
        console.log(`[Inventory] Intentando navegación manual con href=${candidate.href}.`);
        try {
          await page.goto(candidate.href, { waitUntil: 'domcontentloaded' });
        } catch (error) {
          console.log(`[Inventory] Error usando page.goto: ${(error as Error).message ?? error}`);
        }
        await page.waitForTimeout(320);
        if (await hasPurchaseOrdersList(page, 3_000)) {
          console.log('[Inventory] "Order List" visible tras navegar manualmente.');
          return await waitForPurchaseOrdersList(page);
        }
      }
    }

    await page.waitForTimeout(180);
  }

  throw new Error('No se pudo abrir Purchase Orders desde Inventory en 24 segundos.');
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

  // 2) Ir a Purchase Orders con flujo robusto
  const ew = await openPurchaseOrders(page);

  // 3) Ya dentro del listado
  // (ew ya apunta al frame _ew tras openPurchaseOrders)

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
