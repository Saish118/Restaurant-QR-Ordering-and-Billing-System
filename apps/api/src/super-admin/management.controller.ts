import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import * as argon2 from "argon2";
import { AuthGuard, AuthRequest } from "../auth/auth.module";
import { Database, Transaction } from "../database/database.module";
import { parse, requireRole, uuid } from "../common/validation";
import { env } from "../common/env";
import { FEATURES, featureKeysValid } from "./features";
import { IdentityAdmin } from "./identity-admin";
const amount = z.number().int().min(0).max(100000000);
const date = z.iso.datetime({ offset: true }).nullable();
const profile = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .max(100)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    address: z.string().max(500),
    contactPhone: z.string().max(30),
    gstNumber: z.string().max(30),
    timeZone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  })
  .strict();
const subscriptionInput = z
  .object({
    plan: z.string().trim().min(1).max(60),
    setupAmountMinor: amount,
    recurringAmountMinor: amount,
    billingCycle: z.enum(["MONTHLY", "YEARLY"]),
    paymentStatus: z.enum(["PAID", "UNPAID"]),
    trialStartedAt: date,
    trialEndsAt: date,
    expiresAt: date,
  })
  .strict()
  .refine(
    (v) =>
      !v.trialStartedAt ||
      !v.trialEndsAt ||
      Date.parse(v.trialEndsAt) >= Date.parse(v.trialStartedAt),
    "Trial end must not precede its start",
  );
