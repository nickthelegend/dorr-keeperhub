"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

/**
 * Scroll-driven GSAP scenes, on the same contract as the rest of this page:
 * **the markup is the finished state, and animation is subtraction from it.**
 *
 * Every scene below renders complete and readable in HTML. The builder's first
 * job is to `gsap.set()` things out of place, and only then animate them back.
 * That ordering is what makes the scenes safe: if the bundle fails, if the tab
 * is backgrounded so rAF never ticks, if a reader has reduced motion on, or if
 * the component unmounts mid-timeline, what remains on screen is the diagram
 * rather than a blank panel. A scene that starts at `opacity: 0` in CSS and
 * relies on JavaScript to reveal it has already lost that bet.
 *
 * `gsap.context()` gives us the other half: it records every property the
 * builder touched, so `revert()` on cleanup puts the DOM back exactly as
 * rendered — including the initial `set()` calls — instead of stranding it
 * mid-tween.
 */
export function useScene(
  build: (ctx: {
    root: HTMLElement;
    q: <T extends Element = HTMLElement>(selector: string) => T[];
    timeline: (vars?: gsap.TimelineVars) => gsap.core.Timeline;
  }) => void,
  deps: unknown[] = [],
): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Asked for less motion: leave the rendered diagram exactly as it is.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const q = <T extends Element = HTMLElement>(selector: string) =>
        Array.from(root.querySelectorAll<T>(selector));

      /**
       * A timeline bound to this scene entering the viewport. `once` by
       * default — these explain something, and an explanation that replays
       * every time it scrolls past becomes noise on the second pass.
       */
      const timeline = (vars: gsap.TimelineVars = {}) =>
        gsap.timeline({
          defaults: { ease: "power3.out", duration: 0.55 },
          scrollTrigger: { trigger: root, start: "top 72%", once: true },
          ...vars,
        });

      build({ root, q, timeline });
    }, root);

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

/** The page's motion palette, so scenes cannot drift apart from each other. */
export const SCENE = {
  /** Exposed, readable, being priced by somebody else. */
  danger: "#f87171",
  /** Sealed, private, ours. */
  seal: "#38bdf8",
  /** Settled, zero, safe. */
  safe: "#34d399",
  ease: "power3.out",
  /** Long enough to read a step, short enough not to hold the page hostage. */
  step: 0.55,
} as const;
