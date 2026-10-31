import { useCallback, useEffect, useMemo } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";

// One box. Text is rendered as React text only, never as HTML.
function Box({ data }) {
  return (
    <div className={`box box--${data.color}${data.hot ? " box--hot" : ""}`} data-testid={`node-${data.id}`}>
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      {(data.sub || []).map((l, i) => <div key={i} className="box-sub">{l}</div>)}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { box: Box };

// hotEdges: arrow numbers in focus (a simulate step, or what the last action touched). positions: boxes the user dragged.
export function toFlow(d, hotEdges, positions) {
  const hot = new Set(); const now = new Set(hotEdges);
  const edges = d.edges.map((e, i) => {
    if (now.has(i)) { hot.add(e.source); hot.add(e.target); }
    return {
      id: `e${i}`, source: e.source, target: e.target, label: e.label, animated: now.has(i),
      className: `edge${now.has(i) ? " edge--now" : ""}`,
      style: e.dashed ? { strokeDasharray: "8 6" } : undefined, markerEnd: { type: MarkerType.ArrowClosed },
    };
  });
  const nodes = d.nodes.map((n) => ({
    id: n.id, type: "box", position: positions[n.id] || { x: n.x, y: n.y },
    data: { id: n.id, label: n.label, sub: n.sub, color: d.groups[n.group]?.color || "grey", hot: hot.has(n.id) },
  }));
  return { nodes, edges };
}

function Inner({ diagram, hotEdges, positions, onMove, fitKey }) {
  const { nodes, edges } = useMemo(() => toFlow(diagram, hotEdges, positions), [diagram, hotEdges, positions]);
  const rf = useReactFlow();
  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.15 }), 30); return () => clearTimeout(t); }, [fitKey, nodes.length, rf]);
  const onNodesChange = useCallback((changes) => {
    for (const c of changes) if (c.type === "position" && c.position) onMove(c.id, c.position);
  }, [onMove]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} nodesDraggable nodesConnectable={false}
      elementsSelectable={false} fitView proOptions={{ hideAttribution: true }} minZoom={0.2}>
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export default function Canvas(props) {
  return <div className="canvas" data-testid="canvas" role="group" aria-label="Session diagram. Drag boxes to move them."><ReactFlowProvider><Inner {...props} /></ReactFlowProvider></div>;
}
