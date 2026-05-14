"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { DashboardCard } from "./DashboardCard";
import { Activity, Brain } from "lucide-react";
import { useNexus } from "@/providers/NexusProvider";
import { cn } from "@/lib/utils";
import { getNexusLogLabel, summarizeNexusPayload } from "@/lib/nexus/logging";

type ProcessPulse = {
  id: string;
  name: string;
  usage: number;
};

type EventPulse = {
  type: string;
  label: string;
  strength: number;
  timestamp: string;
  payloadPreview: string;
};

type PatternFrame = {
  connected: boolean;
  processes: ProcessPulse[];
  events: EventPulse[];
};

type PointerState = {
  x: number;
  y: number;
  active: boolean;
};

type HitTarget = {
  id: string;
  kind: "process" | "event";
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
  label: string;
  detail: string;
  color: string;
  meta?: string[];
  align?: "left" | "right";
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function toNumber(value: unknown) {
  const reading = Number(value);
  return Number.isFinite(reading) ? reading : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPacketTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Time: unknown";
  return `Time: ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function eventColor(type: string) {
  if (type.includes("ERROR")) return "rgba(239, 68, 68, 0.88)";
  if (type.includes("FILESYSTEM")) return "rgba(0, 255, 255, 0.82)";
  if (type.includes("NEURAL") || type.includes("COMMAND")) return "rgba(168, 85, 247, 0.82)";
  if (type.includes("GRAPH")) return "rgba(34, 197, 94, 0.82)";
  return "rgba(148, 163, 184, 0.62)";
}

function resolveHitTarget(targets: HitTarget[], x: number, y: number, width: number) {
  const barTarget = targets.find((target) => {
    if (target.kind !== "event" || target.width === undefined || target.height === undefined) return false;
    return x >= target.x && x <= target.x + target.width && y >= target.y && y <= target.y + target.height;
  });

  const processTarget = targets
    .filter((target) => target.kind === "process" && target.radius !== undefined)
    .map((target) => ({
      target,
      distance: Math.hypot(x - target.x, y - target.y),
    }))
    .filter(({ target, distance }) => distance <= (target.radius || 0))
    .sort((left, right) => left.distance - right.distance)[0]?.target;

  const target = barTarget || processTarget;
  if (!target) return null;
  const align: "left" | "right" = x > width - 220 ? "left" : "right";

  return {
    ...target,
    x,
    y,
    align,
  };
}

export function NeuralVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<PatternFrame>({
    connected: false,
    processes: [],
    events: [],
  });
  const pointerRef = useRef<PointerState>({ x: 0, y: 0, active: false });
  const hitTargetsRef = useRef<HitTarget[]>([]);
  const hoverTargetRef = useRef<HitTarget | null>(null);
  const [hoverTarget, setHoverTarget] = useState<HitTarget | null>(null);

  const { state, knowledgeGraph, nexusLogs } = useNexus();

  const connected = state === "LINKED" || state === "SYNCING" || state === "RE-SYNCING";
  const processes = useMemo<ProcessPulse[]>(() => {
    const nodes = Array.isArray(knowledgeGraph?.nodes) ? knowledgeGraph.nodes : [];
    return nodes.slice(0, 9).map((node: any, index: number) => ({
      id: String(node.id ?? index),
      name: String(node.name ?? `PID_${index}`),
      usage: toNumber(node.usage),
    }));
  }, [knowledgeGraph]);
  const events = useMemo<EventPulse[]>(() => {
    const recent = nexusLogs.slice(0, 10);
    return recent.map((log, index) => ({
      type: log.type || "PACKET",
      label: getNexusLogLabel(log.type || "PACKET"),
      strength: 1 - index * 0.07,
      timestamp: log.timestamp || "",
      payloadPreview: summarizeNexusPayload(log.payload, 92),
    }));
  }, [nexusLogs]);

  useEffect(() => {
    frameRef.current = {
      connected,
      processes,
      events,
    };
  }, [connected, processes, events]);

  useEffect(() => {
    hoverTargetRef.current = hoverTarget;
  }, [hoverTarget]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = 600;
    let height = 300;

    const resize = () => {
      const pixelRatio = window.devicePixelRatio || 1;
      width = canvas.parentElement?.clientWidth || 600;
      height = 300;
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (time: number) => {
      const frame = frameRef.current;
      const pointer = pointerRef.current;
      const hoverId = hoverTargetRef.current?.id;
      const nextTargets: HitTarget[] = [];
      const pulse = Math.sin(time / 540) * 0.5 + 0.5;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(2, 6, 23, 0.96)";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(148, 163, 184, 0.055)";
      ctx.lineWidth = 1;
      for (let y = 24; y < height; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      if (pointer.active) {
        const pointerGlow = ctx.createRadialGradient(pointer.x, pointer.y, 4, pointer.x, pointer.y, 92);
        pointerGlow.addColorStop(0, "rgba(0, 255, 255, 0.16)");
        pointerGlow.addColorStop(1, "rgba(0, 255, 255, 0)");
        ctx.fillStyle = pointerGlow;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, 92, 0, Math.PI * 2);
        ctx.fill();
      }

      const rings = frame.connected ? 5 : 2;
      for (let i = 0; i < rings; i++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 34 + i * 24 + pulse * 5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 255, ${0.035 + i * 0.012})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const processStream = frame.processes.length
        ? frame.processes
        : Array.from({ length: frame.connected ? 6 : 0 }, (_, index) => ({
            id: `standby-${index}`,
            name: "Awaiting packet",
            usage: 0,
          }));

      processStream.forEach((process, index) => {
        const laneIndex = index % 3;
        const angle = index * GOLDEN_ANGLE + laneIndex * 0.42 + time / 7600;
        const lane = 70 + laneIndex * 25;
        const x = centerX + Math.cos(angle) * lane;
        const y = centerY + Math.sin(angle) * lane;
        const pointerDistance = pointer.active ? Math.hypot(x - pointer.x, y - pointer.y) : 999;
        const proximity = pointer.active && pointerDistance < 90 ? 1 - pointerDistance / 90 : 0;
        const intensity = clamp(process.usage / 100, 0.08, 1);
        const radius = 4 + intensity * 10;
        const targetId = `process-${process.id}`;
        const isHovered = hoverId === targetId;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = `rgba(0, 255, 255, ${0.05 + intensity * 0.16 + (isHovered ? 0.18 : 0)})`;
        ctx.lineWidth = isHovered ? 1.5 : 0.8;
        ctx.stroke();

        if (pointer.active && pointerDistance < 90) {
          ctx.beginPath();
          ctx.moveTo(pointer.x, pointer.y);
          ctx.lineTo(x, y);
          ctx.strokeStyle = `rgba(250, 204, 21, ${0.04 + proximity * 0.26})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius + (isHovered ? 5 : proximity * 2.5), 0, Math.PI * 2);
        ctx.fillStyle = process.usage > 8
          ? `rgba(250, 204, 21, ${0.28 + pulse * 0.3})`
          : `rgba(34, 197, 94, ${0.24 + intensity * 0.36})`;
        ctx.fill();

        if (isHovered) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 10, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(0, 255, 255, 0.54)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        nextTargets.push({
          id: targetId,
          kind: "process",
          x,
          y,
          radius: radius + 18,
          label: process.name,
          detail: `PID ${process.id} // Load ${process.usage.toFixed(1)}%`,
          color: process.usage > 8 ? "text-yellow-400" : "text-secondary",
        });
      });

      const eventSpacing = frame.events.length > 0
        ? clamp((width - 58) / frame.events.length, 30, 44)
        : 36;
      const barWidth = clamp(eventSpacing - 12, 14, 22);

      frame.events.forEach((event, index) => {
        const x = 26 + index * eventSpacing;
        const heightScale = 16 + event.strength * 36 + Math.sin(time / 400 + index) * 4;
        const y = height - 30 - heightScale;
        const targetId = `event-${event.type}-${index}`;
        const isHovered = hoverId === targetId;

        ctx.fillStyle = eventColor(event.type);
        ctx.fillRect(x, y, barWidth, heightScale);

        if (isHovered) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 2, y - 2, barWidth + 4, heightScale + 4);
        }

        ctx.fillStyle = "rgba(226, 232, 240, 0.55)";
        ctx.font = "8px monospace";
        ctx.save();
        ctx.translate(x + barWidth - 4, y - 4);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(event.label.slice(0, 12), 0, 0);
        ctx.restore();

        nextTargets.push({
          id: targetId,
          kind: "event",
          x: x - 8,
          y: y - 10,
          width: barWidth + 16,
          height: heightScale + 18,
          label: event.label,
          detail: `Strength ${Math.round(event.strength * 100)}%`,
          meta: [
            formatPacketTime(event.timestamp),
            event.payloadPreview,
          ],
          color: "text-primary",
        });
      });

      ctx.beginPath();
      ctx.arc(centerX, centerY, 18 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = frame.connected ? "rgba(0, 255, 255, 0.36)" : "rgba(239, 68, 68, 0.24)";
      ctx.fill();

      hitTargetsRef.current = nextTargets;
      animationFrameId = requestAnimationFrame(draw);
    };

    resize();
    draw(0);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const handlePatternPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    pointerRef.current = { x, y, active: true };
    const target = resolveHitTarget(hitTargetsRef.current, x, y, rect.width);
    setHoverTarget((current) => {
      if (!target && !current) return current;
      if (target && current?.id === target.id && Math.abs(current.x - target.x) < 2 && Math.abs(current.y - target.y) < 2) {
        return current;
      }
      return target;
    });
  };

  const handlePatternPointerLeave = () => {
    pointerRef.current = { x: 0, y: 0, active: false };
    setHoverTarget(null);
  };

  const eventTags = events.slice(0, 4).map((event) => event.label);

  return (
    <DashboardCard
      title="Neural Pattern Monitor"
      subtitle="AI Thought Process Visualization"
      headerAction={<Brain className={cn("w-4 h-4", connected ? "text-secondary" : "text-muted-foreground")} />}
      className="col-span-1 lg:col-span-2"
    >
      <div
        className="relative h-[360px] overflow-hidden rounded-lg bg-black/40 cursor-crosshair"
        data-neural-visualizer
        onPointerMove={handlePatternPointerMove}
        onPointerLeave={handlePatternPointerLeave}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label="Live neural pattern canvas"
        />

        <div className="pointer-events-none absolute left-3 top-3 flex h-8 items-center gap-2 rounded border border-white/10 bg-black/55 px-3 font-mono text-[9px] uppercase tracking-widest text-primary">
          <Activity className={cn("h-3.5 w-3.5", connected ? "animate-pulse" : "text-destructive")} />
          <span>{connected ? "Cognitive Stream Active" : "Stream Offline"}</span>
        </div>

        {hoverTarget && (
          <div
            className="pointer-events-none absolute z-20 min-w-[170px] max-w-[280px] rounded border border-primary/20 bg-black/85 p-2 font-mono shadow-[0_0_18px_rgba(0,255,255,0.12)] backdrop-blur-sm"
            data-pattern-tooltip
            style={{
              left: `${hoverTarget.x}px`,
              top: `${hoverTarget.y}px`,
              transform: hoverTarget.align === "left" ? "translate(-105%, -105%)" : "translate(12px, -105%)",
            }}
          >
            <div className={cn("text-[8px] uppercase tracking-widest", hoverTarget.color)}>
              {hoverTarget.kind === "process" ? "Process Node" : "Packet Bar"}
            </div>
            <div className="mt-1 truncate text-[10px] font-bold text-foreground">{hoverTarget.label}</div>
            <div className="mt-1 text-[8px] uppercase tracking-wider text-muted-foreground">{hoverTarget.detail}</div>
            {hoverTarget.meta?.map((line, index) => (
              <div key={`${hoverTarget.id}-meta-${index}`} className="mt-1 break-words text-[8px] leading-relaxed text-muted-foreground/90">
                {line}
              </div>
            ))}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex h-8 items-center gap-2 overflow-hidden border border-white/10 bg-black/55 px-3 font-mono text-[9px] uppercase tracking-widest">
          {eventTags.length > 0 ? (
            eventTags.map((tag, index) => (
              <span key={`${tag}-${index}`} className="shrink-0 text-muted-foreground">
                {tag}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">Awaiting Packet Pattern</span>
          )}
        </div>
      </div>
    </DashboardCard>
  );
}
