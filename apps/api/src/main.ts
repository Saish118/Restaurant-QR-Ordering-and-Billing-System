import * as Sentry from "@sentry/node";
import { env } from "./common/env";
import { createApp } from "./app";
if (env.SENTRY_DSN)
  Sentry.init({
    dsn: env.SENTRY_DSN,
    beforeSend(event) {
      delete event.user;
      delete event.request;
      return event;
    },
  });
createApp()
  .then((app) => app.listen(env.PORT, "0.0.0.0"))
  .catch((error) => {
    Sentry.captureException(error);
    console.error("API startup failed");
    process.exitCode = 1;
  });
