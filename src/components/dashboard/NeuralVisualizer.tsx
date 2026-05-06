"use client";

import { useEffect, useMemo, useRef } from "react";
import { DashboardCard } from "./DashboardCard";
import { Brain, Cpu } from "lucide-react";
import { useNexus } from "@/providers/NexusProvider";
import { cn } from "@/lib/utils";

type VisualNode = {
  id: string;
  name: string;
  usage: number;
  index: number;
};

type PositionedNode = VisualNode & {
  x: number;
  y: number;
  size: number;
};

export function NeuralVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state, knowledgeGraph, systemHealth, nexusLogs, lastUpdate } = useNexus();

  const connected = state === "LINKED" || state === "SYNCING" || state === "RE-SYNCING";
  const cpuLoad = Number(systemHealth?.cpu_load) || 0;
  const ramUsed = Number(systemHealth?.ram_used) || 0;
  const totalThreads = Number(knowledgeGraph?.total_threads) || 0;
  const processNodes = useMemo(() => {
    const nodes = Array.isArray(knowledgeGraph?.nodes) ? knowledgeGraph.nodes : [];
    return nodes.slice(0, 14).map((node: any, index: number) => ({
      id: String(node.id ?? index),
      name: String(node.name ?? `PID_${index}`),
      usage: Number(node.usage) || 0,
      index,
    }));
  }, [knowledgeGraph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = 600;
    let height = 300;
    let telemetryNodes: VisualNode[] = processNodes.length > 0
      ? processNodes
      : Array.from({ length: connected ? 6 : 3 }, (_, index): VisualNode => ({
          id: `standby-${index}`,
          name: connected ? "Awaiting process packet" : "Offline",
          usage: connected ? 1 : 0,
          index,
        }));

    const init = () => {
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
      ctx.clearRect(0, 0, width, height);
      
      const pulse = Math.sin(time / 450) * 0.5 + 0.5;
      const cpuPulse = connected ? Math.max(0.15, cpuLoad / 100) : 0.05;
      const ramPulse = connected ? Math.max(0.1, ramUsed / 100) : 0.05;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.fillStyle = "rgba(2, 6, 23, 0.34)";
      ctx.fillRect(0, 0, width, height);

      ctx.beginPath();
      ctx.arc(centerX, centerY, 42 + pulse * 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 255, 255, ${0.04 + cpuPulse * 0.14})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(centerX, centerY, 72 + ramPulse * 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34, 197, 94, ${0.08 + ramPulse * 0.18})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      const points: PositionedNode[] = telemetryNodes.map((node: VisualNode, index: number) => {
        const spread = telemetryNodes.length || 1;
        const angle = (index / spread) * Math.PI * 2 + time / (6500 + index * 350);
        const orbit = 88 + (index % 3) * 18 + Math.min(18, node.usage * 0.7);
        return {
          ...node,
          x: centerX + Math.cos(angle) * orbit,
          y: centerY + Math.sin(angle) * orbit,
          size: connected ? Math.max(4, Math.min(24, 4 + node.usage * 0.5)) : 4,
        };
      });

      ctx.beginPath();
      ctx.strokeStyle = `rgba(0, 255, 255, ${connected ? 0.09 + pulse * 0.08 : 0.035})`;
      ctx.lineWidth = 0.5;
      points.forEach((point: PositionedNode) => {
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      points.forEach((point: PositionedNode) => {
        const active = connected && point.usage > 0;

        ctx.beginPath();
        ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
        ctx.fillStyle = active
          ? point.usage > 5
            ? `rgba(34, 197, 94, ${0.42 + pulse * 0.28})`
            : `rgba(0, 255, 255, ${0.34 + pulse * 0.22})`
          : "rgba(148, 163, 184, 0.16)";
        ctx.fill();

        if (active && point.usage > 1) {
          ctx.font = "9px monospace";
          ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
          ctx.fillText(point.name.slice(0, 18), point.x + point.size + 4, point.y + 3);
        }
      });

      ctx.beginPath();
      ctx.arc(centerX, centerY, 18 + pulse * 2, 0, Math.PI * 2);
      ctx.fillStyle = connected ? "rgba(0, 255, 255, 0.45)" : "rgba(239, 68, 68, 0.22)";
      ctx.fill();

      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = connected ? "rgba(0, 255, 255, 0.9)" : "rgba(239, 68, 68, 0.75)";
      ctx.fillText(`${Math.round(cpuLoad)}%`, centerX, centerY + 4);
      ctx.textAlign = "start";

      animationFrameId = requestAnimationFrame(draw);
    };

    init();
    draw(0);

    const handleResize = () => init();
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [connected, cpuLoad, ramUsed, processNodes]);

  const lastPacket = lastUpdate
    ? `${Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000))}s`
    : "--";

  return (
    <DashboardCard 
      title="Neural Pattern Monitor" 
      subtitle="AI Thought Process Visualization" 
      headerAction={<Brain className={cn("w-4 h-4", connected ? "text-secondary" : "text-muted-foreground")} />}
      className="col-span-1 lg:col-span-2"
    >
      <div className="relative h-[300px] flex items-center justify-center overflow-hidden rounded-lg bg-black/40">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <div className="z-10 text-center pointer-events-none">
          <div className={cn(
            "inline-flex items-center gap-3 px-3 py-1 rounded-full border text-[10px] font-mono uppercase tracking-widest",
            connected
              ? "bg-primary/10 border-primary/30 text-primary animate-pulse"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          )}>
            <Cpu className="h-3 w-3" />
            <span>{connected ? `CPU ${Math.round(cpuLoad)}%` : "Stream Offline"}</span>
            <span>THREADS {totalThreads || "--"}</span>
            <span>LOGS {nexusLogs.length}</span>
            <span>{lastPacket}</span>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
