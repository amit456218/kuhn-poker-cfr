export const CARD_NAMES: Record<string, string> = { J: "Jack", Q: "Queen", K: "King" };

/** Chips, always signed - the sign is the first thing a poker player reads. */
export function chips(value: number, digits = 4): string {
  const v = Math.abs(value) < 5e-7 ? 0 : value;
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)}`;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Compact scientific notation for exploitability, which spans many decades. */
export function sci(value: number, digits = 2): string {
  if (value === 0) return "0";
  if (value >= 0.001) return value.toFixed(Math.max(digits, 4));
  const exp = Math.floor(Math.log10(Math.abs(value)));
  return `${(value / 10 ** exp).toFixed(digits)}e${exp}`;
}

export function signClass(value: number, epsilon = 5e-7): string {
  if (Math.abs(value) < epsilon) return "zero";
  return value > 0 ? "pos" : "neg";
}

export function compactInt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

/** Turn a history string into readable action names, e.g. "pb" -> "Check, Bet". */
export function describeHistory(history: string): string {
  if (!history) return "no action yet";
  const out: string[] = [];
  history.split("").forEach((a, i) => {
    const facingBet = i > 0 && history[i - 1] === "b";
    out.push(a === "p" ? (facingBet ? "Fold" : "Check") : facingBet ? "Call" : "Bet");
  });
  return out.join(" → ");
}

export function actionLabel(history: string, action: string): string {
  const facingBet = history.endsWith("b");
  if (action === "p") return facingBet ? "Fold" : "Check";
  return facingBet ? "Call" : "Bet";
}
