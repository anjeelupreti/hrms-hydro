"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function usePushSubscription() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subscribe = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Push notifications aren't supported in this browser.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was denied.");
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const keyResponse = await fetch("/api/proxy/notifications/vapid-public-key");
      const { key } = await keyResponse.json();

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });

      await fetch("/api/proxy/notifications/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't enable push notifications.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, [queryClient]);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/proxy/notifications/push-unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    } finally {
      setBusy(false);
    }
  }, [queryClient]);

  return { subscribe, unsubscribe, busy, error };
}
