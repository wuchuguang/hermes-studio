<script setup lang="ts">
import { agentMetadata, agentSupportsSurface, isGlobalOnlyCodingAgent, isNativeCodingAgent, isPluginAgentId } from "@/utils/agent-catalog"
import { nativeCatalogModel, nativeModelLabel, nativeModelPickerId, nativeModelEffortChoices, selectNativeModelEffort } from "@/utils/native-model-families";
import { usePageSidebarState } from "@/composables/usePageSidebar"
import { useSessionReadState } from "@/composables/useSessionReadState"
import { usePageLoadingState, usePageLoadingTask } from "@/composables/usePageLoading"
import { useCodingAgentModels } from "@/composables/useCodingAgentModels"
import PageHeader from '@/components/layout/PageHeader.vue'
import HeaderSidebarToggle from '@/components/layout/HeaderSidebarToggle.vue'
import HeaderToolPanelToggle from '@/components/layout/HeaderToolPanelToggle.vue'
import { AGENT_OPTIONS } from "@/utils/agent-options"
import { setSessionPinned } from "@/api/studio/sessions";
import DshSessionPresetSelect from "@/components/coding-agents/dsh/DshSessionPresetSelect.vue";
import {
  batchDeleteSessions,
  createSessionCategory,
  deleteSessionCategory,
  exportSession,
  saveSessionToObsidian,
  fetchSessionCategories,
  fetchStudioProjects,
  renameSession,
  renameSessionCategory,
  setSessionCategory,
  setSessionWorkspace,
  type SessionCategory,
  type StudioProject,
} from "@/api/studio/sessions";
import type { AvailableModelGroup } from "@/api/hermes/system";
import ModelProtocolModal from '@/components/hermes/models/ModelProtocolModal.vue'
import { inferCodingAgentApiMode, normalizeCodingAgentApiMode, type ChatCodingAgentId, type CodingAgentApiMode, type CodingAgentId } from "@/api/coding-agents";
import { agentInstallationState, fetchAgentAvailabilitySnapshot, type AgentAvailabilitySnapshot } from "@/api/agent-status";
import { useChatStore, type Session, type Attachment } from "@/stores/hermes/chat";
import { useAppStore } from "@/stores/hermes/app";
import { useProfilesStore } from "@/stores/hermes/profiles";
import { useFilesStore } from "@/stores/hermes/files";
import { useToolPanelStore } from "@/stores/hermes/tool-panel";
import { useSessionBrowserPrefsStore } from "@/stores/hermes/session-browser-prefs";
import {
  NSpin,
  NButton,
  NDrawer,
  NDrawerContent,
  NDropdown,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NTooltip,
NPopover,
NRadioButton,
NRadioGroup,
  useMessage,
  type DropdownOption,
} from "naive-ui";
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard";
import FolderPicker from "./FolderPicker.vue";
import DirSearchPicker from "./DirSearchPicker.vue";
import StarIcon from "@/components/common/StarIcon.vue";
import SessionTaskIcon from '@/components/common/SessionTaskIcon.vue';
import ChatInput from "./ChatInput.vue";
import NewChatAgentCards from "./NewChatAgentCards.vue";
import NewChatPage from "./NewChatPage.vue";
import { prepareAgentDeployment, type AgentDeploymentController } from "./agentDeployment.mjs";
import RealtimeVoiceStage from "./RealtimeVoiceStage.vue";
import ConversationMonitorPane from "./ConversationMonitorPane.vue";
import MessageList from "./MessageList.vue";
import SessionListItem from "./SessionListItem.vue";
import ListActionsMenu from "@/components/layout/ListActionsMenu.vue";
import OutlinePanel from "./OutlinePanel.vue";
import ChatToolsPanel from "./ChatToolsPanel.vue";
import SubagentStreamPanel from "./SubagentStreamPanel.vue";
import { chatSessionAgentAvatar } from "@/utils/chat-agent-avatar";
import { buildVisibleSessionCategoryGroups, partitionRecentSessions } from "./session-category-groups";
import { buildSessionCategoryMenuChildren, resolveRecentSessionCategoryLabel } from "./session-category-menu";
import { buildActiveSessionMenuOptions, buildSessionContextMenuOptions } from "./session-menu-options";
import PageSidebarNav from "@/components/layout/PageSidebarNav.vue";
import { getStoredUserId, isStoredSuperAdmin } from "@/api/client"
import { loadNewChatFormPreferences, saveNewChatFormPreferences } from "@/utils/new-chat-form-preferences"
import { useDefaultWorkspace } from "@/composables/useDefaultWorkspace"
import { useChatSurfaceReveal } from "@/composables/useChatSurfaceReveal"
import { canScopedCodingAgentUseProvider, configuredProviderApiMode, hasConfiguredProviderApiKey, usesServerManagedProviderAuth } from "@/utils/codingAgentProviders"
import { useCollapsedProviderGroups } from "@/composables/useCollapsedProviderGroups"
import { OPEN_SUBAGENT_STREAM_EVENT, type OpenSubagentStreamDetail } from "@/utils/hermes/subagent-stream";
import { desktopBridge, hasDesktopBrowserBridge } from "@/utils/desktop-bridge";
import { OPEN_DESKTOP_BROWSER_PANEL_EVENT } from "@/utils/desktop-browser";
import {
  createBrowserAnnotationAttachment,
  type BrowserAnnotationSubmission,
} from "@/utils/browser-annotation-submit";

const props = withDefaults(defineProps<{
  standalone?: boolean;
  contentMode?: "chat" | "connections" | "agents" | "models";
  initialComposerText?: string;
  composerPersistDraft?: boolean;
}>(), {
  standalone: false,
  contentMode: "chat",
  initialComposerText: "",
  composerPersistDraft: true,
});

provide('hermesWorkspaceFilePreview', true);

const SessionTasksDrawer = defineAsyncComponent(async () => (await import('@/components/hermes/tasks/SessionTasksDrawer.vue')).default);
const ConnectionsPanel = defineAsyncComponent(async () => (await import('@/components/hermes/connections/ConnectionsPanel.vue')).default);
const AgentManagerPanel = defineAsyncComponent(async () => (await import('@/views/hermes/AgentManagerView.vue')).default);
const ModelsPanel = defineAsyncComponent(async () => (await import('@/views/hermes/ModelsView.vue')).default);
const WorkspaceDiffPreview = defineAsyncComponent(async () => (await import('@/components/hermes/files/WorkspaceDiffPreview.vue')).default);
const FilePreview = defineAsyncComponent(async () => (await import('@/components/hermes/files/FilePreview.vue')).default);

const chatStore = useChatStore();
const sessionStates = useSessionReadState(() => props.contentMode === 'chat' && !chatStore.isLoadingMessages ? chatStore.activeSessionId : null);
const appStore = useAppStore();
const profilesStore = useProfilesStore();
const filesStore = useFilesStore();
const toolPanelStore = useToolPanelStore();
const sessionBrowserPrefsStore = useSessionBrowserPrefsStore();
const router = useRouter();
const route = useRoute();
const sessionTasksMounted = ref(false);
const showSessionTasks = computed(() => props.contentMode === 'chat' && chatStore.runtimeMode === 'default' && route.query.tasks === '1');
watch(showSessionTasks, show => { if (show) sessionTasksMounted.value = true; }, { immediate: true });
function openSessionTasks() {
  void router.push({ query: { ...route.query, tasks: '1' } });
}
function updateSessionTasksVisibility(show: boolean) {
  if (!show) void router.replace({ query: { ...route.query, tasks: undefined } });
}
const message = useMessage();
const { t } = useI18n();
const isSuperAdmin = computed(() => isStoredSuperAdmin());

const showOutline = ref(false);
const ACTIVE_SESSION_MENU_ID = "active-session-actions-menu";
const showActiveSessionMenu = ref(false);
const activeSessionMenuTriggerRef = ref<InstanceType<typeof NButton> | null>(null);
let activeSessionMenuInitialFocus: "first" | "last" = "first";
let restoreActiveSessionMenuTriggerFocus = false;
const activeSessionSupportsPersistence = computed(() =>
  Boolean(chatStore.activeSession && !chatStore.activeSession.isLocalOnly),
);
const showRealtimeVoice = ref(false);
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null);
const chatInputRef = ref<(InstanceType<typeof ChatInput> & {
  addFiles?: (files: File[]) => void;
  focusComposer?: () => void;
}) | null>(null);
const chatContentWrapperRef = ref<HTMLElement | null>(null);
const chatMainContentRef = ref<HTMLElement | null>(null);
useChatSurfaceReveal(chatMainContentRef, () => chatStore.activeSessionId || 'new-chat', () => !chatStore.isLoadingMessages || chatStore.messages.length > 0);
let workspacePreviewRequestSeq = 0;
let workspacePreviewRequestPending = false;
const chatDropCounter = ref(0);
const isChatDropActive = ref(false);
const showToolPanel = ref(false);
const previewOnlyFileOpen = ref(false);
const toolPanelTransitionReady = ref(false);
const activeToolPanel = ref<"files" | "terminal" | "browser">("files");
const desktopBrowserAvailable = hasDesktopBrowserBridge();
const desktopChatWindowAvailable = desktopBridge()?.isDesktop === true
  && typeof desktopBridge()?.openChatWindow === "function";
const selectedSubagent = ref<OpenSubagentStreamDetail | null>(null);
const selectedSubagentStream = computed(() => {
  const selected = selectedSubagent.value;
  return selected ? chatStore.getSubagentStream(selected.sessionId, selected.subagentId) : null;
});
const activeWorkspaceSessionId = computed(() => chatStore.activeSession?.workspace && !chatStore.activeSession.isLocalOnly ? chatStore.activeSession.id : null);
const activePreviewSessionId = computed(() => chatStore.activeSession?.id && !chatStore.activeSession.isLocalOnly ? chatStore.activeSession.id : null);
const activeWorkspacePath = computed(() => chatStore.activeSession?.workspace && !chatStore.activeSession.isLocalOnly ? chatStore.activeSession.workspace : null);
const TOOL_PANEL_MIN_WIDTH = 360;
const TOOL_PANEL_DEFAULT_WIDTH = 560;
const TOOL_PANEL_STORAGE_KEY = "hermes.chat.toolPanelWidth";
const toolPanelWidth = ref(loadToolPanelWidth());
const toolResizeStart = ref<{ x: number; width: number; deltaSign: 1 | -1 } | null>(null);

const currentMode = ref<"chat" | "live">("chat");

// Batch selection mode
const isBatchMode = ref(false);
const selectedSessionKeys = ref<Set<string>>(new Set());
const showBatchDeleteConfirm = ref(false);
const isBatchDeleting = ref(false);

const { expanded: showSessions, isMobile } = usePageSidebarState(!props.standalone)

const hasPageSidebar = computed(
  () => !props.standalone && currentMode.value === "chat" && props.contentMode === "chat",
);
const pageSidebarExpanded = computed(() => hasPageSidebar.value && showSessions.value);
const toolPanelStyle = computed(() => ({
  width: isMobile.value ? "100%" : `min(${toolPanelWidth.value}px, 100%)`,
}));

function openRealtimeVoice() {
  if (!chatStore.activeSessionId) return;
  showRealtimeVoice.value = true;
}

function closeRealtimeVoice() {
  showRealtimeVoice.value = false;
}

function sessionHref(sessionId: string, profile?: string | null) {
  return router.resolve({
    name: chatStore.runtimeMode === "global_agent" ? "hermes.globalAgentSession" : "hermes.session",
    params: { sessionId },
    query: profile ? { profile } : undefined,
  }).href;
}

function openSessionInNewTab(sessionId: string, profile = sessionProfile(sessionId)) {
  if (typeof window === "undefined") return;
  const bridge = desktopBridge();
  if (bridge?.isDesktop && bridge.openChatWindow) {
    void bridge.openChatWindow(sessionId, profile || undefined);
    return;
  }
  window.open(sessionHref(sessionId, profile), "_blank", "noopener,noreferrer");
}

function handleOutlineNavigate(target: { messageId: string; anchorId: string }) {
  messageListRef.value?.scrollToAnchor(target.messageId, target.anchorId);
  if (isMobile.value) showOutline.value = false;
}

function loadToolPanelWidth() {
  if (typeof window === "undefined") return TOOL_PANEL_DEFAULT_WIDTH;
  const saved = Number.parseInt(
    window.localStorage.getItem(TOOL_PANEL_STORAGE_KEY) || "",
    10,
  );
  return Number.isFinite(saved) ? Math.round(saved) : TOOL_PANEL_DEFAULT_WIDTH;
}

function toolPanelMaxWidth() {
  if (typeof window === "undefined") return 1180;
  if (isMobile.value) return window.innerWidth;
  const available = chatContentWrapperRef.value?.clientWidth || window.innerWidth;
  return Math.max(320, Math.min(Math.floor(available * 0.88), available - 120));
}

