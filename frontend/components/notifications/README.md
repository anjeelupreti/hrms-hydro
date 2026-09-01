# Notifications UI

- `NotificationBell.tsx` — lives in the floating nav shell. Badge shows
  `useUnreadCount` (polled every 30s); dropdown previews the 5 most
  recent, links to `/notifications` (full feed) and
  `/settings/notifications`.
- `app/notifications/page.tsx` — full paginated feed, "mark all read".
- `app/settings/notifications/page.tsx` — email/in-app/push toggles.
  Toggling push doesn't just PATCH a flag — it calls
  `usePushSubscription().subscribe()`/`unsubscribe()`, which drives the
  actual browser permission prompt + `PushManager` subscription; the
  backend flips `push_enabled` automatically as a side effect of
  subscribing/unsubscribing, so the toggle and the real subscription
  state can't drift apart.
- `hooks/usePushSubscription.ts` — registers `public/sw.js`, requests
  `Notification.requestPermission()`, subscribes with the VAPID public
  key fetched from the backend, and POSTs the subscription to
  `push-subscribe`. `public/sw.js` itself is a minimal, dependency-free
  service worker (no Workbox) — this app isn't offline-first, push
  delivery is its only job.
- `app/settings/holidays/page.tsx` — HR-managed list + add/delete
  (`hooks/useHolidays.ts`). Read-only for everyone else.

See `backend/notifications/README.md` for the server side (VAPID key
generation, the birthday/anniversary/holiday Celery Beat reminders, and
why birthdays notify the employee + their manager while holidays
broadcast to everyone).

Data hooks: `hooks/useNotifications.ts`, `hooks/usePushSubscription.ts`,
`hooks/useHolidays.ts`. Types: `types/notifications.ts`, `types/holidays.ts`.
