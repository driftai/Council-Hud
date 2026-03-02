"use client";

import { useEffect, useRef } from "react";
import { DashboardCard } from "./DashboardCard";
import { Brain } from "lucide-react";

export function NeuralVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let particles: { x: number; y: number; vx: number; vy: number; size: number }[] = [];

    const init = () => {
      canvas.width = canvas.parentElement?.clientWidth || 600;
      canvas.height = 300;
      particles = Array.from({ length: 40 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2 + 1,
      }));
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const pulse = Math.sin(time / 500) * 0.5 + 0.5;

      // Draw connections
      ctx.beginPath();
      ctx.strokeStyle = `rgba(0, 255, 255, ${0.1 + pulse * 0.05})`;
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
          }
        }
      }
      ctx.stroke();

      // Draw particles
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 255, 255, ${0.4 + pulse * 0.3})`;
        ctx.fill();
        
        if (Math.random() > 0.995) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(34, 197, 94, 0.4)`;
            ctx.fill();
        }
      });

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
  }, []);

  return (
    <DashboardCard 
      title="Neural Pattern Monitor" 
      subtitle="AI Thought Process Visualization" 
      headerAction={<Brain className="w-4 h-4 text-secondary" />}
      className="col-span-1 lg:col-span-2"
    >
      <div className="relative h-[300px] flex items-center justify-center overflow-hidden rounded-lg bg-black/40">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <div className="z-10 text-center pointer-events-none">
          <div className="inline-block px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-[10px] font-mono text-primary animate-pulse uppercase tracking-widest">
            Cognitive Stream Active
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
