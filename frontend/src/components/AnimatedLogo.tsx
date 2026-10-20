import { useEffect, useRef } from "react";

/**
 * SpecForge animated mark — blueprint document + pen striking an anvil.
 * Pure SVG + JS: light pulses flow along the outlines and the pen strike
 * throws sparks (particle loop driven by requestAnimationFrame).
 */

const STRIKE_MS = 1600; // keep in sync with .sf-pen animation duration
const STRIKE_PHASE = 0.42; // point in the cycle where the pen touches the anvil
const SPARK_COUNT = 28;
const ORIGIN = { x: 56, y: 56 };

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number };

const BLUEPRINT = [
  "M4 12 H96", "M4 92 H96", "M10 4 V96", "M90 4 V96", "M4 50 H14", "M86 50 H96",
];
const DOC = "M28 8 H60 L72 20 V56 H28 Z";
const FOLD = "M60 8 V20 H72";
const PAGES = ["M22 14 V70", "M16 20 V76 H22"];
const TEXT_LINES = [20, 26, 32, 38, 44];
const ANVIL = "M6 56 H90 C84 64 74 66 66 66 L64 74 H72 V82 H28 V74 H36 L34 66 C22 66 12 63 6 56 Z";
const CHEVRON = "M41 87 L50 95 L59 87";

export function AnimatedLogo({ className = "" }: { className?: string }) {
  const sparksRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const group = sparksRef.current;
    if (!group) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame !== "function") return;

    const lines = Array.from(group.querySelectorAll("line"));
    const sparks: Spark[] = lines.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 }));
    const start = performance.now();
    let last = start;
    let lastCycle = -1;
    let frame = 0;

    const emit = (n: number, power: number) => {
      for (const s of sparks) {
        if (n <= 0) break;
        if (s.life > 0) continue;
        const angle = -1.25 + Math.random() * 1.3; // fan out up-right, like the logo
        const speed = (70 + Math.random() * 110) * power;
        s.x = ORIGIN.x + Math.random() * 3;
        s.y = ORIGIN.y;
        s.vx = Math.cos(angle) * speed;
        s.vy = Math.sin(angle) * speed;
        s.max = s.life = 0.4 + Math.random() * 0.55;
        n -= 1;
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const elapsed = now - start;
      const cycle = Math.floor(elapsed / STRIKE_MS - STRIKE_PHASE);
      if (cycle !== lastCycle && elapsed / STRIKE_MS >= STRIKE_PHASE) {
        lastCycle = cycle;
        emit(18, 1);
      } else if (Math.random() < 0.08) {
        emit(1, 0.45); // idle embers
      }

      sparks.forEach((s, i) => {
        const el = lines[i];
        if (s.life <= 0) {
          el.setAttribute("opacity", "0");
          return;
        }
        s.life -= dt;
        s.vy += 140 * dt; // gravity
        s.vx *= 0.985;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const t = Math.max(0, s.life / s.max);
        el.setAttribute("x1", s.x.toFixed(2));
        el.setAttribute("y1", s.y.toFixed(2));
        el.setAttribute("x2", (s.x - s.vx * 0.045).toFixed(2));
        el.setAttribute("y2", (s.y - s.vy * 0.045).toFixed(2));
        el.setAttribute("opacity", t.toFixed(2));
        el.setAttribute("stroke", t > 0.6 ? "#fff3c4" : t > 0.3 ? "#ffb347" : "#ff6a1f");
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg className={`sf-logo ${className}`} viewBox="0 0 100 100" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <linearGradient id="sf-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.42" stopColor="#4fc3f7" />
          <stop offset="0.58" stopColor="#ff8a3d" />
        </linearGradient>
        <linearGradient id="sf-pen" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fd8ff" />
          <stop offset="1" stopColor="#2a8fd6" />
        </linearGradient>
        <radialGradient id="sf-heat" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb347" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ff6a1f" stopOpacity="0" />
        </radialGradient>
        <filter id="sf-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* blueprint guides */}
      <g className="sf-guides" stroke="#4fc3f7" strokeWidth="0.5">
        {BLUEPRINT.map((d) => <path key={d} d={d} />)}
        <path className="sf-axis" d="M50 0 V100" strokeWidth="0.8" />
      </g>

      <g filter="url(#sf-glow)">
        {/* stacked pages + document */}
        <g stroke="#3aa6dc" strokeWidth="2.2">
          {PAGES.map((d) => <path key={d} d={d} />)}
          <path d={DOC} />
          <path d={FOLD} />
          {TEXT_LINES.map((y, i) => <path key={y} d={`M34 ${y} H${i % 2 ? 54 : 62}`} strokeWidth="1.8" />)}
        </g>

        {/* anvil */}
        <circle className="sf-heat" cx="62" cy="68" r="16" fill="url(#sf-heat)" stroke="none" />
        <path d={ANVIL} stroke="url(#sf-metal)" strokeWidth="2.6" fill="rgba(20,40,60,0.35)" />
        <path className="sf-hot" d={CHEVRON} stroke="#ff8a3d" strokeWidth="2.6" />

        {/* flowing light along outlines */}
        <g className="sf-flow" stroke="#e8fbff" strokeWidth="2.4">
          <path d={DOC} pathLength={100} />
          <path d={ANVIL} pathLength={100} style={{ animationDelay: "-1.4s" }} />
          <path d={PAGES[1]} pathLength={100} style={{ animationDelay: "-0.7s" }} />
          <path d={CHEVRON} pathLength={100} stroke="#ffe0a8" style={{ animationDelay: "-2s" }} />
        </g>

        {/* pen (strikes the anvil) */}
        <g className="sf-pen">
          <path d="M86 22 L58 54" stroke="url(#sf-pen)" strokeWidth="5" />
          <path d="M58 54 L54 59" stroke="#bfefff" strokeWidth="2.4" />
          <path d="M84 24 L60 51" stroke="#e8fbff" strokeWidth="0.9" opacity="0.8" />
        </g>
      </g>

      {/* sparks — positioned every frame by the effect above */}
      <g ref={sparksRef} strokeWidth="1.8" filter="url(#sf-glow)">
        {Array.from({ length: SPARK_COUNT }, (_, i) => <line key={i} opacity="0" />)}
      </g>
    </svg>
  );
}
