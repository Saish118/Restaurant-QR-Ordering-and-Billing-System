import { test, expect, type Page } from "@playwright/test";
const restaurantId = "22222222-2222-4222-8222-222222222222";
async function fixture(page: Page, admin = false) {
  let qrEnabled = false;
  let receipts: any[] = [];
  let subscription: any = {
    plan: "pilot",
    setup_amount_minor: 0,
    recurring_amount_minor: 0,
    billing_cycle: "MONTHLY",
    payment_status: "UNPAID",
  };
  let ownerActive = true;
  let categories: any[] = [];
  let dishes: any[] = [];
  let tables: any[] = admin
    ? [{ id: "table-id", label: "Table 1", active: true }]
    : [];
  await page.route("**/auth/v1/token?*", (route) =>
    route.fulfill({
      json: {
        access_token: "test-token",
        refresh_token: "test-refresh",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          aud: "authenticated",
          email: "test@example.com",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      },
    }),
  );
  await page.route("http://localhost:3001/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/v1", ""),
      method = route.request().method(),
      data = method === "GET" ? null : route.request().postDataJSON();
    const restaurant = {
      id: restaurantId,
      name: "Demo Restaurant",
      slug: "demo-restaurant",
      status: "TRIAL",
    };
    if (path === "/me")
      return route.fulfill({
        json: {
          userId: "11111111-1111-4111-8111-111111111111",
          platformAdmin: admin,
          memberships: [
            {
              restaurant_id: restaurantId,
              name: "Demo Restaurant",
              role: "OWNER",
              status: "TRIAL",
            },
          ],
        },
      });
    if (path === "/admin/overview")
      return route.fulfill({
        json: {
          stats: { total_restaurants: 1, monthly_collections_minor: "0" },
          health: { api: "ok", database: "ok", storage: "not_configured" },
          authManagementAvailable: false,
        },
      });
    if (path.endsWith("/management"))
      return route.fulfill({
        json: {
          restaurant,
          settings: {
            qr_ordering_enabled: qrEnabled,
            address: "Pune",
            feature_flags: {},
          },
          subscription,
          owners: [
            {
              user_id: "owner-id",
              display_name: "Owner",
              email: "owner@example.com",
              active: ownerActive,
              platform_admin: false,
            },
          ],
          receipts,
          staff: [],
          usage: { tables: 1, storage_bytes: null },
          featureCatalog: [],
          authManagementAvailable: false,
        },
      });
    if (path === "/admin/restaurants")
      return route.fulfill({ json: [restaurant] });
    if (path === `/admin/restaurants/${restaurantId}`) {
      qrEnabled = data.qrOrderingEnabled;
      return route.fulfill({ json: { updated: true } });
    }
    if (path.endsWith("/subscription")) {
      subscription = {
        ...subscription,
        plan: data.plan,
        setup_amount_minor: data.setupAmountMinor,
        recurring_amount_minor: data.recurringAmountMinor,
        billing_cycle: data.billingCycle,
        payment_status: data.paymentStatus,
      };
      return route.fulfill({ json: { updated: true } });
    }
    if (path.endsWith("/receipts")) {
      receipts.push({
        id: "receipt-1",
        amount_minor: data.amountMinor,
        kind: data.kind,
        paid_at: new Date().toISOString(),
        voided_at: null,
      });
      return route.fulfill({ status: 201, json: { id: "receipt-1" } });
    }
    if (path.endsWith("/access")) {
      ownerActive = data.active;
      return route.fulfill({ json: { updated: true } });
    }
    if (path.endsWith("/qr")) {
      if (!admin || !qrEnabled) return route.fulfill({ status: 403, json: {} });
      return route.fulfill({
        json: {
          label: "Table 1",
          url: "http://localhost:3000/qr/test",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        },
      });
    }
    if (path.endsWith("/settings"))
      return route.fulfill({
        json: {
          address: "Pune",
          qr_ordering_enabled: qrEnabled,
          customer_bill_visible: false,
          waiter_all_tables: true,
        },
      });
    if (path.endsWith("/menu/categories")) {
      if (method === "POST") {
        const row = { id: "category-1", name: data.name, sort_order: 0 };
        categories.push(row);
        return route.fulfill({ status: 201, json: row });
      }
      return route.fulfill({ json: categories });
    }
    if (path.endsWith("/menu/items")) {
      if (method === "POST") {
        const row = {
          id: "dish-1",
          category_id: data.categoryId,
          name: data.name,
          price_minor: data.priceMinor,
          available: data.available,
          vegetarian: data.vegetarian,
          special: data.special,
        };
        dishes.push(row);
        return route.fulfill({ status: 201, json: row });
      }
      return route.fulfill({ json: dishes });
    }
    if (path.includes("/menu/items/")) {
      const row = dishes[0];
      if (data.available !== undefined) row.available = data.available;
      if (data.priceMinor !== undefined) row.price_minor = data.priceMinor;
      return route.fulfill({ json: { updated: true } });
    }
    if (path.endsWith("/tables")) {
      if (method === "POST") {
        const row = { id: "table-1", label: data.label, active: true };
        tables.push(row);
        return route.fulfill({ status: 201, json: row });
      }
      return route.fulfill({ json: tables });
    }
    if (path.includes("/tables/")) {
      tables[0].active = data.active;
      return route.fulfill({ json: { updated: true } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(admin ? "/admin" : "/");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /Demo Restaurant/ }).click();
  return { dishes: () => dishes };
}
test("billing-only owner can manage menu and physical tables but has no QR controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const data = await fixture(page);
  await page.getByLabel("Category name", { exact: true }).fill("Main course");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit category: Main course" }),
  ).toBeVisible();
  await page.getByLabel("Dish name", { exact: true }).fill("Paneer");
  await page.getByLabel("Category", { exact: true }).selectOption("category-1");
  await page.getByLabel("Price (₹)", { exact: true }).fill("125.50");
  await page.getByRole("button", { name: "Add dish", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Paneer", exact: true }),
  ).toBeVisible();
  expect(data.dishes()[0].price_minor).toBe(12550);
  await page.getByRole("button", { name: "Available", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unavailable", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/restaurant-menu-management.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByLabel("Table name or number").fill("Table 1");
  await page.getByRole("button", { name: "Add table", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Table 1 · On" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview QR" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Restaurant settings", exact: true })
    .click();
  await expect(page.getByText("Billing only", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Customers can see their running bill",
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Platform controls", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Turn QR ordering on" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "मराठी", exact: true }).click();
  await expect(page.getByText("फक्त बिलिंग", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "QR सुविधा मुख्य प्रशासक ठरवतात. ती सुरू करण्यासाठी त्यांच्याशी संपर्क साधा.",
    ),
  ).toBeVisible();
});
test("only main admin can enable QR and generate table code previews", async ({
  page,
}) => {
  await fixture(page, true);
  await expect(page.getByRole("button", { name: "Preview QR" })).toHaveCount(0);
  await page.getByLabel("QR ordering enabled", { exact: true }).check();
  await page.getByRole("button", { name: "Save access", exact: true }).click();
  await expect(
    page.getByText("TRIAL · QR mode", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Support", exact: true }).click();
  await page.getByRole("button", { name: "Preview QR", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Table QR setup preview" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/restaurant-admin-support.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByLabel("QR ordering enabled", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save access", exact: true }).click();
  await expect(
    page.getByText("TRIAL · Billing-only mode", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Support", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview QR", exact: true }),
  ).toBeDisabled();
});

test("admin subscription amounts, manual receipts, owner access and mobile layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, true);
  await page.getByRole("button", { name: "Subscription", exact: true }).click();
  await page.getByLabel("Setup amount (₹)", { exact: true }).fill("499.50");
  await page.getByLabel("Recurring amount (₹)", { exact: true }).fill("999");
  await page
    .getByLabel("Billing cycle", { exact: true })
    .selectOption("YEARLY");
  await page
    .getByRole("button", { name: "Save subscription", exact: true })
    .click();
  await expect(
    page.getByLabel("Setup amount (₹)", { exact: true }),
  ).toHaveValue("499.50");
  await expect(
    page.getByLabel("Recurring amount (₹)", { exact: true }),
  ).toHaveValue("999.00");
  await page.getByLabel("Amount received (₹)", { exact: true }).fill("999");
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByText(/₹999.00 · RECURRING/)).toBeVisible();
  await page.getByRole("button", { name: "Owners", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create login", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Disable restaurant access", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable restaurant access", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/restaurant-admin-mobile.png",
    fullPage: true,
  });
});
