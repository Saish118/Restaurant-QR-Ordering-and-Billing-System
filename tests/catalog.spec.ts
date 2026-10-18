import { test, expect, type Page } from "@playwright/test";
const restaurantId = "22222222-2222-4222-8222-222222222222";
async function fixture(page: Page, admin = false) {
  let qrEnabled = false;
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
    if (path === "/admin/restaurants")
      return route.fulfill({ json: [restaurant] });
    if (path === `/admin/restaurants/${restaurantId}`) {
      qrEnabled = data.qrOrderingEnabled;
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
  await page.getByText("Platform controls", { exact: true }).click();
  await page
    .getByRole("button", { name: "Turn QR ordering on", exact: true })
    .click();
  await page.getByRole("button", { name: "Preview QR", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Table QR preview: Table 1" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Download QR" })).toBeVisible();
  await page
    .getByRole("button", { name: "Turn QR ordering off", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Preview QR" })).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Table QR preview: Table 1" }),
  ).toHaveCount(0);
});
