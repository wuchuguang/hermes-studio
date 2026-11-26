<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/hermes/app'
import { clampSidebarWidth, SESSION_SIDEBAR_DEFAULT_WIDTH, SESSION_SIDEBAR_MAX_WIDTH, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, sidebarMaxWidth } from '@/utils/sidebar-width'

const props = defineProps<{ sessionList?: boolean }>()
const appStore = useAppStore()
const { t } = useI18n()
const handle = ref<HTMLElement | null>(null)
const resizing = ref(false)
const viewportWidth = ref(window.innerWidth)
const maxWidth = computed(() => props.sessionList ? SESSION_SIDEBAR_MAX_WIDTH : sidebarMaxWidth(viewportWidth.value))
const storedWidth = computed(() => props.sessionList ? appStore.sessionSidebarWidth : appStore.sidebarWidth)
const width = computed(() => clampSidebarWidth(storedWidth.value, maxWidth.value))

function setWidth(value: number, persist = true) {
  appStore.setSidebarWidth(clampSidebarWidth(value, maxWidth.value), persist, props.sessionList)
}
let drag: { pointerId: number; startX: number; startWidth: number; direction: number } | null = null

function direction() {
  return handle.value?.parentElement && getComputedStyle(handle.value.parentElement).direction === 'rtl' ? -1 : 1
}

function startResize(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || window.innerWidth <= 768) return
  drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width.value, direction: direction() }
  appStore.sidebarResizing = true
  resizing.value = true
  handle.value?.setPointerCapture(event.pointerId)
  window.addEventListener('pointermove', moveResize)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
  window.addEventListener('blur', stopResize)
}

function moveResize(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  setWidth(drag.startWidth + (event.clientX - drag.startX) * drag.direction, false)
}

function stopResize() {
  if (!drag) return
  const pointerId = drag.pointerId
  drag = null
  if (handle.value?.hasPointerCapture(pointerId)) handle.value.releasePointerCapture(pointerId)
  appStore.setSidebarWidth(storedWidth.value, true, props.sessionList)
  appStore.sidebarResizing = false
  resizing.value = false
  window.removeEventListener('pointermove', moveResize)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  window.removeEventListener('blur', stopResize)
}

function resizeWithKeyboard(event: KeyboardEvent) {
  const delta = event.shiftKey ? 40 : 10
  const next = event.key === 'Home' ? SIDEBAR_MIN_WIDTH
    : event.key === 'End' ? maxWidth.value
    : event.key === 'ArrowLeft' ? width.value - delta * direction()
    : event.key === 'ArrowRight' ? width.value + delta * direction() : null
  if (next === null) return
  event.preventDefault()
  setWidth(next)
}

function resetToDefault() {
  const defaultWidth = props.sessionList ? SESSION_SIDEBAR_DEFAULT_WIDTH : SIDEBAR_DEFAULT_WIDTH
  appStore.setSidebarWidth(defaultWidth, true, props.sessionList)
}

function onViewportResize() {
  viewportWidth.value = window.innerWidth
  stopResize()
}
window.addEventListener('resize', onViewportResize)
onUnmounted(() => {
  stopResize()
  window.removeEventListener('resize', onViewportResize)
})
</script>

<template>
  <div
    ref="handle"
    class="sidebar-resize-handle"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="t('sidebar.resize')"
    :aria-valuemin="SIDEBAR_MIN_WIDTH"
    :aria-valuemax="maxWidth"
    :aria-valuenow="width"
    @pointerdown.stop.prevent="startResize"
    @dblclick.stop.prevent="resetToDefault"
    @lostpointercapture="stopResize"
    @keydown="resizeWithKeyboard"
  />
  <Teleport to="body">
    <div v-if="resizing" class="sidebar-resize-shield" />
  </Teleport>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.sidebar-resize-handle {
  position: absolute;
  z-index: 20;
  inset-block: 0;
  inset-inline-end: 0;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  -webkit-app-region: no-drag;

  &::after {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    width: 2px;
    background: transparent;
  }

  &:hover::after,
  &:focus-visible::after { background: $accent-primary; }
  &:focus-visible { outline: 2px solid $accent-primary; outline-offset: -2px; }
  .collapsed > & { display: none; }

  @media (max-width: $breakpoint-mobile) { display: none; }
}

.sidebar-resize-shield {
  position: fixed;
  inset: 0;
  z-index: 100000;
  cursor: col-resize;
  user-select: none;
}
</style>
