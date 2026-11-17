/* Memora · 轻量玻璃高光。事件委托覆盖动态页面，不捕获屏幕或请求网络。 */
export function initLiquidGlass() {
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  const targets = '.rail-btn, .chat-head, .composer-input-row, .btn-primary, .send-btn';
  let active = null;
  let frame = 0;
  let x = 0;
  let y = 0;

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    active?.style.removeProperty('--glass-x');
    active?.style.removeProperty('--glass-y');
    active = null;
  }

  function move(event) {
    if (!finePointer.matches || reducedMotion.matches || reducedTransparency.matches || event.pointerType === 'touch') return;
    const target = event.target instanceof Element ? event.target.closest(targets) : null;
    if (!target || target.matches(':disabled')) { reset(); return; }
    if (active !== target) { reset(); active = target; }
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!active?.isConnected) { reset(); return; }
      const rect = active.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const left = Math.max(0, Math.min(100, (x - rect.left) / rect.width * 100));
      const top = Math.max(0, Math.min(100, (y - rect.top) / rect.height * 100));
      active.style.setProperty('--glass-x', `${left.toFixed(1)}%`);
      active.style.setProperty('--glass-y', `${top.toFixed(1)}%`);
    });
  }

  // SVG 位移只增强桌面 Chromium 的两条装饰边缘；其余环境保留 CSS 材质。
  const chromium = /Chrom(e|ium)\//.test(navigator.userAgent);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('glass-filter-defs');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = '<defs><filter id="memora-glass-refraction" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.018 0.025" numOctaves="1" seed="8" result="noise"/><feGaussianBlur in="noise" stdDeviation="2" result="smooth"/><feDisplacementMap in="SourceGraphic" in2="smooth" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
  document.body.append(svg);
  function preferencesChanged() {
    reset();
    const enhanced = chromium && finePointer.matches && !reducedTransparency.matches && !reducedMotion.matches && CSS.supports('backdrop-filter', 'url("#memora-glass-refraction")');
    document.documentElement.dataset.glassRefraction = enhanced ? 'on' : 'off';
  }
  preferencesChanged();
  document.addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', reset);
  window.addEventListener('blur', reset);
  window.addEventListener('hashchange', reset);
  document.addEventListener('visibilitychange', reset);
  for (const media of [finePointer, reducedMotion, reducedTransparency]) media.addEventListener('change', preferencesChanged);
}