function clampToolPanelWidth(width: number) {
  const maxWidth = toolPanelMaxWidth();
  const minWidth = Math.min(TOOL_PANEL_MIN_WIDTH, maxWidth);
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

function handleToolPanelViewportResize() {
  if (isMobile.value) return;
  toolPanelWidth.value = clampToolPanelWidth(toolPanelWidth.value);
}

function handleToolResizeMove(event: PointerEvent) {
  const start = toolResizeStart.value;
  if (!start) return;
  const delta = (event.clientX - start.x) * start.deltaSign;
  toolPanelWidth.value = clampToolPanelWidth(start.width + delta);
}

function stopToolResize() {
  if (!toolResizeStart.value) return;
  toolResizeStart.value = null;
  window.removeEventListener("pointermove", handleToolResizeMove);
  window.removeEventListener("pointerup", stopToolResize);
  if (!isMobile.value) {
    window.localStorage.setItem(TOOL_PANEL_STORAGE_KEY, String(toolPanelWidth.value));
  }
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
}

function startToolResize(event: PointerEvent) {
  if (isMobile.value) return;
  event.preventDefault();
  toolResizeStart.value = {
    x: event.clientX,
    width: toolPanelWidth.value,
    deltaSign: document.documentElement.dir === "rtl" ? 1 : -1,
  };
  window.addEventListener("pointermove", handleToolResizeMove);
  window.addEventListener("pointerup", stopToolResize);
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";
}

function closeToolPanelOverlay(): boolean {
  if (toolPanelStore.workspaceDiff && filesStore.hasUnsavedChanges) {
    message.warning(t("files.unsavedChanges"));
    return false;
  }
  if (toolPanelStore.workspaceDiff && filesStore.editingFile) filesStore.closeEditor();
  workspacePreviewRequestSeq += 1;
  workspacePreviewRequestPending = false;
  filesStore.closePreview();
  toolPanelStore.closeWorkspaceDiff();
  selectedSubagent.value = null;
  previewOnlyFileOpen.value = false;
  showToolPanel.value = false;
  return true;
}

function toggleToolPanel() {
  if (showToolPanel.value) {
    closeToolPanelOverlay();
    return;
  }
  showToolPanel.value = true;
}

function handleToolPanelBeforeEnter() {
  toolPanelTransitionReady.value = false;
}

function handleToolPanelAfterEnter() {
  toolPanelTransitionReady.value = true;
}

function handleToolPanelBeforeLeave() {
  toolPanelTransitionReady.value = false;
}

function handleToolPanelLeaveCancelled() {
  toolPanelTransitionReady.value = true;
}

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function resetChatDropState() {
  chatDropCounter.value = 0;
  isChatDropActive.value = false;
}

function handleChatDragOver(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleChatDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  chatDropCounter.value += 1;
  isChatDropActive.value = true;
}

function handleChatDragLeave(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  chatDropCounter.value -= 1;
  if (chatDropCounter.value <= 0) resetChatDropState();
}

function handleChatDrop(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  const target = event.target instanceof Element ? event.target : null;
  resetChatDropState();
  if (!files.length || target?.closest(".chat-input-area")) return;
  chatInputRef.value?.addFiles?.(files);
}

function handleWorkspaceFileAttach(file: File) {
  chatInputRef.value?.addFiles?.([file]);
}

async function submitBrowserAnnotations(payload: BrowserAnnotationSubmission): Promise<boolean> {
  const attachment = createBrowserAnnotationAttachment(payload);
  await chatStore.sendMessage("", [attachment]);
  return true;
}

async function handleSessionClick(
  sessionId: string,
  options: { preserveCategoryCollapse?: boolean } = {},
) {
  if (!options.preserveCategoryCollapse) {
    setCategoryRevealSuppressedSessionId(null);
  }
  chatStore.clearSessionCompletedUnread(sessionId);
  if (isMobile.value) showSessions.value = false;
  await router.push({
    name: chatStore.runtimeMode === "global_agent" ? "hermes.globalAgentSession" : "hermes.session",
    params: { sessionId },
  });
  if (chatStore.activeSessionId !== sessionId) {
    await chatStore.switchSession(sessionId);
  }
}

async function handleRecentSessionClick(sessionId: string) {
  // Recent is a shortcut; selecting it must not overwrite the real category's saved collapse state.
  setCategoryRevealSuppressedSessionId(sessionId);
  await handleSessionClick(sessionId, { preserveCategoryCollapse: true });
}


watch(
  pageSidebarExpanded,
  (expanded) => appStore.setPageSidebarExpanded(expanded),
  { immediate: true },
);

function workspacePreviewPath(filePath: string): string | null {
  const workspace = activeWorkspacePath.value?.replace(/\\/g, "/").replace(/\/+$/, "");
  let decodedPath = filePath;
  try {
    decodedPath = decodeURIComponent(filePath);
  } catch {
    // Keep malformed percent sequences unchanged so the server can reject them.
  }
  const normalizedPath = decodedPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedPath || !(normalizedPath.startsWith("/") || /^[a-zA-Z]:\//.test(normalizedPath))) return null;
  if (!workspace) return normalizedPath;
  const ignoreCase = /^[a-zA-Z]:\//.test(workspace);
  const comparableWorkspace = ignoreCase ? workspace.toLowerCase() : workspace;
  const comparablePath = ignoreCase ? normalizedPath.toLowerCase() : normalizedPath;
  if (!comparablePath.startsWith(`${comparableWorkspace}/`)) return normalizedPath;
  return normalizedPath.slice(workspace.length + 1);
}

function handleWorkspaceFilePreviewRequest(event: Event) {
  const customEvent = event as CustomEvent<{
    path?: string
    fileName?: string
    previewOnly?: boolean
    startLine?: number
    endLine?: number
  }>;
  const sessionId = activePreviewSessionId.value;
  const filePath = typeof customEvent.detail?.path === "string" ? customEvent.detail.path : "";
  const previewPath = workspacePreviewPath(filePath);
  if (!sessionId || !previewPath) return;

  customEvent.preventDefault();
  const requestSeq = ++workspacePreviewRequestSeq;
  workspacePreviewRequestPending = true;
  const fileName = customEvent.detail?.fileName || previewPath.split("/").pop() || previewPath;
  const requestedStartLine = customEvent.detail?.startLine;
  const startLine = Number.isInteger(requestedStartLine) && requestedStartLine! > 0
    ? requestedStartLine
    : undefined;
  const requestedEndLine = customEvent.detail?.endLine;
  const endLine = startLine && Number.isInteger(requestedEndLine) && requestedEndLine! >= startLine
    ? requestedEndLine
    : startLine;
  filesStore.closePreview();
  toolPanelStore.closeWorkspaceDiff();
  selectedSubagent.value = null;
  const previewOnly = customEvent.detail?.previewOnly === true;
  previewOnlyFileOpen.value = previewOnly;
  if (previewOnly) showToolPanel.value = true;
  void filesStore.openSessionWorkspacePreview(
    sessionId,
    previewPath,
    fileName,
    -1,
    startLine ? { startLine, endLine } : undefined,
  )
    .then(() => {
      if (requestSeq === workspacePreviewRequestSeq) workspacePreviewRequestPending = false;
    })
    .catch((error) => {
      if (requestSeq !== workspacePreviewRequestSeq) return;
      workspacePreviewRequestPending = false;
      previewOnlyFileOpen.value = false;
      if (previewOnly) showToolPanel.value = false;
      message.error(error instanceof Error ? error.message : t("files.previewFailed"));
    });
}

function handleOpenSubagentStreamRequest(event: Event) {
  const customEvent = event as CustomEvent<OpenSubagentStreamDetail>;
  const detail = customEvent.detail;
  if (!detail?.sessionId || !detail.subagentId || detail.sessionId !== chatStore.activeSessionId) return;
  if (toolPanelStore.workspaceDiff && filesStore.hasUnsavedChanges) {
    message.warning(t("files.unsavedChanges"));
    return;
  }
  if (toolPanelStore.workspaceDiff && filesStore.editingFile) filesStore.closeEditor();
  workspacePreviewRequestSeq += 1;
  workspacePreviewRequestPending = false;
  filesStore.closePreview();
  toolPanelStore.closeWorkspaceDiff();
  previewOnlyFileOpen.value = false;
  selectedSubagent.value = detail;
  showToolPanel.value = true;
}

function handleOpenDesktopBrowserPanelRequest() {
  if (!desktopBrowserAvailable) return;
  if (toolPanelStore.workspaceDiff && filesStore.hasUnsavedChanges) {
    message.warning(t("files.unsavedChanges"));
    return;
  }
  if (toolPanelStore.workspaceDiff && filesStore.editingFile) filesStore.closeEditor();
  workspacePreviewRequestSeq += 1;
  workspacePreviewRequestPending = false;
  filesStore.closePreview();
  toolPanelStore.closeWorkspaceDiff();
  previewOnlyFileOpen.value = false;
  selectedSubagent.value = null;
  activeToolPanel.value = "browser";
  showToolPanel.value = true;
}

onMounted(() => {
  void fetchAgentAvailabilitySnapshot().catch(() => {});



  window.addEventListener("hermes:preview-workspace-file", handleWorkspaceFilePreviewRequest);
  window.addEventListener(OPEN_DESKTOP_BROWSER_PANEL_EVENT, handleOpenDesktopBrowserPanelRequest);
  window.addEventListener(OPEN_SUBAGENT_STREAM_EVENT, handleOpenSubagentStreamRequest);
  window.addEventListener("resize", handleToolPanelViewportResize);
  handleToolPanelViewportResize();
  if (profilesStore.profiles.length === 0) {
    void profilesStore.fetchProfiles();
  }
  if (!props.standalone) void loadSessionCategories();
});

watch(
  () => chatStore.activeSessionId,
  async (sessionId, previousSessionId) => {
    if (sessionId === previousSessionId || !previousSessionId) return;

    if (filesStore.previewFile || toolPanelStore.workspaceDiff || selectedSubagent.value || previewOnlyFileOpen.value) {
      closeToolPanelOverlay();
    } else {
      workspacePreviewRequestSeq += 1;
      workspacePreviewRequestPending = false;
      filesStore.closePreview();
    }
    if (!sessionId) return;

    await nextTick();
    // A session you just opened should be ready to type in. Without this the
    // composer keeps whatever focus the sidebar click left behind, so the first
    // keystroke goes nowhere.
    chatInputRef.value?.focusComposer?.();
  },
  { flush: "post" },
);

onUnmounted(() => {
  newChatOptionsLoadSequence++;

  window.removeEventListener("hermes:preview-workspace-file", handleWorkspaceFilePreviewRequest);
  window.removeEventListener(OPEN_DESKTOP_BROWSER_PANEL_EVENT, handleOpenDesktopBrowserPanelRequest);
  window.removeEventListener(OPEN_SUBAGENT_STREAM_EVENT, handleOpenSubagentStreamRequest);
  window.removeEventListener("resize", handleToolPanelViewportResize);
  stopToolResize();
  workspacePreviewRequestSeq += 1;
  if (workspacePreviewRequestPending || previewOnlyFileOpen.value || filesStore.previewFile?.workspaceSessionId) filesStore.closePreview();
  workspacePreviewRequestPending = false;
  previewOnlyFileOpen.value = false;
  toolPanelStore.closeWorkspaceDiff();
});
watch(showToolPanel, async (visible) => {
  if (!visible || isMobile.value) return;
  await nextTick();
  handleToolPanelViewportResize();
});

watch(
  () => toolPanelStore.workspaceDiff,
  (workspaceDiff) => {
    if (workspaceDiff) {
      workspacePreviewRequestSeq += 1;
      workspacePreviewRequestPending = false;
      filesStore.closePreview();
      selectedSubagent.value = null;
      previewOnlyFileOpen.value = false;
      showToolPanel.value = true;
    }
  },
);

watch(
  () => filesStore.previewFile,
  (previewFile) => {
    if (previewFile) {
      selectedSubagent.value = null;
      activeToolPanel.value = "files";
      showToolPanel.value = true;
    }
  },
);

const showRenameModal = ref(false);
const renameValue = ref("");
const renameSessionId = ref<string | null>(null);
const renameInputRef = ref<InstanceType<typeof NInput> | null>(null);
const sessionProfileFilter = computed(() => chatStore.sessionProfileFilter);
const sessionCategories = ref<SessionCategory[]>([]);
const sessionCategoriesLoading = ref(false);
const sessionCategoriesLoaded = ref(false);
usePageLoadingTask(() => !props.standalone && props.contentMode === 'chat' && !sessionCategoriesLoaded.value);
const sessionCategoriesLoadFailed = ref(false);
const showCreateCategoryModal = ref(false);
const createCategoryValue = ref("");
const createCategorySessionId = ref<string | null>(null);
const createCategoryPendingCategory = ref<SessionCategory | null>(null);
const createCategorySubmitting = ref(false);
const createCategoryInputRef = ref<InstanceType<typeof NInput> | null>(null);
let sessionCategoriesLoadPromise: Promise<void> | null = null;
const COLLAPSED_CATEGORIES_STORAGE_KEY = "hermes_chat_collapsed_categories";
const RECENT_CATEGORY_REVEAL_SUPPRESSION_STORAGE_KEY = "hermes_chat_recent_category_reveal_suppression";
const showRecentCountModal = ref(false);
const recentCountDraft = ref(sessionBrowserPrefsStore.recentCount);

function loadCollapsedCategories(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

const collapsedCategories = ref<Set<string>>(loadCollapsedCategories());

function loadCategoryRevealSuppressedSessionId(): string | null {
  try {
    return sessionStorage.getItem(RECENT_CATEGORY_REVEAL_SUPPRESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

const categoryRevealSuppressedSessionId = ref<string | null>(
  loadCategoryRevealSuppressedSessionId(),
);

function setCategoryRevealSuppressedSessionId(sessionId: string | null) {
  categoryRevealSuppressedSessionId.value = sessionId;
  try {
    if (sessionId) {
      sessionStorage.setItem(RECENT_CATEGORY_REVEAL_SUPPRESSION_STORAGE_KEY, sessionId);
    } else {
      sessionStorage.removeItem(RECENT_CATEGORY_REVEAL_SUPPRESSION_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory behavior when session storage is unavailable.
  }
}

function persistCollapsedCategories() {
  localStorage.setItem(
    COLLAPSED_CATEGORIES_STORAGE_KEY,
    JSON.stringify([...collapsedCategories.value]),
  );
}

function toggleCategoryGroup(key: string) {
  const next = new Set(collapsedCategories.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsedCategories.value = next;
  persistCollapsedCategories();
}
async function handleProfileFilterChange(value: string | null) {
  chatStore.setSessionProfileFilter(value);
  await chatStore.loadSessions(chatStore.sessionProfileFilter);
}

function sortSessionsForSidebar(items: Session[]): Session[] {
  return [...items].sort((a, b) => {
    const aLive = chatStore.isSessionLive(a.id);
    const bLive = chatStore.isSessionLive(b.id);
    if (aLive !== bLive) return aLive ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

const recentSessionPartition = computed(() => partitionRecentSessions(
  chatStore.sessions.filter((session) => !/^person-(main|task)-/.test(session.id) && !session.isPinned),
  sessionBrowserPrefsStore.recentCount,
  t("chat.recent"),
));
const recentSessions = computed(() => recentSessionPartition.value.group);
const nonRecentSessions = computed(() => recentSessionPartition.value.remaining);
const sessionCategoryNames = computed(() => new Map(
  sessionCategories.value.map(category => [category.id, category.name]),
));

function recentCategoryLabel(session: Session): string | undefined {
  return resolveRecentSessionCategoryLabel(
    session.categoryId,
    sessionCategoryNames.value,
    sessionCategoriesLoaded.value,
    sessionCategoriesLoadFailed.value,
    t("chat.uncategorized"),
  );
}

function toggleRecentGroup() {
  sessionBrowserPrefsStore.setRecentCollapsed(!sessionBrowserPrefsStore.recentCollapsed);
}

const pinnedSessions = computed(() =>
  sortSessionsForSidebar(
    chatStore.sessions.filter((session) => !/^person-(main|task)-/.test(session.id) &&
      session.isPinned,
    ),
  ),
);

const unpinnedSessions = computed(() =>
  sortSessionsForSidebar(
    nonRecentSessions.value.filter(
      (session) => !session.isPinned,
    ),
  ),
);

const categorizedSessions = computed(() => buildVisibleSessionCategoryGroups(
  sessionCategories.value,
  unpinnedSessions.value,
  t("chat.uncategorized"),
));

function openRecentCountModal(event: MouseEvent) {
  event.stopPropagation();
  recentCountDraft.value = sessionBrowserPrefsStore.recentCount;
  showRecentCountModal.value = true;
}

function saveRecentCount() {
  sessionBrowserPrefsStore.setRecentCount(recentCountDraft.value);
  showRecentCountModal.value = false;
}

const activeSessionCategoryKey = computed(() => {
  const session = chatStore.sessions.find((item) => item.id === chatStore.activeSessionId);
  return session?.categoryId == null ? "category-none" : `category-${session.categoryId}`;
});

watch(
  [
    () => sessionCategoriesLoaded.value,
    () => categorizedSessions.value.map((group) => group.key).join("\u0000"),
    () => chatStore.activeSessionId,
    activeSessionCategoryKey,
  ],
  ([loaded, , sessionId, activeKey], [previousLoaded, , previousSessionId, previousActiveKey]) => {
    if (!sessionCategoriesLoaded.value || categorizedSessions.value.length === 0) return;
    const activeSession = chatStore.sessions.find((session) => session.id === chatStore.activeSessionId);
    if (categoryRevealSuppressedSessionId.value === activeSession?.id) return;
    setCategoryRevealSuppressedSessionId(null);
    // Only navigation or a changed category should reveal the active session.
    // Background list refreshes must preserve manually collapsed groups.
    const shouldReveal = loaded !== previousLoaded
      || sessionId !== previousSessionId
      || activeKey !== previousActiveKey;
    if (shouldReveal && collapsedCategories.value.has(activeKey)) {
      collapsedCategories.value = new Set(
        [...collapsedCategories.value].filter((key) => key !== activeKey),
      );
      persistCollapsedCategories();
    }
    if (localStorage.getItem(COLLAPSED_CATEGORIES_STORAGE_KEY) !== null) return;
    const expandedKey = categorizedSessions.value.some((group) => group.key === activeKey)
      ? activeKey
      : categorizedSessions.value[0]?.key;
    collapsedCategories.value = new Set(
      categorizedSessions.value.map((group) => group.key).filter((key) => key !== expandedKey),
    );
    persistCollapsedCategories();
  },
  { immediate: true },
);

async function loadSessionCategories() {
  if (sessionCategoriesLoadPromise) return sessionCategoriesLoadPromise;
  sessionCategoriesLoading.value = true;
  sessionCategoriesLoadPromise = (async () => {
    try {
      sessionCategories.value = await fetchSessionCategories();
      sessionCategoriesLoadFailed.value = false;
    } catch {
      sessionCategoriesLoadFailed.value = true;
      message.error(t("chat.categoryLoadFailed"));
    } finally {
      sessionCategoriesLoaded.value = true;
      sessionCategoriesLoading.value = false;
      sessionCategoriesLoadPromise = null;
    }
  })();
  return sessionCategoriesLoadPromise;
}

async function retrySessionCategories() {
  showContextMenu.value = false;
  await loadSessionCategories();
}

const activeSessionTitle = computed(
  () => chatStore.activeSession?.title || t("chat.newChat"),
);

const activeSessionUsesGlobalCodingAgentConfig = computed(() => {
  const session = chatStore.activeSession;
  return session?.codingAgentMode === "global" && Boolean(session.codingAgentId || session.source === "coding_agent");
});

const activeSessionModelLabel = computed(() => {
  const session = chatStore.activeSession;
  if (activeSessionUsesGlobalCodingAgentConfig.value) return t("codingAgents.launchModeGlobal");
  if (!session?.model) return t("models.selectModel");
  if (session.provider === "moa") return `MoA · ${session.model}`;
  return appStore.displayModelName(session.model, session.provider);
});

const headerTitle = computed(() =>
  currentMode.value === "live"
    ? t("chat.liveSessions")
    : activeSessionTitle.value,
);

const showNewChatModal = ref(false);
const showNewChatPage = ref(false);
const pageLoading = usePageLoadingState();
const isEmptySingleChat = computed(() =>
  props.contentMode === "chat" && currentMode.value === "chat"
  && chatStore.runtimeMode === "default" && route.name === "hermes.chat"
  && !pageLoading.value && chatStore.sessionsLoaded && !chatStore.isLoadingSessions
  && !chatStore.activeSessionId && chatStore.sessions.length === 0,
);
const showNewChatSettings = ref(false);
const showNewChatCategory = ref(false);
const newChatCategoryTriggerRef = ref<InstanceType<typeof NButton> | null>(null);
const newChatCategoryAnchor = ref({ x: 0, y: 0 });

const showNewChatPresetMode = ref(false);
const newChatComposerRevision = ref(0);
const newChatPreviousToolPanel = ref(false);
const newChatModelLabel = computed(() => isNewChatGlobalCodingAgent.value
  ? nativeModelDisplayName(newChatNativeSelection.value.model)
  : newChatModel.value ? appStore.displayModelName(newChatModel.value, newChatProvider.value)
    : newChatHasNoModels.value ? t("models.noModels") : t("models.selectModel"));

function updateNewChatCategoryAnchor() {
  if (!showNewChatCategory.value) return;
  const trigger = newChatCategoryTriggerRef.value?.$el as HTMLElement | undefined;
  if (!trigger) return;
  const bounds = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const width = Math.min(isMobile.value ? 320 : 280, viewportWidth - 32);
  // A wide mobile menu needs a viewport-safe center rather than the icon's left edge.
  const x = isMobile.value
    ? Math.max(16 + width / 2, Math.min(bounds.left + bounds.width / 2, viewportWidth - 16 - width / 2))
    : Math.max(16, Math.min(bounds.left, viewportWidth - 16 - width));
  const y = bounds.bottom;
  if (newChatCategoryAnchor.value.x !== x || newChatCategoryAnchor.value.y !== y) {
    newChatCategoryAnchor.value = { x, y };
  }
}

function handleNewChatCategoryShow(show: boolean) {
  showNewChatCategory.value = show;
  if (show) updateNewChatCategoryAnchor();
}

function handleNewChatCategoryClickOutside(event: MouseEvent) {
  const trigger = newChatCategoryTriggerRef.value?.$el as HTMLElement | undefined;
  if (event.target instanceof Node && trigger?.contains(event.target)) return;
  showNewChatCategory.value = false;
}

function closeNewChatPage() {
  if (showNewChatPage.value) persistNewChatForm();
  showNewChatPage.value = false;
  if (sessionModelIsDraft.value) {
    showSessionModelPicker.value = false;
    showSessionModelModeModal.value = false;
    pendingSessionModelSwitch.value = null;
    sessionModelIsDraft.value = false;
  }
  if (workspaceIsDraft.value) {
    showWorkspaceModal.value = false;
    workspaceIsDraft.value = false;
  }
  showNewChatSettings.value = false;
  showNewChatCategory.value = false;
  showNewChatPresetMode.value = false;
  newChatOptionsLoadSequence++;
}


watch(() => router.currentRoute.value.fullPath, () => closeNewChatPage());
const NEW_CHAT_AGENT_STORAGE_KEY = "hermes_new_chat_agent_v1";
const DEFAULT_NEW_CHAT_AGENT = "ekko-agent";
function loadNewChatAgent(): "hermes" | ChatCodingAgentId {
  try {
    const saved = localStorage.getItem(NEW_CHAT_AGENT_STORAGE_KEY);
    return isPluginAgentId(saved) ? saved : AGENT_OPTIONS.find(option => option.value === saved)?.value || DEFAULT_NEW_CHAT_AGENT;
  } catch {
    return DEFAULT_NEW_CHAT_AGENT;
  }
}
let preferredNewChatAgent = loadNewChatAgent();
const newChatAgent = ref<"hermes" | ChatCodingAgentId>(preferredNewChatAgent);
const newChatAgentMode = ref<"global" | "scoped">("scoped");
const newChatProfile = ref<string>("default");
const newChatProvider = ref<string>("");
const newChatModel = ref<string>("");
const newChatModelKind = ref<"model" | "moa">("model");
const newChatBaseUrl = ref<string>("");
const newChatApiKey = ref<string>("");
const newChatApiMode = ref<CodingAgentApiMode>("codex_responses");
const newChatApiModeManual = ref(false);
const newChatWorkspace = ref("");
const newChatProjectSlug = ref<string | null>(null);
const newChatExtraDirs = ref<string[]>([]);
const newChatAgentPreset = ref<string>();
const newChatPresetReady = ref(false);
const newChatCategoryId = ref<number | null>(null);
const newChatCategoryCreating = ref(false);
const newChatCategorySelectRevision = ref(0);
const newChatLoading = ref(false);
const newChatAgentLoading = ref(false);
const newChatModelsLoading = ref(false);
let newChatOptionsLoadSequence = 0;
let restoringNewChatForm = false;

const newChatCustomModel = ref(false);

const newChatReasoningEffort = ref("");

const newChatNativeSelections = ref<Record<string, { model: string; reasoningEffort: string }>>({});

const sessionModelIsDraft = ref(false);

const showSessionModelPicker = ref(false);

const workspaceIsDraft = ref(false);
const sessionModelTrigger = ref<HTMLElement | null>(null);
const newChatComposerReasoningEffort = computed({
  get: () => isNewChatGlobalCodingAgent.value ? newChatNativeSelection.value.reasoningEffort || selectedNewChatNativeModel.value?.reasoningEffort || "" : newChatReasoningEffort.value,
  set: (value: string) => {
    if (isNewChatGlobalCodingAgent.value) newChatNativeSelections.value[newChatAgent.value] = selectNativeModelEffort(newChatNativeCatalog.value?.models, newChatNativeSelection.value.model, value);
    else newChatReasoningEffort.value = value;
  },
});
const newChatDraftConfig = computed(() => ({
  agent: newChatAgent.value,
  profile: newChatProfile.value,
  provider: isNewChatGlobalCodingAgent.value ? "" : newChatProvider.value,
  model: isNewChatGlobalCodingAgent.value ? newChatNativeSelection.value.model : newChatModel.value,
  codingAgentMode: isNewChatCodingAgent.value ? effectiveNewChatAgentMode.value : undefined,
}));

const newChatSettingsSelectProps = {
  to: true,
  // Leave room for the trigger and screen edges when a long menu flips upward.
  themeOverrides: { peers: { InternalSelectMenu: { height: "min(300px, calc(50dvh - 40px))" } } },
};

function handleNewChatAgentChange(value: "hermes" | ChatCodingAgentId) {
  if (!newChatAgentOptions.value.some(option => option.value === value)) return;
  showNewChatPresetMode.value = false;
  preferredNewChatAgent = value;
  newChatAgent.value = value;
  try {
    localStorage.setItem(NEW_CHAT_AGENT_STORAGE_KEY, value);
  } catch {
    // Keep the selection in memory when local storage is unavailable.
  }
}

function openNewChatWorkspace() {
  if (newChatLoading.value) return;
  workspaceIsDraft.value = true;
  workspaceSessionId.value = null;
  workspaceValue.value = newChatWorkspace.value;
  showWorkspaceModal.value = true;
  void initWorkspaceComposable();
}

function handleNewChatLaunchModeKeydown(event: KeyboardEvent) {
  if (newChatLoading.value || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  handleNewChatLaunchModeChange(event.key === "End" || (event.key !== "Home" && newChatAgentMode.value !== "global"));
  const group = event.currentTarget as HTMLElement;
  nextTick(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
}

function handleNewChatLaunchModeChange(global: boolean) {
  if (!newChatLoading.value) newChatAgentMode.value = global ? "global" : "scoped";
}

function nativeModelDisplayName(model: string) {
  return nativeModelLabel(newChatNativeCatalog.value?.models, model, t("codingAgents.nativeModelDefault"));
}

async function openSessionModelPicker(sessionId: string | null, event?: MouseEvent) {
  sessionModelTrigger.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const isDraft = sessionId === null;
  const draftSequence = newChatOptionsLoadSequence;
  if (isDraft && (!showNewChatPage.value || newChatLoading.value)) return;
  if (isDraft && isNewChatGlobalCodingAgent.value) {
    sessionModelSessionId.value = null;
    sessionModelIsDraft.value = true;
    sessionModelValue.value = nativeModelPickerId(newChatNativeCatalog.value?.models, newChatNativeSelection.value.model);
    sessionModelProvider.value = `native:${newChatAgent.value}`;
    showSessionModelPicker.value = true;
    return;
  }
  const requestedSession =
    chatStore.sessions.find((s) => s.id === sessionId) ||
    (chatStore.activeSession?.id === sessionId ? chatStore.activeSession : undefined);
  if (
    requestedSession?.codingAgentMode === "global" &&
    Boolean(requestedSession.codingAgentId || requestedSession.source === "coding_agent")
  ) return;
  if (appStore.modelGroups.length === 0 && appStore.profileModelGroups.length === 0) {
    await appStore.loadModels();
  }
  if (isDraft && !isCurrentNewChatOptionsLoad(draftSequence)) return;
  sessionModelSessionId.value = sessionId;
  sessionModelIsDraft.value = isDraft;
  const session = sessionModelSession.value;
  const groups = sessionModelBaseGroups.value;
  const providerGroup = session?.provider
    ? groups.find((group) => group.provider === session.provider)
    : undefined;
  const fallbackGroup = providerGroup || groups.find((group) => group.models.length > 0);
  const defaults = {
    provider: fallbackGroup?.provider || "",
    model: fallbackGroup?.models.includes(session?.model || "")
      ? session?.model || ""
      : fallbackGroup?.models[0] || "",
  };
  const usesMoa = session?.provider === "moa" && sessionCanUseMoa.value;
  sessionModelValue.value = usesMoa
    ? session?.model || ""
    : providerGroup ? session?.model || defaults.model || "" : defaults.model || "";
  sessionModelProvider.value = usesMoa
    ? "moa"
    : providerGroup ? session?.provider || "" : defaults.provider || "";
  pendingSessionModelSwitch.value = null;
  showSessionModelModeModal.value = false;
  showSessionModelPicker.value = true;
}

function persistNewChatForm() {
  if (restoringNewChatForm) return;
  saveNewChatFormPreferences(getStoredUserId(), {
    agent: preferredNewChatAgent, mode: newChatAgentMode.value, profile: newChatProfile.value,
    provider: newChatProvider.value, model: newChatModel.value, customModel: newChatCustomModel.value,
    apiMode: newChatApiMode.value, apiModeManual: newChatApiModeManual.value, reasoningEffort: newChatReasoningEffort.value,
    workspace: newChatWorkspace.value, categoryId: newChatCategoryId.value,
    agentPreset: newChatAgentPreset.value, baseUrl: newChatBaseUrl.value, apiKey: newChatApiKey.value,
    nativeModels: newChatNativeSelections.value,
  });
}

watch([newChatAgent, newChatAgentMode, newChatProfile, newChatProvider, newChatModel, newChatCustomModel,
  newChatApiMode, newChatApiModeManual, newChatReasoningEffort, newChatWorkspace, newChatCategoryId, newChatAgentPreset, newChatBaseUrl, newChatApiKey],
  () => { if (showNewChatPage.value) persistNewChatForm(); }, { flush: "post" });
watch(newChatNativeSelections, () => { if (showNewChatPage.value) persistNewChatForm(); }, { deep: true });

const newChatCategoryOptions = computed(() => [
  { label: t("chat.uncategorized"), value: 0 },
  ...sessionCategories.value.map((category) => ({
    label: category.name,
    value: category.id,
  })),
]);

async function handleNewChatProjectChange(slug: string | null) {
  newChatProjectSlug.value = slug;
  if (!slug) {
    newChatExtraDirs.value = [];
    return;
  }
  const project = workspaceProjects.value.find((p) => p.slug === slug);
  if (!project) return;
  const paths = project.folders.map((f) => f.path);
  const primary = project.primary_path || paths[0];
  if (!primary) return;
  // Main workspace = primary repo; extras = remaining member dirs.
  newChatWorkspace.value = primary;
  newChatExtraDirs.value = paths.filter((d) => d !== primary);
}

// Auto-bind new-chat primary dir to a registered project on USER pick/edit:
// matching primary_path pulls in the project's extra dirs + dropdown reflect.
function handleNewChatPrimaryChange() {
  const primary = (newChatWorkspace.value || "").trim();
  newChatProjectSlug.value = null;
  if (!primary) return;
  const project = workspaceProjects.value.find(
    (p) => (p.primary_path || p.folders.find((f) => f.is_primary)?.path) === primary,
  );
  if (!project) return;
  const paths = project.folders.map((f) => f.path);
  newChatProjectSlug.value = project.slug;
  newChatExtraDirs.value = [...new Set(paths.filter((d) => d !== primary))];
}

async function handleNewChatCategoryChange(value: string | number | null) {
  if (value === null || value === 0) {
    newChatCategoryId.value = null;
    return;
  }
  if (typeof value === "number") {
    newChatCategoryId.value = value;
    return;
  }

  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return;
  const existing = sessionCategories.value.find(
    (category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (existing) {
    newChatCategoryId.value = existing.id;
    newChatCategorySelectRevision.value += 1;
    return;
  }

  newChatCategoryCreating.value = true;
  try {
    const category = await createSessionCategory(name);
    if (!sessionCategories.value.some((item) => item.id === category.id)) {
      sessionCategories.value = [...sessionCategories.value, category].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }
    newChatCategoryId.value = category.id;
    message.success(t("chat.categoryCreated", { name: category.name }));
  } catch (error: any) {
    message.error(error?.message || t("chat.categoryCreateFailed"));
  } finally {
    newChatCategoryCreating.value = false;
    // Clear the string tag retained internally by NSelect after resolving it to a category ID.
    newChatCategorySelectRevision.value += 1;
  }
}

// Default workspace feature (multiple defaults supported)
const defaultWorkspaces = ref<string[]>([]);
const recentWorkspaces = ref<Array<{ path: string; lastUsed: number; useCount: number }>>([]);
let workspaceComposable: ReturnType<typeof useDefaultWorkspace> | null = null;

function initWorkspaceComposable() {
  workspaceComposable = useDefaultWorkspace();
  return workspaceComposable.init().then(() => {
    defaultWorkspaces.value = workspaceComposable!.defaultWorkspaces.value;
    recentWorkspaces.value = workspaceComposable!.recentWorkspaces.value;
  });
}

function handleToggleDefaultWorkspace() {
  if (!workspaceComposable) return;
  const currentPath = newChatWorkspace.value;
  if (!currentPath) return;
  
  const isDefault = defaultWorkspaces.value.includes(currentPath);
  if (isDefault) {
    workspaceComposable.removeDefaultWorkspace(currentPath);
    defaultWorkspaces.value = defaultWorkspaces.value.filter(p => p !== currentPath);
  } else {
    workspaceComposable.addDefaultWorkspace(currentPath);
    defaultWorkspaces.value = [...defaultWorkspaces.value, currentPath];
  }
}

function handleSelectRecentWorkspace(path: string) {
  newChatWorkspace.value = path;
}

function handleSelectDefaultWorkspace(path: string) {
  newChatWorkspace.value = path;
  showDefaultWorkspaceMenu.value = false;
}

function handleTogglePinRecent(path: string) {
  if (!workspaceComposable) return;
  const isDefault = defaultWorkspaces.value.includes(path);
  if (isDefault) {
    workspaceComposable.removeDefaultWorkspace(path);
    defaultWorkspaces.value = defaultWorkspaces.value.filter(p => p !== path);
  } else {
    workspaceComposable.addDefaultWorkspace(path);
    defaultWorkspaces.value = [...defaultWorkspaces.value, path];
  }
}

const isCurrentWorkspaceDefault = computed(() => {
  return Boolean(newChatWorkspace.value && defaultWorkspaces.value.includes(newChatWorkspace.value));
});

const showDefaultWorkspaceMenu = ref(false);

function getFolderName(path: string | null): string {
  if (!path) return '';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

const mostRecentDefaultWorkspace = computed(() => {
  if (defaultWorkspaces.value.length === 0) return null;
  
  // 从最近使用记录中找第一个默认工作区
  const recent = [...recentWorkspaces.value].sort((a, b) => b.lastUsed - a.lastUsed);
  for (const entry of recent) {
    if (defaultWorkspaces.value.includes(entry.path)) {
      return entry.path;
    }
  }
  
  // 如果没有使用记录，返回第一个默认工作区
  return defaultWorkspaces.value[0];
});

// 动态计算可见的工作区数量（根据容器宽度）
const visibleDefaultWorkspaces = computed(() => {
  if (defaultWorkspaces.value.length === 0) return [];
  
  // 简单策略：前2个总是可见，其余通过"更多"菜单
  // 未来可以根据实际容器宽度动态调整
  const maxVisible = Math.min(2, defaultWorkspaces.value.length);
  return defaultWorkspaces.value.slice(0, maxVisible);
});

const hasHiddenDefaults = computed(() => {
  return defaultWorkspaces.value.length > visibleDefaultWorkspaces.value.length;
});

const hiddenDefaultWorkspaces = computed(() => {
  const visible = new Set(visibleDefaultWorkspaces.value);
  return defaultWorkspaces.value.filter(ws => !visible.has(ws));
});


const newChatAgentAvailability = ref<AgentAvailabilitySnapshot | null>(null);
const newChatAgentOptions = computed(() => AGENT_OPTIONS.filter(option =>
  option.value === DEFAULT_NEW_CHAT_AGENT
    || (agentInstallationState(newChatAgentAvailability.value, option.value) === "installed" && agentSupportsSurface(option.value, 'chat')),
));

function selectPreferredNewChatAgent() {
  newChatAgent.value = newChatAgentOptions.value.find(option => option.value === preferredNewChatAgent)?.value || DEFAULT_NEW_CHAT_AGENT;
}

const newChatApiModeOptions = computed(() => [
  { label: t("codingAgents.protocolOpenAiChat"), value: "chat_completions" },
  { label: t("codingAgents.protocolOpenAiResponses"), value: "codex_responses" },
  { label: t("codingAgents.protocolAnthropicMessages"), value: "anthropic_messages" },
]);

const newChatAgentModeOptions = computed(() => [
  { label: t("codingAgents.launchModeGlobal"), value: "global" },
  { label: t("codingAgents.launchModeScoped"), value: "scoped" },
]);

function effectiveNewChatMode(
  agent: typeof newChatAgent.value,
  requestedMode: typeof newChatAgentMode.value,
) {
  if (agent === "ekko-agent") return "scoped";
  if (isGlobalOnlyCodingAgent(agent)) return "global";
  return requestedMode;
}

function getModelGroupsForProfile(profile: string) {
  const profileModels = appStore.profileModelGroups.find(
    (entry) => entry.profile === profile,
  );
  return profileModels?.groups || [];
}

function isNewChatProviderAllowed(group: AvailableModelGroup) {
  if (group.provider === "moa") return newChatAgent.value === "hermes";
  const mode = effectiveNewChatMode(newChatAgent.value, newChatAgentMode.value);
  if (!(newChatAgent.value !== "hermes" && mode === "scoped")) return true;
  return canScopedCodingAgentUseProvider(newChatAgent.value as ChatCodingAgentId, group.provider);
}

function getSelectableModelGroupsForProfile(profile: string) {
  return getModelGroupsForProfile(profile).filter(isNewChatProviderAllowed);
}

function getDefaultModelForProfile(profile: string) {
  const groups = getSelectableModelGroupsForProfile(profile);
  const activeProfileName = profilesStore.activeProfileName || "default";
  const selectedProvider = appStore.selectedProvider || "";
  const selectedModel = appStore.selectedModel || "";
  const selectedGroup = selectedProvider
    ? groups.find((group) => group.provider === selectedProvider)
    : undefined;
  if (
    profile === activeProfileName &&
    selectedGroup?.models.includes(selectedModel)
  ) {
    return {
      provider: selectedProvider,
      model: selectedModel,
    };
  }
  const profileModels = appStore.profileModelGroups.find(
    (entry) => entry.profile === profile,
  );
  const defaultProvider = profileModels?.default_provider || "";
  const defaultModel = profileModels?.default || "";
  const providerGroup = defaultProvider
    ? groups.find((group) => group.provider === defaultProvider)
    : undefined;
  const fallbackGroup = providerGroup || groups.find((group) => group.models.length > 0);
  return {
    provider: fallbackGroup?.provider || "",
    model: fallbackGroup?.models.includes(defaultModel)
      ? defaultModel
      : fallbackGroup?.models[0] || "",
  };
}

const newChatProfileOptions = computed(() =>
  (profilesStore.profiles.length > 0 ? profilesStore.profiles : [{ name: "default" }]).map((profile) => ({
    label: profile.name,
    value: profile.name,
  })),
);

const newChatModelGroups = computed(() => {
  const groups = getSelectableModelGroupsForProfile(newChatProfile.value);
  return newChatModelKind.value === "moa"
    ? groups.filter((group) => group.provider === "moa")
    : groups.filter((group) => group.provider !== "moa");
});

const newChatMoaGroup = computed(() =>
  getSelectableModelGroupsForProfile(newChatProfile.value).find((group) => group.provider === "moa"),
);

const newChatCanUseMoa = computed(() =>
  newChatAgent.value === "hermes" && Boolean(newChatMoaGroup.value?.models.length),
);

const newChatProviderOptions = computed(() =>
  newChatModelGroups.value.map((group) => ({
    label: group.label || group.provider,
    value: group.provider,
  })),
);

const newChatModelOptions = computed(() => {
  const group = newChatModelGroups.value.find(
    (item) => item.provider === newChatProvider.value,
  );
  return (group?.models || []).map((model) => ({
    label: appStore.displayModelName(model, group?.provider),
    value: model,
  }));
});

const selectedNewChatProviderGroup = computed(() =>
  newChatModelGroups.value.find((item) => item.provider === newChatProvider.value),
);

const isNewChatCodingAgent = computed(() => newChatAgent.value !== "hermes");
const isNewChatExternalCodingAgent = computed(() => newChatAgent.value.startsWith("plugin:") || newChatAgent.value === "claude-code" || newChatAgent.value === "codex" || newChatAgent.value === "pi" || newChatAgent.value === "grok" || (newChatAgent.value === "antigravity" || isNativeCodingAgent(newChatAgent.value)) || isGlobalOnlyCodingAgent(newChatAgent.value) || (newChatAgent.value === "opencode" || newChatAgent.value === "dsh"));
const effectiveNewChatAgentMode = computed(() =>
  effectiveNewChatMode(newChatAgent.value, newChatAgentMode.value),
);
const isNewChatGlobalCodingAgent = computed(() =>
  isNewChatCodingAgent.value && effectiveNewChatAgentMode.value === "global",
);
const { catalog: newChatNativeCatalog } = useCodingAgentModels(
  () => newChatAgent.value as CodingAgentId,
  () => showNewChatPage.value && isNewChatGlobalCodingAgent.value,
  () => newChatProfile.value,
);
const newChatNativeSelection = computed(() => newChatNativeSelections.value[newChatAgent.value] || { model: "", reasoningEffort: "" });
const selectedNewChatNativeModel = computed(() => nativeCatalogModel(newChatNativeCatalog.value?.models, newChatNativeSelection.value.model));
const newChatNativeReasoningEfforts = computed(() => selectedNewChatNativeModel.value?.reasoningEfforts || []);
const newChatNativeEffortChoices = computed(() => nativeModelEffortChoices(newChatNativeCatalog.value?.models, newChatNativeSelection.value.model));
useCodingAgentModels( /* catalog unused after merge; keep side-effect subscription */
  () => {
    const id = chatStore.activeSession?.codingAgentId || chatStore.activeSession?.agent || "codex";
    return (agentMetadata(id)?.id || id) as CodingAgentId;
  },
  () => !showNewChatPage.value && activeSessionUsesGlobalCodingAgentConfig.value,
  () => chatStore.activeSession?.profile,
);
const newChatModelCatalogKnown = computed(() => appStore.profileModelGroups.some(entry => entry.profile === newChatProfile.value));
function isNewChatModelAvailable(group = selectedNewChatProviderGroup.value) {
  return !!group && !group.model_meta?.[newChatModel.value]?.disabled && (
    group.models.includes(newChatModel.value) || (appStore.customModels[group.provider] || []).includes(newChatModel.value)
    || (newChatCustomModel.value && !!newChatModel.value)
  );
}
const newChatHasNoModels = computed(() => !isNewChatGlobalCodingAgent.value && !newChatModelsLoading.value
  && newChatModelCatalogKnown.value && !isNewChatModelAvailable() && !getSelectableModelGroupsForProfile(newChatProfile.value)
    .some(group => group.models.some(model => !group.model_meta?.[model]?.disabled)
      || (appStore.customModels[group.provider] || []).length > 0));
function openNewChatModelSettings() {
  showSessionModelPicker.value = false;
  void router.push({ name: "hermes.models", query: { modelProfile: newChatProfile.value } });
}

const newChatUsesProviderModel = computed(() => !isNewChatGlobalCodingAgent.value);
const newChatNeedsBaseUrl = computed(() =>
  isNewChatCodingAgent.value && !isPluginAgentId(newChatAgent.value) && effectiveNewChatAgentMode.value === "scoped" && !selectedNewChatProviderGroup.value?.base_url,
);
const newChatUsesServerAuth = computed(() =>
  usesServerManagedProviderAuth(newChatAgent.value as ChatCodingAgentId, selectedNewChatProviderGroup.value?.provider),
);
const newChatNeedsApiKey = computed(() =>
  isNewChatCodingAgent.value &&
  effectiveNewChatAgentMode.value === "scoped" &&
  !newChatUsesServerAuth.value &&
  !hasConfiguredProviderApiKey(selectedNewChatProviderGroup.value),
);
const canConfirmNewChat = computed(() => {
  if (newChatCategoryCreating.value || newChatLoading.value) return false;
  if (!newChatAgentOptions.value.some(option => option.value === newChatAgent.value)) return false;
  if (newChatAgent.value === "dsh" && (!newChatAgentPreset.value || !newChatPresetReady.value)) return false;
  if (!profilesStore.profiles.some(profile => profile.name === newChatProfile.value)) return false;
  if (!newChatUsesProviderModel.value) return true;
  if (newChatModelsLoading.value) return false;
  if (!newChatProvider.value || !newChatModel.value) return false;
  if (!isNewChatCodingAgent.value) return true;
  if (isNewChatCodingAgent.value && effectiveNewChatAgentMode.value === "scoped" && !newChatApiMode.value) return false;
  if (newChatNeedsBaseUrl.value && !newChatBaseUrl.value.trim()) return false;
  if (newChatNeedsApiKey.value && !newChatApiKey.value.trim()) return false;
  return true;
});

const newChatMissingCredentials = computed(() =>
  !!newChatProvider.value && !!newChatModel.value && ((newChatNeedsBaseUrl.value && !newChatBaseUrl.value.trim())
  || (newChatNeedsApiKey.value && !newChatApiKey.value.trim())),
);

const newChatConfiguredApiMode = computed(() => configuredProviderApiMode(selectedNewChatProviderGroup.value, newChatModel.value));
watch(newChatConfiguredApiMode, (mode) => {
  if (!restoringNewChatForm && !newChatApiModeManual.value && mode && newChatApiMode.value !== mode) newChatApiMode.value = mode;
}, { flush: "sync" });

function defaultNewChatApiMode(group?: AvailableModelGroup): CodingAgentApiMode {
  const providerKey = String(group?.provider || newChatProvider.value || "").toLowerCase();
  const baseUrl = String(group?.base_url || newChatBaseUrl.value || "").toLowerCase();
  return normalizeCodingAgentApiMode(
    group?.api_mode,
    inferCodingAgentApiMode(providerKey, baseUrl),
  );
}

function syncNewChatApiMode() {
  newChatApiMode.value = defaultNewChatApiMode(selectedNewChatProviderGroup.value);
}

function syncNewChatModelSelection() {
  newChatApiModeManual.value = false;
  const defaults = getDefaultModelForProfile(newChatProfile.value);
  newChatModelKind.value = defaults.provider === "moa" && newChatAgent.value === "hermes"
    ? "moa"
    : "model";
  newChatProvider.value = defaults.provider;
  newChatModel.value = defaults.model;
  newChatBaseUrl.value = "";
  newChatApiKey.value = "";
  syncNewChatApiMode();
}

function handleNewChatModelKindChange(value: "model" | "moa") {
  if (value === "moa") {
    const group = newChatMoaGroup.value;
    if (!group?.models.length) return;
    newChatModelKind.value = "moa";
    newChatProvider.value = "moa";
    newChatModel.value = group.models[0];
  } else {
    newChatModelKind.value = "model";
    const groups = getSelectableModelGroupsForProfile(newChatProfile.value)
      .filter((group) => group.provider !== "moa");
    const profileModels = appStore.profileModelGroups.find(
      (entry) => entry.profile === newChatProfile.value,
    );
    const defaultGroup = groups.find((group) => group.provider === profileModels?.default_provider);
    const group = defaultGroup || groups.find((item) => item.models.length > 0);
    newChatProvider.value = group?.provider || "";
    newChatModel.value = group?.models.includes(profileModels?.default || "")
      ? profileModels?.default || ""
      : group?.models[0] || "";
  }
  newChatBaseUrl.value = "";
  newChatApiKey.value = "";
  syncNewChatApiMode();
}

function ensureNewChatProviderSelection() {
  if (!newChatUsesProviderModel.value) return;
  const currentGroup = selectedNewChatProviderGroup.value;
  if (currentGroup && currentGroup.models.includes(newChatModel.value)) {
    syncNewChatApiMode();
    return;
  }
  syncNewChatModelSelection();
}

watch(
  () => [newChatAgent.value, newChatAgentMode.value, newChatProfile.value],
  () => {
    ensureNewChatProviderSelection();
    // Reload workspace data when profile changes
    if (newChatProfile.value) {
      initWorkspaceComposable();
    }
  },
);

function isCurrentNewChatOptionsLoad(sequence: number) {
  return showNewChatModal.value && sequence === newChatOptionsLoadSequence;
}

async function refreshNewChatAgentAvailability(sequence: number) {
  newChatAgentLoading.value = !newChatAgentAvailability.value;
  try {
    const availability = await fetchAgentAvailabilitySnapshot();
    if (!isCurrentNewChatOptionsLoad(sequence)) return;
    newChatAgentAvailability.value = availability;
    if (!newChatAgentOptions.value.some(option => option.value === newChatAgent.value)) {
      newChatAgent.value = newChatAgentOptions.value[0]?.value || "ekko-agent";
    }
    selectPreferredNewChatAgent();
  } catch {
    if (isCurrentNewChatOptionsLoad(sequence) && !newChatAgentAvailability.value) {
      message.error(t("codingAgents.loadFailed"));
    }
  } finally {
    if (isCurrentNewChatOptionsLoad(sequence)) newChatAgentLoading.value = false;
  }
}

async function loadNewChatProfiles(sequence: number) {
  if (profilesStore.profiles.length > 0) return;
  await profilesStore.fetchProfiles();
  if (!isCurrentNewChatOptionsLoad(sequence)) return;
  if (!profilesStore.profiles.some(profile => profile.name === newChatProfile.value)) {
    newChatProfile.value = profilesStore.activeProfileName || profilesStore.profiles[0]?.name || "default";
  }
  ensureNewChatProviderSelection();
}

async function loadNewChatModels(sequence: number) {
  newChatModelsLoading.value = appStore.modelGroups.length === 0 && appStore.profileModelGroups.length === 0;
  if (!newChatModelsLoading.value) return;
  try {
    await appStore.loadModels();
    if (isCurrentNewChatOptionsLoad(sequence)) ensureNewChatProviderSelection();
  } finally {
    if (isCurrentNewChatOptionsLoad(sequence)) newChatModelsLoading.value = false;
  }
}

function openNewChatModal() {
  const sequence = ++newChatOptionsLoadSequence;
  isBatchMode.value = false;
  selectedSessionKeys.value.clear();
  showBatchDeleteConfirm.value = false;
  newChatAgentPreset.value = undefined;
  newChatPresetReady.value = false;
  if (isMobile.value) showSessions.value = false;
  showNewChatModal.value = true;
  newChatCategoryId.value = null;
  newChatProjectSlug.value = null;
  newChatExtraDirs.value = [];
  void loadWorkspaceProjects();
  newChatProfile.value =
    profilesStore.activeProfileName ||
    profilesStore.profiles.find((profile) => profile.active)?.name ||
    profilesStore.profiles[0]?.name ||
    "default";
  initWorkspaceComposable();
  newChatWorkspace.value = mostRecentDefaultWorkspace.value || "";
  syncNewChatModelSelection();

  void refreshNewChatAgentAvailability(sequence);
  void loadSessionCategories();
  void loadNewChatProfiles(sequence);
  void loadNewChatModels(sequence);
}

async function openNewChatPage(options: { preserveSidebar?: boolean } = {}) {
  if (newChatLoading.value) return;
  if (props.contentMode !== "chat") await router.push({ name: "hermes.chat" });
  const previousToolPanel = showNewChatPage.value ? newChatPreviousToolPanel.value : showToolPanel.value;
  closeNewChatPage();
  newChatPreviousToolPanel.value = previousToolPanel;
  currentMode.value = "chat";
  showToolPanel.value = false;
  showRealtimeVoice.value = false;
  showOutline.value = false;
  newChatComposerRevision.value++;
  const sequence = ++newChatOptionsLoadSequence;
  isBatchMode.value = false;
  selectedSessionKeys.value.clear();
  showBatchDeleteConfirm.value = false;
  newChatAgentPreset.value = undefined;
  newChatPresetReady.value = false;
  if (isMobile.value) showSessions.value = false;
  showNewChatModal.value = true;
  newChatCategoryId.value = null;
  newChatProjectSlug.value = null;
  newChatExtraDirs.value = [];
  void loadWorkspaceProjects();
  newChatProfile.value =
    profilesStore.activeProfileName ||
    profilesStore.profiles.find((profile) => profile.active)?.name ||
    profilesStore.profiles[0]?.name ||
    "default";
  initWorkspaceComposable();
  newChatWorkspace.value = mostRecentDefaultWorkspace.value || "";
  syncNewChatModelSelection();

  const saved = loadNewChatFormPreferences(getStoredUserId());
  restoringNewChatForm = true;
  newChatApiModeManual.value = saved?.apiModeManual ?? !!saved?.apiMode;
  preferredNewChatAgent = saved?.agent || loadNewChatAgent();
  selectPreferredNewChatAgent();
  newChatAgentMode.value = saved?.mode || "scoped";
  newChatAgentPreset.value = saved?.agentPreset;
  newChatReasoningEffort.value = saved?.reasoningEffort || "";
  newChatNativeSelections.value = saved?.nativeModels || {};
  newChatPresetReady.value = false;
  newChatCategoryId.value = saved?.categoryId ?? null;
  newChatProfile.value = saved?.profile || profilesStore.activeProfileName
    || profilesStore.profiles.find(profile => profile.active)?.name || profilesStore.profiles[0]?.name || "default";
  newChatWorkspace.value = saved?.workspace || "";
  newChatProvider.value = saved?.provider || "";
  newChatModel.value = saved?.model || "";
  newChatCustomModel.value = saved?.customModel || false;
  newChatBaseUrl.value = saved?.baseUrl || "";
  newChatApiKey.value = saved?.apiKey || "";
  newChatApiMode.value = saved?.apiMode || "chat_completions";
  newChatModelsLoading.value = !newChatModelCatalogKnown.value;
  if (!saved) syncNewChatModelSelection();
  restoringNewChatForm = false;
  if (isMobile.value && !options.preserveSidebar) showSessions.value = false;
  showNewChatPage.value = true;
  void initWorkspaceComposable().then(() => {
    if (isCurrentNewChatOptionsLoad(sequence) && !saved && !newChatWorkspace.value) {
      newChatWorkspace.value = mostRecentDefaultWorkspace.value || "";
    }
  });
  void refreshNewChatAgentAvailability(sequence);
  void loadSessionCategories();
  void loadNewChatProfiles(sequence);
  void loadNewChatModels(sequence);
}

function handleNewChatProfileChange(value: string) {
  newChatProfile.value = value;
  syncNewChatModelSelection();
}

function handleNewChatProviderChange(value: string) {
  newChatProvider.value = value;
  newChatModel.value = newChatModelOptions.value[0]?.value || "";
  newChatBaseUrl.value = "";
  newChatApiKey.value = "";
  syncNewChatApiMode();
}

async function submitNewChat(text: string, attachments?: Attachment[]): Promise<boolean> {
  if (!canConfirmNewChat.value || !showNewChatPage.value) return false;
  const sequence = newChatOptionsLoadSequence;
  newChatLoading.value = true;
  let deployment: AgentDeploymentController | null = null;
  try {
    if (newChatAgent.value === "hermes") {
      try {
        const status = await fetchAgentAvailabilitySnapshot();
        if (agentInstallationState(status, "hermes") === "not-installed") {
          showNewChatPage.value = false;
          if (isSuperAdmin.value) {
            await router.push({ name: "hermes.agentManager", query: { runtime: "install" } });
          } else {
            message.warning(t("codingAgents.installRequired", { agent: "Hermes" }));
          }
          return false;
        }
      } catch (error) {
        console.warn("Failed to read Hermes Agent availability before creating a chat:", error);
      }
    }

    if (isNewChatExternalCodingAgent.value) {
      try {
        const agentId = newChatAgent.value as CodingAgentId;
        // Reuse the server inventory; probing every CLI's version delays creation.
        const status = await fetchAgentAvailabilitySnapshot();
        if (agentInstallationState(status, agentId) !== "installed") {
          const agentName = newChatAgentOptions.value.find(option => option.value === agentId)?.label || agentId;
          message.warning(t("codingAgents.installRequired", { agent: agentName }));
          showNewChatPage.value = false;
          await router.push({ name: "hermes.agentManager" });
          return false;
        }
      } catch {
        message.error(t("codingAgents.loadFailed"));
        return false;
      }
    }

    if (!isCurrentNewChatOptionsLoad(sequence)) return false;
    const group = selectedNewChatProviderGroup.value;
    const source = newChatAgent.value === "hermes" ? "cli" : newChatAgent.value === "ekko-agent" ? "builtin_agent" : "coding_agent";
    const codingAgentMode = effectiveNewChatAgentMode.value;
    const isGlobalCodingAgent = source === "coding_agent" && codingAgentMode === "global";
    const agent = newChatAgent.value === "claude-code" ? "claude" : newChatAgent.value;
    deployment = prepareAgentDeployment(chatMainContentRef.value?.querySelector('.agent-card.active'));
    const session = chatStore.newChat({
      profile: newChatProfile.value,
      provider: isGlobalCodingAgent ? undefined : newChatProvider.value,
      model: isGlobalCodingAgent ? newChatNativeSelection.value.model || undefined : newChatModel.value,
      source,
      agent,
      codingAgentId: newChatAgent.value === "hermes" ? undefined : newChatAgent.value,
      codingAgentMode: source === "coding_agent" || source === "builtin_agent" ? codingAgentMode : undefined,
      agentPreset: newChatAgent.value === "dsh" ? newChatAgentPreset.value : undefined,
      workspace: newChatWorkspace.value || null,
      categoryId: newChatCategoryId.value,
      baseUrl: (source === "coding_agent" || source === "builtin_agent") && !isGlobalCodingAgent ? group?.base_url || newChatBaseUrl.value.trim() || undefined : undefined,
      apiKey: (source === "coding_agent" || source === "builtin_agent") && !isGlobalCodingAgent ? group?.api_key || (newChatNeedsApiKey.value ? newChatApiKey.value.trim() || undefined : undefined) : undefined,
      apiMode: isNewChatCodingAgent.value && !isGlobalCodingAgent ? newChatApiMode.value : undefined,
      reasoningEffort: isGlobalCodingAgent ? newChatComposerReasoningEffort.value || undefined
        : newChatProvider.value !== "moa" ? newChatReasoningEffort.value : undefined,
    });
    // Send the first message before changing the route so it belongs to this session.
    void chatStore.sendMessage(text, attachments);
    deployment?.start(session.id);
    closeNewChatPage();
    if (newChatWorkspace.value) {
      void workspaceComposable?.recordWorkspaceUsage(newChatWorkspace.value)
        .catch(() => message.error(t("chat.workspaceSetFailed")));
    }

    await router.push({
      name: chatStore.runtimeMode === "global_agent" ? "hermes.globalAgentSession" : "hermes.session",
      params: { sessionId: session.id },
    });
    showNewChatPage.value = false;
    if (isMobile.value) showSessions.value = false;
    return true;
  } catch (error) {
    deployment?.cancel();
    throw error;
  } finally {
    newChatLoading.value = false;
  }
}

async function confirmNewChat() {
  if (!canConfirmNewChat.value) return;
  if (newChatAgent.value === "hermes") {
    newChatLoading.value = true;
    try {
      const status = await fetchAgentAvailabilitySnapshot();
      if (agentInstallationState(status, "hermes") === "not-installed") {
        showNewChatModal.value = false;
        if (isSuperAdmin.value) {
          await router.push({ name: "hermes.agentManager", query: { runtime: "install" } });
        } else {
          message.warning(t("codingAgents.installRequired", { agent: "Hermes" }));
        }
        return;
      }
    } catch (error) {
      console.warn("Failed to read Hermes Agent availability before creating a chat:", error);
    } finally {
      newChatLoading.value = false;
    }
  }

  if (isNewChatExternalCodingAgent.value) {
    newChatLoading.value = true;
    try {
      const agentId = newChatAgent.value as CodingAgentId;
      // Reuse the server inventory; probing every CLI's version delays creation.
      const status = await fetchAgentAvailabilitySnapshot();
      if (agentInstallationState(status, agentId) !== "installed") {
        const agentName = newChatAgentOptions.value.find(option => option.value === agentId)?.label || agentId;
        message.warning(t("codingAgents.installRequired", { agent: agentName }));
        showNewChatModal.value = false;
        await router.push({ name: "hermes.agentManager" });
        return;
      }
    } catch {
      message.error(t("codingAgents.loadFailed"));
      return;
    } finally {
      newChatLoading.value = false;
    }
  }

  const group = selectedNewChatProviderGroup.value;
  const source = newChatAgent.value === "hermes" ? "cli" : newChatAgent.value === "ekko-agent" ? "builtin_agent" : "coding_agent";
  const codingAgentMode = effectiveNewChatAgentMode.value;
  const isGlobalCodingAgent = source === "coding_agent" && codingAgentMode === "global";
  const agent = newChatAgent.value === "codex"
    ? "codex"
    : newChatAgent.value === "claude-code"
      ? "claude"
      : newChatAgent.value === "pi"
        ? "pi"
      : newChatAgent.value === "grok"
        ? "grok"
      : newChatAgent.value === "dsh" ? "dsh" : newChatAgent.value === "opencode"
        ? "opencode"
      : isNativeCodingAgent(newChatAgent.value) ? newChatAgent.value
      : newChatAgent.value === "antigravity" ? "antigravity" : newChatAgent.value === "cursor"
        ? "cursor"
      : newChatAgent.value === "ekko-agent"
        ? "ekko-agent"
      : "hermes";
  const session = chatStore.newChat({
    profile: newChatProfile.value,
    provider: isGlobalCodingAgent ? undefined : newChatProvider.value,
    model: isGlobalCodingAgent ? undefined : newChatModel.value,
    source,
    agent,
    codingAgentId: newChatAgent.value === "hermes" ? undefined : newChatAgent.value,
    codingAgentMode: source === "coding_agent" || source === "builtin_agent" ? codingAgentMode : undefined,
    agentPreset: newChatAgent.value === "dsh" ? newChatAgentPreset.value : undefined,
    workspace: newChatWorkspace.value || null,
    workspaceExtraDirs: newChatExtraDirs.value.length ? [...newChatExtraDirs.value] : undefined,
    categoryId: newChatCategoryId.value,
    baseUrl: (source === "coding_agent" || source === "builtin_agent") && !isGlobalCodingAgent ? group?.base_url || newChatBaseUrl.value.trim() || undefined : undefined,
    apiKey: (source === "coding_agent" || source === "builtin_agent") && !isGlobalCodingAgent ? group?.api_key || newChatApiKey.value.trim() || undefined : undefined,
    apiMode: isNewChatCodingAgent.value && !isGlobalCodingAgent ? newChatApiMode.value : undefined,
  });
  // Record workspace to recent list
  if (newChatWorkspace.value && workspaceComposable) {
    void workspaceComposable.recordWorkspaceUsage(newChatWorkspace.value).then(() => {
      recentWorkspaces.value = workspaceComposable!.recentWorkspaces.value;
    });
  }
  
  await router.push({
    name: chatStore.runtimeMode === "global_agent" ? "hermes.globalAgentSession" : "hermes.session",
    params: { sessionId: session.id },
  });
  showNewChatModal.value = false;
  if (isMobile.value) showSessions.value = false;
}

function sessionProfile(sessionId: string): string | null {
  return chatStore.sessions.find((session) => session.id === sessionId)?.profile || null;
}

function buildSessionUrl(sessionId: string, profile?: string | null): string {
  const href = router.resolve({
    name: chatStore.runtimeMode === "global_agent" ? "hermes.globalAgentSession" : "hermes.session",
    params: { sessionId },
    query: profile ? { profile } : undefined,
  }).href;
  return `${window.location.origin}${window.location.pathname}${href}`;
}

async function copySessionLink(id?: string) {
  const sessionId = id || chatStore.activeSessionId;
  if (sessionId) {
    const ok = await copyToClipboard(buildSessionUrl(sessionId, sessionProfile(sessionId)));
    if (ok) message.success(t("common.copied"));
    else message.error(t("common.copied") + " ✗");
  }
}

async function copySessionId(id?: string) {
  const sessionId = id || chatStore.activeSessionId;
  if (sessionId) {
    const ok = await copyToClipboard(sessionId);
    if (ok) message.success(t("common.copied"));
    else message.error(t("common.copied") + " ✗");
  }
}

const activeSessionMenuOptions = computed<DropdownOption[]>(() => buildActiveSessionMenuOptions({
  outline: t("chat.outlineTitle"),
  rename: t("chat.rename"),
  open: t(desktopChatWindowAvailable
    ? "chat.openSessionInNewWindow"
    : "chat.openSessionInNewTab"),
  copyId: t("chat.copySessionId"),
}, {
  canRename: activeSessionSupportsPersistence.value,
  canOpen: activeSessionSupportsPersistence.value,
}));

function activeSessionMenuProps() {
  return {
    id: ACTIVE_SESSION_MENU_ID,
    role: "menu",
    "aria-label": t("chat.sessionActions"),
  };
}

function activeSessionMenuNodeProps(option: DropdownOption) {
  return {
    id: `${ACTIVE_SESSION_MENU_ID}-${String(option.key || "item")}`,
    role: "menuitem",
    tabindex: -1,
    "aria-disabled": option.disabled ? "true" as const : undefined,
  };
}

function activeSessionMenuItems(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const menu = document.getElementById(ACTIVE_SESSION_MENU_ID);
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

function focusActiveSessionMenuItem(position: number | "first" | "last") {
  const items = activeSessionMenuItems();
  if (items.length === 0) return;
  const index = position === "first"
    ? 0
    : position === "last"
      ? items.length - 1
      : (position + items.length) % items.length;
  items[index]?.focus({ preventScroll: true });
}

function focusActiveSessionMenuTrigger() {
  const element = activeSessionMenuTriggerRef.value?.$el as HTMLElement | undefined;
  element?.focus({ preventScroll: true });
}

function focusAdjacentToActiveSessionMenuTrigger(backwards: boolean) {
  if (typeof document === "undefined") return;
  const trigger = activeSessionMenuTriggerRef.value?.$el as HTMLElement | undefined;
  if (!trigger) return;
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    if (element.closest(`#${ACTIVE_SESSION_MENU_ID}`) || element.closest('[inert]')) return false;
    if (element.tabIndex < 0 || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  const triggerIndex = candidates.indexOf(trigger);
  if (triggerIndex < 0) return;
  const target = candidates[triggerIndex + (backwards ? -1 : 1)];
  target?.focus({ preventScroll: true });
}

function handleActiveSessionMenuTriggerKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  event.stopPropagation();
  activeSessionMenuInitialFocus = event.key === "ArrowUp" ? "last" : "first";
  showActiveSessionMenu.value = true;
}

function handleActiveSessionMenuKeydown(event: KeyboardEvent) {
  const items = activeSessionMenuItems();
  const current = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="menuitem"]');
  const currentIndex = current ? items.indexOf(current) : -1;

  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Home") focusActiveSessionMenuItem("first");
    else if (event.key === "End") focusActiveSessionMenuItem("last");
    else if (event.key === "ArrowDown") focusActiveSessionMenuItem(currentIndex < 0 ? 0 : currentIndex + 1);
    else focusActiveSessionMenuItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    current?.querySelector<HTMLElement>(".n-dropdown-option-body")?.click();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    restoreActiveSessionMenuTriggerFocus = true;
    showActiveSessionMenu.value = false;
  } else if (event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    const backwards = event.shiftKey;
    restoreActiveSessionMenuTriggerFocus = false;
    showActiveSessionMenu.value = false;
    void nextTick().then(() => focusAdjacentToActiveSessionMenuTrigger(backwards));
  }
}

watch(showActiveSessionMenu, async (visible, wasVisible) => {
  if (visible) {
    restoreActiveSessionMenuTriggerFocus = false;
    await nextTick();
    focusActiveSessionMenuItem(activeSessionMenuInitialFocus);
    activeSessionMenuInitialFocus = "first";
    return;
  }
  if (!wasVisible || !restoreActiveSessionMenuTriggerFocus) return;
  restoreActiveSessionMenuTriggerFocus = false;
  await nextTick();
  focusActiveSessionMenuTrigger();
});

function openRenameSession(sessionId: string) {
  const session = chatStore.sessions.find((item) => item.id === sessionId)
    || (chatStore.activeSession?.id === sessionId ? chatStore.activeSession : null);
  renameSessionId.value = sessionId;
  renameValue.value = session?.title || "";
  showRenameModal.value = true;
  nextTick(() => {
    renameInputRef.value?.focus();
  });
}

function handleActiveSessionMenuSelect(key: string) {
  const sessionId = chatStore.activeSessionId;
  if (!sessionId) return;
  restoreActiveSessionMenuTriggerFocus = key !== "rename";
  if (key === "outline") {
    showOutline.value = !showOutline.value;
  } else if (key === "rename") {
    if (!activeSessionSupportsPersistence.value) return;
    openRenameSession(sessionId);
  } else if (key === "open-link") {
    if (!activeSessionSupportsPersistence.value) return;
    openSessionInNewTab(sessionId, chatStore.activeSession?.profile || null);
  } else if (key === "copy-id") {
    void copySessionId(sessionId);
  }
}

async function handleDeleteSession(id: string) {
  const ok = await chatStore.deleteSession(id);
  if (!ok) {
    message.error(t("common.deleteFailed"));
    return;
  }
  await syncSessionRouteAfterDeletion();
  message.success(t("chat.sessionDeleted"));
}

async function syncSessionRouteAfterDeletion() {
  if (isMobile.value && !chatStore.activeSessionId && chatStore.sessions.length === 0) showSessions.value = false;
  const routeId = router.currentRoute.value.params.sessionId;
  if (!routeId || chatStore.sessions.some(session => session.id === routeId)) return;
  await router.replace(chatStore.activeSessionId ? {
    name: chatStore.runtimeMode === "global_agent" ? "hermes.globalAgentSession" : "hermes.session",
    params: { sessionId: chatStore.activeSessionId },
  } : { name: chatStore.runtimeMode === "global_agent" ? "hermes.globalAgent" : "hermes.chat" });
}

function toggleBatchMode() {
  if (isBatchDeleting.value) return;
  isBatchMode.value = !isBatchMode.value;
  if (!isBatchMode.value) {
    selectedSessionKeys.value.clear();
    showBatchDeleteConfirm.value = false;
  }
}

function sessionSelectionKey(session: Pick<Session, "id" | "profile">): string {
  return `${session.profile || "default"}\u0000${session.id}`;
}

function toggleSessionSelection(session: Session) {
  if (isBatchDeleting.value) return;
  const key = sessionSelectionKey(session);
  if (selectedSessionKeys.value.has(key)) {
    selectedSessionKeys.value.delete(key);
  } else {
    selectedSessionKeys.value.add(key);
  }
  selectedSessionKeys.value = new Set(selectedSessionKeys.value);
  if (selectedSessionKeys.value.size === 0) {
    showBatchDeleteConfirm.value = false;
  }
}

function isSessionSelected(session: Session): boolean {
  return selectedSessionKeys.value.has(sessionSelectionKey(session));
}

async function handleBatchDelete() {
  if (selectedSessionKeys.value.size === 0 || isBatchDeleting.value) return;

  const sessionsByKey = new Map(chatStore.sessions.map((session) => [sessionSelectionKey(session), session]));
  const targets = Array.from(selectedSessionKeys.value)
    .map((key) => sessionsByKey.get(key))
    .filter((session): session is Session => Boolean(session))
    .map((session) => ({ id: session.id, profile: session.profile || null }));
  if (targets.length === 0) return;
  isBatchDeleting.value = true;
  try {
    const result = await batchDeleteSessions(targets);
    if (result.deleted > 0) {
      const failedIds = new Set(result.errors.map(error => error.id));
      for (const target of targets) if (!failedIds.has(target.id)) chatStore.forgetSession(target.id);
      await chatStore.loadSessions(chatStore.sessionProfileFilter);
      await syncSessionRouteAfterDeletion();

      message.success(t("chat.batchDeleteSuccess", { count: result.deleted }));
      if (result.failed > 0) {
        message.warning(t("chat.batchDeletePartial", { failed: result.failed }));
      }
    } else {
      message.error(t("chat.batchDeleteFailed"));
    }
  } catch (err: any) {
    message.error(t("chat.batchDeleteFailed"));
  } finally {
    isBatchDeleting.value = false;
    showBatchDeleteConfirm.value = false;
    isBatchMode.value = false;
    selectedSessionKeys.value.clear();
  }
}

function selectAllSessions() {
  if (isBatchDeleting.value) return;
  selectedSessionKeys.value.clear();
  for (const session of chatStore.sessions) {
    selectedSessionKeys.value.add(sessionSelectionKey(session));
  }
  selectedSessionKeys.value = new Set(selectedSessionKeys.value);
}

const selectedCount = computed(() => selectedSessionKeys.value.size);
const canSelectAll = computed(() => {
  return chatStore.sessions.length > 0;
});

const contextSessionId = ref<string | null>(null);
const contextSessionPinned = computed(() =>
  contextSessionId.value
    ? Boolean(contextSession.value?.isPinned)
    : false,
);
const contextSession = computed(() =>
  contextSessionId.value
    ? chatStore.sessions.find((session) => session.id === contextSessionId.value) || null
    : null,
);

const showCategoryContextMenu = ref(false);
const categoryContextMenuX = ref(0);
const categoryContextMenuY = ref(0);
const categoryContextId = ref<number | null>(null);
const categoryContextName = computed(() =>
  sessionCategories.value.find((item) => item.id === categoryContextId.value)?.name || "",
);
const categoryContextMenuOptions = computed<DropdownOption[]>(() => [
  { label: t("chat.renameCategory"), key: "rename" },
  { label: t("chat.deleteCategory"), key: "delete" },
]);
const showRenameCategoryModal = ref(false);
const renameCategoryValue = ref("");
const showDeleteCategoryModal = ref(false);

function handleCategoryContextMenu(event: MouseEvent, groupKey: string) {
  if (groupKey === "category-none") return;
  const categoryId = Number(groupKey.slice("category-".length));
  if (!Number.isSafeInteger(categoryId)) return;
  event.preventDefault();
  event.stopPropagation();
  showContextMenu.value = false;
  categoryContextId.value = categoryId;
  categoryContextMenuX.value = event.clientX;
  categoryContextMenuY.value = event.clientY;
  showCategoryContextMenu.value = true;
}

function handleCategoryMenuButton(event: MouseEvent, groupKey: string) {
  if (groupKey === "category-none") return;
  const categoryId = Number(groupKey.slice("category-".length));
  if (!Number.isSafeInteger(categoryId)) return;
  event.preventDefault();
  event.stopPropagation();
  const anchor = event.currentTarget as HTMLElement;
  const rect = anchor.getBoundingClientRect();
  showContextMenu.value = false;
  categoryContextId.value = categoryId;
  categoryContextMenuX.value = rect.left;
  categoryContextMenuY.value = rect.bottom;
  showCategoryContextMenu.value = true;
}

function handleCategoryContextMenuSelect(key: string) {
  showCategoryContextMenu.value = false;
  const category = sessionCategories.value.find((item) => item.id === categoryContextId.value);
  if (!category) return;
  if (key === "rename") {
    renameCategoryValue.value = category.name;
    showRenameCategoryModal.value = true;
  } else if (key === "delete") {
    showDeleteCategoryModal.value = true;
  }
}

async function handleRenameCategoryConfirm() {
  const categoryId = categoryContextId.value;
  const name = renameCategoryValue.value.trim().replace(/\s+/g, " ");
  if (!categoryId || !name) return false;
  try {
    const category = await renameSessionCategory(categoryId, name);
    sessionCategories.value = sessionCategories.value
      .map((item) => item.id === category.id ? category : item)
      .sort((a, b) => a.name.localeCompare(b.name));
    message.success(t("chat.categoryRenamed"));
    showRenameCategoryModal.value = false;
  } catch (error: any) {
    message.error(error?.message || t("chat.categoryRenameFailed"));
    return false;
  }
}

async function handleDeleteCategoryConfirm() {
  const categoryId = categoryContextId.value;
  if (!categoryId) return false;
  try {
    await deleteSessionCategory(categoryId);
    sessionCategories.value = sessionCategories.value.filter((item) => item.id !== categoryId);
    for (const session of chatStore.sessions) {
      if (session.categoryId === categoryId) session.categoryId = null;
    }
    const collapsedKey = `category-${categoryId}`;
    if (collapsedCategories.value.has(collapsedKey)) {
      collapsedCategories.value = new Set(
        [...collapsedCategories.value].filter((key) => key !== collapsedKey),
      );
      persistCollapsedCategories();
    }
    message.success(t("chat.categoryDeleted"));
    showDeleteCategoryModal.value = false;
  } catch (error: any) {
    message.error(error?.message || t("chat.categoryDeleteFailed"));
    return false;
  }
}

const canSetContextSessionModel = computed(() =>
  contextSession.value?.source === "cli" ||
  contextSession.value?.source === "builtin_agent" ||
  (contextSession.value?.source === "coding_agent" && contextSession.value?.codingAgentMode !== "global"),
);

const contextMenuOptions = computed(() => buildSessionContextMenuOptions({
  pinned: contextSessionPinned.value,
  includeArchive: contextSession.value?.source !== "global_agent",
  includeModel: canSetContextSessionModel.value,
  categoryChildren: buildSessionCategoryMenuChildren({
    categories: sessionCategories.value,
    currentCategoryId: contextSession.value?.categoryId,
    createCategoryLabel: t("chat.createCategory"),
    uncategorizedLabel: t("chat.uncategorized"),
    loadFailedLabel: t("chat.categoryLoadFailed"),
    retryLabel: t("common.retry"),
    loadFailed: sessionCategoriesLoadFailed.value,
    loading: sessionCategoriesLoading.value,
  }),
  labels: {
    pin: t("chat.pin"),
    unpin: t("chat.unpin"),
    rename: t("chat.rename"),
    archive: t("chat.archiveSession"),
    workspace: t("chat.setWorkspace"),
    model: t("chat.setModel"),
    category: t("chat.moveToCategory"),
    export: t("chat.export"),
    exportFull: t("chat.exportFull"),
    exportCompressed: t("chat.exportCompressed"),
    saveObsidian: t("chat.saveObsidian"),
    open: t(desktopChatWindowAvailable
      ? "chat.openSessionInNewWindow"
      : "chat.openSessionInNewTab"),
    copyLink: t("chat.copySessionLink"),
    copyId: t("chat.copySessionId"),
  },
}).map(option => option.key === "pin"
  ? { ...option, disabled: Boolean(contextSession.value?.isLocalOnly) }
  : option));
const contextMenuCategoriesKey = computed(() => [
  sessionCategoriesLoadFailed.value ? "failed" : "ready",
  sessionCategoriesLoading.value ? "loading" : "idle",
  ...sessionCategories.value.map(category => `${category.id}:${category.name}`),
].join("|"));

function handleContextMenu(e: MouseEvent, sessionId: string) {
  e.preventDefault();
  showCategoryContextMenu.value = false;
  contextSessionId.value = sessionId;
  showContextMenu.value = true;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
}

const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

function parseExportKey(key: string): { mode: 'full' | 'compressed'; ext: 'json' | 'txt' } | null {
  if (key === 'export-full-json') return { mode: 'full', ext: 'json' }
  if (key === 'export-full-txt') return { mode: 'full', ext: 'txt' }
  if (key === 'export-compressed-json') return { mode: 'compressed', ext: 'json' }
  if (key === 'export-compressed-txt') return { mode: 'compressed', ext: 'txt' }
  return null
}

async function handleContextMenuSelect(key: string) {
  showContextMenu.value = false;
  if (!contextSessionId.value) return;
  if (key === "category:retry") {
    await retrySessionCategories();
    return;
  }
  if (key === "category:create") {
    if (sessionCategoriesLoading.value) return;
    createCategorySessionId.value = contextSessionId.value;
    createCategoryPendingCategory.value = null;
    createCategoryValue.value = "";
    showCreateCategoryModal.value = true;
    nextTick(() => {
      createCategoryInputRef.value?.focus();
    });
    return;
  }
  if (key === "pin") {
    const session = contextSession.value;
    if (!session || session.isLocalOnly) return;
    try {
      const result = await setSessionPinned(session.id, !session.isPinned);
      session.isPinned = result.is_pinned;
    } catch (error: any) {
      message.error(error?.message || t("common.saveFailed"));
    }
    return;
  }
  if (key.startsWith("category:")) {
    const session = contextSession.value;
    if (!session) return;
    const rawCategoryId = key.slice("category:".length);
    const categoryId = rawCategoryId === "none" ? null : Number(rawCategoryId);
    if (categoryId !== null && !Number.isSafeInteger(categoryId)) return;
    if ((session.categoryId ?? null) === categoryId) return;
    try {
      if (!session.isLocalOnly) await setSessionCategory(session.id, categoryId);
    } catch (error: any) {
      message.error(error?.message || t("chat.categoryUpdateFailed"));
      return;
    }
    session.categoryId = categoryId;
    message.success(t("chat.categoryUpdated"));
    return;
  }
  if (key === "copy-link") {
    copySessionLink(contextSessionId.value);
  } else if (key === "copy-id") {
    copySessionId(contextSessionId.value);
  } else if (key === "open-link") {
    openSessionInNewTab(contextSessionId.value, contextSession.value?.profile || null);
  } else if (key === "archive") {
    const archivedSession = contextSession.value;
    const ok = await chatStore.archiveSession(contextSessionId.value);
    if (ok) {
      if (archivedSession) {
        selectedSessionKeys.value.delete(sessionSelectionKey(archivedSession));
        selectedSessionKeys.value = new Set(selectedSessionKeys.value);
      }
      message.success(t("chat.sessionArchived"));
    } else {
      message.error(t("chat.archiveSessionFailed"));
    }
  } else if (parseExportKey(key)) {
    const { mode, ext } = parseExportKey(key)!;
    const loadingMsg = mode === "compressed" ? message.loading(t("chat.exportCompressing"), { duration: 0 }) : null;
    try {
      await exportSession(contextSessionId.value, mode, ext);
      loadingMsg?.destroy();
      message.success(t("chat.exportSuccess"));
    } catch {
      loadingMsg?.destroy();
      message.error(t("chat.exportFailed"));
    }
  } else if (key === "save-obsidian") {
    try {
      const res = await saveSessionToObsidian(contextSessionId.value);
      if (res?.ok) {
        message.success(`${t("chat.obsidianSaved")}${res.path}`);
      } else {
        message.error(t("chat.obsidianSaveFailed"));
      }
    } catch {
      message.error(t("chat.obsidianSaveFailed"));
    }
  } else if (key === "workspace") {
    const session = chatStore.sessions.find(
      (s) => s.id === contextSessionId.value,
    );
    workspaceSessionId.value = contextSessionId.value;
    workspaceValue.value = session?.workspace || "";
    workspaceExtraDirs.value = [...(session?.workspaceExtraDirs || [])];
    showWorkspaceModal.value = true;
    void loadWorkspaceProjects();
  } else if (key === "model") {
    await openSessionModelModal(contextSessionId.value);
  } else if (key === "rename") {
    openRenameSession(contextSessionId.value);
  }
}

async function handleCreateCategoryConfirm() {
  if (createCategorySubmitting.value) return false;
  const sessionId = createCategorySessionId.value;
  const session = chatStore.sessions.find((item) => item.id === sessionId);
  const name = createCategoryValue.value.trim().replace(/\s+/g, " ");
  if (!sessionId || !session || !name) return false;

  createCategorySubmitting.value = true;
  let category: SessionCategory | undefined = createCategoryPendingCategory.value || undefined;
  let created = Boolean(createCategoryPendingCategory.value);
  try {
    try {
      if (!category) {
        category = sessionCategories.value.find(
          (item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
      }
      if (!category) {
        const createdCategory = await createSessionCategory(name);
        category = createdCategory;
        created = true;
        if (!sessionCategories.value.some((item) => item.id === createdCategory.id)) {
          sessionCategories.value = [...sessionCategories.value, createdCategory].sort((a, b) =>
            a.name.localeCompare(b.name),
          );
        }
      }
    } catch (error: any) {
      message.error(error?.message || t("chat.categoryCreateFailed"));
      return false;
    }

    try {
      if (!session.isLocalOnly) await setSessionCategory(session.id, category.id);
    } catch (error: any) {
      if (created) {
        createCategoryPendingCategory.value = category;
        createCategoryValue.value = category.name;
      }
      message.error(created
        ? t("chat.categoryCreatedMoveFailed", { name: category.name })
        : error?.message || t("chat.categoryUpdateFailed"));
      return false;
    }

    session.categoryId = category.id;
    if (chatStore.activeSession?.id === session.id) {
      chatStore.activeSession.categoryId = category.id;
    }
    message.success(created
      ? t("chat.categoryCreatedAndMoved", { name: category.name })
      : t("chat.categoryUpdated"));
    createCategoryPendingCategory.value = null;
    showCreateCategoryModal.value = false;
    createCategorySessionId.value = null;
  } finally {
    createCategorySubmitting.value = false;
  }
}

function handleCreateCategoryEnter(event: KeyboardEvent) {
  if (event.isComposing) return;
  void handleCreateCategoryConfirm();
}

watch(showCreateCategoryModal, (visible) => {
  if (visible) return;
  createCategoryPendingCategory.value = null;
  createCategorySessionId.value = null;
  createCategoryValue.value = "";
});

function handleClickOutside() {
  showContextMenu.value = false;
}

async function handleRenameConfirm() {
  if (!renameSessionId.value || !renameValue.value.trim()) return;
  const ok = await renameSession(
    renameSessionId.value,
    renameValue.value.trim(),
  );
  if (ok) {
    const session = chatStore.sessions.find(
      (s) => s.id === renameSessionId.value,
    );
    if (session) session.title = renameValue.value.trim();
    if (chatStore.activeSession?.id === renameSessionId.value) {
      chatStore.activeSession.title = renameValue.value.trim();
    }
    message.success(t("chat.renamed"));
  } else {
    message.error(t("chat.renameFailed"));
  }
  showRenameModal.value = false;
}

const showWorkspaceModal = ref(false);
const workspaceValue = ref("");
const workspaceSessionId = ref<string | null>(null);
const workspaceExtraDirs = ref<string[]>([]);

function openActiveSessionWorkspace() {
  const session = chatStore.activeSession;
  if (!session?.id) return;
  workspaceSessionId.value = session.id;
  workspaceValue.value = session.workspace || "";
  workspaceExtraDirs.value = [...(session.workspaceExtraDirs || [])];
  showWorkspaceModal.value = true;
  void loadWorkspaceProjects();
}

// --- Project (multi-folder workspace) binding -------------------------------
const workspaceProjects = ref<StudioProject[]>([]);
const workspaceProjectsLoading = ref(false);
const selectedProjectSlug = ref<string | null>(null);

async function loadWorkspaceProjects() {
  if (workspaceProjectsLoading.value) return;
  workspaceProjectsLoading.value = true;
  try {
    workspaceProjects.value = await fetchStudioProjects();
  } finally {
    workspaceProjectsLoading.value = false;
  }
}

const workspaceProjectOptions = computed(() =>
  workspaceProjects.value.map((p) => ({
    label: `${p.name} (${p.folders.length} dirs)`,
    value: p.slug,
  })),
);

function handleProjectSelected(slug: string | null) {
  selectedProjectSlug.value = slug;
  if (!slug) return;
  const project = workspaceProjects.value.find((p) => p.slug === slug);
  if (!project) return;
  const paths = project.folders.map((f) => f.path);
  const primary = project.primary_path || paths[0];
  if (!primary) return;
  // Main workspace = primary repo; extras = the remaining member dirs.
  workspaceValue.value = primary;
  workspaceExtraDirs.value = paths.filter((d) => d !== primary);
}

// Auto-bind: when the USER picks/edits the primary dir (not on modal open —
// that would clobber session-specific extra edits), and the new primary
// matches a registered project's primary_path, pull in its extra dirs and
// reflect the binding in the project dropdown.
function syncWorkspaceProjectBinding() {
  const primary = (workspaceValue.value || "").trim();
  selectedProjectSlug.value = null;
  if (!primary) return;
  const project = workspaceProjects.value.find(
    (p) => (p.primary_path || p.folders.find((f) => f.is_primary)?.path) === primary,
  );
  if (!project) return;
  const paths = project.folders.map((f) => f.path);
  selectedProjectSlug.value = project.slug;
  workspaceExtraDirs.value = [...new Set(paths.filter((d) => d !== primary))];
}

function handleWorkspacePrimaryChange() {
  syncWorkspaceProjectBinding();
}
// ---------------------------------------------------------------------------

function handleWorkspaceExtraRemove(dir: string) {
  workspaceExtraDirs.value = workspaceExtraDirs.value.filter((d) => d !== dir);
}

async function handleWorkspaceConfirm() {
  if (!workspaceSessionId.value) return;
  const ok = await setSessionWorkspace(
    workspaceSessionId.value,
    workspaceValue.value || null,
    workspaceExtraDirs.value,
  );
  if (ok) {
    const session = chatStore.sessions.find(
      (s) => s.id === workspaceSessionId.value,
    );
    if (session) {
      session.workspace = workspaceValue.value || null;
      session.workspaceExtraDirs = [...workspaceExtraDirs.value];
    }
    if (chatStore.activeSession?.id === workspaceSessionId.value) {
      chatStore.activeSession.workspace = workspaceValue.value || null;
      chatStore.activeSession.workspaceExtraDirs = [...workspaceExtraDirs.value];
    }
    message.success(t("chat.workspaceSet"));
  } else {
    message.error(t("chat.workspaceSetFailed"));
  }
  showWorkspaceModal.value = false;
}

const showSessionModelModal = ref(false);
const showSessionModelModeModal = ref(false);
const sessionModelSessionId = ref<string | null>(null);
const sessionModelSearch = ref("");
const sessionModelKind = ref<"model" | "moa">("model");
const {
  isGroupCollapsed: isSessionModelGroupCollapsed,
  toggleGroup: toggleSessionModelCollapsedGroup,
} = useCollapsedProviderGroups();
const sessionModelValue = ref("");
const sessionModelProvider = ref("");
const sessionModelCustomInput = ref("");
const sessionModelCustomProvider = ref("");
const sessionModelApiMode = ref<CodingAgentApiMode>("codex_responses");
const pendingSessionModelSwitch = ref<{ model: string; provider: string } | null>(null);
const sessionModelSwitching = ref(false);

const sessionModelProfile = computed<string | null>(() => {
  const session = chatStore.sessions.find((s) => s.id === sessionModelSessionId.value);
  return session?.profile || null;
});

const sessionModelSession = computed(() =>
  chatStore.sessions.find((s) => s.id === sessionModelSessionId.value) ||
  (chatStore.activeSession?.id === sessionModelSessionId.value ? chatStore.activeSession : undefined),
);

const isSessionModelScopedCodingAgent = computed(() =>
  (sessionModelSession.value?.source === "coding_agent" || sessionModelSession.value?.source === "builtin_agent") &&
  sessionModelSession.value?.codingAgentMode !== "global",
);
const sessionModelCodingAgentId = computed<ChatCodingAgentId | undefined>(() =>
  sessionModelSession.value?.codingAgentId ||
  (sessionModelSession.value?.agent === "claude"
    ? "claude-code"
      : sessionModelSession.value?.agent === "codex"
        ? "codex"
      : sessionModelSession.value?.agent === "pi"
        ? "pi"
      : sessionModelSession.value?.agent === "grok"
        ? "grok"
      : sessionModelSession.value?.agent === "dsh" ? "dsh" : sessionModelSession.value?.agent === "opencode"
        ? "opencode"
      : isNativeCodingAgent(sessionModelSession.value?.agent) ? sessionModelSession.value?.agent
      : sessionModelSession.value?.agent === "antigravity" ? "antigravity" : sessionModelSession.value?.agent === "cursor"
        ? "cursor"
      : sessionModelSession.value?.agent === "ekko-agent"
        ? "ekko-agent"
        : undefined),
);
const isSessionModelCodingAgent = computed(() =>
  sessionModelSession.value?.source === "coding_agent" || Boolean(sessionModelSession.value?.codingAgentId),
);

const sessionModelAllGroups = computed(() =>
  sessionModelProfile.value
    ? getModelGroupsForProfile(sessionModelProfile.value).filter((group) => (
        group.provider === "moa"
          ? !isSessionModelCodingAgent.value
          : (!isSessionModelScopedCodingAgent.value ||
            !sessionModelCodingAgentId.value ||
            canScopedCodingAgentUseProvider(sessionModelCodingAgentId.value, group.provider))
      ))
    : [],
);

const sessionModelBaseGroups = computed(() =>
  sessionModelAllGroups.value.filter((group) => group.provider !== "moa"),
);

const sessionMoaGroup = computed(() =>
  sessionModelAllGroups.value.find((group) => group.provider === "moa"),
);

const sessionCanUseMoa = computed(() =>
  !isSessionModelCodingAgent.value && Boolean(sessionMoaGroup.value?.models.length),
);

const sessionModelProviderOptions = computed(() =>
  sessionModelBaseGroups.value.map((group) => ({ label: group.label, value: group.provider })),
);

const sessionModelGroupsWithCustom = computed(() =>
  sessionModelBaseGroups.value.map((group) => ({
    ...group,
    models: [
      ...group.models,
      ...(appStore.customModels[group.provider] || []).filter(
        (model) => !group.models.includes(model),
      ),
    ],
  })),
);

const filteredSessionModelGroups = computed(() => {
  const query = sessionModelSearch.value.trim().toLowerCase();
  if (!query) return sessionModelGroupsWithCustom.value;
  return sessionModelGroupsWithCustom.value
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => {
        const displayName = appStore.displayModelName(model, group.provider);
        return model.toLowerCase().includes(query) || displayName.toLowerCase().includes(query);
      }),
    }))
    .filter((group) => group.models.length > 0 || group.label.toLowerCase().includes(query));
});

const filteredSessionMoaModels = computed(() => {
  const models = sessionMoaGroup.value?.models || [];
  const query = sessionModelSearch.value.trim().toLowerCase();
  return query ? models.filter((model) => model.toLowerCase().includes(query)) : models;
});

async function openSessionModelModal(sessionId: string) {
  const requestedSession =
    chatStore.sessions.find((s) => s.id === sessionId) ||
    (chatStore.activeSession?.id === sessionId ? chatStore.activeSession : undefined);
  if (
    requestedSession?.codingAgentMode === "global" &&
    Boolean(requestedSession.codingAgentId || requestedSession.source === "coding_agent")
  ) return;
  if (appStore.modelGroups.length === 0 && appStore.profileModelGroups.length === 0) {
    await appStore.loadModels();
  }
  const session =
    chatStore.sessions.find((s) => s.id === sessionId) ||
    (chatStore.activeSession?.id === sessionId ? chatStore.activeSession : undefined);
  sessionModelSessionId.value = sessionId;
  const groups = sessionModelBaseGroups.value;
  const providerGroup = session?.provider
    ? groups.find((group) => group.provider === session.provider)
    : undefined;
  const fallbackGroup = providerGroup || groups.find((group) => group.models.length > 0);
  const defaults = {
    provider: fallbackGroup?.provider || "",
    model: fallbackGroup?.models.includes(session?.model || "")
      ? session?.model || ""
      : fallbackGroup?.models[0] || "",
  };
  const usesMoa = session?.provider === "moa" && sessionCanUseMoa.value;
  sessionModelKind.value = usesMoa ? "moa" : "model";
  sessionModelValue.value = usesMoa
    ? session?.model || ""
    : providerGroup ? session?.model || defaults.model || "" : defaults.model || "";
  sessionModelProvider.value = usesMoa
    ? "moa"
    : providerGroup ? session?.provider || "" : defaults.provider || "";
  sessionModelCustomProvider.value = usesMoa ? defaults.provider : sessionModelProvider.value;
  sessionModelSearch.value = "";
  sessionModelCustomInput.value = "";
  showSessionModelModal.value = true;
}

function handleSessionModelKindChange(value: "model" | "moa") {
  if (sessionModelSwitching.value || (value === "moa" && !sessionCanUseMoa.value)) return;
  sessionModelKind.value = value;
  sessionModelSearch.value = "";
}

function handleHeaderModelClick() {
  if (activeSessionUsesGlobalCodingAgentConfig.value) return;
  const sessionId = chatStore.activeSession?.id;
  if (!sessionId) {
    openNewChatModal();
    return;
  }
  openSessionModelModal(sessionId);
}

function toggleSessionModelGroup(provider: string) {
  if (sessionModelSwitching.value) return;
  toggleSessionModelCollapsedGroup(provider);
}

function isCustomSessionModel(model: string, provider: string) {
  return (appStore.customModels[provider] || []).includes(model);
}

function sessionModelDisplayName(model: string, provider: string) {
  return appStore.displayModelName(model, provider);
}

function sessionModelAlias(model: string, provider: string) {
  return appStore.getModelAlias(model, provider);
}

function defaultSessionModelApiMode(provider: string): CodingAgentApiMode {
  const group = sessionModelBaseGroups.value.find((item) => item.provider === provider);
  const providerKey = String(group?.provider || provider || "").toLowerCase();
  const baseUrl = String(group?.base_url || "").toLowerCase();
  return normalizeCodingAgentApiMode(
    group?.api_mode,
    inferCodingAgentApiMode(providerKey, baseUrl),
  );
}

async function applySessionModelSwitch(model: string, provider: string, apiMode?: CodingAgentApiMode, manualApiMode = false) {
  if (sessionModelSwitching.value) return;
  if (sessionModelIsDraft.value) {
    if (!showNewChatPage.value || newChatLoading.value) return;
    if (isNewChatGlobalCodingAgent.value) {
      if (model && !newChatNativeCatalog.value?.models.some(entry => entry.id === model && !entry.hidden)) return;
      const sameFamily = model === nativeModelPickerId(newChatNativeCatalog.value?.models, newChatNativeSelection.value.model);
      newChatNativeSelections.value[newChatAgent.value] = model && sameFamily
        ? selectNativeModelEffort(newChatNativeCatalog.value?.models, model, newChatComposerReasoningEffort.value)
        : { model, reasoningEffort: model ? nativeCatalogModel(newChatNativeCatalog.value?.models, model)?.reasoningEffort || "" : "" };
      showSessionModelPicker.value = false;
      return;
    }
    newChatApiModeManual.value = manualApiMode;
    if (newChatProvider.value !== provider) {
      newChatBaseUrl.value = "";
      newChatApiKey.value = "";
    }
    newChatProvider.value = provider;
    newChatModel.value = model;
    newChatCustomModel.value = !selectedNewChatProviderGroup.value?.models.includes(model);
    syncNewChatApiMode();
    if (apiMode) newChatApiMode.value = apiMode;
    pendingSessionModelSwitch.value = null;
    showSessionModelModeModal.value = false;
    showSessionModelPicker.value = false;
    return;
  }
  if (!sessionModelSessionId.value) return;
  sessionModelSwitching.value = true;
  try {
    const ok = await chatStore.switchSessionModel(model, provider, sessionModelSessionId.value, apiMode);
    if (ok) {
      sessionModelValue.value = model;
      sessionModelProvider.value = provider;
      if (apiMode) sessionModelApiMode.value = apiMode;
      pendingSessionModelSwitch.value = null;
      showSessionModelModeModal.value = false;
      showSessionModelModal.value = false;
      message.success(t("chat.modelSet"));
    } else {
      message.error(t("chat.modelSetFailed"));
    }
  } finally {
    sessionModelSwitching.value = false;
  }
}

async function selectSessionModel(model: string, provider: string) {
  const meta = sessionModelBaseGroups.value.find((group) => group.provider === provider)?.model_meta?.[model];
  if (meta?.disabled || !sessionModelSessionId.value || sessionModelSwitching.value) return;
  if (isSessionModelScopedCodingAgent.value) {
    const group = sessionModelBaseGroups.value.find(group => group.provider === provider);
    const mode = configuredProviderApiMode(group, model);
    const sameModel = sessionModelProvider.value === provider && sessionModelValue.value === model;
    if (mode && !(group?.api_mode_by_model && sameModel)) {
      await applySessionModelSwitch(model, provider, mode);
      return;
    }
    pendingSessionModelSwitch.value = { model, provider };
    sessionModelApiMode.value = sameModel
      ? normalizeCodingAgentApiMode(sessionModelIsDraft.value ? newChatApiMode.value : sessionModelSession.value?.apiMode, mode || defaultSessionModelApiMode(provider))
      : mode || defaultSessionModelApiMode(provider);
    showSessionModelModeModal.value = true;
    return;
  }
  await applySessionModelSwitch(model, provider);
}

async function selectSessionMoaPreset(preset: string) {
  if (!preset || sessionModelSwitching.value) return;
  await applySessionModelSwitch(preset, "moa");
}

async function confirmSessionModelMode() {
  const pending = pendingSessionModelSwitch.value;
  if (!pending) return;
  await applySessionModelSwitch(pending.model, pending.provider, sessionModelApiMode.value, true);
}

function cancelSessionModelMode() {
  if (sessionModelSwitching.value) return;
  pendingSessionModelSwitch.value = null;
  showSessionModelModeModal.value = false;
}

async function handleSessionModelCustomSubmit() {
  const model = sessionModelCustomInput.value.trim();
  const provider = sessionModelCustomProvider.value;
  if (!model || !provider || sessionModelSwitching.value) return;
  await selectSessionModel(model, provider);
}

// Wait for route cleanup and session loading before opening the empty state;
// explicit session links may still be resolving outside the sidebar list.
watch([isEmptySingleChat, () => route.fullPath], ([empty]) => {
  if (empty && !showNewChatPage.value) void openNewChatPage({ preserveSidebar: true });
}, { immediate: true, flush: "post" });
</script>

<template>
  <div class="chat-panel" :class="{ 'chat-panel--standalone': standalone }">
    <SessionListSidebar
      v-if="hasPageSidebar"
      :expanded="showSessions"
      :navigation="contentMode !== 'chat'"
    >
      <template #header>
        <PageSidebarNav
          :active="contentMode === 'connections' ? 'connections' : contentMode === 'agents' ? 'agents' : contentMode === 'models' ? 'models' : chatStore.runtimeMode === 'global_agent' ? 'global' : 'chat'"
          :primary-label="t('chat.newChat')"
          @primary="openNewChatModal"
        >
          <template #actions>
            <ListActionsMenu
              v-if="contentMode === 'chat'"
              :label="t('chat.sessionListActions')"
              :profiles="profilesStore.profiles"
              :profile="sessionProfileFilter"
              :loading="profilesStore.loading"
              :batch-mode="isBatchMode"
              @filter="handleProfileFilterChange"
              @batch="toggleBatchMode"
            />
            <button
              v-if="isMobile"
              class="session-close-btn"
              type="button"
              :aria-label="t('common.close')"
              @click="showSessions = false"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="m18 6-12 12M6 6l12 12" />
              </svg>
            </button>
          </template>
        </PageSidebarNav>
        <SessionSelectionToolbar
          v-if="contentMode === 'chat' && isBatchMode"
          v-model:show-confirm="showBatchDeleteConfirm"
          :selected-count="selectedCount"
          :can-select-all="canSelectAll"
          :deleting="isBatchDeleting"
          @select-all="selectAllSessions"
          @delete="handleBatchDelete"
          @cancel="toggleBatchMode"
        />
      </template>
      <template #default>
        <div
          v-if="chatStore.isLoadingSessions && chatStore.sessions.length === 0"
          class="session-loading"
        >
          <NSpin size="small" :description="t('common.loading')" />
        </div>
        <div v-else-if="chatStore.sessions.length === 0" class="session-empty">
          {{ t("chat.noSessions") }}
        </div>

        <template v-if="pinnedSessions.length > 0">
          <div class="session-group-header session-group-header--static">
            <span class="session-group-label">{{ t("chat.pinned") }}</span>
            <span class="session-group-count">{{ pinnedSessions.length }}</span>
          </div>
          <SessionListItem
            v-for="s in pinnedSessions"
            :key="`pinned-${s.id}`"
            :session="s"
            :active="s.id === chatStore.activeSessionId"
            :pinned="true"
            can-delete
            :streaming="sessionStates.isWorking(s.id, chatStore.isSessionWorking(s.id))"
            :completed-unread="sessionStates.isUnread(s.id, chatStore.isSessionCompletedUnread(s.id))"
            :selectable="isBatchMode"
            :selected="isSessionSelected(s)"
            :show-profile="true"
            :to="sessionHref(s.id)"
            :intercept-modified-navigation="desktopChatWindowAvailable"
            @select="handleSessionClick(s.id)"
            @open-new="openSessionInNewTab(s.id, s.profile || null)"
            @contextmenu="handleContextMenu($event, s.id)"
            @delete="handleDeleteSession(s.id)"
            @toggle-select="toggleSessionSelection(s)"
          />
        </template>

        <template
          v-if="
            sessionBrowserPrefsStore.showRecentSessions &&
            recentSessions.sessions.length > 0
          "
        >
          <div class="session-group-header session-group-header--recent">
            <button
              class="session-group-toggle"
              type="button"
              :aria-expanded="!sessionBrowserPrefsStore.recentCollapsed"
              @click="toggleRecentGroup"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="group-chevron"
                :class="{ collapsed: sessionBrowserPrefsStore.recentCollapsed }"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="session-group-label">{{ recentSessions.label }}</span>
              <span class="session-group-count">{{ recentSessions.sessions.length }}</span>
            </button>
            <button class="session-group-config" type="button" :title="t('chat.recentCount')" @click="openRecentCountModal">⚙</button>
          </div>
          <template v-if="!sessionBrowserPrefsStore.recentCollapsed">
            <SessionListItem
              v-for="s in recentSessions.sessions"
              :key="`recent-${s.id}`"
              :session="s"
              :active="s.id === chatStore.activeSessionId"
              :pinned="Boolean(s.isPinned)"
              can-delete
              :streaming="sessionStates.isWorking(s.id, chatStore.isSessionWorking(s.id))"
              :completed-unread="sessionStates.isUnread(s.id, chatStore.isSessionCompletedUnread(s.id))"
              :selectable="isBatchMode"
              :selected="isSessionSelected(s)"
              :show-profile="true"
              :category-label="recentCategoryLabel(s)"
              :to="sessionHref(s.id)"
              :intercept-modified-navigation="desktopChatWindowAvailable"
              @select="handleRecentSessionClick(s.id)"
              @open-new="openSessionInNewTab(s.id, s.profile || null)"
              @contextmenu="handleContextMenu($event, s.id)"
              @delete="handleDeleteSession(s.id)"
              @toggle-select="toggleSessionSelection(s)"
            />
          </template>
        </template>

        <div
          v-if="sessionCategoriesLoadFailed"
          class="session-category-load-error"
          role="alert"
        >
          <span>{{ t("chat.categoryLoadFailed") }}</span>
          <button
            type="button"
            :disabled="sessionCategoriesLoading"
            @click="retrySessionCategories"
          >
            {{ t("common.retry") }}
          </button>
        </div>

        <template v-for="group in categorizedSessions" :key="group.key">
          <div
            class="session-group-header"
            @click="toggleCategoryGroup(group.key)"
            @contextmenu="handleCategoryContextMenu($event, group.key)"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="group-chevron"
              :class="{ collapsed: collapsedCategories.has(group.key) }"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span class="session-group-label">{{ group.label }}</span>
            <span class="session-group-count">{{ group.sessions.length }}</span>
            <button
              v-if="group.key !== 'category-none'"
              class="session-category-menu-button"
              type="button"
              :aria-label="t('chat.more')"
              :title="t('chat.more')"
              @click="handleCategoryMenuButton($event, group.key)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
          </div>
          <template v-if="!collapsedCategories.has(group.key)">
            <SessionListItem
              v-for="s in group.sessions"
              :key="s.id"
              :session="s"
              :active="s.id === chatStore.activeSessionId"
              :pinned="false"
              can-delete
              :streaming="sessionStates.isWorking(s.id, chatStore.isSessionWorking(s.id))"
              :completed-unread="sessionStates.isUnread(s.id, chatStore.isSessionCompletedUnread(s.id))"
              :selectable="isBatchMode"
              :selected="isSessionSelected(s)"
              :show-profile="true"
              :to="sessionHref(s.id)"
              :intercept-modified-navigation="desktopChatWindowAvailable"
              @select="handleSessionClick(s.id)"
              @open-new="openSessionInNewTab(s.id, s.profile || null)"
              @contextmenu="handleContextMenu($event, s.id)"
              @delete="handleDeleteSession(s.id)"
              @toggle-select="toggleSessionSelection(s)"
            />
          </template>
        </template>
      </template>
    </SessionListSidebar>

    <NDropdown
      :key="contextMenuCategoriesKey"
      placement="bottom-start"
      trigger="manual"
      :x="contextMenuX"
      :y="contextMenuY"
      :options="contextMenuOptions"
      :show="showContextMenu"
      @select="handleContextMenuSelect"
      @clickoutside="handleClickOutside"
    />

    <NModal v-model:show="showNewChatSettings">
      <div class="new-chat-settings-panel" role="dialog" aria-modal="true" :aria-label="t('chat.newChatSettings')">
        <header class="new-chat-settings-header">
          <h2>{{ t('chat.newChatSettings') }}</h2>
          <NButton quaternary circle size="small" :aria-label="t('common.close')" @click="showNewChatSettings = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </NButton>
        </header>
        <div class="new-chat-settings-body" :inert="newChatLoading || undefined">
          <!-- Float menus outside the modal panel so its overflow cannot clip them. -->
          <div class="new-chat-settings-group">
            <label class="new-chat-field">
              <span class="new-chat-label">{{ t("sidebar.profiles") }}</span>
              <NSelect
                v-bind="newChatSettingsSelectProps"
                :value="newChatProfile"
                :options="newChatProfileOptions"
                :loading="profilesStore.loading && profilesStore.profiles.length === 0"
                @update:value="handleNewChatProfileChange"
              />
            </label>
          </div>
          <div v-if="(isNewChatCodingAgent && effectiveNewChatAgentMode === 'scoped' && !newChatConfiguredApiMode) || newChatNeedsBaseUrl || newChatNeedsApiKey" class="new-chat-settings-group">
            <label v-if="isNewChatCodingAgent && effectiveNewChatAgentMode === 'scoped' && !newChatConfiguredApiMode" class="new-chat-field">
              <span class="new-chat-label">{{ t("codingAgents.protocolScope") }}</span>
              <NSelect
                v-bind="newChatSettingsSelectProps"
                v-model:value="newChatApiMode"
                @update:value="newChatApiModeManual = true"
                :options="newChatApiModeOptions"
                :disabled="newChatLoading"
              />
            </label>
            <label v-if="newChatNeedsBaseUrl" class="new-chat-field">
              <span class="new-chat-label">{{ t("models.baseUrl") }}</span>
              <NInput
                v-model:value="newChatBaseUrl"
                :placeholder="t('models.baseUrlPlaceholder')"
              />
            </label>
            <label v-if="newChatNeedsApiKey" class="new-chat-field">
              <span class="new-chat-label">{{ t("models.apiKey") }}</span>
              <NInput
                v-model:value="newChatApiKey"
                type="password"
                show-password-on="click"
                :placeholder="t('models.apiKeyPlaceholder')"
              />
            </label>
          </div>
        </div>
      </div>
    </NModal>

    <NModal
      v-model:show="showRecentCountModal"
      preset="dialog"
      :title="t('chat.recentCount')"
      :positive-text="t('common.ok')"
      :negative-text="t('common.cancel')"
      @positive-click="saveRecentCount"
    >
      <NInputNumber v-model:value="recentCountDraft" :min="1" :max="100" />
    </NModal>

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="categoryContextMenuX"
      :y="categoryContextMenuY"
      :options="categoryContextMenuOptions"
      :show="showCategoryContextMenu"
      @select="handleCategoryContextMenuSelect"
      @clickoutside="showCategoryContextMenu = false"
    />

    <NModal
      v-model:show="showCreateCategoryModal"
      preset="dialog"
      :title="t('chat.createCategory')"
      :positive-text="createCategoryPendingCategory ? t('common.retry') : t('common.create')"
      :negative-text="t('common.cancel')"
      :positive-button-props="{
        loading: createCategorySubmitting,
        disabled: createCategorySubmitting || (!createCategoryPendingCategory && !createCategoryValue.trim()),
      }"
      :negative-button-props="{ disabled: createCategorySubmitting }"
      :mask-closable="!createCategorySubmitting"
      :close-on-esc="!createCategorySubmitting"
      :closable="!createCategorySubmitting"
      @positive-click="handleCreateCategoryConfirm"
    >
      <NInput
        ref="createCategoryInputRef"
        v-model:value="createCategoryValue"
        :placeholder="t('chat.enterCategoryName')"
        :maxlength="40"
        :disabled="createCategorySubmitting"
        :readonly="Boolean(createCategoryPendingCategory)"
        @keydown.enter="handleCreateCategoryEnter"
      />
    </NModal>

    <NModal
      v-model:show="showRenameCategoryModal"
      preset="dialog"
      :title="t('chat.renameCategory')"
      :positive-text="t('common.ok')"
      :negative-text="t('common.cancel')"
      @positive-click="handleRenameCategoryConfirm"
    >
      <NInput
        v-model:value="renameCategoryValue"
        :placeholder="t('chat.enterCategoryName')"
        :maxlength="40"
        @keydown.enter="handleRenameCategoryConfirm"
      />
    </NModal>

    <NModal
      v-model:show="showDeleteCategoryModal"
      preset="dialog"
      type="warning"
      :title="t('chat.deleteCategory')"
      :positive-text="t('common.delete')"
      :negative-text="t('common.cancel')"
      @positive-click="handleDeleteCategoryConfirm"
    >
      {{ t('chat.confirmDeleteCategory', { name: categoryContextName }) }}
    </NModal>

    <NModal
      v-model:show="showRenameModal"
      preset="dialog"
      :title="t('chat.renameSession')"
      :positive-text="t('common.ok')"
      :negative-text="t('common.cancel')"
      @positive-click="handleRenameConfirm"
    >
      <NInput
        ref="renameInputRef"
        v-model:value="renameValue"
        :placeholder="t('chat.enterNewTitle')"
      />
    </NModal>

    <NModal
      v-model:show="showWorkspaceModal"
      preset="dialog"
      :title="t('chat.setWorkspaceTitle')"
      :positive-text="t('common.ok')"
      :negative-text="t('common.cancel')"
      style="width: var(--studio-workspace-picker-width)"
      @positive-click="handleWorkspaceConfirm"
    >
      <div class="workspace-modal-body">
        <div v-if="workspaceProjects.length" class="workspace-project-section">
          <div class="workspace-extra-header">
            <span class="workspace-extra-title">{{ t('chat.workspaceProject') }}</span>
          </div>
          <NSelect
            :value="selectedProjectSlug"
            :options="workspaceProjectOptions"
            :loading="workspaceProjectsLoading"
            :placeholder="t('chat.workspaceProjectPlaceholder')"
            size="small"
            clearable
            @update:value="handleProjectSelected"
          />
        </div>
        <FolderPicker v-model="workspaceValue" @update:model-value="handleWorkspacePrimaryChange" />
        <div class="workspace-extra-section">
          <div class="workspace-extra-header">
            <span class="workspace-extra-title">{{ t('chat.workspaceExtraDirs') }}</span>
          </div>
          <DirSearchPicker
            :model-value="workspaceExtraDirs"
            hide-chips
            class="workspace-extra-picker"
            @update:model-value="workspaceExtraDirs = $event"
          />
          <div v-if="workspaceExtraDirs.length" class="workspace-extra-list">
            <div v-for="dir in workspaceExtraDirs" :key="dir" class="workspace-extra-item">
              <span class="workspace-extra-path" :title="dir">{{ dir }}</span>
              <NButton
                size="tiny"
                quaternary
                type="error"
                @click="handleWorkspaceExtraRemove(dir)"
              >
                {{ t('common.delete') }}
              </NButton>
            </div>
          </div>
          <div v-else class="workspace-extra-empty">{{ t('chat.workspaceExtraEmpty') }}</div>
        </div>
      </div>
    </NModal>

    <NModal
      v-model:show="showSessionModelModal"
      preset="card"
      :title="t('chat.setModelTitle')"
      :style="{ width: 'min(480px, calc(100vw - 32px))' }"
      :mask-closable="!sessionModelSwitching"
      :close-on-esc="!sessionModelSwitching"
      :closable="!sessionModelSwitching"
    >
      <NSpin :show="sessionModelSwitching" class="session-model-switch-spin">
        <template #description>{{ t('chat.modelSwitching') }}</template>
        <div v-if="sessionCanUseMoa" class="session-model-kind-field">
          <span class="session-model-kind-label">{{ t('chat.modelType') }}</span>
          <NRadioGroup
            :value="sessionModelKind"
            name="session-model-kind"
            @update:value="handleSessionModelKindChange"
          >
            <NRadioButton value="model">{{ t('chat.standardModels') }}</NRadioButton>
            <NRadioButton value="moa">{{ t('chat.moaPresets') }}</NRadioButton>
          </NRadioGroup>
        </div>
        <NInput
          v-model:value="sessionModelSearch"
          :placeholder="t('models.searchPlaceholder')"
          :disabled="sessionModelSwitching"
          clearable
          size="small"
          class="session-model-search"
        />
        <div v-if="sessionModelKind === 'model'" class="session-model-list" :aria-busy="sessionModelSwitching">
        <div v-for="group in filteredSessionModelGroups" :key="group.provider" class="session-model-group">
          <div class="session-model-group-header" @click="toggleSessionModelGroup(group.provider)">
            <svg
              class="session-model-group-arrow"
              :class="{ collapsed: isSessionModelGroupCollapsed(group.provider) }"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span class="session-model-group-label">{{ group.label }}</span>
            <span class="session-model-group-count">{{ group.models.length }}</span>
          </div>
          <div v-show="!isSessionModelGroupCollapsed(group.provider)" class="session-model-group-items">
            <div
              v-for="model in group.models"
              :key="model"
              class="session-model-item"
              :class="{
                active: model === sessionModelValue && group.provider === sessionModelProvider,
                disabled: !!group.model_meta?.[model]?.disabled,
                switching: sessionModelSwitching,
              }"
              :aria-disabled="sessionModelSwitching || !!group.model_meta?.[model]?.disabled"
              :title="group.model_meta?.[model]?.disabled ? t('models.disabledTooltip') : ''"
              @click="selectSessionModel(model, group.provider)"
            >
              <span class="session-model-item-label">
                <span class="session-model-item-name">{{ sessionModelDisplayName(model, group.provider) }}</span>
                <span v-if="sessionModelAlias(model, group.provider)" class="session-model-item-id">
                  {{ t('models.aliasCanonical', { model }) }}
                </span>
              </span>
              <span v-if="group.model_meta?.[model]?.preview" class="session-model-badge-preview">{{ t('models.previewBadge') }}</span>
              <span v-if="group.model_meta?.[model]?.disabled" class="session-model-badge-disabled">{{ t('models.disabledBadge') }}</span>
              <span v-if="isCustomSessionModel(model, group.provider)" class="session-model-badge-custom">{{ t('models.customBadge') }}</span>
              <svg
                v-if="model === sessionModelValue && group.provider === sessionModelProvider"
                class="session-model-check"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        </div>
        <div v-if="filteredSessionModelGroups.length === 0" class="session-model-empty">
          {{ sessionModelSearch ? 'No results' : 'No models' }}
        </div>
        </div>
        <div v-else class="session-model-list" :aria-busy="sessionModelSwitching">
          <div class="session-model-group-items session-moa-items">
            <div
              v-for="preset in filteredSessionMoaModels"
              :key="preset"
              class="session-model-item"
              :class="{
                active: preset === sessionModelValue && sessionModelProvider === 'moa',
                switching: sessionModelSwitching,
              }"
              :aria-disabled="sessionModelSwitching"
              @click="selectSessionMoaPreset(preset)"
            >
              <span class="session-model-item-label">
                <span class="session-model-item-name">{{ preset }}</span>
              </span>
              <svg
                v-if="preset === sessionModelValue && sessionModelProvider === 'moa'"
                class="session-model-check"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
          <div v-if="filteredSessionMoaModels.length === 0" class="session-model-empty">
            {{ t('chat.noMoaPresets') }}
          </div>
        </div>
        <div v-if="sessionModelKind === 'model'" class="session-model-custom">
          <div class="session-model-custom-row">
            <NSelect
              v-model:value="sessionModelCustomProvider"
              :options="sessionModelProviderOptions"
              :disabled="sessionModelSwitching"
              size="small"
              class="session-model-custom-provider"
            />
            <NInput
              v-model:value="sessionModelCustomInput"
              :placeholder="t('models.customModelPlaceholder')"
              :disabled="sessionModelSwitching"
              size="small"
              class="session-model-custom-input"
              @keydown.enter="handleSessionModelCustomSubmit"
            />
          </div>
          <div class="session-model-custom-hint">
            {{ t('models.customModelHint') }}
          </div>
        </div>
      </NSpin>
    </NModal>

    <ModelProtocolModal
      v-model:show="showSessionModelModeModal"
      v-model:value="sessionModelApiMode"
      :loading="sessionModelSwitching"
      @cancel="cancelSessionModelMode"
      @confirm="confirmSessionModelMode"
    />

    <NDrawer
      v-model:show="showNewChatModal"
      class="new-chat-drawer"
      placement="right"
      width="var(--studio-drawer-width)"
      :mask-closable="true"
    >
      <NDrawerContent :title="t('chat.newChat')" closable>
        <div class="new-chat-form">
          <label class="new-chat-field">
            <span class="new-chat-label">{{ t("chat.agent") }}</span>
            <NSelect
              v-model:value="newChatAgent"
              :options="newChatAgentOptions"
                :virtual-scroll="false"
              :loading="newChatAgentLoading"
              :disabled="newChatLoading || newChatAgentLoading"
            />
          </label>
          <DshSessionPresetSelect
            v-if="showNewChatModal && newChatAgent === 'dsh'"
            v-model="newChatAgentPreset" :disabled="newChatLoading" @valid="newChatPresetReady = $event"
          />
          <label v-if="isNewChatExternalCodingAgent && !isGlobalOnlyCodingAgent(newChatAgent)" class="new-chat-field">
            <span class="new-chat-label">{{ t("codingAgents.launchModeScope") }}</span>
            <NRadioGroup v-model:value="newChatAgentMode" name="new-chat-coding-agent-mode">
              <NRadioButton
                v-for="option in newChatAgentModeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </NRadioButton>
            </NRadioGroup>
          </label>
          <label class="new-chat-field">
            <span class="new-chat-label">{{ t("sidebar.profiles") }}</span>
            <NSelect
              :value="newChatProfile"
              :options="newChatProfileOptions"
              :loading="profilesStore.loading && profilesStore.profiles.length === 0"
              @update:value="handleNewChatProfileChange"
            />
          </label>
          <label class="new-chat-field">
            <span class="new-chat-label">{{ t("chat.category") }}</span>
            <NSelect
              :key="newChatCategorySelectRevision"
              :value="newChatCategoryId ?? 0"
              :options="newChatCategoryOptions"
              :placeholder="t('chat.categoryPlaceholder')"
              :loading="sessionCategoriesLoading || newChatCategoryCreating"
              :disabled="newChatLoading || sessionCategoriesLoading || newChatCategoryCreating"
              filterable
              tag
              @update:value="handleNewChatCategoryChange"
            />
            <span class="new-chat-field-hint">{{ t("chat.categoryCreateHint") }}</span>
          </label>
          <label v-if="newChatUsesProviderModel && newChatCanUseMoa" class="new-chat-field">
            <span class="new-chat-label">{{ t('chat.modelType') }}</span>
            <NRadioGroup
              :value="newChatModelKind"
              name="new-chat-model-kind"
              @update:value="handleNewChatModelKindChange"
            >
              <NRadioButton value="model">{{ t('chat.standardModels') }}</NRadioButton>
              <NRadioButton value="moa">{{ t('chat.moaPresets') }}</NRadioButton>
            </NRadioGroup>
          </label>
          <label v-if="newChatUsesProviderModel && newChatModelKind === 'model'" class="new-chat-field">
            <span class="new-chat-label">{{ t("models.provider") }}</span>
            <NSelect
              :value="newChatProvider"
              :options="newChatProviderOptions"
              :loading="newChatModelsLoading"
              :disabled="newChatLoading || newChatModelsLoading"
              @update:value="handleNewChatProviderChange"
            />
          </label>
          <label v-if="newChatUsesProviderModel" class="new-chat-field">
            <span class="new-chat-label">
              {{ newChatModelKind === 'moa' ? t('chat.moaPresets') : t('models.models') }}
            </span>
            <NSelect
              v-model:value="newChatModel"
              :options="newChatModelOptions"
              :loading="newChatModelsLoading"
              :disabled="newChatLoading || newChatModelsLoading || !newChatProvider"
              filterable
            />
          </label>
          <label v-if="isNewChatCodingAgent && effectiveNewChatAgentMode === 'scoped'" class="new-chat-field">
            <span class="new-chat-label">{{ t("codingAgents.protocolScope") }}</span>
            <NSelect
              v-model:value="newChatApiMode"
              :options="newChatApiModeOptions"
              :disabled="newChatLoading"
            />
          </label>
          <label v-if="newChatNeedsBaseUrl" class="new-chat-field">
            <span class="new-chat-label">{{ t("models.baseUrl") }}</span>
            <NInput
              v-model:value="newChatBaseUrl"
              :placeholder="t('models.baseUrlPlaceholder')"
            />
          </label>
          <label v-if="newChatNeedsApiKey" class="new-chat-field">
            <span class="new-chat-label">{{ t("models.apiKey") }}</span>
            <NInput
              v-model:value="newChatApiKey"
              type="password"
              show-password-on="click"
              :placeholder="t('models.apiKeyPlaceholder')"
            />
          </label>
          <div class="new-chat-field">
            <span class="new-chat-label">{{ t("chat.workspaceProject") }}</span>
            <NSelect
              v-if="workspaceProjects.length"
              :value="newChatProjectSlug"
              :options="workspaceProjectOptions"
              :loading="workspaceProjectsLoading"
              :placeholder="t('chat.workspaceProjectPlaceholder')"
              size="small"
              clearable
              @update:value="handleNewChatProjectChange"
            />
            <span v-else class="new-chat-field-hint">{{ t("chat.workspaceProjectEmpty") }}</span>
          </div>
          <div class="new-chat-field">
            <span class="new-chat-label">
              {{ t("chat.workspace") }}
              <NTooltip v-if="isCurrentWorkspaceDefault">
                <template #trigger>
                  <span class="workspace-default-badge">{{ t("chat.workspaceDefault") }}</span>
                </template>
                {{ t("chat.workspaceDefaultTooltip") }}
              </NTooltip>
            </span>
            <!-- Default workspace chips -->
            <div v-if="defaultWorkspaces.length > 0" class="default-workspace-chips">
              <span class="default-workspace-label">{{ t("chat.defaultWorkspace") }}:</span>
              <div class="workspace-chips-container">
                <template v-for="(ws, index) in visibleDefaultWorkspaces" :key="ws">
                  <div
                    class="workspace-chip"
                    :class="{ active: newChatWorkspace === ws }"
                    @click="handleSelectDefaultWorkspace(ws)"
                    :title="ws"
                  >
                    {{ getFolderName(ws) }}
                  </div>
                  <span v-if="index < visibleDefaultWorkspaces.length - 1 || hasHiddenDefaults" class="workspace-chip-separator">/</span>
                </template>
                <div v-if="hasHiddenDefaults" class="workspace-chip-dropdown">
                  <button
                    class="workspace-chip-more"
                    type="button"
                    :aria-expanded="showDefaultWorkspaceMenu"
                    @click="showDefaultWorkspaceMenu = !showDefaultWorkspaceMenu"
                  >
                    <span>{{ t("chat.more") }}</span>
                    <svg class="workspace-more-chevron" :class="{ expanded: showDefaultWorkspaceMenu }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <div v-if="showDefaultWorkspaceMenu" class="workspace-dropdown-menu">
                    <div
                      v-for="ws in hiddenDefaultWorkspaces"
                      :key="ws"
                      class="workspace-dropdown-item"
                      @click="handleSelectDefaultWorkspace(ws)"
                      :title="ws"
                    >
                      {{ getFolderName(ws) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <FolderPicker
              v-model="newChatWorkspace"
              show-favorite
              :favorite="isCurrentWorkspaceDefault"
              :favorite-disabled="!newChatWorkspace"
              :favorite-title="isCurrentWorkspaceDefault ? t('chat.workspaceUnpin') : t('chat.workspacePin')"
              @toggle-favorite="handleToggleDefaultWorkspace"
              @update:model-value="handleNewChatPrimaryChange"
            />
            <div v-if="newChatExtraDirs.length" class="workspace-extra-list new-chat-extra-list">
              <div v-for="dir in newChatExtraDirs" :key="dir" class="workspace-extra-item">
                <span class="workspace-extra-path" :title="dir">{{ dir }}</span>
                <NButton
                  size="tiny"
                  quaternary
                  type="error"
                  @click="newChatExtraDirs = newChatExtraDirs.filter((d) => d !== dir)"
                >
                  {{ t('common.delete') }}
                </NButton>
              </div>
            </div>
            <DirSearchPicker
              :model-value="newChatExtraDirs"
              hide-chips
              @update:model-value="newChatExtraDirs = $event"
            />
            <div v-if="recentWorkspaces.length > 0" class="recent-workspaces">
              <span class="recent-workspaces-label">{{ t("chat.workspaceRecent") }}:</span>
              <div class="recent-workspaces-chips">
                <NButton
                  v-for="ws in recentWorkspaces"
                  :key="ws.path"
                  size="tiny"
                  :type="ws.path === newChatWorkspace ? 'primary' : 'default'"
                  @click="handleSelectRecentWorkspace(ws.path)"
                >
                  <template #icon>
                    <span
                      class="recent-pin-icon"
                      :class="{ 'is-pinned': defaultWorkspaces.includes(ws.path) }"
                      @click.stop="handleTogglePinRecent(ws.path)"
                      :title="defaultWorkspaces.includes(ws.path) ? t('chat.workspaceUnpin') : t('chat.workspacePin')"
                    >
                      <StarIcon :filled="defaultWorkspaces.includes(ws.path)" width="14" height="14" />
                    </span>
                  </template>
                  {{ getFolderName(ws.path) }}
                </NButton>
              </div>
            </div>
          </div>
        </div>
        <template #footer>
          <div class="new-chat-actions">
            <NButton @click="showNewChatModal = false">{{ t("common.cancel") }}</NButton>
            <NButton
              type="primary"
              :disabled="!canConfirmNewChat"
              @click="confirmNewChat"
            >
              {{ t("common.create") }}
            </NButton>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>

    <SessionTasksDrawer v-if="sessionTasksMounted && !standalone && chatStore.runtimeMode === 'default'" :show="showSessionTasks" @update:show="updateSessionTasksVisibility" />

    <div
      class="chat-main"
      :class="{ 'chat-main--sidebar-collapsed': !pageSidebarExpanded }"
    >
      <ConnectionsPanel
        v-if="contentMode === 'connections'"
      />
      <AgentManagerPanel
        v-else-if="contentMode === 'agents'"
      />
      <ModelsPanel
        v-else-if="contentMode === 'models'"
      />
      <template v-else>
      <PageHeader>
      <header v-if="!standalone" class="chat-header">
        <div class="header-left">
          <HeaderSidebarToggle
            v-if="currentMode === 'chat'"
            class="header-sidebar-toggle"
            :expanded="showSessions"
            @toggle="showSessions = !showSessions"
          />
          <span class="header-session-title" dir="auto">{{ headerTitle }}</span>
        </div>
        <div class="header-actions">
          <NTooltip v-if="chatStore.runtimeMode === 'default'" trigger="hover">
            <template #trigger>
              <NButton class="header-tasks-button" quaternary size="small" circle :aria-label="t('sessionTasks.title')" :aria-expanded="showSessionTasks" aria-haspopup="dialog" @click="openSessionTasks">
                <template #icon><SessionTaskIcon :size="16" /></template>
              </NButton>
            </template>
            {{ t('sessionTasks.title') }}
          </NTooltip>
          <NButton
            v-if="chatStore.activeSession?.workspace"
            class="header-workspace-button"
            quaternary
            size="small"
            circle
            :title="chatStore.activeSession.workspace"
            :aria-label="t('chat.setWorkspace')"
            @click="openActiveSessionWorkspace"
          >
            <template #icon>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </template>
          </NButton>
          <!-- chat/live mode toggle hidden -->
          <template v-if="currentMode === 'chat' && !showNewChatPage">
            <HeaderToolPanelToggle v-if="isSuperAdmin" :expanded="showToolPanel" controls="chat-tool-panel"
              :tooltip="desktopBrowserAvailable ? `${t('drawer.files')} / ${t('drawer.terminal')} / ${t('browser.title')}` : `${t('drawer.files')} / ${t('drawer.terminal')}`"
              @toggle="toggleToolPanel" />
            <NDropdown
              v-model:show="showActiveSessionMenu"
              trigger="click"
              placement="bottom-end"
              :keyboard="false"
              :menu-props="activeSessionMenuProps"
              :node-props="activeSessionMenuNodeProps"
              :options="activeSessionMenuOptions"
              :show-arrow="true"
              @select="handleActiveSessionMenuSelect"
              @keydown="handleActiveSessionMenuKeydown"
            >
              <NTooltip trigger="hover" :disabled="showActiveSessionMenu">
                <template #trigger>
                  <NButton
                    ref="activeSessionMenuTriggerRef"
                    class="header-session-menu-trigger"
                    quaternary
                    size="small"
                    :disabled="!chatStore.activeSessionId"
                    :aria-label="t('chat.sessionActions')"
                    :aria-expanded="showActiveSessionMenu"
                    aria-controls="active-session-actions-menu"
                    aria-haspopup="menu"
                    @keydown="handleActiveSessionMenuTriggerKeydown"
                    circle
                  >
                    <template #icon>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                      </svg>
                    </template>
                  </NButton>
                </template>
                {{ t("chat.sessionActions") }}
              </NTooltip>
            </NDropdown>
          </template>
        </div>
      </header>
      </PageHeader>

      <template v-if="currentMode === 'chat'">
        <div
          ref="chatContentWrapperRef"
          class="chat-content-wrapper"
          :class="{ 'chat-content-wrapper--drop-active': isChatDropActive }"
          @dragover="handleChatDragOver"
          @dragenter="handleChatDragEnter"
          @dragleave="handleChatDragLeave"
          @drop="handleChatDrop"
        >
          <div ref="chatMainContentRef" class="chat-main-content" data-agent-deployment-surface
            :data-agent-deployment-session="chatStore.activeSessionId || ''"
            :data-agent-deployment-active="currentMode === 'chat' && !showNewChatPage"
            :data-agent-deployment-status-session="chatStore.activeSessionId || ''"
            :data-agent-deployment-status="chatStore.isLoadingMessages ? 'pending' : chatStore.isRunActive ? 'working' : 'settled'">
            <NewChatPage v-if="showNewChatPage" :title="t('chat.newChatCardTitle')" :subtitle="t('chat.newChatCardSubtitle')">
              <template #cards>
                <NewChatAgentCards :value="newChatAgent" :options="newChatAgentOptions"
                  :loading="newChatAgentLoading" :disabled="newChatLoading"
                  @update:value="handleNewChatAgentChange" />
              </template>
                <div class="new-chat-config-bar">
                  <div class="new-chat-config-actions">
                    <NButton quaternary circle size="small" class="new-chat-config-icon" :disabled="newChatLoading" :title="newChatWorkspace || t('chat.workspace')"
                      :aria-label="t('chat.workspace')" :aria-expanded="showWorkspaceModal && workspaceIsDraft" @click="openNewChatWorkspace">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                    </NButton>
                    <DshSessionPresetSelect v-if="newChatAgent === 'dsh'" :key="newChatComposerRevision" v-model="newChatAgentPreset" v-model:show="showNewChatPresetMode"
                      compact :disabled="newChatLoading" @valid="newChatPresetReady = $event" />
                    <NButton quaternary circle size="small" class="new-chat-config-icon" :disabled="newChatLoading" :title="t('chat.newChatSettings')"
                      :aria-label="t('chat.newChatSettings')" :aria-expanded="showNewChatSettings" @click="showNewChatSettings = true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--bg-card)"/><circle cx="15" cy="17" r="2" fill="var(--bg-card)"/></svg>
                    </NButton>
                    <NButton ref="newChatCategoryTriggerRef" quaternary circle size="small" class="new-chat-config-icon" :disabled="newChatLoading"
                      :title="`${t('chat.category')}: ${newChatCategoryOptions.find(option => option.value === (newChatCategoryId ?? 0))?.label || t('chat.uncategorized')}`"
                      :aria-label="t('chat.category')" :aria-expanded="showNewChatCategory" aria-haspopup="dialog"
                      aria-controls="new-chat-category-picker" @click="handleNewChatCategoryShow(!showNewChatCategory)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13 13 20a2 2 0 0 1-2.83 0L3 12.83V3h9.83L20 10.17a2 2 0 0 1 0 2.83Z"/><circle cx="7.5" cy="7.5" r="1"/></svg>
                    </NButton>
                    <NPopover :show="showNewChatCategory" trigger="manual" :placement="isMobile ? 'bottom' : 'bottom-start'"
                      :x="newChatCategoryAnchor.x" :y="newChatCategoryAnchor.y" :show-arrow="!isMobile"
                      @clickoutside="handleNewChatCategoryClickOutside"
                      :disabled="newChatLoading" :style="{ width: isMobile ? '320px' : '280px', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box' }">
                      <div id="new-chat-category-picker" role="dialog" :aria-label="t('chat.category')">
                        <div class="new-chat-field">
                          <span class="new-chat-label">{{ t("chat.category") }}</span>
                          <NSelect
                            v-bind="newChatSettingsSelectProps"
                            :to="false"
                            :input-props="{ 'aria-label': t('chat.category') }"
                            :key="newChatCategorySelectRevision"
                            :value="newChatCategoryId ?? 0"
                            :options="newChatCategoryOptions"
                            :placeholder="t('chat.categoryPlaceholder')"
                            :loading="sessionCategoriesLoading || newChatCategoryCreating"
                            :disabled="newChatLoading || sessionCategoriesLoading || newChatCategoryCreating"
                            filterable
                            tag
                            @update:value="handleNewChatCategoryChange"
                          />
                          <span class="new-chat-field-hint">{{ t("chat.categoryCreateHint") }}</span>
                        </div>
                      </div>
                    </NPopover>
                    <div v-if="isNewChatExternalCodingAgent && !isGlobalOnlyCodingAgent(newChatAgent)"
                      class="new-chat-launch-toggle" role="radiogroup" :aria-label="t('codingAgents.launchModeScope')"
                      @keydown="handleNewChatLaunchModeKeydown">
                      <button type="button" role="radio" :aria-checked="newChatAgentMode === 'scoped'"
                        :tabindex="newChatAgentMode === 'scoped' ? 0 : -1" :disabled="newChatLoading"
                        :title="t('codingAgents.launchModeScoped')" @click="handleNewChatLaunchModeChange(false)">
                        {{ t('codingAgents.modelScope') }}
                      </button>
                      <button type="button" role="radio" :aria-checked="newChatAgentMode === 'global'"
                        :tabindex="newChatAgentMode === 'global' ? 0 : -1" :disabled="newChatLoading"
                        :title="t('codingAgents.launchModeGlobal')" @click="handleNewChatLaunchModeChange(true)">
                        {{ t('codingAgents.launchModeGlobalShort') }}
                      </button>
                    </div>
                  </div>
                </div>
                <ChatInput :key="newChatComposerRevision" ref="chatInputRef" draft :send-disabled="!canConfirmNewChat"
                  :draft-config="newChatDraftConfig" v-model:reasoning-effort="newChatComposerReasoningEffort"
                  :native-reasoning-efforts="isNewChatGlobalCodingAgent ? newChatNativeReasoningEfforts : undefined"
                  :native-effort-choices="isNewChatGlobalCodingAgent ? newChatNativeEffortChoices : undefined"
                  :submit="submitNewChat" :model-label="newChatModelLabel" :model-disabled="newChatLoading || (!isNewChatGlobalCodingAgent && newChatModelsLoading)"
                  :model-expanded="showSessionModelPicker && sessionModelIsDraft"
                  :persist-draft="false" :initial-text="initialComposerText" @model-click="openSessionModelPicker(null, $event)" />
                <button v-if="newChatHasNoModels" type="button" class="new-chat-config-hint" @click="openNewChatModelSettings">
                  {{ t('models.noModels') }} · {{ t('models.noProviderPromptAction') }}
                </button>
                <button v-else-if="newChatMissingCredentials" type="button" class="new-chat-config-hint" @click="showNewChatSettings = true">
                  {{ t('chat.newChatCredentialsHint') }}
                </button>
            </NewChatPage>
            <template v-else>
            <MessageList
              ref="messageListRef"
              :approval-portal-to-body="showRealtimeVoice"
              scroll-scope="chat"
            />
            <ChatInput
              ref="chatInputRef"
              :model-label="activeSessionModelLabel"
              :model-disabled="activeSessionUsesGlobalCodingAgentConfig"
              :initial-text="initialComposerText"
              :persist-draft="composerPersistDraft"
              @model-click="handleHeaderModelClick"
              @voice-click="openRealtimeVoice"
            />
            </template>
          </div>
          <OutlinePanel
            v-if="showOutline"
            :messages="chatStore.messages"
            @navigate="handleOutlineNavigate"
          />
          <Transition
            name="tool-panel"
            @before-enter="handleToolPanelBeforeEnter"
            @after-enter="handleToolPanelAfterEnter"
            @before-leave="handleToolPanelBeforeLeave"
            @leave-cancelled="handleToolPanelLeaveCancelled"
          >
            <aside
              v-if="showToolPanel"
              id="chat-tool-panel"
              class="chat-tool-panel"
              role="region"
              :aria-label="t('chat.sidePanel')"
              :style="toolPanelStyle"
            >
              <div
                class="chat-tool-resize-handle"
                @pointerdown="startToolResize"
              />
              <div class="chat-tool-panel-inner">
                <WorkspaceDiffPreview
                  v-if="toolPanelStore.workspaceDiff"
                  :custom-close="closeToolPanelOverlay"
                />
                <SubagentStreamPanel
                  v-else-if="selectedSubagent"
                  :agent="chatSessionAgentAvatar(chatStore.activeSession)"
                  :stream="selectedSubagentStream"
                  @close="closeToolPanelOverlay"
                />
                <template v-else-if="previewOnlyFileOpen">
                  <FilePreview
                    v-if="filesStore.previewFile"
                    :custom-close="closeToolPanelOverlay"
                  />
                  <div v-else class="chat-file-preview-loading">
                    <NSpin size="small" />
                  </div>
                </template>
                <template v-else>
                  <ChatToolsPanel v-model:active-panel="activeToolPanel"
                    :workspace-session-id="activeWorkspaceSessionId" :workspace="activeWorkspacePath"
                    :visible="showToolPanel" :browser-visible="toolPanelTransitionReady" :browser-available="desktopBrowserAvailable"
                    :submit="submitBrowserAnnotations" @attach="handleWorkspaceFileAttach" />
                </template>
              </div>
            </aside>
          </Transition>
        </div>
      </template>
      <ConversationMonitorPane
        v-else
        :human-only="sessionBrowserPrefsStore.humanOnly"
      />
      </template>
    </div>
    <Teleport to="body">
      <RealtimeVoiceStage
        v-if="showRealtimeVoice"
        @close="closeRealtimeVoice"
      />
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.chat-panel {
  display: flex;
  height: 100%;
  position: relative;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  background-color: $bg-card;
}

.session-model-search {
  margin-bottom: 12px;
}

.workspace-modal-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.workspace-extra-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workspace-extra-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workspace-extra-title {
  font-size: 12px;
  color: $text-muted;
  font-weight: 500;
}

.workspace-extra-picker {
  margin-top: 4px;
}

.workspace-project-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.workspace-extra-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.new-chat-extra-list {
  margin: 6px 0;
}

.workspace-extra-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}

.workspace-extra-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.08);
}

.workspace-extra-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  direction: rtl;
  text-align: left;
}

.workspace-extra-empty {
  font-size: 12px;
  color: $text-muted;
}

.session-model-kind-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.session-model-kind-label {
  font-size: 12px;
  color: $text-muted;
  font-weight: 500;
}

.session-model-switch-spin {
  min-height: 180px;
}

.session-model-list {
  max-height: 50vh;
  overflow-y: auto;
  scrollbar-width: thin;
}

.session-model-group {
  margin-bottom: 4px;
}

.session-model-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  color: $text-secondary;
  cursor: pointer;
  border-radius: $radius-sm;
  user-select: none;
  transition: background-color $transition-fast;

  &:hover {
    background-color: $bg-secondary;
  }
}

.session-model-group-arrow {
  flex-shrink: 0;
  transition: transform $transition-fast;

  &.collapsed {
    transform: rotate(-90deg);
  }
}

.session-model-group-label {
  flex: 1;
}

.session-model-group-count {
  font-size: 11px;
  color: $text-muted;
  font-weight: 400;
}

.session-model-group-items {
  padding-inline-start: 8px;
}

.session-moa-items {
  padding-inline-start: 0;
}

.session-model-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 13px;
  color: $text-secondary;
  border-radius: $radius-sm;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    background-color: rgba(var(--accent-primary-rgb), 0.06);
    color: $text-primary;
  }

  &.active {
    color: $accent-primary;
    font-weight: 500;
  }

  &.disabled {
    opacity: 0.45;
    cursor: not-allowed;

    &:hover {
      background-color: transparent;
      color: $text-secondary;
    }
  }

  &.switching {
    cursor: wait;
  }
}

.session-model-item-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-model-item-name,
.session-model-item-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: $font-code;
}

.session-model-item-name {
  font-size: 12px;
}

.session-model-item-id {
  color: $text-muted;
  font-size: 10px;
  font-weight: 400;
}

.session-model-check {
  flex-shrink: 0;
  color: $accent-primary;
}

.session-model-badge-preview,
.session-model-badge-custom,
.session-model-badge-disabled {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  margin-inline-end: 4px;
  letter-spacing: 0.03em;
}

.session-model-badge-preview {
  color: #fff;
  background: #d97706;
}

.session-model-badge-custom {
  color: #fff;
  background: $accent-primary;
}

.session-model-badge-disabled {
  color: $text-muted;
  background: transparent;
  border: 1px solid $border-color;
  padding: 0 5px;
}

.session-model-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: $text-muted;
}

.session-model-custom {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid $border-color;
}

.session-model-custom-row {
  display: flex;
  gap: 8px;
}

.session-model-custom-provider {
  width: 160px;
  flex-shrink: 0;
}

.session-model-custom-input {
  flex: 1;
}

.session-model-custom-hint {
  margin-top: 6px;
  font-size: 11px;
  color: $text-muted;
}

.session-list {
  width: $sidebar-width;
  min-height: 0;
  align-self: stretch;
  margin: 0;
  background: $bg-sidebar-surface;
  border-inline-end: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition:
    width $transition-normal,
    opacity $transition-normal;
  overflow: hidden;

  &--navigation .page-sidebar-top {
    flex: 1;
    overflow-y: auto;
  }

  &.collapsed {
    width: 0;
    margin-inline-start: 0;
    margin-inline-end: 0;
    border: none;
    box-shadow: none;
    opacity: 0;
    pointer-events: none;
  }

  @media (max-width: $breakpoint-mobile) {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    height: auto;
    margin: 0;
    z-index: 120;
    // 会话抽屉收窄: 小屏按视口比例, 大屏封顶 224 — 不吃桌面拖拽持久化的宽度
    width: min(58vw, 224px);

    &.collapsed {
      transform: translateX(-100%);
      opacity: 0;
    }
  }
}

@media (max-width: $breakpoint-mobile) {
  .session-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 110;
    opacity: 0;
    pointer-events: none;
    transition: opacity $transition-fast;

    &.active {
      opacity: 1;
      pointer-events: auto;
    }
  }
}

.page-sidebar-top {
  flex-shrink: 0;
  padding: 12px;
}

.page-sidebar-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-sidebar-tab {
  width: 100%;
  min-width: 0;
  height: 34px;
  border: none;
  border-radius: $radius-sm;
  background: transparent;
  color: $text-secondary;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  transition:
    background-color $transition-fast,
    color $transition-fast;

  svg {
    flex-shrink: 0;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 18px;
  }

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.06);
    color: $text-primary;
  }
}

.session-list-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  justify-content: space-between;
}

