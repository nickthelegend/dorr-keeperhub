"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * A scroll-triggered entrance that fails visible.
 *
 * Two bugs are designed out of this, both of which leave real content
 * permanently unreadable and neither of which throws anything:
 *
 * 1. `whileInView` only fires while an element overlaps the viewport. Restore a
 *    scroll position, follow a deep link, or fling the page and anything
 *    skipped never intersects — so with a once-only reveal it sits at opacity 0
 *    forever. The trigger here is "has this reached the fold", which is also
 *    true of everything already scrolled past, so nothing can be missed.
 *
 * 2. Starting at `opacity: 0` and animating up means the content only exists if
 *    the animation runs. A background tab gets no `requestAnimationFrame`, so
 *    the whole page can render blank — which is exactly what happened while
 *    building this. So the default state is *visible*, and the entrance is
 *    applied after mount only to elements that are below the fold, where
 *    nobody can see them change. If JavaScript never runs, or animations never
 *    tick, the page is still a page.
 */
export function Reveal({
  children,
  delay = 0,
  y = 20,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Visible until something proves it is safe to hide.
  const [shown, setShown] = useState(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduceMotion) return;

    const fold = () => window.innerHeight - 60;

    // Above the fold at mount: it is already on screen, leave it alone.
    if (el.getBoundingClientRect().top < fold()) return;

    setShown(false);

    const check = () => {
      if (el.getBoundingClientRect().top < fold()) {
        setShown(true);
        window.removeEventListener("scroll", check);
        window.removeEventListener("resize", check);
      }
    };

    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [reduceMotion]);

  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={{ opacity: shown ? 1 : 0, y: shown || reduceMotion ? 0 : y }}
      transition={{ duration: reduceMotion ? 0 : 0.7, delay: shown ? delay : 0, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
