"use client";

import { useEffect, useRef, useState } from "react";
import { chains } from "@/lib/chains";
import { dropSession, getSession, MissingError, UnreachableError, type Session } from "@/lib/electrum";
import type { ChainId } from "@/lib/types";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "unreachable"; servers: string[] }
  | { status: "missing"; message: string }
  | { status: "ready"; data: T };

/** Loading, unreachable, missing and ready states for any loader; retry drops the Electrum session. */
export function useLoad<T>(chainId: ChainId, key: string, load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancel = false;
    setState({ status: "loading" });
    loadRef
      .current()
      .then((data) => {
        if (!cancel) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancel) return;
        if (error instanceof UnreachableError) setState({ status: "unreachable", servers: error.servers });
        else if (error instanceof MissingError) setState({ status: "missing", message: error.message });
        else setState({ status: "missing", message: "The server did not return this." });
      });
    return () => {
      cancel = true;
    };
  }, [chainId, key, attempt]);

  return {
    state,
    retry: () => {
      if (chains[chainId].backend === "electrum") dropSession(chainId);
      setAttempt((value) => value + 1);
    },
  };
}

export function useChainLoad<T>(chainId: ChainId, key: string, load: (session: Session) => Promise<T>) {
  return useLoad(chainId, key, () => getSession(chainId).then(load));
}

/**
 * Same states as useChainLoad, for a page that reads either an Electrum chain or Bitcoin.
 * Bitcoin has no socket: `mempool` runs against the mempool.space REST API, whose replies are cached.
 */
export function useSourceLoad<T>(
  chainId: ChainId,
  key: string,
  loaders: { electrum: (session: Session) => Promise<T>; mempool: () => Promise<T> },
) {
  return useLoad(chainId, key, () =>
    chains[chainId].backend === "mempool-space" ? loaders.mempool() : getSession(chainId).then(loaders.electrum),
  );
}