.session-selection-count {
  min-width: 0;
  font-size: 12px;
  color: $text-secondary;
}

.session-list-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;

  .n-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    min-height: 22px;
  }
}

.session-close-btn {
  display: inline-flex;
  border: none;
  background: none;
  cursor: pointer;
  color: $text-secondary;
  padding: 4px;
  border-radius: $radius-sm;
  height: 22px;
  min-height: 22px;
  align-items: center;
  justify-content: center;

  &:hover {
    background: rgba($accent-primary, 0.06);
  }
}

.session-list-title {
  font-size: 12px;
  font-weight: 600;
  color: $text-muted;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 22px;
}

.conversation-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  margin-top: 8px;
  padding: 2px;
  border-radius: $radius-sm;
  background: rgba(var(--accent-primary-rgb), 0.05);
}

.conversation-switch-tab {
  min-width: 0;
  height: 28px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: $text-secondary;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
  transition:
    background-color $transition-fast,
    color $transition-fast;

  &:hover {
    color: $text-primary;
  }

  &.active {
    background: $bg-card;
    color: $text-primary;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
}

.new-chat-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

:deep(.new-chat-drawer .n-drawer-content) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.new-chat-drawer .n-drawer-header),
:deep(.new-chat-drawer .n-drawer-footer) {
  flex-shrink: 0;
}

