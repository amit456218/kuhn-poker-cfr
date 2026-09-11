import type { TreeNode } from "@/lib/api";

/**
 * The betting tree, drawn as an indented outline.
 *
 * Only nine histories exist in the whole game, which is exactly why Kuhn poker
 * is the right teaching vehicle: the complete decision structure of poker -
 * bet, call, fold, bluff, showdown - fits on one screen with nothing elided.
 */
function Node({
  node,
  action,
  depth,
}: {
  node: TreeNode;
  action?: string;
  depth: number;
}) {
  const pad = depth * 24;

  if (node.terminal) {
    return (
      <div style={{ paddingLeft: pad, display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0 5px" }}>
        <span style={{ paddingLeft: pad }} />
        <span className="chip-tag" style={{ borderColor: "#3a2b12", color: "var(--gold)" }}>
          {action}
        </span>
        <span className="muted" style={{ fontSize: "0.83rem" }}>{node.outcome}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0" }}>
        <span style={{ paddingLeft: pad }} />
        {action && <span className="chip-tag">{action}</span>}
        <span className={`chip-tag ${node.player === 0 ? "p0" : "p1"}`}>
          Player {(node.player ?? 0) + 1} decides
        </span>
        <span className="muted mono" style={{ fontSize: "0.75rem" }}>pot {node.pot}</span>
      </div>
      {node.children &&
        Object.entries(node.children).map(([label, child]) => (
          <Node key={label} node={child} action={label} depth={depth + 1} />
        ))}
    </div>
  );
}

export default function GameTree({ tree }: { tree: TreeNode }) {
  return (
    <div style={{ fontSize: "0.9rem", borderLeft: "1px solid var(--line)", paddingLeft: 6 }}>
      <Node node={tree} depth={0} />
    </div>
  );
}
