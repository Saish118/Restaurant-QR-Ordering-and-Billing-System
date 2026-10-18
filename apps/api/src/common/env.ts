import "dotenv/config";
import { z } from "zod";
export const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    WEB_ORIGIN: z.string().url(),
    PORT: z.coerce.number().default(3001),
    SENTRY_DSN: z.string().optional(),
  })
  .parse(process.env);
