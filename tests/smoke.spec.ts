import { test, expect } from "@playwright/test";
for (const locale of [
  {
    code: "en",
    name: "English",
    heading: "Welcome back",
    email: "Email address",
    password: "Password",
    submit: "Sign in",
  },
  {
    code: "mr",
    name: "मराठी",
    heading: "आपले स्वागत आहे",
    email: "ईमेल पत्ता",
    password: "पासवर्ड",
    submit: "लॉग इन करा",
  },
  {
    code: "hi",
    name: "हिन्दी",
    heading: "आपका स्वागत है",
    email: "ईमेल पता",
    password: "पासवर्ड",
    submit: "लॉग इन करें",
  },
]) {
  test(`${locale.name} mobile login is translated, usable and remembers choice`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: locale.name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: locale.heading }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale.code);
    await expect(page.getByLabel(locale.email, { exact: true })).toBeVisible();
    const password = page.getByLabel(locale.password, { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page
      .getByRole("button", { name: locale.submit, exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByRole("button", { name: locale.submit, exact: true })
        .evaluate((el) => el.getBoundingClientRect().bottom < innerHeight),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: locale.heading }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/restaurant-${locale.code}-mobile.png`,
      fullPage: true,
    });
  });
}
test("workspace actions, settings and errors translate without changing restaurant data", async ({
  page,
}) => {
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
  await page.route("**/v1/me", (route) =>
    route.fulfill({
      json: {
        userId: "11111111-1111-4111-8111-111111111111",
        platformAdmin: true,
        memberships: [
          {
            restaurant_id: "22222222-2222-4222-8222-222222222222",
            name: "Demo Restaurant",
            role: "OWNER",
            status: "TRIAL",
          },
        ],
      },
    }),
  );
  await page.route("**/v1/admin/restaurants", (route) =>
    route.fulfill({
      json: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Demo Restaurant",
          status: "TRIAL",
          slug: "demo-restaurant",
        },
      ],
    }),
  );
  await page.route("**/v1/restaurants/*/settings", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 403, json: { message: "Forbidden" } })
      : route.fulfill({
          json: {
            address: "Pune",
            qr_ordering_enabled: false,
            customer_bill_visible: false,
            waiter_all_tables: true,
          },
        }),
  );
  await page.goto("/");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "मराठी", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "आपली रेस्टॉरंट्स" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Demo Restaurant/ }).click();
  await page
    .getByRole("button", { name: "रेस्टॉरंटची सेटिंग्ज", exact: true })
    .click();
  await expect(page.getByLabel("रेस्टॉरंटचा पत्ता")).toHaveValue("Pune");
  await page.getByRole("button", { name: "बदल जतन करा" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "या कृतीची आपल्याला परवानगी नाही.",
  );
  await page.getByRole("button", { name: "हिन्दी", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "आपको इस काम की अनुमति नहीं है।",
  );
  await expect(page.getByLabel("रेस्तराँ का पता")).toHaveValue("Pune");
});

test("sign-in never submits a password in the URL when JavaScript is unavailable", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.route("**/", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 405,
            body: "JavaScript is required to sign in.",
          })
        : route.continue(),
    );
    await page
      .getByLabel("Email address", { exact: true })
      .fill("test@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("test-only-password");
    const submitted = page.waitForRequest((req) => req.method() === "POST");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const req = await submitted;
    expect(new URL(req.url()).search).toBe("");
    expect(req.postData()).toContain("password=");
  } finally {
    await context.close();
  }
});

test("platform admin stays English while restaurant language preference is retained", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("restaurant-language", "mr"),
  );
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
  await page.route("**/v1/me", (route) =>
    route.fulfill({
      json: {
        userId: "11111111-1111-4111-8111-111111111111",
        platformAdmin: true,
        memberships: [],
      },
    }),
  );
  await page.route("**/v1/admin/restaurants", (route) =>
    route.fulfill({
      json: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Demo Restaurant",
          status: "TRIAL",
          slug: "demo-restaurant",
        },
      ],
    }),
  );
  await page.goto("/admin");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Language / भाषा" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your restaurants" }),
  ).toBeVisible();
  await expect(
    page.getByText("+ Add a restaurant", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "मराठी", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("restaurant-language")),
  ).toBe("mr");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "आपले स्वागत आहे" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "मराठी", exact: true }),
  ).toBeVisible();
});

test("restaurant owner cannot enter the platform admin workspace", async ({
  page,
}) => {
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
  await page.route("**/auth/v1/logout*", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/v1/me", (route) =>
    route.fulfill({
      json: {
        userId: "11111111-1111-4111-8111-111111111111",
        platformAdmin: false,
        memberships: [],
      },
    }),
  );
  await page.goto("/admin");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "You do not have permission for this action.",
  );
  await expect(
    page.getByText("+ Add a restaurant", { exact: true }),
  ).toHaveCount(0);
});
