import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, AuthRequest } from "../auth/auth.module";
import { Database } from "../database/database.module";
import { parse, requireRole, uuid } from "../common/validation";
@Controller()
@UseGuards(AuthGuard)
export class RestaurantsController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get("me") me(@Req() req: AuthRequest) {
    return this.db.asUser(req.identity, undefined, async (tx, role) => ({
      userId: req.identity.id,
      platformAdmin: role === "SUPER_ADMIN",
      memberships:
        await tx.$queryRaw`SELECT m.restaurant_id,m.role,r.name,r.status FROM restaurant_users m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.user_id=${req.identity.id}::uuid AND m.active`,
    }));
  }
  @Get("restaurants/:id") restaurant(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.db.asUser(req.identity, uuid(id), async (tx) => {
      const [row] = await tx.$queryRaw<
        unknown[]
      >`SELECT id,name,slug,status FROM restaurants WHERE id=${id}::uuid`;
      return row;
    });
  }
  @Get("restaurants/:id/settings") settings(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      const [row] = await tx.$queryRaw<
        unknown[]
      >`SELECT restaurant_id,qr_ordering_enabled,currency,address,logo_path,gst_number,waiter_all_tables,customer_bill_visible FROM restaurant_settings WHERE restaurant_id=${id}::uuid`;
      return row;
    });
  }
  @Patch("restaurants/:id/settings") update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const data = parse(
      z
        .object({
          address: z.string().max(500),
          customerBillVisible: z.boolean(),
          waiterAllTables: z.boolean(),
        })
        .strict(),
      body,
    );
    return this.db.asUser(req.identity, uuid(id), async (tx, role) => {
      requireRole(role, ["OWNER", "SUPER_ADMIN"]);
      await tx.$executeRaw`UPDATE restaurant_settings SET address=${data.address},customer_bill_visible=${data.customerBillVisible},waiter_all_tables=${data.waiterAllTables} WHERE restaurant_id=${id}::uuid`;
      await tx.$executeRaw`INSERT INTO audit_logs(restaurant_id,actor_id,action,target_id) VALUES(${id}::uuid,${req.identity.id}::uuid,'RESTAURANT_SETTINGS_UPDATED',${id}::uuid)`;
      return { updated: true };
    });
  }
}
@Module({ controllers: [RestaurantsController] })
export class RestaurantsModule {}
