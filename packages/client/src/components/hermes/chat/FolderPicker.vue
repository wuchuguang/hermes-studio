<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { searchWorkspaceDirs } from '@/api/studio/sessions'

/**
 * Primary-directory picker: search by name, inline results, selected-path
 * row. The old browse tree was removed — search covers the home tree
 * (depth-bounded, junk-pruned) and inline results survive the iOS
 * keyboard viewport churn that broke floating dropdowns.
 */
const props = defineProps<{
  modelValue: string | null
  showFavorite?: boolean
  favorite?: boolean
  favoriteDisabled?: boolean
  favoriteTitle?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  'toggle-favorite': []
}>()

const { t } = useI18n()
const selectedPath = ref(props.modelValue || '')

watch(() => props.modelValue, (v) => { selectedPath.value = v || '' })

function updateSelectedPath(value: string | null) {
  const next = String(value || '').trim()
  selectedPath.value = next
  emit('update:modelValue', next || null)
}

function clearSelected() {
  updateSelectedPath(null)
}

// ── Search-by-name (inline results; iOS-keyboard-proof) ──────────────────
const searchQuery = ref('')
const searchHits = ref<Array<{ path: string; name: string }>>([])
const searchSearching = ref(false)
const searchDone = ref(false)
let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  if (!searchQuery.value || searchQuery.value.trim().length < 2) {
    searchHits.value = []
    searchDone.value = false
    return
  }
  const q = searchQuery.value
  searchTimer = setTimeout(() => void runDirSearch(q), 250)
}

async function runDirSearch(q: string) {
  const seq = ++searchSeq
  searchSearching.value = true
  try {
    const found = await searchWorkspaceDirs(q)
    if (seq !== searchSeq) return
    searchHits.value = found
    searchDone.value = true
  } finally {
    if (seq === searchSeq) searchSearching.value = false
  }
}

function pickSearchHit(path: string) {
  updateSelectedPath(path)
  searchQuery.value = ''
  searchHits.value = []
  searchDone.value = false
}
</script>

<template>
  <div class="folder-picker">
    <input
      v-model="searchQuery"
      class="folder-search-input"
      type="text"
      :placeholder="t('chat.dirSearchPlaceholder')"
      enterkeyhint="search"
      @input="onSearchInput"
      @keydown.enter.prevent="() => { if (searchHits.length) pickSearchHit(searchHits[0].path) }"
    >
    <div v-if="searchSearching" class="folder-search-status">{{ t('chat.dirSearchSearching') }}</div>
    <div v-else-if="searchQuery.trim().length >= 2 && searchDone && !searchHits.length" class="folder-search-status">
      {{ t('chat.dirSearchNoResults') }}
    </div>
    <div v-if="searchHits.length" class="folder-search-results">
      <button
        v-for="h in searchHits"
        :key="h.path"
        type="button"
        class="folder-search-hit"
        @click="pickSearchHit(h.path)"
      >
        <span class="folder-hit-name">{{ h.name }}</span>
        <span class="folder-hit-path">{{ h.path }}</span>
      </button>
    </div>

    <!-- Selected path display -->
    <div v-if="selectedPath" class="folder-selected">
      <span class="folder-selected-label">{{ t('chat.folderPickerSelected') }}</span>
      <span class="folder-selected-path" :title="selectedPath">{{ selectedPath }}</span>
      <button
        class="folder-selected-clear"
        type="button"
        :title="t('common.delete')"
        aria-label="clear"
        @click.stop="clearSelected"
      >×</button>
      <button
        v-if="props.showFavorite"
        class="folder-selected-favorite"
        type="button"
        :disabled="props.favoriteDisabled"
        :title="props.favoriteTitle"
        :aria-label="props.favoriteTitle"
        @click.stop="emit('toggle-favorite')"
      >
        <span class="folder-selected-star" :class="{ 'is-pinned': props.favorite }">
          {{ props.favorite ? '★' : '☆' }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.folder-picker {
  display: flex;
  flex-direction: column;
}

.folder-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  outline: none;
  margin-bottom: 6px;
}

.folder-search-input:focus {
  border-color: var(--accent, rgba(96, 165, 250, 0.6));
}

.folder-search-status {
  font-size: 12px;
  opacity: 0.6;
  padding: 2px 0;
}

.folder-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
  margin-bottom: 6px;
}

.folder-search-hit {
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

.folder-search-hit:active {
  background: rgba(128, 128, 128, 0.15);
}

.folder-hit-name {
  font-weight: 600;
  font-size: 13px;
}

.folder-hit-path {
  opacity: 0.55;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  align-self: stretch;
}

.folder-selected {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.08);
}

.folder-selected-label {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.55;
}

.folder-selected-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.folder-selected-clear {
  flex-shrink: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 3px;
  color: inherit;
  opacity: 0.6;
}

.folder-selected-clear:hover {
  opacity: 1;
}

.folder-selected-favorite {
  flex-shrink: 0;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0 3px;
  color: inherit;
  opacity: 0.75;
}

.folder-selected-favorite:disabled {
  opacity: 0.3;
  cursor: default;
}

.folder-selected-star.is-pinned {
  color: #f5b83d;
}
</style>
