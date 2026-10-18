import {
  Body,
  Controller,
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
import { AuthGuard, AuthRequest } from "../auth/auth.module";
import { Database, Transaction } from "../database/database.module";
import { parse, requireRole, uuid } from "../common/validation";
const categoryInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    sortOrder: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
const itemInput = z
  .object({
    categoryId: z.uuid(),
    name: z.string().trim().min(1).max(160),
    priceMinor: z.number().int().min(0).max(100000000),
    taxBps: z.number().int().min(0).max(10000).optional(),
    available: z.boolean().optional(),
    vegetarian: z.boolean().optional(),
    special: z.boolean().optional(),
  })
  .strict();
const itemPatch = itemInput.partial().refine((v) => Object.keys(v).length > 0);
async function audit(
  tx: Transaction,
  restaurantId: string,
  actorId: string,
  action: string,
  targetId: string,
) {
  await tx.audit_logs.create({
    data: {
      restaurant_id: restaurantId,
      actor_id: actorId,
      action,
      target_id: targetId,
    },
  });
}
@Controller("restaurants/:restaurantId/menu")
@UseGuards(AuthGuard)
export class MenuController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get("categories") categories(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
  ) {
    return this.db.asUser(req.identity, uuid(id), async (tx) =>
      tx.menu_categories.findMany({
        where: { restaurant_id: id },
        orderBy: [{ sort_order: "asc" }, { name: "asc" }, { id: "asc" }],
        take: 200,
      }),
    );
  }
  @Post("categories") createCategory(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(categoryInput, body);
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      const row = await tx.menu_categories.create({
        data: {
          restaurant_id: id,
          name: data.name,
          sort_order: data.sortOrder,
        },
      });
      await audit(tx, id, req.identity.id, "MENU_CATEGORY_CREATED", row.id);
      return row;
    });
  }
  @Patch("categories/:categoryId") updateCategory(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
    @Param("categoryId") categoryId: string,
    @Body() body: unknown,
  ) {
    const data = parse(categoryInput, body);
    uuid(categoryId);
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      const result = await tx.menu_categories.updateMany({
        where: { id: categoryId, restaurant_id: id },
        data: { name: data.name, sort_order: data.sortOrder },
      });
      if (!result.count) throw new NotFoundException();
      await audit(tx, id, req.identity.id, "MENU_CATEGORY_UPDATED", categoryId);
      return { updated: true };
    });
  }
  @Get("items") items(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
  ) {
    return this.db.asUser(req.identity, uuid(id), async (tx) =>
      tx.menu_items.findMany({
        where: { restaurant_id: id },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 1000,
      }),
    );
  }
  @Post("items") createItem(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(itemInput, body);
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      if (
        !(await tx.menu_categories.findFirst({
          where: { id: data.categoryId, restaurant_id: id },
        }))
      )
        throw new NotFoundException();
      const row = await tx.menu_items.create({
        data: {
          restaurant_id: id,
          category_id: data.categoryId,
          name: data.name,
          price_minor: data.priceMinor,
          tax_bps: data.taxBps ?? 0,
          available: data.available ?? true,
          vegetarian: data.vegetarian ?? true,
          special: data.special ?? false,
        },
      });
      await audit(tx, id, req.identity.id, "MENU_ITEM_CREATED", row.id);
      return row;
    });
  }
  @Patch("items/:itemId") updateItem(
    @Req() req: AuthRequest,
    @Param("restaurantId") id: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    const data = parse(itemPatch, body);
    uuid(itemId);
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      if (
        data.categoryId &&
        !(await tx.menu_categories.findFirst({
          where: { id: data.categoryId, restaurant_id: id },
        }))
      )
        throw new NotFoundException();
      const result = await tx.menu_items.updateMany({
        where: { id: itemId, restaurant_id: id },
        data: {
          category_id: data.categoryId,
          name: data.name,
          price_minor: data.priceMinor,
          tax_bps: data.taxBps,
          available: data.available,
          vegetarian: data.vegetarian,
          special: data.special,
        },
      });
      if (!result.count) throw new NotFoundException();
      await audit(tx, id, req.identity.id, "MENU_ITEM_UPDATED", itemId);
      return { updated: true };
    });
  }
}
@Module({ controllers: [MenuController] })
export class MenuModule {}