async function audit(
  tx: Transaction,
  tenant: string | null,
  actor: string,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  await tx.audit_logs.create({
    data: {
      restaurant_id: tenant,
      actor_id: actor,
      action,
      target_id: target,
      details: details as any,
    },
  });
}
@Controller("admin")
@UseGuards(AuthGuard)
export class ManagementController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(IdentityAdmin) private readonly identities: IdentityAdmin,
  ) {}
  private admin<T>(
    req: AuthRequest,
    id: string | undefined,
    work: (tx: Transaction) => Promise<T>,
  ) {
    return this.db.asUser(
      req.identity,
      id ? uuid(id) : undefined,
      async (tx, role) => {
        requireRole(role, ["SUPER_ADMIN"]);
        return work(tx);
      },
    );
  }
  @Get("overview") overview(@Req() req: AuthRequest) {
    return this.admin(req, undefined, async (tx) => {
      const [stats] = await tx.$queryRaw<
        Record<string, number | string>[]
      >`WITH accounts AS (SELECT r.*,CASE WHEN (r.status='TRIAL' AND s.trial_ends_at<=now()) OR (r.status='ACTIVE' AND s.expires_at<=now()) THEN 'EXPIRED' ELSE r.status::text END effective FROM restaurants r LEFT JOIN subscriptions s ON s.restaurant_id=r.id WHERE r.deleted_at IS NULL) SELECT count(*)::int AS total_restaurants,count(*) FILTER(WHERE effective='ACTIVE')::int AS active_restaurants,count(*) FILTER(WHERE effective='TRIAL')::int AS free_trials,count(*) FILTER(WHERE effective='EXPIRED')::int AS expired_accounts,count(*) FILTER(WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::int AS new_restaurants_this_month,(SELECT count(*)::int FROM orders) AS total_orders,(SELECT coalesce(sum(amount_minor),0)::text FROM subscription_receipts WHERE voided_at IS NULL AND paid_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AND paid_at<=now()) AS monthly_collections_minor FROM accounts`;
      return {
        stats,
        health: {
          api: "ok",
          database: "ok",
          uptimeSeconds: Math.floor(process.uptime()),
          auth: "configured_not_probed",
          storage: "not_configured",
          errorTracking: env.SENTRY_DSN
            ? "sentry_configured"
            : "local_sanitized_logs",
        },
        authManagementAvailable: this.identities.available,
        featureCatalog: FEATURES,
      };
    });
  }
  @Get("restaurants/:id/management") details(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.admin(req, id, async (tx) => {
      const restaurant = await tx.restaurants.findUnique({ where: { id } });
      const settings = await tx.restaurant_settings.findUnique({
        where: { restaurant_id: id },
      });
      const subscription = await tx.subscriptions.findUnique({
        where: { restaurant_id: id },
      });
      const owners =
        await tx.$queryRaw`SELECT m.user_id,m.active,u.display_name,u.email,EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=m.user_id AND p.active) AS platform_admin FROM restaurant_users m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=${id}::uuid AND m.role='OWNER' ORDER BY u.display_name`;
      const [usage] = await tx.$queryRaw<
        Record<string, number | string | null>[]
      >`SELECT (SELECT count(*)::int FROM tables WHERE restaurant_id=${id}::uuid) AS tables,(SELECT count(*)::int FROM staff WHERE restaurant_id=${id}::uuid) AS staff,(SELECT count(*)::int FROM orders WHERE restaurant_id=${id}::uuid AND created_at>=date_trunc('day',now() AT TIME ZONE ${settings?.time_zone ?? "Asia/Kolkata"}) AT TIME ZONE ${settings?.time_zone ?? "Asia/Kolkata"}) AS orders_today,(SELECT count(*)::int FROM orders WHERE restaurant_id=${id}::uuid AND created_at>=date_trunc('month',now() AT TIME ZONE ${settings?.time_zone ?? "Asia/Kolkata"}) AT TIME ZONE ${settings?.time_zone ?? "Asia/Kolkata"}) AS orders_month,(SELECT count(*)::int FROM bills WHERE restaurant_id=${id}::uuid AND finalized_at IS NOT NULL) AS bills_generated,(SELECT max(last_seen_at) FROM restaurant_activity WHERE restaurant_id=${id}::uuid) AS last_activity,(SELECT max(last_login_at) FROM restaurant_activity WHERE restaurant_id=${id}::uuid) AS last_login`;
      const receipts =
        await tx.$queryRaw`SELECT id,amount_minor,kind,paid_at,voided_at,void_reason FROM subscription_receipts WHERE restaurant_id=${id}::uuid ORDER BY paid_at DESC LIMIT 50`;
      const staff = await tx.staff.findMany({
        where: { restaurant_id: id },
        select: { id: true, name: true, role: true, active: true },
        take: 200,
      });
      const expiry =
        restaurant?.status === "TRIAL"
          ? subscription?.trial_ends_at
          : subscription?.expires_at;
      const effectiveStatus =
        restaurant &&
        ["TRIAL", "ACTIVE"].includes(restaurant.status) &&
        expiry &&
        expiry.getTime() <= Date.now()
          ? "EXPIRED"
          : restaurant?.status;
      return {
        restaurant,
        effectiveStatus,
        settings,
        subscription,
        owners,
        usage: {
          ...usage,
          storage_bytes: null,
          storage_status: "Not configured",
        },
        receipts,
        staff,
        featureCatalog: FEATURES,
        authManagementAvailable: this.identities.available,
      };
    });
  }
  @Patch("restaurants/:id/profile") updateProfile(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(profile, body);
    return this.admin(req, id, async (tx) => {
      await tx.restaurants.update({
        where: { id },
        data: { name: data.name, slug: data.slug },
      });
      await tx.restaurant_settings.update({
        where: { restaurant_id: id },
        data: {
          address: data.address,
          contact_phone: data.contactPhone,
          gst_number: data.gstNumber,
          time_zone: data.timeZone,
        },
      });
      await audit(tx, id, req.identity.id, "RESTAURANT_PROFILE_UPDATED", id);
      return { updated: true };
    });
  }
  @Post("restaurants/:id/archive") archive(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
      body,
    );
    return this.admin(req, id, async (tx) => {
      await tx.restaurants.update({
        where: { id },
        data: { deleted_at: new Date(), status: "CLOSED" },
      });
      await tx.restaurant_settings.update({
        where: { restaurant_id: id },
        data: { qr_ordering_enabled: false },
      });
      await tx.guest_capabilities.updateMany({
        where: { restaurant_id: id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await audit(tx, id, req.identity.id, "RESTAURANT_ARCHIVED", id, {
        reason: data.reason,
      });
      return { archived: true };
    });
  }
  @Post("restaurants/:id/restore") restore(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.admin(req, id, async (tx) => {
      await tx.restaurants.update({
        where: { id },
        data: { deleted_at: null, status: "SUSPENDED" },
      });
      await audit(tx, id, req.identity.id, "RESTAURANT_RESTORED", id);
      return { restored: true, status: "SUSPENDED" };
    });
  }
  @Patch("restaurants/:id/subscription") subscription(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(subscriptionInput, body);
    return this.admin(req, id, async (tx) => {
      await tx.subscriptions.upsert({
        where: { restaurant_id: id },
        create: {
          restaurant_id: id,
          plan: data.plan,
          setup_amount_minor: data.setupAmountMinor,
          recurring_amount_minor: data.recurringAmountMinor,
          billing_cycle: data.billingCycle,
          payment_status: data.paymentStatus,
          trial_started_at: data.trialStartedAt
            ? new Date(data.trialStartedAt)
            : null,
          trial_ends_at: data.trialEndsAt ? new Date(data.trialEndsAt) : null,
          expires_at: data.expiresAt ? new Date(data.expiresAt) : null,
        },
        update: {
          plan: data.plan,
          setup_amount_minor: data.setupAmountMinor,
          recurring_amount_minor: data.recurringAmountMinor,
          billing_cycle: data.billingCycle,
          payment_status: data.paymentStatus,
          trial_started_at: data.trialStartedAt
            ? new Date(data.trialStartedAt)
            : null,
          trial_ends_at: data.trialEndsAt ? new Date(data.trialEndsAt) : null,
          expires_at: data.expiresAt ? new Date(data.expiresAt) : null,
        },
      });
      await audit(tx, id, req.identity.id, "SUBSCRIPTION_UPDATED", id, {
        ...data,
      });
      return { updated: true };
    });
  }
  @Post("restaurants/:id/trial") trial(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          action: z.enum(["START", "END", "EXTEND"]),
          days: z.number().int().min(1).max(365).default(14),
        })
        .strict(),
      body,
    );
    return this.admin(req, id, async (tx) => {
      const restaurant = await tx.restaurants.findUnique({ where: { id } });
      if (restaurant?.deleted_at)
        throw new ConflictException("Restore the restaurant first");
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE restaurant_id=${id}::uuid FOR UPDATE`;
      const sub = await tx.subscriptions.findUnique({
        where: { restaurant_id: id },
      });
      if (!sub) throw new NotFoundException();
      const now = new Date();
      const end =
        data.action === "END"
          ? now
          : new Date(
              (data.action === "EXTEND"
                ? Math.max(now.getTime(), sub.trial_ends_at?.getTime() ?? 0)
                : now.getTime()) +
                data.days * 86400000,
            );
      await tx.subscriptions.update({
        where: { restaurant_id: id },
        data: {
          trial_started_at:
            data.action === "START" ? now : (sub.trial_started_at ?? now),
          trial_ends_at: end,
        },
      });
      if (data.action !== "END")
        await tx.restaurants.update({
          where: { id },
          data: { status: "TRIAL" },
        });
      else if (restaurant?.status === "TRIAL")
        await tx.restaurants.update({
          where: { id },
          data: { status: "EXPIRED" },
        });
      await audit(tx, id, req.identity.id, "TRIAL_" + data.action, id, {
        days: data.days,
        endsAt: end.toISOString(),
      });
      return { updated: true };
    });
  }
  @Post("restaurants/:id/receipts") receipt(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          amountMinor: amount.refine((v) => v > 0),
          kind: z.enum(["SETUP", "RECURRING"]),
          paidAt: z.iso.datetime({ offset: true }).optional(),
          idempotencyKey: z.uuid(),
        })
        .strict(),
      body,
    );
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          amount: data.amountMinor,
          kind: data.kind,
          paidAt: data.paidAt ?? null,
        }),
      )
      .digest("hex");
    return this.admin(req, id, async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE restaurant_id=${id}::uuid FOR UPDATE`;
      const existing = await tx.subscription_receipts.findUnique({
        where: {
          restaurant_id_idempotency_key: {
            restaurant_id: id,
            idempotency_key: data.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.request_hash !== hash)
          throw new ConflictException(
            "Payment key was reused with different data",
          );
        return { id: existing.id, recorded: true };
      }
      const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
      if (paidAt.getTime() > Date.now() + 60000)
        throw new BadRequestException("Payment date must not be in the future");
      const row = await tx.subscription_receipts.create({
        data: {
          restaurant_id: id,
          amount_minor: data.amountMinor,
          kind: data.kind,
          paid_at: paidAt,
          idempotency_key: data.idempotencyKey,
          request_hash: hash,
          recorded_by: req.identity.id,
        },
      });
      await tx.subscriptions.update({
        where: { restaurant_id: id },
        data: { payment_status: "PAID" },
      });
      await audit(
        tx,
        id,
        req.identity.id,
        "SUBSCRIPTION_PAYMENT_RECORDED",
        row.id,
        { amountMinor: data.amountMinor, kind: data.kind },
      );
      return { id: row.id, recorded: true };
    });
  }
  @Post("restaurants/:id/receipts/:receiptId/void") voidReceipt(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Param("receiptId") receiptId: string,
    @Body() body: unknown,
  ) {
    uuid(receiptId);
    const data = parse(
      z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
      body,
    );
    return this.admin(req, id, async (tx) => {
      const found = await tx.subscription_receipts.findFirst({
        where: { id: receiptId, restaurant_id: id },
      });
      if (!found) throw new NotFoundException();
      if (found.voided_at) return { voided: true };
      await tx.subscription_receipts.update({
        where: { id: receiptId },
        data: { voided_at: new Date(), void_reason: data.reason },
      });
      await audit(
        tx,
        id,
        req.identity.id,
        "SUBSCRIPTION_PAYMENT_VOIDED",
        receiptId,
        { reason: data.reason },
      );
      return { voided: true };
    });
  }
  @Patch("restaurants/:id/features") features(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          flags: z.record(z.string(), z.boolean()).refine(featureKeysValid),
        })
        .strict(),
      body,
    );
    return this.admin(req, id, async (tx) => {
      await tx.$queryRaw`SELECT restaurant_id FROM restaurant_settings WHERE restaurant_id=${id}::uuid FOR UPDATE`;
      const settings = await tx.restaurant_settings.findUnique({
        where: { restaurant_id: id },
      });
      if (!settings) throw new NotFoundException();
      await tx.restaurant_settings.update({
        where: { restaurant_id: id },
        data: {
          feature_flags: {
            ...(settings.feature_flags as Record<string, boolean>),
            ...data.flags,
          },
        },
      });
      await audit(tx, id, req.identity.id, "FEATURES_UPDATED", id, {
        flags: data.flags,
      });
      return { updated: true };
    });
  }
  @Get("audit") logs(
    @Req() req: AuthRequest,
    @Query("restaurantId") restaurantId?: string,
  ) {
    if (restaurantId) uuid(restaurantId);
    return this.admin(req, restaurantId, (tx) =>
      tx.audit_logs.findMany({
        where: restaurantId ? { restaurant_id: restaurantId } : {},
        orderBy: { created_at: "desc" },
        take: 100,
      }),
    );
  }
  @Get("errors") errors(@Req() req: AuthRequest) {
    return this.admin(req, undefined, (tx) =>
      tx.error_logs.findMany({ orderBy: { created_at: "desc" }, take: 100 }),
    );
  }
  @Post("restaurants/:id/owners/link") linkOwner(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          userId: z.uuid(),
          displayName: z.string().trim().min(1).max(120),
        })
        .strict(),
      body,
    );
    return this.admin(req, id, async (tx) => {
      await tx.users.upsert({
        where: { id: data.userId },
        create: { id: data.userId, display_name: data.displayName },
        update: {},
      });
      await tx.restaurant_users.upsert({
        where: {
          restaurant_id_user_id: { restaurant_id: id, user_id: data.userId },
        },
        create: { restaurant_id: id, user_id: data.userId, role: "OWNER" },
        update: { role: "OWNER", active: true },
      });
      await audit(tx, id, req.identity.id, "OWNER_LINKED", data.userId);
      return { linked: true };
    });
  }
  @Post("restaurants/:id/owners/login") async createOwner(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          email: z.email(),
          password: z.string().min(12).max(128),
          displayName: z.string().trim().min(1).max(120),
        })
        .strict(),
      body,
    );
    await this.admin(req, id, async () => true);
    const identity = await this.identities.create(
      data.email,
      data.password,
      data.displayName,
    );
    try {
      return await this.admin(req, id, async (tx) => {
        await tx.users.create({
          data: {
            id: identity.id,
            display_name: data.displayName,
            email: identity.email,
          },
        });
        await tx.restaurant_users.create({
          data: { restaurant_id: id, user_id: identity.id, role: "OWNER" },
        });
        await audit(
          tx,
          id,
          req.identity.id,
          "OWNER_LOGIN_CREATED",
          identity.id,
        );
        return { id: identity.id, email: identity.email };
      });
    } catch (error) {
      try {
        await this.identities.removeNewAccount(identity.id);
      } catch {
        await this.db.recordError(
          "OWNER_PROVISIONING_CLEANUP",
          "admin/owners/login",
          "operator-action",
        );
      }
      throw error;
    }
  }
  @Patch("restaurants/:id/owners/:userId/access") ownerAccess(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    uuid(userId);
    const data = parse(z.object({ active: z.boolean() }).strict(), body);
    return this.admin(req, id, async (tx) => {
      const member = await tx.restaurant_users.findFirst({
        where: { restaurant_id: id, user_id: userId, role: "OWNER" },
      });
      if (!member) throw new NotFoundException();
      await tx.restaurant_users.update({
        where: { id: member.id },
        data: { active: data.active },
      });
      await audit(tx, id, req.identity.id, "OWNER_ACCESS_UPDATED", userId, {
        active: data.active,
      });
      return { updated: true };
    });
  }
  @Post("restaurants/:id/owners/:userId/reset-password") async resetPassword(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    uuid(userId);
    const data = parse(
      z.object({ password: z.string().min(12).max(128) }).strict(),
      body,
    );
    await this.admin(req, id, async () => true);
    if (!this.identities.available)
      throw new (await import("@nestjs/common")).ServiceUnavailableException(
        "Configure the server-only Supabase secret key first",
      );
    await this.admin(req, id, async (tx) => {
      if (
        !(await tx.restaurant_users.findFirst({
          where: { restaurant_id: id, user_id: userId, role: "OWNER" },
        }))
      )
        throw new NotFoundException();
      if (
        await tx.platform_admins.findFirst({
          where: { user_id: userId, active: true },
        })
      )
        throw new ForbiddenException(
          "Platform administrator passwords cannot be reset from restaurant support",
        );
      await tx.users.update({
        where: { id: userId },
        data: {
          auth_not_before: new Date(Math.ceil(Date.now() / 1000) * 1000),
        },
      });
      await audit(
        tx,
        id,
        req.identity.id,
        "OWNER_PASSWORD_RESET_REQUESTED",
        userId,
      );
    });
    await this.identities.reset(userId, data.password);
    await this.admin(req, id, async (tx) => {
      await audit(
        tx,
        id,
        req.identity.id,
        "OWNER_PASSWORD_RESET_COMPLETED",
        userId,
      );
    });
    return { reset: true };
  }
  @Post("restaurants/:id/staff/:staffId/reset-pin") resetPin(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Param("staffId") staffId: string,
    @Body() body: unknown,
  ) {
    uuid(staffId);
    const data = parse(
      z.object({ pin: z.string().regex(/^\d{6,8}$/) }).strict(),
      body,
    );
    return this.admin(req, id, async (tx) => {
      const staff = await tx.staff.findFirst({
        where: { id: staffId, restaurant_id: id },
      });
      if (!staff) throw new NotFoundException();
      const hash = await argon2.hash(data.pin, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });
      await tx.staff.update({
        where: { id: staffId },
        data: {
          pin_hash: hash,
          session_version: { increment: 1 },
          failed_attempts: 0,
          locked_until: null,
        },
      });
      await tx.staff_sessions.updateMany({
        where: { restaurant_id: id, staff_id: staffId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await audit(tx, id, req.identity.id, "STAFF_PIN_RESET", staffId);
      return { reset: true };
    });
  }
  @Post("restaurants/:id/tables/:tableId/regenerate-qr") regenerate(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Param("tableId") tableId: string,
    @Body() body: unknown,
  ) {
    uuid(tableId);
    const data = parse(
      z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
      body,
    );
    return this.admin(req, id, async (tx) => {
      const settings = await tx.restaurant_settings.findUnique({
        where: { restaurant_id: id },
      });
      const restaurant = await tx.restaurants.findUnique({ where: { id } });
      const subscription = await tx.subscriptions.findUnique({
        where: { restaurant_id: id },
      });
      const expiry =
        restaurant?.status === "TRIAL"
          ? subscription?.trial_ends_at
          : subscription?.expires_at;
      if (
        !settings?.qr_ordering_enabled ||
        restaurant?.deleted_at ||
        !restaurant ||
        !["ACTIVE", "TRIAL"].includes(restaurant.status) ||
        (expiry && expiry.getTime() <= Date.now())
      )
        throw new ForbiddenException(
          "QR is disabled or the restaurant account has expired",
        );
      const table = await tx.tables.findFirst({
        where: { restaurant_id: id, id: tableId, active: true },
      });
      if (!table) throw new NotFoundException();
      await tx.tables.update({
        where: { id: tableId },
        data: { qr_reference: randomUUID() },
      });
      const sessions = await tx.dining_sessions.findMany({
        where: { restaurant_id: id, table_id: tableId },
        select: { id: true },
      });
      await tx.guest_capabilities.updateMany({
        where: {
          restaurant_id: id,
          dining_session_id: { in: sessions.map((s) => s.id) },
          revoked_at: null,
        },
        data: { revoked_at: new Date() },
      });
      await audit(tx, id, req.identity.id, "TABLE_QR_REGENERATED", tableId, {
        reason: data.reason,
      });
      return { regenerated: true };
    });
  }
}
