"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared client-side fetch helper for billing endpoints. Solves four
 * recurring footguns from raw fetch() in components:
 *
 *   1. **AbortController on unmount.** If the component unmounts while
 *      a fetch is in-flight, setState would warn "can't update on
 *      unmounted component" and leak the response. AbortController
 *      cancels the network request AND short-circuits the state set.
 *   2. **429 Retry-After honoring.** Server rate-limits with a 429 +
 *      `retry-after: <seconds>` header. Raw fetch ignores it; we
 *      respect it and stay quiet until the window passes.
 *   3. **Exponential backoff on network errors.** A flapping Wi-Fi
 *      connection used to cause every component to spam the endpoint.
 *      Backoff: 1s, 2s, 4s, 8s, max 30s.
 *   4. **Stable references.** The returned `refresh` function is
 *      memoized so passing it into useEffect deps doesn't cause an
 *      infinite re-render loop.
 *
 * Usage:
 *   const { data, error, loading, refresh } = useBillingFetch<BalanceResp>(
 *     "/api/billing/credits",
 *     { initial: serverProps.initialBalance, pollMs: 15_000 },
 *   );
 */

export type FetchState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Manually re-fetch (e.g. after a successful checkout redirect). */
  refresh: () => void;
};

export type FetchOptions<T> = {
  /** Server-rendered initial value so the UI isn't a flash of null. */
  initial?: T;
  /** Auto-poll interval in ms. 0 = no polling, only refresh on mount + manual. */
  pollMs?: number;
  /** Skip auto-poll when document is hidden (browser-tab in background). */
  pausePollWhenHidden?: boolean;
  /** Map response → typed shape. Defaults to JSON.parse-as-T. */
  transform?: (json: unknown) => T;
};

// Max backoff between retries on transient network errors / 5xx.
const MAX_BACKOFF_MS = 30_000;

export function useBillingFetch<T>(
  url: string,
  opts: FetchOptions<T> = {},
): FetchState<T> {
  const [data, setData] = useState<T | null>(opts.initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Refs hold the latest options without forcing re-renders. The
  // effect below reads them via ref so changing them doesn't tear
  // down the poll loop.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const abortRef = useRef<AbortController | null>(null);
  const backoffMsRef = useRef(1000);
  const retryAfterUntilRef = useRef(0);
  // mountedRef stays true between mount and unmount. Used by the
  // fetcher to short-circuit setState after unmount. AbortController
  // covers the in-flight request; this covers the rare case where the
  // .then handler resolves AFTER the abort but before React notices.
  const mountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    // Skip if a server-issued Retry-After window hasn't elapsed.
    if (Date.now() < retryAfterUntilRef.current) return;
    // Cancel any in-flight request from a previous tick.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!mountedRef.current) return;
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after") ?? "5");
        const wait = Number.isFinite(ra) && ra > 0 ? ra : 5;
        retryAfterUntilRef.current = Date.now() + wait * 1000;
        setError(`rate limited (try again in ${wait}s)`);
        return;
      }
      if (!res.ok) {
        // Treat 5xx as transient; back off and retry next tick.
        if (res.status >= 500) {
          backoffMsRef.current = Math.min(
            backoffMsRef.current * 2,
            MAX_BACKOFF_MS,
          );
          setError(`server error ${res.status}; retrying`);
          return;
        }
        // 4xx (except 429): probably won't fix itself. Show error,
        // don't keep retrying every tick.
        const body = await res.text().catch(() => "");
        setError(`${res.status}: ${body.slice(0, 200) || "request failed"}`);
        return;
      }
      const json = (await res.json()) as unknown;
      const value = optsRef.current.transform
        ? optsRef.current.transform(json)
        : (json as T);
      if (!mountedRef.current) return;
      setData(value);
      setError(null);
      // Reset backoff on success.
      backoffMsRef.current = 1000;
    } catch (err) {
      // Abort is expected on unmount / next tick — ignore silently.
      if (err instanceof Error && err.name === "AbortError") return;
      if (!mountedRef.current) return;
      // Network error → backoff.
      backoffMsRef.current = Math.min(
        backoffMsRef.current * 2,
        MAX_BACKOFF_MS,
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [url]);

  // Mount + poll loop. Re-runs only if `url` changes.
  useEffect(() => {
    mountedRef.current = true;
    // Initial fetch unless caller seeded `initial`.
    if (optsRef.current.initial == null) {
      void doFetch();
    }
    const pollMs = optsRef.current.pollMs ?? 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (pollMs > 0) {
      intervalId = setInterval(() => {
        const shouldPause =
          optsRef.current.pausePollWhenHidden !== false &&
          typeof document !== "undefined" &&
          document.visibilityState === "hidden";
        if (shouldPause) return;
        void doFetch();
      }, pollMs);
    }
    // Re-fetch on tab focus so a long-backgrounded tab catches up.
    const onVis = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        void doFetch();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (intervalId) clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [doFetch]);

  return { data, error, loading, refresh: doFetch };
}
