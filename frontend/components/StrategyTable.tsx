import type { InfoSetInfo, Strategy } from "@/lib/api";
import StrategyBar from "./StrategyBar";

/**
 * The solved strategy, grouped by which seat is acting.
 *
 * Optionally shows a reference strategy alongside (the closed-form Nash
 * equilibrium) plus the gap between them, which is how the dashboard
 * demonstrates that the solver found the *known correct* answer rather than
 * merely a stable one.
 */
export default function StrategyTable({
  strategy,
  infoSets,
  reference,
  referenceLabel = "Nash",
}: {
  strategy: Strategy;
  infoSets: InfoSetInfo[];
  reference?: Strategy;
  referenceLabel?: string;
}) {
  const seats = [0, 1];
  return (
    <>
      {seats.map((seat) => {
        const rows = infoSets.filter((i) => i.player === seat);
        return (
          <div key={seat} style={{ marginBottom: 26 }}>
            <div className="badge-row" style={{ marginBottom: 10 }}>
              <span className={`chip-tag ${seat === 0 ? "p0" : "p1"}`}>
                Player {seat + 1}
              </span>
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                {seat === 0
                  ? "acts first, and is worth −1/18 chips per hand at equilibrium"
                  : "acts second — this half of the equilibrium is unique"}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Situation</th>
                    <th style={{ width: 190 }}>Strategy</th>
                    {/* Each seat acts at two different points in the tree, where "b"
                        means Bet in one and Call in the other, so a single header
                        has to name both. The Situation column disambiguates. */}
                    <th className="num">Bet / Call</th>
                    {reference && <th className="num">{referenceLabel}</th>}
                    {reference && <th className="num">Δ</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((info) => {
                    const probs = strategy[info.key] ?? [0.5, 0.5];
                    const ref = reference?.[info.key];
                    const delta = ref ? Math.abs(probs[1] - ref[1]) : 0;
                    return (
                      <tr key={info.key}>
                        <td>
                          <span className="mono" style={{ fontWeight: 700 }}>{info.card}</span>
                          <span className="muted" style={{ marginLeft: 8, fontSize: "0.8rem" }}>
                            {info.card_name}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.84rem" }}>{info.situation}</td>
                        <td><StrategyBar probs={probs} history={info.history} /></td>
                        <td className="num">{(probs[1] * 100).toFixed(1)}%</td>
                        {reference && (
                          <td className="num muted">{ref ? `${(ref[1] * 100).toFixed(1)}%` : "—"}</td>
                        )}
                        {reference && (
                          <td className={`num ${delta > 0.02 ? "neg" : "zero"}`}>
                            {(delta * 100).toFixed(2)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
