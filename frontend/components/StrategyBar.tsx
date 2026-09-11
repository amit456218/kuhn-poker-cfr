import { actionLabel } from "@/lib/format";

/**
 * One information set's mixed strategy as a two-segment bar.
 *
 * Showing it as a proportion rather than a number is deliberate: the single
 * hardest idea for a newcomer is that the correct play here is a *frequency*,
 * not a choice. A bar makes "bet 30% of the time" look like what it is.
 */
export default function StrategyBar({
  probs,
  history,
}: {
  probs: number[];
  history: string;
}) {
  const [pass, bet] = probs;
  return (
    <div className="sbar" title={`${actionLabel(history, "p")} ${(pass * 100).toFixed(1)}% · ${actionLabel(history, "b")} ${(bet * 100).toFixed(1)}%`}>
      <div className="sbar-seg sbar-pass" style={{ width: `${pass * 100}%` }}>
        {pass > 0.16 ? `${Math.round(pass * 100)}%` : ""}
      </div>
      <div className="sbar-seg sbar-bet" style={{ width: `${bet * 100}%` }}>
        {bet > 0.16 ? `${Math.round(bet * 100)}%` : ""}
      </div>
    </div>
  );
}
