import { useEffect, useRef } from "react";

/**
 * "SpecForge" wordmark matching the animated logo: brushed-metal "Spec",
 * molten "Forge", a light sheen flowing across both, and embers rising off
 * "Forge" with a spark burst on every pen strike (same 1.6s beat as the logo).
 */

const STRIKE_MS = 1600;
const STRIKE_PHASE = 0.42;
const EMBERS = 22;

type Ember = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number };

function EmberField() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame !== "function") return;

    const dots = Array.from(svg.querySelectorAll("circle"));
    const embers: Ember[] = dots.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, r: 1 }));
    const start = performance.now();
    let last = start;
    let lastCycle = -1;
    let frame = 0;

    // coordinates are in a 100 x 40 box laid over the "Forge" letters
    const spawn = (burst: boolean) => {
      const e = embers.find((x) => x.life <= 0);
      if (!e) return;
      if (burst) {
        // sparks thrown off the right edge of the word
        e.x = 88 + Math.random() * 8;
        e.y = 14 + Math.random() * 14;
        const a = -1.1 + Math.random() * 1.0;
        const v = 45 + Math.random() * 70;
        e.vx = Math.cos(a) * v;
        e.vy = Math.sin(a) * v;
        e.max = e.life = 0.35 + Math.random() * 0.4;
        e.r = 0.9 + Math.random() * 0.6;
      } else {
        // embers drifting up from the molten letters
        e.x = 4 + Math.random() * 92;
        e.y = 18 + Math.random() * 16;
        e.vx = (Math.random() - 0.5) * 8;
        e.vy = -(10 + Math.random() * 18);
        e.max = e.life = 0.9 + Math.random() * 1.1;
        e.r = 0.5 + Math.random() * 0.7;
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const elapsed = now - start;
      const cycle = Math.floor(elapsed / STRIKE_MS - STRIKE_PHASE);
      if (cycle !== lastCycle && elapsed / STRIKE_MS >= STRIKE_PHASE) {
        lastCycle = cycle;
        for (let i = 0; i < 7; i += 1) spawn(true);
      }
      if (Math.random() < 0.12) spawn(false);

      embers.forEach((e, i) => {
        const el = dots[i];
        if (e.life <= 0) {
          el.setAttribute("opacity", "0");
          return;
        }
        e.life -= dt;
        e.vy += (e.vy > 0 ? 60 : 20) * dt;
        e.vx += (Math.random() - 0.5) * 30 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const t = Math.max(0, e.life / e.max);
        const flicker = 0.7 + Math.random() * 0.3;
        el.setAttribute("cx", e.x.toFixed(2));
        el.setAttribute("cy", e.y.toFixed(2));
        el.setAttribute("r", (e.r * (0.5 + t * 0.5)).toFixed(2));
        el.setAttribute("opacity", (Math.min(1, t * 1.6) * flicker).toFixed(2));
        el.setAttribute("fill", t > 0.6 ? "#fff1c2" : t > 0.3 ? "#ffb347" : "#ff6a1f");
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg ref={ref} className="sf-embers" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: EMBERS }, (_, i) => <circle key={i} opacity="0" />)}
    </svg>
  );
}

export function AnimatedWordmark() {
  return (
    <>
      <span className="sf-word sf-spec" data-text="Spec">Spec</span>
      <span className="sf-word sf-forge" data-text="Forge">
        Forge
        <EmberField />
      </span>
    </>
  );
}
