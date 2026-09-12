<script setup lang="ts">
import { ref } from 'vue'
import { NSelect } from 'naive-ui'
import { searchWorkspaceDirs } from '@/api/studio/sessions'

/**
 * Searchable directory picker for extra workspace dirs: type >=2 chars,
 * pick a result, it lands as a chip; chips are removable.
 */
const props = defineProps<{
  modelValue: string[]
  /** Hide the selected-chips row (host renders its own chips list). */
  hideChips?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const input = ref('')
const options = ref<Array<{ label: string; value: string }>>([])
const searching = ref(false)
let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

function removeDir(dir: string) {
  emit('update:modelValue', props.modelValue.filter((d) => d !== dir))
}

async function runSearch(q: string) {
  const seq = ++searchSeq
  searching.value = true
  try {
    const hits = await searchWorkspaceDirs(q)
    if (seq !== searchSeq) return
    options.value = hits
      .filter((h) => !props.modelValue.includes(h.path))
      .map((h) => ({ label: `${h.name} — ${h.path}`, value: h.path }))
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

function onInput(value: string) {
  input.value = value
  if (searchTimer) clearTimeout(searchTimer)
  if (!value || value.trim().length < 2) {
    options.value = []
    return
  }
  searchTimer = setTimeout(() => void runSearch(value), 250)
}

function onPick(value: string | null) {
  if (!value) return
  if (!props.modelValue.includes(value)) {
    emit('update:modelValue', [...props.modelValue, value])
  }
  input.value = ''
  options.value = []
}
</script>

<template>
  <div class="dir-search-picker">
    <NSelect
      :value="null"
      :options="options"
      :loading="searching"
      filterable
      remote
      clearable
      size="small"
      :placeholder="$t('chat.dirSearchPlaceholder')"
      @search="onInput"
      @update:value="onPick"
    />
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