:deep(.new-chat-drawer .n-drawer-body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

:deep(.new-chat-drawer .n-drawer-body-content-wrapper) {
  height: 100%;
  overflow-y: auto;
}

:deep(.new-chat-drawer .folder-picker) {
  max-height: 260px;
}

:deep(.new-chat-drawer .folder-tree) {
  max-height: 170px;
}

@media (max-width: $breakpoint-mobile) {
  :deep(.new-chat-drawer .n-drawer-body-content-wrapper) {
    padding-top: 12px;
    padding-bottom: 12px;
  }

  :deep(.new-chat-drawer .folder-picker) {
    max-height: 210px;
  }

  :deep(.new-chat-drawer .folder-tree) {
    max-height: 128px;
  }
}
.new-chat-config-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: calc(6px * var(--spacing-scale, 1)) calc(12px * var(--spacing-scale, 1)); margin-bottom: 8px; }
.new-chat-config-actions { display: flex; justify-content: flex-start; align-items: center; gap: calc(8px * var(--spacing-scale, 1)); max-width: 100%; }
.new-chat-config-icon { width: 28px; height: 28px; padding: 0; }
.new-chat-launch-toggle {
  display: inline-flex; flex: none; gap: calc(2px * var(--spacing-scale, 1)); margin: 0 2px; padding: calc(2px * var(--spacing-scale, 1));
  border-radius: var(--radius-component, 8px); background: rgba(var(--text-primary-rgb), .045);
  button {
    min-width: 44px; height: 24px; padding: 0 calc(9px * var(--spacing-scale, 1)); border: 0; border-radius: var(--radius-component, 6px);
    background: transparent; color: $text-secondary; font: inherit; font-size: calc(var(--font-size-base, 14px) * 12 / 14); line-height: var(--line-height, calc(var(--font-size-base, 14px) * 20 / 14));
    white-space: nowrap; cursor: pointer; transition: background-color .15s, color .15s, box-shadow .15s;
    &[aria-checked="true"] {
      background: var(--theme-card-bg, $bg-card); color: $text-primary;
      box-shadow: 0 1px 4px #00000014, inset 0 0 0 1px rgba(var(--text-primary-rgb), .1);
    }
    &:focus-visible { outline: 2px solid $accent-primary; outline-offset: 2px; }
    &:disabled { cursor: default; opacity: .45; }
  }
}
.new-chat-config-hint { display: block; margin: 10px auto 0; padding: 0; border: 0; background: transparent; color: $text-secondary; font: inherit; font-size: calc(var(--font-size-base, 14px) * 12 / 14); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.workspace-picker-content { display: flex; flex-direction: column; gap: calc(12px * var(--spacing-scale, 1)); max-height: 65vh; overflow-y: auto; }
.workspace-picker-content :deep(.n-button__content) { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: $breakpoint-mobile) {
  .new-chat-config-bar { flex-wrap: wrap; gap: calc(6px * var(--spacing-scale, 1)); }
  .new-chat-config-actions { width: 100%; }
}

.new-chat-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-chat-label {
  font-size: 12px;
  color: $text-muted;
  font-weight: 500;
}

.new-chat-field-hint {
  font-size: 11px;
  color: $text-muted;
}

.new-chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.session-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 4px;
  cursor: pointer;
  user-select: none;
}

