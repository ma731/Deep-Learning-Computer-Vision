/* FreshGuard — anime.js layer (v4). Staggered, orchestrated entrances for the
   dynamically-injected Lab grids. Decorative only; degrades gracefully if the
   CDN is blocked or reduced-motion is on. */
(() => {
  const A = window.anime;
  if (!A || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const { animate, stagger } = A;

  /* Stagger-reveal any fresh `childSel` items added inside `hostSel`.
     Re-fires per render (each compare/augment run), but never double-animates
     the same element (dataset flag). */
  const revealOnAdd = (hostSel, childSel, opts) => {
    const host = document.querySelector(hostSel);
    if (!host) return;
    const flush = () => {
      const fresh = [...host.querySelectorAll(childSel)].filter((el) => !el.dataset.aIn);
      if (!fresh.length) return;
      fresh.forEach((el) => { el.dataset.aIn = "1"; });
      animate(fresh, opts);
    };
    new MutationObserver(flush).observe(host, { childList: true, subtree: true });
    flush();
  };

  // Grad-CAM gallery — cells bloom outward from the centre of the grid
  revealOnAdd("#gradcam-grid", ".gc-cell", {
    opacity: [0, 1], scale: [0.78, 1], duration: 560,
    delay: stagger(26, { grid: [5, 4], from: "center" }), ease: "outBack",
  });
  // Model-compare rows — slide in from the left, one after another
  revealOnAdd("#compare-body", ".cmp-row", {
    opacity: [0, 1], translateX: [-24, 0], duration: 520,
    delay: stagger(95), ease: "outCubic",
  });
  // Augmentation variants — pop in
  revealOnAdd("#augment-body", ".aug-cell", {
    opacity: [0, 1], scale: [0.7, 1], duration: 480,
    delay: stagger(55, { from: "first" }), ease: "outBack",
  });
})();
