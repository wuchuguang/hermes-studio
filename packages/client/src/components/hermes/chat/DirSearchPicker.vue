<script setup lang="ts">
import { ref } from 'vue'
import { searchWorkspaceDirs } from '@/api/studio/sessions'

/**
 * Searchable directory picker for extra workspace dirs.
 *
 * Deliberately NOT an NSelect remote dropdown: on iOS PWA the keyboard
 * viewport resize (plus the boot.js --vh compensation) makes floating/
 * binder-positioned dropdowns flicker closed or misposition, which read
 * as "search does nothing". Results render inline below the input, in
 * normal document flow — keyboard-proof on both platforms.
 */
const props = defineProps<{
  modelValue: string[]
  /** Hide the selected-chips row (host renders its own chips list). */
  hideChips?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const input = ref('')
const hits = ref<Array<{ path: string; name: string }>>([])
const searching = ref(false)
const searched = ref(false)
let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

function removeDir(dir: string) {
  emit('update:modelValue', props.modelValue.filter((d) => d !== dir))
}

async function runSearch(q: string) {
  const seq = ++searchSeq
  searching.value = true
  try {
    const found = await searchWorkspaceDirs(q)
    if (seq !== searchSeq) return
    hits.value = found.filter((h) => !props.modelValue.includes(h.path))
    searched.value = true
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

function onInput() {
  const value = input.value
  if (searchTimer) clearTimeout(searchTimer)
  if (!value || value.trim().length < 2) {
    hits.value = []
    searched.value = false
    return
  }
  searchTimer = setTimeout(() => void runSearch(value), 250)
}

function pick(path: string) {
  if (!props.modelValue.includes(path)) {
    emit('update:modelValue', [...props.modelValue, path])
  }
  input.value = ''
  hits.value = []
  searched.value = false
}
</script>

<template>
  <div class="dir-search-picker">
    <input
      v-model="input"
      class="dir-search-input"
      type="text"
      :placeholder="$t('chat.dirSearchPlaceholder')"
      enterkeyhint="search"
      @input="onInput"
      @keydown.enter.prevent="() => { if (hits.length) pick(hits[0].path) }"
    >
    <div v-if="searching" class="dir-search-status">{{ $t('chat.dirSearchSearching') }}</div>
    <div v-else-if="input.trim().length >= 2 && searched && !hits.length" class="dir-search-status">
      {{ $t('chat.dirSearchNoResults') }}
    </div>
    <div v-if="hits.length" class="dir-search-results">
      <button
        v-for="h in hits"
        :key="h.path"
        type="button"
        class="dir-search-hit"
        @click="pick(h.path)"
      >
        <span class="dir-hit-name">{{ h.name }}</span>
        <span class="dir-hit-path">{{ h.path }}</span>
      </button>
    </div>
    <div v-if="!hideChips && modelValue.length" class="dir-search-chips">
      <span v-for="dir in modelValue" :key="dir" class="dir-chip" :title="dir">
        {{ dir.split('/').pop() || dir }}
        <button class="dir-chip-x" type="button" @click="removeDir(dir)">×</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.dir-search-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dir-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  outline: none;
}

.dir-search-input:focus {
  border-color: var(--accent, rgba(96, 165, 250, 0.6));
}

.dir-search-status {
  font-size: 12px;
  opacity: 0.6;
  padding: 2px 0;
}

.dir-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}

.dir-search-hit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.dir-search-hit:active {
  background: rgba(128, 128, 128, 0.15);
}

.dir-hit-name {
  font-weight: 600;
  font-size: 13px;
}

.dir-hit-path {
  opacity: 0.55;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  align-self: stretch;
}

.dir-search-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dir-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(128, 128, 128, 0.12);
}

.dir-chip-x {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
  color: inherit;
  opacity: 0.6;
}

.dir-chip-x:hover {
  opacity: 1;
}
</style>