.session-group-header--static,
.session-group-header--recent {
  cursor: default;
}

.session-group-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.group-chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
  transform: rotate(90deg);

  &.collapsed {
    transform: rotate(0deg);
  }
}

.session-group-label {
  font-size: 10px;
  font-weight: 600;
  color: $text-muted;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.session-group-config {
  margin-inline-start: auto;
  border: 0;
  background: transparent;
  color: $text-muted;
  cursor: pointer;
  padding: 0 2px;
}

.session-group-count {
  font-size: 10px;
  color: $text-muted;
  font-weight: 400;
}

.session-category-menu-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-inline-start: auto;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: $text-muted;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: $bg-secondary;
    color: $text-primary;
  }
}

.session-category-load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 4px 10px 8px;
  padding: 7px 8px;
  border: 1px solid rgba(var(--error-rgb), 0.25);
  border-radius: 6px;
  background: rgba(var(--error-rgb), 0.06);
  color: var(--error);
  font-size: 11px;

  button {
    flex: 0 0 auto;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
  }

  button:disabled {
    cursor: default;
    opacity: 0.55;
  }
}

.session-items {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px 12px;
}

.session-loading,
.session-empty {
  padding: 16px 10px;
  font-size: 12px;
  color: $text-muted;
  text-align: center;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  margin: 10px 10px 10px 0;
  background: $bg-main-surface;
  border: 1px solid $border-color;
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);

  &--sidebar-collapsed {
    margin-inline-start: 10px;
  }

  @media (max-width: $breakpoint-mobile) {
    margin: 0;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
}

