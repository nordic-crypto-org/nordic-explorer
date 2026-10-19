"use client";

import { useEffect, useState } from "react";
import { shortId } from "@/lib/format";
import { knownTokenIcon } from "@/lib/known-tokens";
import { apiTokenLabel, type ApiToken } from "@/lib/token-api";
import type { ChainId } from "@/lib/types";

/** Token API name, ticker, decimals and icon for a Nexa token id; null until loaded or when the API fails. */
export function useTokenLabel(chain: ChainId, id: string | null | undefined): ApiToken | null {
  const [meta, setMeta] = useState<ApiToken | null>(null);
  useEffect(() => {
    setMeta(null);
    if (chain !== "nexa" || !id) return;
    let live = true;
    apiTokenLabel(id)
      .then((m) => live && setMeta({ ...m, icon: knownTokenIcon(chain, m.group) ?? knownTokenIcon(chain, m.parent ?? "") ?? m.icon }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chain, id]);
  return meta;
}

export function tokenLabel(meta: ApiToken | null, id: string, head = 8, tail = 4) {
  return meta?.ticker ?? meta?.name ?? shortId(id, head, tail);
}

export function TokenIcon({ meta, size = 16 }: { meta: ApiToken | null; size?: number }) {
  return meta?.icon ? <img className="tokicon" src={meta.icon} alt="" width={size} height={size} referrerPolicy="no-referrer" /> : null;
}
