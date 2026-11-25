// Hermes Studio — iOS 键盘 visualViewport 补偿 (内置版, 2026-09-11 v3)
// 固化进 fork 源码。机制:
// 1) --vh = 1% visualViewport 高 → .app-shell(calc(100*var(--vh))) 随键盘收缩;
// 2) 键盘打开时给 html 打内联高度 = visualViewport 高 → 文档可滚余量归零,
//    Safari "滚动到焦点元素" 的顶起 (vv.pageTop 偏移) 从结构上不可能发生。
//    v2 只用 scrollTo(0,0) 对抗顶起, 实测压不赢 (文档仍有 100%:100% 的假余量,
//    iOS 允许键盘态滚动一个 overflow:hidden 的文档, 且触摸滑动可复位而程序滚动不行)。
// 3) 兜底: focusin/focusout 后再补 scrollTo(0,0)。
;(() => {
  if (!window.visualViewport) return
  const vv = window.visualViewport
  const root = document.documentElement

  const resetPan = () => {
    if (window.scrollY !== 0 || vv.pageTop !== 0) {
      window.scrollTo(0, 0)
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0
    }
  }

  const update = () => {
    const h = vv.height
    const kb = Math.max(0, window.innerHeight - h)
    // app 约定 --vh = 1% 视口高 (global.scss: --vh: 1vh/1dvh), 此处必须除以 100
    root.style.setProperty('--vh', (h / 100) + 'px')
    root.classList.toggle('keyboard-open', kb > 120)
    if (kb > 120) {
      root.style.height = h + 'px' // 滚动余量归零, 顶起无空间
      resetPan()
    } else {
      root.style.height = '' // 键盘收起/桌面端: 还原 height:100%
    }
  }

  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)

  // 键盘已开时再次聚焦 (键盘尺寸不变, resize 不触发): 双 rAF 等 Safari 先做完顶起再复位
  document.addEventListener('focusin', () => {
    if (root.classList.contains('keyboard-open'))
      requestAnimationFrame(() => requestAnimationFrame(resetPan))
  })
  // 键盘收起后清一次残留偏移
  document.addEventListener('focusout', () => setTimeout(resetPan, 350))
})()

// Shell 自愈 (2026-11-25): 部署后旧壳引用已删除的 hash 资产 → 模块脚本加载失败 →
// 白屏僵死。捕获 script 资源错误 (capture 阶段, target 是 <script> 元素本身), 清
// SW 缓存后强刷一次 (sessionStorage 防循环)。
;(() => {
  const KEY = 'hermes-shell-recovered'
  window.addEventListener('error', (ev) => {
    const t = ev.target || ev.srcElement
    if (!(t instanceof HTMLScriptElement) || t.src === location.href) return
    if (sessionStorage.getItem(KEY)) return
    sessionStorage.setItem(KEY, '1')
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister()
        return caches.keys()
      }).then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .finally(() => location.reload())
    } else {
      location.reload()
    }
  }, true)
  // 成功启动后解除防循环标记 (应用入口里也调不到这里, 用 load 事件近似)
  window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem(KEY), 8000))
})()
