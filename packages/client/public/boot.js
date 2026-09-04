// Hermes Studio — iOS 键盘 visualViewport 补偿 (内置版, 2026-09-04)
// 与 /pwa/boot.js 注入层等价, 固化进 fork 源码。
// iOS Safari 键盘弹出时 window.innerHeight 不变, 布局被整体顶起;
// 用 visualViewport.height 写 CSS 变量 --vh, 并打 keyboard-open 类。
;(() => {
  if (!window.visualViewport) return
  const root = document.documentElement
  let last = 0
  const update = () => {
    const h = window.visualViewport.height
    const kb = Math.max(0, window.innerHeight - h)
    // app 约定 --vh = 1% 视口高 (global.scss: --vh: 1vh/1dvh), 此处必须除以 100
    root.style.setProperty('--vh', (h / 100) + 'px')
    root.classList.toggle('keyboard-open', kb > 120)
    last = h
  }
  update()
  window.visualViewport.addEventListener('resize', update)
  window.visualViewport.addEventListener('scroll', update)
})()
