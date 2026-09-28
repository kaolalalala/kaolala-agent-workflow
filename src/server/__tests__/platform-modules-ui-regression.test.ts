import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("platform modules UI regression", () => {
  it("keeps dashboard as the Chinese operations overview entry", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/dashboard/page.tsx"),
      "utf8",
    );

    expect(source.includes("欢迎回来，今天继续推进你的 Agent 项目")).toBe(true);
    expect(source.includes("最近项目")).toBe(true);
    expect(source.includes("最近运行")).toBe(true);
    expect(source.includes("最近文件")).toBe(true);
    expect(source.includes("/showcases?scenario=")).toBe(true);
    expect(source.includes("runService.listProjects()")).toBe(true);
    expect(source.includes("runService.listRuns(20)")).toBe(true);
  });

  it("keeps assets center wired to all major asset domains", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/assets/page.tsx"),
      "utf8",
    );

    expect(source.includes("资产中心")).toBe(true);
    expect(source.includes(`tab === "tools"`)).toBe(true);
    expect(source.includes(`tab === "models"`)).toBe(true);
    expect(source.includes(`tab === "prompts"`)).toBe(true);
    expect(source.includes(`tab === "scripts"`)).toBe(true);
    expect(source.includes(`tab === "skills"`)).toBe(true);
    expect(source.includes("listToolAssets")).toBe(true);
    expect(source.includes("listModelAssets")).toBe(true);
    expect(source.includes("listPromptTemplateAssets")).toBe(true);
    expect(source.includes("listScriptAssets")).toBe(true);
    expect(source.includes("listSkillAssets")).toBe(true);
    expect(source.includes("listWorkflowTemplates")).toBe(true);
    expect(source.includes("listAgentTemplates")).toBe(true);
    expect(source.includes("listWorkflowAssetReferences")).toBe(true);
  });

  it("keeps settings center focused on global configuration, notifications, and inheritance preview", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/settings/page.tsx"),
      "utf8",
    );

    expect(source.includes("设置")).toBe(true);
    expect(source.includes("全局设置")).toBe(true);
    expect(source.includes("平台级默认模型配置。继承关系：全局 → 项目 → 工作流 → 节点。")).toBe(true);
    expect(source.includes("通知通道")).toBe(true);
    expect(source.includes("项目继承预览（全局 → 项目）")).toBe(true);
    expect(source.includes("生效结果")).toBe(true);
    expect(source.includes("getWorkspaceConfig")).toBe(true);
    expect(source.includes("updateWorkspaceConfig")).toBe(true);
    expect(source.includes("createCredential")).toBe(true);
    expect(source.includes("listNotificationChannels")).toBe(true);
  });

  it("keeps agent dev page wired to workspace and dev-run flows", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/agent-dev/page.tsx"),
      "utf8",
    );

    expect(source.includes("开发台")).toBe(true);
    expect(source.includes("工作台列表")).toBe(true);
    expect(source.includes("最近运行")).toBe(true);
    expect(source.includes("listWorkspaces")).toBe(true);
    expect(source.includes("listDevRuns(15)")).toBe(true);
    expect(source.includes("createWorkspace")).toBe(true);
    expect(source.includes("deleteWorkspace")).toBe(true);
    expect(source.includes("/agent-dev/${ws.id}")).toBe(true);
  });

  it("keeps projects page wired to creation, archiving, and deletion flows", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/projects/page.tsx"),
      "utf8",
    );

    expect(source.includes("项目管理")).toBe(true);
    expect(source.includes("按项目名称或描述搜索")).toBe(true);
    expect(source.includes("仅进行中")).toBe(true);
    expect(source.includes("createProject")).toBe(true);
    expect(source.includes("updateProject")).toBe(true);
    expect(source.includes("deleteProject")).toBe(true);
    expect(source.includes("归档项目")).toBe(true);
    expect(source.includes("删除项目")).toBe(true);
  });

  it("keeps workflow entry page connected to project metadata and the editor shell", () => {
    const pageSource = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/projects/[projectId]/workflows/[workflowId]/page.tsx"),
      "utf8",
    );
    const shellSource = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/projects/[projectId]/workflows/[workflowId]/workflow-editor-shell.tsx"),
      "utf8",
    );

    expect(pageSource.includes("WorkflowEditorShell")).toBe(true);
    expect(pageSource.includes("runService.getProject(projectId)")).toBe(true);
    expect(pageSource.includes("runService.getProjectWorkflow(projectId, workflowId)")).toBe(true);
    expect(pageSource.includes("未命名项目")).toBe(true);
    expect(pageSource.includes("未命名工作流")).toBe(true);

    expect(shellSource.includes("AppShell")).toBe(true);
    expect(shellSource.includes("META_COLLAPSE_KEY")).toBe(true);
    expect(shellSource.includes("返回项目")).toBe(true);
    expect(shellSource.includes("项目 ID：")).toBe(true);
    expect(shellSource.includes("工作流 ID：")).toBe(true);
    expect(shellSource.includes("更新时间：")).toBe(true);
    expect(shellSource.includes("折叠")).toBe(true);
    expect(shellSource.includes("展开信息")).toBe(true);
  });

  it("keeps evaluations module wired to suite, case, run, and report flows", () => {
    const pageSource = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/evaluations/page.tsx"),
      "utf8",
    );
    const clientSource = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/evaluations/evaluations-client.tsx"),
      "utf8",
    );

    expect(pageSource.includes("EvaluationsClient")).toBe(true);
    expect(clientSource.includes("回放、对比、评分与回归验证")).toBe(true);
    expect(clientSource.includes("创建评测套件")).toBe(true);
    expect(clientSource.includes("创建评测用例")).toBe(true);
    expect(clientSource.includes("最近评测运行")).toBe(true);
    expect(clientSource.includes("评测报告")).toBe(true);
    expect(clientSource.includes("listEvaluationSuites")).toBe(true);
    expect(clientSource.includes("listEvaluationRuns(50)")).toBe(true);
    expect(clientSource.includes("createEvaluationSuite")).toBe(true);
    expect(clientSource.includes("createEvaluationCase")).toBe(true);
    expect(clientSource.includes("executeEvaluationCase")).toBe(true);
    expect(clientSource.includes("getEvaluationRun")).toBe(true);
  });
});
