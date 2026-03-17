"use client";

import { useMemo, useState } from "react";

import { NodeLibrary } from "@/features/workflow/components/NodeLibrary";
import { TaskTree } from "@/features/workflow/components/TaskTree";

export function LeftSidebar() {
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [taskCollapsed, setTaskCollapsed] = useState(false);

  const gridRows = useMemo(() => {
    if (libraryCollapsed && taskCollapsed) {
      return "auto auto";
    }
    if (libraryCollapsed) {
      return "auto minmax(0,1fr)";
    }
    if (taskCollapsed) {
      return "minmax(0,1fr) auto";
    }
    return "minmax(0,0.52fr) minmax(0,0.48fr)";
  }, [libraryCollapsed, taskCollapsed]);

  return (
    <aside
      className="grid h-full min-h-0 gap-3 rounded-[28px] border border-white/60 bg-[var(--panel)] p-3 shadow-[0_28px_80px_-36px_var(--shadow-color)] backdrop-blur dark:border-white/10"
      style={{ gridTemplateRows: gridRows }}
    >
      <NodeLibrary collapsed={libraryCollapsed} onToggle={() => setLibraryCollapsed((prev) => !prev)} />
      <TaskTree collapsed={taskCollapsed} onToggle={() => setTaskCollapsed((prev) => !prev)} />
    </aside>
  );
}
