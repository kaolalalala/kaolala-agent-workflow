"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import Editor from "@monaco-editor/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";

import {
  runtimeClient,
  type DevWorkspaceRunResult,
  type LocalEnvironmentView,
  type LocalProjectConfig,
  type LocalFileInfo,
  type WorkspaceFileView,
} from "@/features/workflow/adapters/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const TerminalPanel = dynamic(
  () => import("@/components/terminal/terminal-panel").then((m) => ({ default: m.TerminalPanel })),
  { ssr: false },
);

/* ── Constants ── */

const DEFAULT_BOTTOM_HEIGHT = 220;
const MIN_BOTTOM_HEIGHT = 100;
const MAX_BOTTOM_HEIGHT = 400;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/* ── Helpers ── */

interface TabItem {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
}

interface RunRecord {
  id: number;
  result: DevWorkspaceRunResult;
  timestamp: string;
}

const EXT_LANG_MAP: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".ts": "typescript",
  ".jsx": "javascript",
  ".tsx": "typescript",
  ".json": "json",
  ".md": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".html": "html",
  ".css": "css",
  ".sh": "shell",
  ".bash": "shell",
  ".sql": "sql",
  ".xml": "xml",
  ".toml": "ini",
  ".ini": "ini",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".r": "r",
  ".rb": "ruby",
  ".lua": "lua",
  ".txt": "plaintext",
};

function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return EXT_LANG_MAP[path.slice(dot).toLowerCase()] ?? "plaintext";
}

/** Generate a run command from a file path, like an IDE's "Run File" button. */
function commandForFile(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const name = filePath.replace(/\\/g, "/");
  switch (ext) {
    case ".py": return `python ${name}`;
    case ".js": return `node ${name}`;
    case ".ts": return `deno run ${name}`;
    case ".tsx": return `deno run ${name}`;
    case ".jsx": return `node ${name}`;
    case ".sh": return `bash ${name}`;
    case ".bash": return `bash ${name}`;
    case ".rb": return `ruby ${name}`;
    case ".go": return `go run ${name}`;
    case ".rs": return `cargo run`;
    case ".java": return `java ${name}`;
    case ".lua": return `lua ${name}`;
    case ".r": return `Rscript ${name}`;
    case ".jl": return `julia ${name}`;
    default: return "";
  }
}

const RUNNABLE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".sh", ".bash",
  ".rb", ".go", ".rs", ".java", ".lua", ".r", ".jl",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".md", ".txt",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh",
  ".bash", ".bat", ".ps1", ".csv", ".xml", ".html", ".css",
  ".sql", ".r", ".jl", ".lua", ".rb", ".go", ".rs", ".c",
  ".cpp", ".h", ".hpp", ".java", ".kt", ".swift", ".env",
]);

function isTextFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function fileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if ([".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java", ".c", ".cpp", ".rb", ".lua", ".sh", ".bash"].includes(ext)) {
    return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-indigo-400" />;
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
}

function inputFileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"].includes(ext)) {
    return <FileImage className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  }
  if ([".pdf", ".doc", ".docx", ".txt", ".md"].includes(ext)) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
  }
  if ([".csv", ".xls", ".xlsx", ".tsv"].includes(ext)) {
    return <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  }
  if ([".json", ".xml", ".yaml", ".yml", ".toml"].includes(ext)) {
    return <Database className="h-3.5 w-3.5 shrink-0 text-orange-400" />;
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Types for file tree grouping ── */

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children: FileTreeNode[];
}

function buildFileTree(files: WorkspaceFileView[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();

  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const file of sorted) {
    const parts = file.path.split("/");
    const node: FileTreeNode = {
      name: file.name,
      path: file.path,
      isDirectory: file.isDirectory,
      size: file.size,
      children: [],
    };

    if (file.isDirectory) {
      dirMap.set(file.path, node);
    }

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = dirMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
  }

  return root;
}

function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type WorkspaceMode = "workspace" | "local_project";

function localFileToView(f: LocalFileInfo): WorkspaceFileView {
  return {
    name: f.name,
    path: f.path,
    isDirectory: f.isDirectory,
    size: f.size,
    updatedAt: f.updatedAt,
  };
}

/* ── Props ── */

interface DevWorkspaceShellProps {
  workspaceId: string;
  initialEntryFile?: string;
  initialRunCommand?: string;
}

