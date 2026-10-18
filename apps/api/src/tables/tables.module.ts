import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import QRCode from "qrcode";
import { AuthGuard, AuthRequest } from "../auth/auth.module";
import { Database } from "../database/database.module";
import { parse, requireRole, uuid } from "../common/validation";
import { env } from "../common/env";
const tableInput = z
  .object({ label: z.string().trim().min(1).max(60) })
  .strict();
const tablePatch = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
@Controller()
@UseGuards(AuthGuard)
export class TablesController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get("restaurants/:restaurantId/tables") list(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
  ) {
    return this.db.asUser(req.identity, uuid(id), async (tx) =>
      tx.tables.findMany({
        where: { restaurant_id: id },
        select: { id: true, label: true, active: true, restaurant_id: true },
        orderBy: [{ label: "asc" }, { id: "asc" }],
        take: 500,
      }),
    );
  }
  @Post("restaurants/:restaurantId/tables") create(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(tableInput, body);
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      const row = await tx.tables.create({
        data: { restaurant_id: id, label: data.label },
        select: { id: true, label: true, active: true, restaurant_id: true },
      });
      await tx.audit_logs.create({
        data: {
          restaurant_id: id,
          actor_id: req.identity.id,
          action: "TABLE_CREATED",
          target_id: row.id,
        },
      });
      return row;
    });
  }
  @Patch("restaurants/:restaurantId/tables/:tableId") update(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
    @Param("tableId") tableId: string,
    @Body() body: unknown,
  ) {
    const data = parse(tablePatch, body);
    uuid(tableId);
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM tables WHERE restaurant_id=${id}::uuid AND id=${tableId}::uuid FOR UPDATE`;
      if (!rows.length) throw new NotFoundException();
      if (
        data.active === false &&
        (await tx.dining_sessions.findFirst({
          where: {
            restaurant_id: id,
            table_id: tableId,
            status: { in: ["OPEN", "BILLING"] },
          },
        }))
      )
        throw new ConflictException("Table has an active visit");
      await tx.tables.updateMany({
        where: { restaurant_id: id, id: tableId },
        data,
      });
      await tx.audit_logs.create({
        data: {
          restaurant_id: id,
          actor_id: req.identity.id,
          action: "TABLE_UPDATED",
          target_id: tableId,
        },
      });
      return { updated: true };
    });
  }
  @Get("admin/restaurants/:restaurantId/tables/:tableId/qr") async qr(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
    @Param("tableId") tableId: string,
  ) {
    uuid(tableId);
    const result = await this.db.asUser(
      req.identity,
      uuid(id),
      async (tx, role) => {
        requireRole(role, ["SUPER_ADMIN"]);
        const settings = await tx.restaurant_settings.findUnique({
          where: { restaurant_id: id },
        });
        const restaurant = await tx.restaurants.findUnique({ where: { id } });
        if (
          !settings?.qr_ordering_enabled ||
          !restaurant ||
          !["ACTIVE", "TRIAL"].includes(restaurant.status)
        )
          throw new ForbiddenException(
            "QR access is not enabled for this restaurant",
          );
        const table = await tx.tables.findFirst({
          where: { restaurant_id: id, id: tableId, active: true },
        });
        if (!table) throw new NotFoundException();
        await tx.audit_logs.create({
          data: {
            restaurant_id: id,
            actor_id: req.identity.id,
            action: "TABLE_QR_GENERATED",
            target_id: tableId,
          },
        });
        return {
          label: table.label,
          url: new URL(`/qr/${table.qr_reference}`, env.WEB_ORIGIN).toString(),
        };
      },
    );
    return {
      ...result,
      svg: await QRCode.toString(result.url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 4,
        width: 256,
      }),
    };
  }
}
@Module({ controllers: [TablesController] })
export class TablesModule {}
