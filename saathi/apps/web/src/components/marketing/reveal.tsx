'use client';

import { useEffect } from 'react';

/**
 * Progressive enhancement that never hides content without JavaScript: the server HTML is
 * fully visible. After hydration, blocks that are still below the fold are held back
 * (`saathi-pre`) and rise in once as they scroll into view. Children of
 * `[data-reveal-stagger]` rise one after another. Reduced motion skips all of it.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const below = (e: Element) => e.getBoundingClientRect().top > window.innerHeight;
    const targets: HTMLElement[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('[data-reveal]')) if (below(e)) targets.push(e);
    for (const group of document.querySelectorAll<HTMLElement>('[data-reveal-stagger]')) {
      Array.from(group.children).forEach((c, i) => {
        if (!(c instanceof HTMLElement) || !below(c)) return;
        c.style.animationDelay = `${Math.min(i, 8) * 80}ms`;
        targets.push(c);
      });
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          en.target.classList.remove('saathi-pre');
          en.target.classList.add('saathi-fade');
          io.unobserve(en.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px' },
    );
    for (const t of targets) {
      t.classList.add('saathi-pre');
      io.observe(t);
    }
    return () => {
      io.disconnect();
      for (const t of targets) t.classList.remove('saathi-pre');
    };
  }, []);
  return null;
}
