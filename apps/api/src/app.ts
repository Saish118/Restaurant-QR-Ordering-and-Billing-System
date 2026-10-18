import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { RestaurantsModule } from "./restaurants/restaurants.module";
import { SuperAdminModule } from "./super-admin/super-admin.module";
import { env } from "./common/env";
import { ApiErrors } from "./common/errors";
@Controller("health")
class HealthController {
  @Get() health() {
    return { status: "ok" };
  }
}
@Module({
  imports: [DatabaseModule, AuthModule, RestaurantsModule, SuperAdminModule],
  controllers: [HealthController],
})
export class AppModule {}
export async function createApp() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 65536,
      logger: {
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
        ],
      },
    }),
  );
  await app.register(helmet);
  app.enableCors({
    origin: env.WEB_ORIGIN,
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.useGlobalFilters(new ApiErrors());
  app.setGlobalPrefix("v1");
  app.enableShutdownHooks();
  return app;
}
