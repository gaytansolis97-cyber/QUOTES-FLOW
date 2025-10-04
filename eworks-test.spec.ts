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

async function waitForPurchaseOrdersList(page: Page, timeoutMs = 12_000) {
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

async function hoverInventory(
  page: Page,
  info: Awaited<ReturnType<typeof findInAnyFrame>>,
  attempt: number,
) {
  const hoverPoints: Array<[number, number]> = [
    [0.14, 0.64],
    [0.16, 0.62],
    [0.12, 0.66],
  ];

  if (info.frame.isDetached()) {
    throw new Error('El frame con Inventory se encuentra desmontado');
  }

  await info.locator.scrollIntoViewIfNeeded().catch(() => {});

  for (const [fx, fy] of hoverPoints) {
    console.log(
      `[Inventory] Hover intento ${attempt} en coordenadas relativas (${fx.toFixed(2)}, ${fy.toFixed(2)}).`,
    );

    try {
      const box = await info.locator.boundingBox();
      if (box) {
        const px = Math.max(2, Math.round(box.width * fx));
        const py = Math.max(2, Math.round(box.height * fy));

        try {
          await info.locator.hover({ position: { x: px, y: py } });
          console.log(`[Inventory] Hover ejecutado via locator.hover en punto (${px}, ${py}).`);
        } catch (hoverError) {
          console.log(
            `[Inventory] locator.hover falló, intentando fallback mouse.move: ${
              (hoverError as Error).message ?? hoverError
            }`,
          );
          try {
            await page.mouse.move(box.x + px, box.y + py);
            console.log('[Inventory] page.mouse.move ejecutado como fallback.');
          } catch (mouseError) {
            console.log(
              `[Inventory] Fallback mouse.move también falló: ${
                (mouseError as Error).message ?? mouseError
              }`,
            );
          }
        }
      } else {
        await info.locator.hover();
        console.log('[Inventory] Hover ejecutado sin boundingBox.');
      }
    } catch (error) {
      console.log(`[Inventory] Error durante hover: ${(error as Error).message ?? error}`);
    }

    await page.waitForTimeout(50);
  }
}

async function findPurchaseOrdersCandidate(page: Page) {
  for (const frame of [page.mainFrame(), ...page.frames()]) {
    const loc = frame.locator('a, td').filter({ hasText: PO_TEXT_RX }).first();
    const count = await loc.count().catch(() => 0);
    if (!count) continue;

    const visible = await loc.isVisible({ timeout: 120 }).catch(() => false);
    if (!visible) continue;

    const info = await loc
      .evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        const anchor = (tag === 'a' ? el : el.closest('a')) as HTMLAnchorElement | null;
        const href = anchor
          ? anchor.getAttribute('href') || (anchor.href && anchor.href.trim() ? anchor.href : null)
          : null;
        return { tag, hasAnchor: !!anchor, href: href && href.trim() ? href : null };
      })
      .catch(() => null);

    if (!info) continue;

    return {
      frame,
      locator: loc,
      isLink: info.hasAnchor,
      href: info.href ?? undefined,
      tagName: info.tag,
    };
  }

  return null;
}

async function clickOrNavigate(
  page: Page,
  candidate: NonNullable<Awaited<ReturnType<typeof findPurchaseOrdersCandidate>>>,
) {
  console.log('[Inventory] Intentando click (trial) sobre el candidato.');
  try {
    await candidate.locator.click({ trial: true, timeout: 800 });
    console.log('[Inventory] Trial exitoso, ejecutando click real.');
    await candidate.locator.click({ timeout: 2_000 });
    await page.waitForTimeout(150);

    if (await hasPurchaseOrdersList(page, 1_500)) {
      console.log('[Inventory] "Order List" visible tras el click.');
      return true;
    }

    console.log('[Inventory] "Order List" no apareció en 1.5s después del click.');
  } catch (error) {
    console.log(`[Inventory] Error durante el click: ${(error as Error).message ?? error}`);
  }

  if (candidate.href) {
    console.log(`[Inventory] Probando navegación manual via href: ${candidate.href}`);
    try {
      await page.goto(candidate.href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(220);
      if (await hasPurchaseOrdersList(page, 2_000)) {
        console.log('[Inventory] "Order List" visible tras navegación manual.');
        return true;
      }
      console.log('[Inventory] "Order List" no apareció tras navegación manual.');
    } catch (error) {
      console.log(`[Inventory] Error durante navegación manual: ${(error as Error).message ?? error}`);
    }
  }

  return false;
}

async function openPurchaseOrders(page: Page) {
  console.log('[Inventory] Iniciando flujo robusto para abrir Purchase Orders.');
  const deadline = Date.now() + 24_000;
  let attempt = 0;
  let inventoryInfo: Awaited<ReturnType<typeof findInAnyFrame>> | null = null;

  while (Date.now() < deadline) {
    const attemptStart = Date.now();
    attempt++;
    const finishAttempt = async () => {
      const remaining = 250 - (Date.now() - attemptStart);
      if (remaining > 0) {
        await page.waitForTimeout(remaining);
      }
    };

    if (!inventoryInfo) {
      try {
        inventoryInfo = await findInAnyFrame(page, INVENTORY_CELL_ID, 1_500);
        console.log('[Inventory] Inventory localizado.');
      } catch (error) {
        console.log(
          `[Inventory] No se pudo localizar Inventory en intento ${attempt}: ${
            (error as Error).message ?? error
          }`,
        );
        await finishAttempt();
        continue;
      }
    }

    try {
      await hoverInventory(page, inventoryInfo, attempt);
    } catch (error) {
      console.log(`[Inventory] Hover falló, se reintentará: ${(error as Error).message ?? error}`);
      inventoryInfo = null;
      await finishAttempt();
      continue;
    }

    await page.waitForTimeout(80);

    const candidate = await findPurchaseOrdersCandidate(page);
    if (candidate) {
      await candidate.locator.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(80);
      const rawText = (await candidate.locator.innerText().catch(() => '')).trim();
      console.log(
        `[Inventory] Candidato "Purchase Orders" encontrado (${candidate.isLink ? 'link' : candidate.tagName}). Texto="${
          rawText.slice(0, 80) || '<sin texto>'
        }".`,
      );

      const success = await clickOrNavigate(page, candidate);
      if (success) {
        console.log('[Inventory] Validando "Order List" final.');
        return await waitForPurchaseOrdersList(page, 12_000);
      }
    }

    await finishAttempt();
  }

  throw new Error('No se pudo abrir Purchase Orders desde Inventory en 24s');
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