.chat-content-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  min-width: 0;
  max-width: 100%;
}

.chat-content-wrapper--drop-active::after {
  content: "";
  position: absolute;
  inset: 12px;
  z-index: 30;
  pointer-events: none;
  border: 2px dashed var(--accent-info);
  border-radius: 8px;
  background: rgba(var(--accent-info-rgb), 0.05);
}

.chat-main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background-color: var(--theme-content-bg, $bg-main-surface);
  animation: chat-surface-fade-in 1.5s ease both;
}

@keyframes chat-surface-fade-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 21px 20px;
  border-bottom: 1px solid $border-color;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  flex: 1;
  min-width: 0;
}

.header-session-title {
  font-size: 16px;
  font-weight: 600;
  color: $text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-badge {
  font-size: 10px;
  color: $text-muted;
  background: rgba($text-muted, 0.12);
  padding: 1px 7px;
  border-radius: 8px;
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

:global(#active-session-actions-menu [role="menuitem"]:focus-visible > .n-dropdown-option-body) {
  outline: 2px solid var(--accent-primary);
  outline-offset: -2px;
}

.chat-mode-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-inline-end: 4px;
}

@media (max-width: $breakpoint-mobile) {
  .chat-header {
    padding: calc(16px + env(safe-area-inset-top, 0px)) 12px 16px 52px;
  }

  .header-sidebar-toggle {
    display: none;
  }

  .header-session-title {
    font-size: 14px;
  }

}

.chat-tool-panel {
  position: relative;
  flex: 0 0 auto;
  min-width: 320px;
  max-width: 100%;
  max-inline-size: 100%;
  box-sizing: border-box;
  background: $bg-card;
  border-inline-start: 1px solid $border-color;
  display: flex;
  min-height: 0;
  overflow: visible;
}

.tool-panel-enter-active,
.tool-panel-leave-active {
  overflow: hidden;
  pointer-events: none;
  will-change: width, min-width, opacity;
  transition:
    width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.16s ease,
    border-color 0.16s ease;
}

.tool-panel-enter-from,
.tool-panel-leave-to {
  width: 0 !important;
  min-width: 0;
  opacity: 0;
  border-inline-start-color: transparent;
}

.chat-tool-resize-handle {
  position: absolute;
  inset-inline-start: -7px;
  top: 0;
  bottom: 0;
  width: 14px;
  cursor: col-resize;
  z-index: 20;

  &::after {
    content: "";
    position: absolute;
    inset-inline-start: 6px;
    top: 0;
    bottom: 0;
    width: 1px;
    background:
      linear-gradient($border-color, $border-color) top / 1px calc(50% - 26px) no-repeat,
      linear-gradient($border-color, $border-color) bottom / 1px calc(50% - 26px) no-repeat;
    transition: background $transition-fast;
    z-index: 1;
  }

  &::before {
    content: "";
    position: absolute;
    inset-inline-start: 1px;
    top: 50%;
    width: 12px;
    height: 38px;
    transform: translateY(-50%);
    border-radius: 6px;
    background:
      linear-gradient($text-muted, $text-muted) center 12px / 6px 1px no-repeat,
      linear-gradient($text-muted, $text-muted) center 19px / 6px 1px no-repeat,
      linear-gradient($text-muted, $text-muted) center 26px / 6px 1px no-repeat,
      $bg-card;
    border: 1px solid $border-color;
    opacity: 0.9;
    transition: all $transition-fast;
    z-index: 2;
  }

  &:hover::after {
    background:
      linear-gradient(var(--accent-primary), var(--accent-primary)) top / 1px calc(50% - 26px) no-repeat,
      linear-gradient(var(--accent-primary), var(--accent-primary)) bottom / 1px calc(50% - 26px) no-repeat;
  }

  &:hover::before {
    background:
      linear-gradient(var(--accent-primary), var(--accent-primary)) center 12px / 6px 1px no-repeat,
      linear-gradient(var(--accent-primary), var(--accent-primary)) center 19px / 6px 1px no-repeat,
      linear-gradient(var(--accent-primary), var(--accent-primary)) center 26px / 6px 1px no-repeat,
      $bg-card;
    border-color: var(--accent-primary);
    opacity: 1;
  }
}

.chat-tool-panel-inner {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: $bg-main-surface;
}

.chat-file-preview-loading {
  flex: 1;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
}

.chat-tool-tabs {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  order: 2;
  width: 48px;
  height: 100%;
  gap: 4px;
  padding: 8px 6px;
  border-inline-start: 1px solid $border-color;
  background: $bg-sidebar-surface;
  box-sizing: border-box;
}

.chat-tool-tab {
  position: relative;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: $radius-sm;
  background: transparent;
  color: $text-secondary;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all $transition-fast;

  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  &:hover {
    color: $text-primary;
    background: rgba(var(--accent-primary-rgb), 0.06);
  }

  &.active {
    color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.12);

    &::after {
      content: "";
      position: absolute;
      right: -6px;
      top: 9px;
      bottom: 9px;
      width: 2px;
      border-radius: 2px 0 0 2px;
      background: var(--accent-primary);
    }
  }
}

