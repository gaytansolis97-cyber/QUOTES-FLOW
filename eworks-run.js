import { test, expect, Page } from '@playwright/test';

test.setTimeout(120_000);

const URL = 'https://fariabrothers.eworkorders.com/default.asp';
const USER = 'GUADALUPEG';
const PASS = 'GAYTAN909959';

// ⬅️ si algún día cambia ese id, cámbialo aquí
const INVENTORY_CELL_ID = '#dm0m0i7tdT';

async function openInventoryMenu(page: Page) {
  // 1) localiza el <td id="dm0m0i7tdT">Inventory</td>
  const inv = page.locator(INVENTORY_CELL_ID).first();

  // asegúrate de que exista en el DOM
  await inv.waitFor({ state: 'visible', timeout: 15_000 });

  // 2) varias tácticas de hover por si el sitio sólo abre el menú con puntero encima
  // 2.a) scroll y hover normal
  await inv.scrollIntoViewIfNeeded().catch(() => {});
  await inv.hover({ force: true }).catch(() => {});

  // 2.b) mueve el ratón al centro del elemento (algunas UIs escuchan 'mousemove')
  const box = await inv.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // pequeño “temblor” para disparar onmouseover antiguos
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2);
  }

  // 2.c) inyecta un mouseover por si el sitio usa handlers inline
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const ev = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  }, INVENTORY_CELL_ID);

  // breve espera a que se pinte el submenú
  await page.waitForTimeout(300);
}

test('crear orden en eWorkOrders (abrir Inventory > Purchase Orders > Add)', async ({ page }) => {
  // ===== 1) Login =====
  await page.goto(URL);
  await page.getByRole('textbox', { name: 'USER ID' }).fill(USER);
  await page.getByRole('textbox', { name: 'PASSWORD' }).fill(PASS);
  await page.getByRole('button', { name: 'Login' }).click();

  // La barra superior a veces tarda un poco en aparecer con estilo
  await expect(page.locator('text=Welcome to eWorkOrders')).toBeVisible({ timeout: 30_000 }).catch(() => {});

  // ===== 2) Abrir menú Inventory (fuera de iframe) =====
  // uno o dos reintentos por si la primera no “engancha” el hover
  await openInventoryMenu(page);
  await page.waitForTimeout(200);
  await openInventoryMenu(page);

  // ===== 3) Click en "Purchase Orders" del menú desplegado =====
  // (usamos ancla por texto; si tu menú muestra otra etiqueta, cámbiala)
  const poLink = page.locator('a:has-text("Purchase Orders")').first();
  await poLink.waitFor({ state: 'visible', timeout: 10_000 });
  await poLink.click({ trial: true }).catch(() => {});
  await poLink.click({ force: true });

  // ===== 4) Esperar el iframe de eWorkOrders y pulsar "Add" =====
  const ew = page.frameLocator('iframe[name="_ew"]'); // nombre típico del iframe
  await ew.locator('text=Order List').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  // Si no hay “Order List”, esperamos directamente la barra de acciones
  const addBtn = ew.getByRole('link', { name: 'Add', exact: true });
  await addBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await addBtn.click();

  // A partir de aquí ya estás en la pantalla de creación de PO.
  // Puedes seguir con selects/campos como lo tenías grabado.
});