export function DevWorkspaceShell({
  workspaceId,
  initialEntryFile,
  initialRunCommand,
}: DevWorkspaceShellProps) {
  /* ── Mode state ── */
  const [mode, setMode] = useState<WorkspaceMode>("workspace");
  const [localConfig, setLocalConfig] = useState<LocalProjectConfig | null>(null);
  const [localConfigLoading, setLocalConfigLoading] = useState(true);
  const [showLocalSetup, setShowLocalSetup] = useState(false);
  const [localPathInput, setLocalPathInput] = useState("");

  /* ── File tree state ── */
  const [files, setFiles] = useState<WorkspaceFileView[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState("");

  /* ── Tabs state ── */
  const [openTabs, setOpenTabs] = useState<TabItem[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  /* ── Run config ── */
  const [entryFile, setEntryFile] = useState(initialEntryFile ?? "");
  const [runCommand, setRunCommand] = useState(initialRunCommand ?? "");

  /* ── Environment state ── */
  const [environments, setEnvironments] = useState<LocalEnvironmentView[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [envsLoading, setEnvsLoading] = useState(false);
  const [envTesting, setEnvTesting] = useState(false);
  const [envTestResult, setEnvTestResult] = useState<{ success: boolean; output: string } | null>(null);

  /* ── Run state ── */
  const [isRunning, setIsRunning] = useState(false);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const runIdCounter = useRef(0);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);

  /* ── Output panel ── */
  const [bottomHeight, setBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  const [outputTab, setOutputTab] = useState<"stdout" | "stderr" | "history" | "terminal">("stdout");

  /* ── New file / folder input ── */
  const [newItemName, setNewItemName] = useState("");
  const [newItemMode, setNewItemMode] = useState<"file" | "folder" | null>(null);

  /* ── File upload refs ── */
  const uploadRef = useRef<HTMLInputElement>(null);
  const zipUploadRef = useRef<HTMLInputElement>(null);
  const inputsUploadRef = useRef<HTMLInputElement>(null);
  const inputsZipUploadRef = useRef<HTMLInputElement>(null);

  /* ── Upload progress ── */
  const [uploading, setUploading] = useState(false);

  /* ── Sidebar state ── */
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`devws_collapsed_${workspaceId}`);
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  /* ── Active run result ── */
  const activeRun = runHistory.find((r) => r.id === activeRunId) ?? runHistory[0] ?? null;

  /* ── Load local project config on mount ── */
  useEffect(() => {
    (async () => {
      try {
        const config = await runtimeClient.getLocalProjectConfig(workspaceId);
        if (config) {
          setLocalConfig(config);
          setMode("local_project");
          setLocalPathInput(config.localPath);
          if (config.entryFile) setEntryFile(config.entryFile);
          if (config.runCommand) setRunCommand(config.runCommand);
          if (config.environmentId) setSelectedEnvId(config.environmentId);
        }
      } catch {
        // No config, stay in workspace mode
      } finally {
        setLocalConfigLoading(false);
      }
    })();
  }, [workspaceId]);

  /* ── Load files ── */
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError("");
    try {
      if (mode === "local_project") {
        const result = await runtimeClient.listLocalFiles(workspaceId);
        setFiles(result.files.map(localFileToView));
      } else {
        const tree = await runtimeClient.listWorkspaceFiles(workspaceId);
        setFiles(tree.files);
      }
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "加载文件失败");
    } finally {
      setFilesLoading(false);
    }
  }, [workspaceId, mode]);

  useEffect(() => {
    if (!localConfigLoading) void loadFiles();
  }, [loadFiles, localConfigLoading]);

  /* ── Load environments ── */
  const loadEnvironments = useCallback(async (refresh = false) => {
    setEnvsLoading(true);
    try {
      const envs = refresh
        ? await runtimeClient.refreshEnvironments()
        : await runtimeClient.listEnvironments();
      setEnvironments(envs);
    } catch {
      // Non-fatal: environments are optional
    } finally {
      setEnvsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEnvironments();
  }, [loadEnvironments]);

  /* ── Test environment ── */
  const onTestEnvironment = useCallback(async () => {
    if (!selectedEnvId) return;
    setEnvTesting(true);
    setEnvTestResult(null);
    try {
      const result = await runtimeClient.testEnvironment(selectedEnvId);
      setEnvTestResult(result);
    } catch (err) {
      setEnvTestResult({ success: false, output: err instanceof Error ? err.message : "测试失败" });
    } finally {
      setEnvTesting(false);
    }
  }, [selectedEnvId]);

  /* ── Open file in tab ── */
  const openFile = useCallback(
    async (filePath: string) => {
      const existing = openTabs.find((t) => t.path === filePath);
      if (existing) {
        setActiveTabPath(filePath);
        return;
      }

      try {
        const file = mode === "local_project"
          ? await runtimeClient.readLocalFile(workspaceId, filePath)
          : await runtimeClient.readWorkspaceFile(workspaceId, filePath);
        const tab: TabItem = {
          path: filePath,
          name: file.name,
          content: file.content,
          isDirty: false,
        };
        setOpenTabs((prev) => [...prev, tab]);
        setActiveTabPath(filePath);
      } catch (err) {
        setFilesError(err instanceof Error ? err.message : "打开文件失败");
      }
    },
    [workspaceId, openTabs, mode],
  );

  /* ── Save active file ── */
  const saveActiveFile = useCallback(async () => {
    const tab = openTabs.find((t) => t.path === activeTabPath);
    if (!tab || !tab.isDirty) return;

    try {
      if (mode === "local_project") {
        await runtimeClient.writeLocalFile(workspaceId, tab.path, tab.content);
      } else {
        await runtimeClient.writeWorkspaceFile(workspaceId, tab.path, tab.content);
      }
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === tab.path ? { ...t, isDirty: false } : t)),
      );
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "保存失败");
    }
  }, [workspaceId, openTabs, activeTabPath, mode]);

  /* ── Save all dirty tabs ── */
  const saveAllDirtyTabs = useCallback(async () => {
    const dirtyTabs = openTabs.filter((t) => t.isDirty);
    if (dirtyTabs.length === 0) return;
    for (const tab of dirtyTabs) {
      if (mode === "local_project") {
        await runtimeClient.writeLocalFile(workspaceId, tab.path, tab.content);
      } else {
        await runtimeClient.writeWorkspaceFile(workspaceId, tab.path, tab.content);
      }
    }
    setOpenTabs((prev) => prev.map((t) => ({ ...t, isDirty: false })));
  }, [workspaceId, openTabs, mode]);

  /* ── Close tab ── */
  const closeTab = useCallback(
    (path: string) => {
      setOpenTabs((prev) => prev.filter((t) => t.path !== path));
      if (activeTabPath === path) {
        setActiveTabPath((prev) => {
          const remaining = openTabs.filter((t) => t.path !== path);
          return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
        });
      }
    },
    [openTabs, activeTabPath],
  );

  /* ── Editor change ── */
  const onEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeTabPath || value === undefined) return;
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.path === activeTabPath ? { ...t, content: value, isDirty: true } : t,
        ),
      );
    },
    [activeTabPath],
  );

  /* ── Create file or folder ── */
  const onCreateItem = useCallback(async () => {
    const name = newItemName.trim();
    if (!name || !newItemMode) return;
    try {
      if (mode === "local_project") {
        if (newItemMode === "folder") {
          await runtimeClient.createLocalFile(workspaceId, name, undefined, true);
        } else {
          await runtimeClient.createLocalFile(workspaceId, name, "");
        }
      } else {
        if (newItemMode === "folder") {
          await runtimeClient.createWorkspaceFile(workspaceId, `${name}/.gitkeep`, "");
        } else {
          await runtimeClient.createWorkspaceFile(workspaceId, name, "");
        }
      }
      setNewItemName("");
      setNewItemMode(null);
      await loadFiles();
      if (newItemMode === "file") {
        void openFile(name);
      }
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "创建失败");
    }
  }, [workspaceId, newItemName, newItemMode, loadFiles, openFile, mode]);

  /* ── Upload multiple files ── */
  const onUploadFiles = useCallback(
    async (fileList: FileList) => {
      setUploading(true);
      setFilesError("");
      try {
        for (const file of Array.from(fileList)) {
          const base64 = await readFileAsBase64(file);
          await runtimeClient.createWorkspaceFile(workspaceId, file.name, undefined, base64);
        }
        await loadFiles();
      } catch (err) {
        setFilesError(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploading(false);
      }
    },
    [workspaceId, loadFiles],
  );

  /* ── Import ZIP ── */
  const onImportZip = useCallback(
    async (file: globalThis.File) => {
      setUploading(true);
      setFilesError("");
      try {
        const result = await runtimeClient.uploadZip(workspaceId, file);
        await loadFiles();
        setFilesError(`ZIP 导入完成，共 ${result.imported} 个文件`);
      } catch (err) {
        setFilesError(err instanceof Error ? err.message : "导入 ZIP 失败");
      } finally {
        setUploading(false);
      }
    },
    [workspaceId, loadFiles],
  );

  /* ── Upload files to inputs/ ── */
  const onUploadInputFiles = useCallback(
    async (fileList: FileList) => {
      setUploading(true);
      setFilesError("");
      try {
        for (const file of Array.from(fileList)) {
          const base64 = await readFileAsBase64(file);
          await runtimeClient.createWorkspaceFile(workspaceId, `inputs/${file.name}`, undefined, base64);
        }
        await loadFiles();
      } catch (err) {
        setFilesError(err instanceof Error ? err.message : "上传 inputs 失败");
      } finally {
        setUploading(false);
      }
    },
    [workspaceId, loadFiles],
  );

  /* ── Import ZIP to inputs/ ── */
  const onImportInputsZip = useCallback(
    async (file: globalThis.File) => {
      setUploading(true);
      setFilesError("");
      try {
        const result = await runtimeClient.uploadInputsZip(workspaceId, file);
        await loadFiles();
        setFilesError(`ZIP 导入到 inputs 完成，共 ${result.imported} 个文件`);
      } catch (err) {
        setFilesError(err instanceof Error ? err.message : "导入 ZIP 到 inputs 失败");
      } finally {
        setUploading(false);
      }
    },
    [workspaceId, loadFiles],
  );

  /* ── Delete file ── */
  const onDeleteFile = useCallback(
    async (filePath: string) => {
      try {
        if (mode === "local_project") {
          await runtimeClient.deleteLocalFile(workspaceId, filePath);
        } else {
          await runtimeClient.deleteWorkspaceFile(workspaceId, filePath);
        }
        closeTab(filePath);
        await loadFiles();
      } catch (err) {
        setFilesError(err instanceof Error ? err.message : "删除失败");
      }
    },
    [workspaceId, closeTab, loadFiles, mode],
  );

  /* ── Save local config ── */
  const saveLocalConfig = useCallback(async () => {
    if (!localPathInput.trim()) return;
    try {
      const config = await runtimeClient.saveLocalProjectConfig(workspaceId, {
        localPath: localPathInput.trim(),
        entryFile: entryFile || undefined,
        runCommand: runCommand || undefined,
        environmentId: selectedEnvId || undefined,
      });
      setLocalConfig(config);
      setMode("local_project");
      setShowLocalSetup(false);
      await loadFiles();
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "保存本地工程配置失败");
    }
  }, [workspaceId, localPathInput, entryFile, runCommand, selectedEnvId, loadFiles]);

  /* ── Resolve effective run command: explicit runCommand > auto from current file ── */
  const effectiveRunCommand = runCommand || (activeTabPath ? commandForFile(activeTabPath) : "");
  const currentFileRunnable = activeTabPath ? RUNNABLE_EXTENSIONS.has(activeTabPath.slice(activeTabPath.lastIndexOf(".")).toLowerCase()) : false;

  /* ── Run script (auto-save all dirty files first) ── */
  const onRun = useCallback(async () => {
    const cmd = effectiveRunCommand;
    if (!cmd) {
      setFilesError("请填写执行命令或打开一个可运行的文件");
      return;
    }
    setIsRunning(true);
    setFilesError("");
    setOutputTab("stdout");
    try {
      // Auto-save all dirty tabs before running
      await saveAllDirtyTabs();

      const effectiveEntry = entryFile || activeTabPath || undefined;
      const result = mode === "local_project"
        ? await runtimeClient.runLocalScript(workspaceId, {
            entryFile: effectiveEntry,
            runCommand: cmd,
            environmentId: selectedEnvId || undefined,
          })
        : await runtimeClient.runWorkspaceScript(workspaceId, {
            entryFile: effectiveEntry,
            runCommand: cmd,
            environmentId: selectedEnvId || undefined,
          });
      const id = ++runIdCounter.current;
      const record: RunRecord = {
        id,
        result,
        timestamp: new Date().toLocaleString("zh-CN"),
      };
      setRunHistory((prev) => [record, ...prev].slice(0, 20));
      setActiveRunId(id);
      if (!result.success) setOutputTab("stderr");
    } catch (err) {
      const id = ++runIdCounter.current;
      const record: RunRecord = {
        id,
        result: {
          exitCode: -1,
          stdout: "",
          stderr: err instanceof Error ? err.message : "执行失败",
          durationMs: 0,
          outputFiles: [],
          success: false,
        },
        timestamp: new Date().toLocaleString("zh-CN"),
      };
      setRunHistory((prev) => [record, ...prev].slice(0, 20));
      setActiveRunId(id);
      setOutputTab("stderr");
    } finally {
      setIsRunning(false);
    }
  }, [workspaceId, entryFile, activeTabPath, effectiveRunCommand, selectedEnvId, saveAllDirtyTabs, mode]);

  /* ── Bottom panel resize ── */
  const startBottomResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = bottomHeight;
    const onMove = (move: PointerEvent) =>
      setBottomHeight(clamp(startH + (startY - move.clientY), MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /* ── Sidebar resize ── */
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = sidebarWidth;
    const onMove = (move: PointerEvent) =>
      setSidebarWidth(clamp(startW + (move.clientX - startX), 140, 400));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /* ── Toggle folder collapse ── */
  const toggleDir = useCallback((dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      try { localStorage.setItem(`devws_collapsed_${workspaceId}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [workspaceId]);

  /* ── Active tab ── */
  const activeTab = openTabs.find((t) => t.path === activeTabPath) ?? null;

  /* ── File tree data ── */
  const allTree = buildFileTree(files); // for local project mode
  const workspaceFiles = files.filter(
    (f) => !f.path.startsWith("inputs/") && f.path !== "inputs",
  );
  const inputFiles = files.filter(
    (f) => f.path.startsWith("inputs/") && f.path !== "inputs",
  );
  // Strip "inputs/" prefix for building the inputs tree
  const inputFilesNormalized: WorkspaceFileView[] = inputFiles.map((f) => ({
    ...f,
    path: f.path.replace(/^inputs\//, ""),
    name: f.name,
  }));
  const workspaceTree = buildFileTree(workspaceFiles);
  const inputsTree = buildFileTree(inputFilesNormalized);
  const inputsFileCount = inputFiles.filter((f) => !f.isDirectory).length;

  /* ── Keyboard shortcut: Ctrl+S ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void saveActiveFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveActiveFile]);

  /* ── Render file tree node ── */
  const renderTreeNode = (node: FileTreeNode, depth: number) => {
    if (node.isDirectory) {
      const isCollapsed = collapsedDirs.has(node.path);
      return (
        <div key={node.path}>
          <div
            className="group flex cursor-pointer items-center justify-between rounded px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onClick={() => toggleDir(node.path)}
          >
            <span className="flex min-w-0 items-center gap-1">
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
              )}
              {isCollapsed ? (
                <FolderClosed className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}
              <span className="truncate">{node.name}</span>
            </span>
            <button
              type="button"
              className="hidden shrink-0 p-0.5 text-slate-400 hover:text-rose-500 group-hover:block"
              onClick={(e) => {
                e.stopPropagation();
                void onDeleteFile(node.path);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {!isCollapsed && node.children.map((child) => renderTreeNode(child, depth + 1))}
        </div>
      );
    }
    return (
      <div
        key={node.path}
        className={`group flex cursor-pointer items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-slate-100 ${
          activeTabPath === node.path ? "bg-indigo-50 text-indigo-700" : "text-slate-700"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => void openFile(node.path)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {fileIcon(node.name)}
          <span className="truncate">{node.name}</span>
        </span>
        <button
          type="button"
          className="hidden shrink-0 p-0.5 text-slate-400 hover:text-rose-500 group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            void onDeleteFile(node.path);
          }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  };

  /* ── Render input tree node (inputs/ prefix re-added for operations) ── */
  const renderInputTreeNode = (node: FileTreeNode, depth: number) => {
    const realPath = `inputs/${node.path}`;
    if (node.isDirectory) {
      const isCollapsed = collapsedDirs.has(realPath);
      return (
        <div key={realPath}>
          <div
            className="group flex cursor-pointer items-center justify-between rounded px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onClick={() => toggleDir(realPath)}
          >
            <span className="flex min-w-0 items-center gap-1">
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
              )}
              {isCollapsed ? (
                <FolderClosed className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}
              <span className="truncate">{node.name}</span>
            </span>
            <button
              type="button"
              className="hidden shrink-0 p-0.5 text-slate-400 hover:text-rose-500 group-hover:block"
              onClick={(e) => {
                e.stopPropagation();
                void onDeleteFile(realPath);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {!isCollapsed && node.children.map((child) => renderInputTreeNode(child, depth + 1))}
        </div>
      );
    }

    const canEdit = isTextFile(node.name);
    return (
      <div
        key={realPath}
        className={`group flex cursor-pointer items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-slate-100 ${
          activeTabPath === realPath ? "bg-indigo-50 text-indigo-700" : "text-slate-700"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => canEdit && void openFile(realPath)}
        title={canEdit ? undefined : `${node.name} (${formatFileSize(node.size)}) — 二进制文件，不可编辑`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {inputFileIcon(node.name)}
          <span className="truncate">{node.name}</span>
          {!canEdit && (
            <span className="shrink-0 text-[10px] text-slate-400">{formatFileSize(node.size)}</span>
          )}
        </span>
        <button
          type="button"
          className="hidden shrink-0 p-0.5 text-slate-400 hover:text-rose-500 group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            void onDeleteFile(realPath);
          }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_24px_-20px_rgba(15,23,42,0.22)]">
      {/* ── Top Bar ── */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 px-3">
        <Link
          href="/agent-dev"
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回开发台
        </Link>
        <div className="h-4 w-px bg-slate-200" />
        <nav className="flex items-center gap-1 text-xs text-slate-500">
          <Link href="/agent-dev" className="hover:text-slate-700">
            开发台
          </Link>
          <span>/</span>
          <span className="font-medium text-slate-800" title={workspaceId}>
            工作台 {workspaceId.slice(0, 8)}
          </span>
        </nav>

        {/* Mode selector */}
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-[11px] ${mode === "workspace" ? "bg-white font-medium text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            onClick={() => {
              if (mode !== "workspace") {
                setMode("workspace");
                setOpenTabs([]);
                setActiveTabPath(null);
              }
            }}
          >
            Workspace
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${mode === "local_project" ? "bg-white font-medium text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            onClick={() => {
              if (localConfig) {
                setMode("local_project");
                setOpenTabs([]);
                setActiveTabPath(null);
              } else {
                setShowLocalSetup(true);
              }
            }}
          >
            <HardDrive className="h-3 w-3" />
            本地工程
          </button>
        </div>

        {mode === "local_project" && localConfig && (
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="本地工程设置"
            onClick={() => setShowLocalSetup(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="flex-1" />

        {/* Run config inline */}
        {activeTabPath && currentFileRunnable && (
          <span className="truncate rounded bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600" title={activeTabPath}>
            {activeTabPath.split(/[/\\]/).pop()}
          </span>
        )}
        <Input
          value={runCommand}
          onChange={(e) => setRunCommand(e.target.value)}
          placeholder={activeTabPath && currentFileRunnable ? commandForFile(activeTabPath) : "执行命令 (如 python main.py)"}
          className="h-7 w-52 text-xs"
        />

        {/* Environment selector */}
        <div className="flex items-center gap-1">
          <select
            value={selectedEnvId}
            onChange={(e) => {
              setSelectedEnvId(e.target.value);
              setEnvTestResult(null);
            }}
            className="h-7 w-44 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            disabled={envsLoading}
          >
            <option value="">默认环境</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="刷新环境列表"
            onClick={() => void loadEnvironments(true)}
            disabled={envsLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${envsLoading ? "animate-spin" : ""}`} />
          </button>
          {selectedEnvId && (
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="测试环境"
              onClick={() => void onTestEnvironment()}
              disabled={envTesting}
            >
              {envTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : envTestResult ? (
                envTestResult.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-rose-500" />
                )
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        {inputsFileCount > 0 && (
          <span className="text-[10px] text-slate-400" title="inputs/ 中的文件数">
            {inputsFileCount} 输入
          </span>
        )}

        <Button
          size="sm"
          onClick={() => void onRun()}
          disabled={isRunning || !effectiveRunCommand}
          className="h-7 gap-1 px-3 text-xs"
          title={effectiveRunCommand ? `$ ${effectiveRunCommand}` : "打开可运行文件或填写命令"}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isRunning ? "运行中" : runCommand ? "运行" : currentFileRunnable ? "运行当前文件" : "运行"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void saveActiveFile()}
          disabled={!activeTab?.isDirty}
          className="h-7 gap-1 px-2 text-xs"
        >
          <Save className="h-3.5 w-3.5" />
          {openTabs.filter((t) => t.isDirty).length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-white">
              {openTabs.filter((t) => t.isDirty).length}
            </span>
          )}
        </Button>
      </div>

      {/* ── Main area (file tree + editor) ── */}
      <div className="flex min-h-0 flex-1">
        {/* ── File Tree ── */}
        {!sidebarCollapsed && (
        <aside className="flex shrink-0 flex-col border-r border-slate-200 bg-slate-50/50" style={{ width: sidebarWidth }}>
          {/* Uploading indicator */}
          {uploading && (
            <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-1.5 text-xs text-indigo-600">
              <Loader2 className="h-3 w-3 animate-spin" /> 上传中...
            </div>
          )}

          {filesError && (
            <div className="border-b border-slate-100 px-2 py-1">
              <p className="text-xs text-rose-600">{filesError}</p>
            </div>
          )}

          {filesLoading && (
            <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> 加载中...
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {mode === "local_project" ? (
              /* ── Local Project: single file tree ── */
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                    <HardDrive className="h-3 w-3" />
                    项目文件
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      title="新建文件"
                      onClick={() => setNewItemMode((v) => (v === "file" ? null : "file"))}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      title="新建文件夹"
                      onClick={() => setNewItemMode((v) => (v === "folder" ? null : "folder"))}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      title="刷新文件列表"
                      onClick={() => void loadFiles()}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${filesLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                {/* New file / folder input */}
                {newItemMode && (
                  <div className="flex gap-1 border-b border-slate-100 px-2 py-1">
                    <Input
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void onCreateItem();
                        if (e.key === "Escape") setNewItemMode(null);
                      }}
                      placeholder={newItemMode === "folder" ? "文件夹名" : "文件名 (如 main.py)"}
                      className="h-6 flex-1 text-xs"
                      autoFocus
                    />
                    <Button size="sm" onClick={() => void onCreateItem()} className="h-6 px-2 text-xs">
                      创建
                    </Button>
                  </div>
                )}

                <div className="px-1 py-1">
                  {!filesLoading && files.length === 0 && !filesError && (
                    <p className="px-2 py-1 text-xs text-slate-400">目录为空</p>
                  )}
                  {allTree.map((node) => renderTreeNode(node, 0))}
                </div>
              </div>
            ) : (
            /* ── Workspace Mode: dual sections ── */
            <>
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                <span className="text-xs font-medium text-slate-600">代码</span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="新建文件"
                    onClick={() => setNewItemMode((v) => (v === "file" ? null : "file"))}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="新建文件夹"
                    onClick={() => setNewItemMode((v) => (v === "folder" ? null : "folder"))}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="上传代码文件"
                    onClick={() => uploadRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="导入 ZIP 到代码区"
                    onClick={() => zipUploadRef.current?.click()}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* New file / folder input */}
              {newItemMode && (
                <div className="flex gap-1 border-b border-slate-100 px-2 py-1">
                  <Input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void onCreateItem();
                      if (e.key === "Escape") setNewItemMode(null);
                    }}
                    placeholder={newItemMode === "folder" ? "文件夹名" : "文件名 (如 main.py)"}
                    className="h-6 flex-1 text-xs"
                    autoFocus
                  />
                  <Button size="sm" onClick={() => void onCreateItem()} className="h-6 px-2 text-xs">
                    创建
                  </Button>
                </div>
              )}

              <div className="px-1 py-1">
                {!filesLoading && workspaceFiles.length === 0 && !filesError && (
                  <p className="px-2 py-1 text-xs text-slate-400">暂无代码文件</p>
                )}
                {workspaceTree.map((node) => renderTreeNode(node, 0))}
              </div>
            </div>

            {/* ── Inputs (输入资源) Section ── */}
            <div className="border-t border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                  输入
                  {inputsFileCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] text-slate-500">
                      {inputsFileCount}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="上传输入文件"
                    onClick={() => inputsUploadRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="导入 ZIP 到输入区"
                    onClick={() => inputsZipUploadRef.current?.click()}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="px-1 py-1">
                {!filesLoading && inputFilesNormalized.length === 0 && (
                  <p className="px-2 py-1 text-xs text-slate-400">暂无输入文件。上传 PDF、图片、CSV 等资源。</p>
                )}
                {inputsTree.map((node) => renderInputTreeNode(node, 0))}
              </div>
            </div>
          </>
          )}
          </div>

          {/* Hidden file inputs — workspace code files */}
          <input
            ref={uploadRef}
            type="file"
            multiple
            accept=".py,.js,.ts,.json,.yaml,.yml,.txt,.md,.sh,.jsx,.tsx,.html,.css,.xml,.toml,.ini,.cfg,.conf,.csv,.sql,.r,.jl,.lua,.rb,.go,.rs,.c,.cpp,.h,.hpp,.java,.kt,.swift,.env,.bat,.ps1"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void onUploadFiles(e.target.files);
              }
              e.target.value = "";
            }}
          />
          <input
            ref={zipUploadRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportZip(file);
              e.target.value = "";
            }}
          />
          {/* Hidden file inputs — inputs resource files (broad accept) */}
          <input
            ref={inputsUploadRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.svg,.webp,.bmp,.ico,.csv,.xls,.xlsx,.tsv,.json,.xml,.yaml,.yml,.toml,.txt,.md,.doc,.docx,.pptx,.mp3,.wav,.mp4,.zip,.tar,.gz,.parquet,.feather,.pkl,.npy,.npz,.h5,.hdf5,.py,.js,.ts,.html,.css,.sql,.sh,.r,.jl"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void onUploadInputFiles(e.target.files);
              }
              e.target.value = "";
            }}
          />
          <input
            ref={inputsZipUploadRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportInputsZip(file);
              e.target.value = "";
            }}
          />

          <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1">
            <p className="truncate text-[10px] text-slate-400" title={mode === "local_project" ? localConfig?.localPath : workspaceId}>
              {mode === "local_project" ? `📁 ${localConfig?.localPath ?? ""}` : `ws: ${workspaceId}`}
            </p>
            <button
              type="button"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="收起侧栏"
              onClick={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose className="h-3 w-3" />
            </button>
          </div>
        </aside>
        )}

        {/* ── Sidebar resize handle ── */}
        {!sidebarCollapsed && (
          <div
            className="flex w-1 shrink-0 cursor-col-resize items-center justify-center hover:bg-indigo-200"
            onPointerDown={startSidebarResize}
          />
        )}

        {/* ── Collapsed sidebar toggle ── */}
        {sidebarCollapsed && (
          <div className="flex w-8 shrink-0 flex-col items-center border-r border-slate-200 bg-slate-50/50 pt-2">
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="展开侧栏"
              onClick={() => setSidebarCollapsed(false)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Editor Area ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          {openTabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-px overflow-x-auto border-b border-slate-200 bg-slate-50/50 px-1">
              {openTabs.map((tab) => (
                <div
                  key={tab.path}
                  className={`group flex cursor-pointer items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                    tab.path === activeTabPath
                      ? "border-indigo-500 text-slate-800"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                  onClick={() => setActiveTabPath(tab.path)}
                >
                  {tab.isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
                  <span className="max-w-[120px] truncate">{tab.name}</span>
                  <button
                    type="button"
                    className="ml-1 hidden rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.path);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Monaco Editor or placeholder */}
          <div className="flex-1">
            {activeTab ? (
              <Editor
                language={langFromPath(activeTab.path)}
                value={activeTab.content}
                path={activeTab.path}
                theme="vs"
                onChange={onEditorChange}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  padding: { top: 8, bottom: 8 },
                  automaticLayout: true,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                从左侧文件树中选择文件开始编辑
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Drag handle ── */}
      <div
        className="flex h-1.5 shrink-0 cursor-row-resize items-center justify-center bg-slate-100 hover:bg-slate-200"
        onPointerDown={startBottomResize}
      >
        <div className="h-0.5 w-10 rounded-full bg-slate-300" />
      </div>

      {/* ── Output panel ── */}
      <div className="shrink-0 overflow-hidden" style={{ height: bottomHeight }}>
        {/* Output tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <div className="flex items-center gap-px">
            {(["stdout", "stderr", "history", ...(mode === "local_project" ? ["terminal" as const] : [])] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`border-b-2 px-3 py-1.5 text-xs font-medium ${
                  outputTab === t
                    ? "border-indigo-500 text-slate-800"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
                onClick={() => setOutputTab(t as typeof outputTab)}
              >
                {t === "stdout" ? "输出" : t === "stderr" ? "错误" : t === "terminal" ? (
                  <span className="flex items-center gap-1"><TerminalIcon className="h-3 w-3" />终端</span>
                ) : "历史"}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Run status */}
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> 运行中...
            </span>
          )}
          {activeRun && !isRunning && (
            <span className="flex items-center gap-2 text-xs">
              <Badge variant={activeRun.result.success ? "success" : "danger"}>
                exit {activeRun.result.exitCode}
              </Badge>
              <span className="text-slate-400">{activeRun.result.durationMs}ms</span>
            </span>
          )}
        </div>

        {/* Output content */}
        <div className={`h-[calc(100%-32px)] ${outputTab === "terminal" ? "" : "overflow-auto p-3"}`}>
          {outputTab === "terminal" && mode === "local_project" && (
            <TerminalPanel workspaceId={workspaceId} className="h-full" />
          )}
          {outputTab === "stdout" && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-700">
              {activeRun?.result.stdout || (
                <span className="text-slate-400">暂无输出。点击「运行」执行脚本。</span>
              )}
            </pre>
          )}
          {outputTab === "stderr" && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-rose-600">
              {activeRun?.result.stderr || (
                <span className="text-slate-400">无错误输出。</span>
              )}
            </pre>
          )}
          {outputTab === "history" && (
            <div className="space-y-1">
              {runHistory.length === 0 ? (
                <p className="text-xs text-slate-400">暂无运行记录。</p>
              ) : (
                runHistory.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 ${
                      record.id === activeRunId ? "bg-indigo-50" : ""
                    }`}
                    onClick={() => {
                      setActiveRunId(record.id);
                      setOutputTab(record.result.success ? "stdout" : "stderr");
                    }}
                  >
                    <Badge variant={record.result.success ? "success" : "danger"} className="shrink-0">
                      exit {record.result.exitCode}
                    </Badge>
                    <span className="text-slate-500">{record.result.durationMs}ms</span>
                    <span className="flex-1" />
                    <span className="text-slate-400">{record.timestamp}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      {/* ── Local Project Setup Modal ── */}
      {showLocalSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[480px] rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">本地工程配置</h3>
              <button
                type="button"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setShowLocalSetup(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">本地项目目录</label>
                <Input
                  value={localPathInput}
                  onChange={(e) => setLocalPathInput(e.target.value)}
                  placeholder="如 C:\projects\my-agent"
                  className="text-xs"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  输入本地项目的绝对路径，文件树将展示该目录内容
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">入口文件 (可选)</label>
                <Input
                  value={entryFile}
                  onChange={(e) => setEntryFile(e.target.value)}
                  placeholder="如 main.py, src/app.ts"
                  className="text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">运行命令</label>
                <Input
                  value={runCommand}
                  onChange={(e) => setRunCommand(e.target.value)}
                  placeholder="如 python -m src.main"
                  className="text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => void saveLocalConfig()}
                  disabled={!localPathInput.trim()}
                  className="gap-1 text-xs"
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  绑定并保存
                </Button>
                {localConfig && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-rose-600 hover:bg-rose-50"
                    onClick={async () => {
                      await runtimeClient.deleteLocalProjectConfig(workspaceId);
                      setLocalConfig(null);
                      setMode("workspace");
                      setShowLocalSetup(false);
                      setOpenTabs([]);
                      setActiveTabPath(null);
                    }}
                  >
                    解除绑定
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowLocalSetup(false)}
                >
                  取消
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