.chat-tool-content {
  order: 1;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: $bg-main-surface;
}

.chat-tool-content > * {
  height: 100%;
  min-height: 0;
}

@media (max-width: $breakpoint-mobile) {
  .chat-tool-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 70;
    left: 0;
    width: 100% !important;
    max-width: 100vw !important;
    max-inline-size: 100vw;
    min-width: 0;
    box-sizing: border-box;
    border-inline-start: none;
    box-shadow: none;
  }

  .chat-tool-resize-handle {
    display: none;
  }

  .tool-panel-enter-active,
  .tool-panel-leave-active {
    transition:
      transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.16s ease;
  }

  .tool-panel-enter-from,
  .tool-panel-leave-to {
    width: 100% !important;
    transform: translateX(100%);
  }

  .tool-panel-enter-from:dir(rtl),
  .tool-panel-leave-to:dir(rtl) {
    transform: translateX(-100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-panel-enter-active,
  .tool-panel-leave-active {
    transition-duration: 0.01ms;
  }
}

/* ── Default Workspace Feature ─────────────────────────────────── */

.default-workspace-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  min-width: 0;
  margin-bottom: 8px;
}

.default-workspace-label {
  font-size: 13px;
  color: var(--n-text-color-3);
  flex-shrink: 0;
}

