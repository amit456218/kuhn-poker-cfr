import { CARD_NAMES } from "@/lib/format";

export default function PlayingCard({
  card,
  small = false,
  hidden = false,
}: {
  card?: string;
  small?: boolean;
  hidden?: boolean;
}) {
  if (hidden || !card) {
    return <div className={`pcard back ${small ? "small" : ""}`} aria-label="face-down card" />;
  }
  return (
    <div className={`pcard ${small ? "small" : ""}`} aria-label={CARD_NAMES[card] ?? card}>
      <span className="rank">{card}</span>
      <span className="name">{CARD_NAMES[card] ?? ""}</span>
    </div>
  );
}
