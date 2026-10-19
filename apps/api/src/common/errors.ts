import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { Database } from "../database/database.module";
import { FastifyReply } from "fastify";
import * as Sentry from "@sentry/node";
@Catch()
export class ApiErrors implements ExceptionFilter {
  constructor(private readonly database?: Database) {}
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (error instanceof HttpException) {
      reply.status(error.getStatus()).send(error.getResponse());
      return;
    }
    const code = (error as { code?: string }).code;
    const meta = (
      error as {
        meta?: {
          code?: string;
          driverAdapterError?: { cause?: { originalCode?: string } };
        };
      }
    ).meta;
    const dbCode = meta?.code ?? meta?.driverAdapterError?.cause?.originalCode;
    if (
      code === "P2002" ||
      code === "P2003" ||
      (code === "P2010" && ["23505", "23503", "23514"].includes(dbCode ?? ""))
    ) {
      reply
        .status(409)
        .send({ message: "Operation conflicts with existing data" });
      return;
    }
    Sentry.captureException(error);
    const request = host.switchToHttp().getRequest();
    void this.database
      ?.recordError(
        /^P[0-9]+$/.test(code ?? "") ? code! : "UNEXPECTED_ERROR",
        request.routeOptions?.url ?? "unknown",
        String(request.id ?? "unknown"),
      )
      .catch(() => {});
    reply.status(500).send({ message: "Unable to complete request" });
  }
}