.workspace-chips-container {
  display: flex;
  flex: 1 1 240px;
  min-width: 0;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  position: relative;
}

.workspace-chip {
  min-width: 0;
  padding: 4px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-chip:hover {
  background: rgba(var(--accent-primary-rgb), 0.06);
  border-color: var(--accent-muted);
  color: var(--text-primary);
}

.workspace-chip.active {
  background: rgba(var(--accent-primary-rgb), 0.12);
  border-color: var(--accent-muted);
  color: var(--accent-primary);
  font-weight: 500;
}

.workspace-chip-separator {
  flex-shrink: 0;
  color: var(--n-text-color-3);
  font-size: 13px;
  user-select: none;
}

.workspace-chip-dropdown {
  position: relative;
  display: flex;
  flex-shrink: 0;
}

.workspace-chip-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  line-height: inherit;
  padding: 4px 12px;
  font-size: 13px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--text-secondary);
}

.workspace-chip-more:hover {
  background: rgba(var(--accent-primary-rgb), 0.06);
  border-color: var(--accent-muted);
  color: var(--text-primary);
}

.workspace-more-chevron {
  flex-shrink: 0;

  &.expanded {
    transform: rotate(180deg);
  }
}

.workspace-dropdown-menu {
  position: absolute;
  top: 100%;
  inset-inline-end: 0;
  margin-top: 4px;
  width: 240px;
  max-width: calc(100vw - 48px);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 9999;
  max-height: 300px;
  overflow-y: auto;
}

.workspace-dropdown-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-dropdown-item:hover {
  background: var(--n-color-hover);
}

.workspace-default-badge {
  display: inline-block;
  margin-inline-start: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: #f5a623;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid rgba(245, 166, 35, 0.3);
  border-radius: 3px;
  vertical-align: middle;
}

.recent-workspaces {
  margin-top: 8px;
}

.recent-workspaces-label {
  display: block;
  font-size: 11px;
  color: $text-muted;
  margin-bottom: 4px;
}

.recent-workspaces-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.recent-pin-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
  transition: opacity $transition-fast;

  &:hover,
  &.is-pinned {
    opacity: 1;
  }
}
</style>
