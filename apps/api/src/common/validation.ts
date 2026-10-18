import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { z } from "zod";
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
export function uuid(value: string) {
  return parse(z.uuid(), value);
}
export function requireRole(role: string, allowed: string[]) {
  if (!allowed.includes(role))
    throw new ForbiddenException("Action not permitted");
}
