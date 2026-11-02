import type { ChainId } from "@/lib/types";
import { chains } from "@/lib/data";

/** Official coin mark, sized to the surrounding text (about 1em). */
export function CoinLogo({ chain }: { chain: ChainId }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="coin-logo" src={`/coins/${chain}.svg`} alt="" width={16} height={16} />;
}

/** Chain name with its logo in front, e.g. in headings, crumbs and eyebrows. */
export function ChainName({ chain }: { chain: ChainId }) {
  return (
    <span className="chain-name">
      <CoinLogo chain={chain} />
      {chains[chain].name}
    </span>
  );
}
