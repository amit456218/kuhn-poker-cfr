export default function Stat({
  label,
  value,
  note,
  tone = "",
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "" | "accent" | "gold" | "danger" | "blue";
}) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
