"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { DashboardCard } from "./DashboardCard";
import { Activity, Cpu, Lock, RotateCcw, XCircle, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNexus } from "@/providers/NexusProvider";
import { Button } from "@/components/ui/button";

type ProcessNode = {
  id: number;
  name: string;
  usage: number;
};

type NodePoint = {
  x: number;
  y: number;
};

type GraphView = {
  x: number;
  y: number;
  scale: number;
};

type DragState =
  | {
      mode: "pan";
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      mode: "node";
      id: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      width: number;
      height: number;
      scale: number;
    };

const DEFAULT_VIEW: GraphView = { x: 0, y: 0, scale: 1 };

const NODE_POSITIONS: NodePoint[] = [
  { x: 50, y: 13 },
  { x: 78, y: 25 },
  { x: 84, y: 56 },
  { x: 64, y: 78 },
  { x: 36, y: 78 },
  { x: 16, y: 56 },
  { x: 22, y: 25 },
  { x: 50, y: 88 },
];

function toNumber(value: unknown) {
  const reading = Number(value);
  return Number.isFinite(reading) ? reading : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nodeClasses(load: number) {
  if (load >= 20) return "border-destructive bg-destructive/25 shadow-[0_0_20px_rgba(239,68,68,0.22)]";
  if (load >= 8) return "border-yellow-400 bg-yellow-400/20 shadow-[0_0_18px_rgba(250,204,21,0.18)]";
  return "border-primary/70 bg-primary/20 shadow-[0_0_18px_rgba(0,255,255,0.18)]";
}

function loadTextColor(load: number) {
  if (load >= 20) return "text-destructive";
  if (load >= 8) return "text-yellow-400";
  return "text-secondary";
}

function loadBarColor(load: number) {
  if (load >= 20) return "bg-destructive";
  if (load >= 8) return "bg-yellow-400";
  return "bg-secondary";
}

export function KnowledgeGraph() {
  const { state, knowledgeGraph, killProcess } = useNexus();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [view, setView] = useState<GraphView>(DEFAULT_VIEW);
  const [nodeOffsets, setNodeOffsets] = useState<Record<number, NodePoint>>({});
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const connected = state === "LINKED" || state === "SYNCING" || state === "RE-SYNCING";
  const nodes: ProcessNode[] = useMemo(() => {
    const source = Array.isArray(knowledgeGraph?.nodes) ? knowledgeGraph.nodes : [];
    // System Idle Process (PID 0) always pegs the top of Windows process tables but isn't
    // real work, so it crowds out anything meaningful. Drop it before slicing.
    return source
      .filter((node: any) => {
        const id = toNumber(node?.id);
        const name = String(node?.name ?? "").toLowerCase();
        if (id === 0) return false;
        if (name === "system idle process" || name === "idle") return false;
        return true;
      })
      .slice(0, 8)
      .map((node: any) => ({
        id: toNumber(node.id),
        name: String(node.name ?? "unknown"),
        usage: toNumber(node.usage),
      }));
  }, [knowledgeGraph]);
  const totalThreads = toNumber(knowledgeGraph?.total_threads);
  const activeNode = nodes.find((node) => node.id === activeId) || nodes[0] || null;
  const canKillActive = !!activeNode && activeNode.id > 4;

  useEffect(() => {
    const handleWindowPointerMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.mode === "pan") {
        setView((previous) => ({
          ...previous,
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        }));
        return;
      }

      const nextX = drag.originX + ((event.clientX - drag.startX) / drag.width / drag.scale) * 100;
      const nextY = drag.originY + ((event.clientY - drag.startY) / drag.height / drag.scale) * 100;
      setNodeOffsets((previous) => ({
        ...previous,
        [drag.id]: {
          x: nextX,
          y: nextY,
        },
      }));
    };

    const handleWindowPointerRelease = () => {
      dragRef.current = null;
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerRelease);
    window.addEventListener("pointercancel", handleWindowPointerRelease);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerRelease);
      window.removeEventListener("pointercancel", handleWindowPointerRelease);
    };
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      if (!connected) return;
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const factor = Math.exp(-event.deltaY * 0.0015);

      setView((previous) => {
        const scale = clamp(previous.scale * factor, 0.55, 2.4);
        const worldX = centerX + (cursorX - centerX - previous.x) / previous.scale;
        const worldY = centerY + (cursorY - centerY - previous.y) / previous.scale;

        return {
          scale,
          x: cursorX - centerX - (worldX - centerX) * scale,
          y: cursorY - centerY - (worldY - centerY) * scale,
        };
      });
    };

    element.addEventListener("wheel", handleNativeWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleNativeWheel);
    };
  }, [connected]);

  const positionedNodes = useMemo(() => {
    return nodes.map((node, index) => {
      const base = NODE_POSITIONS[index] || NODE_POSITIONS[0];
      const offset = nodeOffsets[node.id] || { x: 0, y: 0 };
      return {
        ...node,
        x: clamp(base.x + offset.x, 6, 94),
        y: clamp(base.y + offset.y, 6, 94),
      };
    });
  }, [nodes, nodeOffsets]);

  const zoomBy = (factor: number) => {
    setView((previous) => ({
      ...previous,
      scale: clamp(previous.scale * factor, 0.55, 2.4),
    }));
  };

  const resetGraphView = () => {
    setView(DEFAULT_VIEW);
    setNodeOffsets({});
  };

  const handleGraphPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!connected || event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("[data-graph-node],[data-graph-action],[data-detail-panel]")) return;

    dragRef.current = {
      mode: "pan",
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleNodePointerDown = (event: PointerEvent<HTMLButtonElement>, node: ProcessNode) => {
    if (!connected || event.button !== 0) return;

    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const offset = nodeOffsets[node.id] || { x: 0, y: 0 };
    dragRef.current = {
      mode: "node",
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      width: rect.width,
      height: rect.height,
      scale: view.scale,
    };
    setActiveId(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleGraphPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.mode === "pan") {
      setView((previous) => ({
        ...previous,
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      }));
      return;
    }

    const nextX = drag.originX + ((event.clientX - drag.startX) / drag.width / drag.scale) * 100;
    const nextY = drag.originY + ((event.clientY - drag.startY) / drag.height / drag.scale) * 100;
    setNodeOffsets((previous) => ({
      ...previous,
      [drag.id]: {
        x: nextX,
        y: nextY,
      },
    }));
  };

  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  return (
    <DashboardCard
      title="Intelligence Graph"
      subtitle="Live Process Mapping"
      headerAction={<Activity className={cn("w-4 h-4", connected ? "text-primary animate-pulse" : "text-muted-foreground")} />}
    >
      <div
        ref={viewportRef}
        className="relative h-[360px] touch-none overflow-hidden rounded-lg border border-white/5 bg-black/40 cursor-grab active:cursor-grabbing"
        data-graph-viewport
        onPointerDown={handleGraphPointerDown}
        onPointerMove={handleGraphPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        {!connected ? (
          <div className="relative z-10 flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-full border border-destructive/30 bg-black/40 p-4">
              <Lock className="h-8 w-8 text-destructive/60" />
            </div>
            <h4 className="font-headline text-sm font-bold uppercase tracking-tighter text-destructive/80">
              {state}_LOST
            </h4>
            <div className="mt-4 max-w-[220px] rounded border border-destructive/20 bg-destructive/5 p-2">
              <p className="font-mono text-[9px] uppercase leading-relaxed text-destructive/70">
                HARDWARE UPLINK OFFLINE // RUN TOGGLE-ROUTER.BAT TO RE-ESTABLISH
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="absolute right-2 top-2 z-50 flex items-center gap-1" data-graph-action>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Zoom out"
                aria-label="Zoom out graph"
                className="h-7 w-7 border border-white/10 bg-black/55 text-muted-foreground hover:bg-white/10 hover:text-primary"
                onClick={() => zoomBy(0.86)}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Reset graph"
                aria-label="Reset graph view"
                className="h-7 w-7 border border-white/10 bg-black/55 text-muted-foreground hover:bg-white/10 hover:text-primary"
                onClick={resetGraphView}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Zoom in"
                aria-label="Zoom in graph"
                className="h-7 w-7 border border-white/10 bg-black/55 text-muted-foreground hover:bg-white/10 hover:text-primary"
                onClick={() => zoomBy(1.16)}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div
              className="absolute inset-0 z-10"
              data-graph-stage
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                transformOrigin: "50% 50%",
              }}
            >
              <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40 bg-primary/10 shadow-[0_0_34px_rgba(0,255,255,0.16)]" />
              <div className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-secondary/40 bg-secondary/10" />
              <Cpu className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-primary" />

              <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                {positionedNodes.map((node, index) => (
                  <line
                    key={`${node.id}-${index}`}
                    x1="50%"
                    y1="50%"
                    x2={`${node.x}%`}
                    y2={`${node.y}%`}
                    stroke={node.id === activeNode?.id ? "rgba(0,255,255,0.34)" : "rgba(148,163,184,0.12)"}
                    strokeWidth={node.id === activeNode?.id ? 1.4 : 0.8}
                  />
                ))}
              </svg>

              {positionedNodes.map((node) => {
                const load = clamp(node.usage, 0, 100);
                const size = 34 + clamp(load, 0, 45) * 0.32;
                const isActive = node.id === activeNode?.id;

                return (
                  <button
                    key={`${node.id}-${node.name}`}
                    type="button"
                    data-graph-node
                    data-node-id={node.id}
                    data-node-x={node.x.toFixed(2)}
                    data-node-y={node.y.toFixed(2)}
                    aria-label={`Inspect process ${node.name} PID ${node.id}`}
                    title={`${node.name} (${node.id})`}
                    className={cn(
                      "absolute z-10 flex items-center justify-center rounded-full border font-mono text-[8px] font-bold transition-[border-color,box-shadow,background-color] duration-200 cursor-move focus:outline-none focus:ring-1 focus:ring-primary",
                      nodeClasses(load),
                      isActive && "ring-1 ring-primary"
                    )}
                    style={{
                      left: `${node.x}%`,
                      top: `${node.y}%`,
                      width: `${size}px`,
                      height: `${size}px`,
                      transform: "translate(-50%, -50%)",
                    }}
                    onPointerDown={(event) => handleNodePointerDown(event, node)}
                    onPointerMove={handleGraphPointerMove}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                    onMouseEnter={() => setActiveId(node.id)}
                    onFocus={() => setActiveId(node.id)}
                    onClick={() => setActiveId(node.id)}
                  >
                    <span className={loadTextColor(load)}>{Math.round(load)}</span>
                  </button>
                );
              })}
            </div>

            <div
              className="absolute bottom-3 left-3 right-3 z-40 rounded border border-white/10 bg-black/75 p-3 backdrop-blur-sm"
              data-detail-panel
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="grid grid-cols-[1fr_auto] items-start gap-3">
                <div className="min-w-0 font-mono">
                  <div className="mb-1 flex items-center gap-2 text-[8px] uppercase tracking-widest text-muted-foreground">
                    <span>PID {activeNode?.id ?? "--"}</span>
                    <span>THREADS {totalThreads || "--"}</span>
                  </div>
                  <div className="truncate text-[11px] font-bold text-foreground">
                    {activeNode?.name || "Awaiting process packet"}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={cn("h-full rounded-full", activeNode && loadBarColor(activeNode.usage))}
                      style={{ width: `${clamp(activeNode?.usage ?? 0, 0, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("font-mono text-sm font-bold", loadTextColor(activeNode?.usage ?? 0))}>
                    {activeNode ? `${activeNode.usage.toFixed(1)}%` : "--"}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title={canKillActive ? `Terminate ${activeNode?.name}` : "Protected process"}
                    aria-label={canKillActive ? `Terminate ${activeNode?.name}` : "Protected process"}
                    disabled={!canKillActive}
                    className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    onClick={() => {
                      if (activeNode && canKillActive) void killProcess(activeNode.id);
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardCard>
  );
}
