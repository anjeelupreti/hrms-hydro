"use client";

import { useEffect } from "react";

import { useMyTodayAttendance } from "@/hooks/useAttendance";

/**
 * Tells the server the clock is still running, while the tab is open.
 *
 * **This is "closing the tab clocks you out", built so it works.** Wiring the
 * clock-out directly to the tab closing is the right instinct — it ends the
 * session when somebody actually stops, which is what makes a late night come
 * out as a late night instead of being truncated to the office's closing time.
 *
 * The problem is that the browser cannot tell *closing* from *refreshing*.
 * Both fire `pagehide`; there is no flag that separates them. Clocking out on
 * that event means F5 clocks you out, and so does following a link to a
 * download, and so does a crash-and-restore.
 *
 * Recording presence has the same effect and none of that. Close the tab and
 * the beats simply stop, so the sweep ends the session at the last one — where
 * you actually left. Refresh and the next beat lands a second later, so nothing
 * happens at all. A flat battery, a force quit and a lost connection all behave
 * like closing, which is the honest reading of each of them.
 *
 * **A minute apart.** Fine enough that the recorded end is within a minute of
 * the real one, rare enough to be nothing on a server — one small write per
 * signed-in person per minute, and only for the people actually clocked in.
 *
 * **Nothing at all while the tab is hidden.** A backgrounded tab is not
 * somebody at work, and browsers throttle its timers anyway. The beat resumes
 * on return, which also means a laptop that slept over lunch records the lunch
 * honestly rather than counting it.
 */

const EVERY = 60_000;

export default function PresenceBeat() {
  const { data: today } = useMyTodayAttendance();
  const clockedIn = Boolean(today?.is_clocked_in);

  useEffect(() => {
    if (!clockedIn) return;

    let cancelled = false;

    async function beat() {
      // Hidden tabs are not people at work. Checked at send time rather than
      // at schedule time, so a tab hidden mid-interval does not get one more.
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        await fetch("/api/proxy/attendance/logs/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Not `keepalive`: this is a periodic write, not a parting shot, and
          // the whole point is that we do *not* need the last one to land.
          body: "{}",
        });
      } catch {
        // Deliberately silent. A missed beat costs at most a minute of
        // precision on a session end, and a toast about it would be noise
        // about something the person cannot act on.
      }
    }

    // One immediately, so a session that starts and ends inside a minute still
    // records where it got to.
    beat();
    const timer = setInterval(beat, EVERY);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [clockedIn]);

  return null;
}
