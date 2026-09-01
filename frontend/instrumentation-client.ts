// Client-side telemetry init. Next 16 runs this automatically on the client
// with no next.config wrapping — deliberately using @sentry/browser (not
// @sentry/nextjs) so nothing touches this project's customized build config.
//
// A no-op until NEXT_PUBLIC_SENTRY_DSN is set, so dev is unaffected. Server
// errors are captured separately by the Django Sentry integration (which
// also tags the tenant schema).
import * as Sentry from "@sentry/browser";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    // Never ship URLs/inputs that could carry tenant PII by default.
    sendDefaultPii: false,
  });
}

// Next 16 calls this on route changes; harmless when Sentry is disabled.
export function onRouterTransitionStart() {}
