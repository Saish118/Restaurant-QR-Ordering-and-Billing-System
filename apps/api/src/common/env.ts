import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../../.env"), quiet: true });
import { z } from "zod";
export const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    WEB_ORIGIN: z.string().url(),
    PORT: z.coerce.number().default(3001),
    SENTRY_DSN: z.string().optional(),
  })
  .parse(process.env);
