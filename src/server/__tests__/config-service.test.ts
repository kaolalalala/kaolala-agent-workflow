import { beforeEach, describe, expect, it } from "vitest";

import { configService } from "@/server/config/config-service";

describe("config service", () => {
  beforeEach(() => {
    configService.resetForTests();
  });

  it("creates and updates workspace config", () => {
    const workspace = configService.ensureWorkspaceConfig();
    expect(workspace.id).toBeTruthy();
    const originalName = workspace.name;

    const updated = configService.updateWorkspaceConfig({
      defaultProvider: "openrouter",
      defaultModel: "openai/gpt-4.1",
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      defaultTemperature: 0.7,
    });

    expect(updated.name).toBe(originalName);
    expect(updated.defaultProvider).toBe("openrouter");
    expect(updated.defaultModel).toBe("openai/gpt-4.1");
    expect(updated.defaultBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(updated.defaultTemperature).toBe(0.7);
  });

  it("creates credential and resolves api key", () => {
    const credential = configService.createCredential({
      provider: "openrouter",
      label: "主账号",
      apiKey: "sk-test-123",
    });

    expect(credential.encryptedValue).not.toBe("sk-test-123");

    const list = configService.listCredentials();
    expect(list.length).toBe(1);
    expect(configService.resolveCredentialApiKey(list[0].id)).toBe("sk-test-123");
  });

  it("updates node config and stores markdown documents", () => {
    configService.ensureWorkspaceConfig();
    const config = configService.ensureNodeConfig({
      runId: "run_1",
      nodeId: "node_1",
      name: "执行代理-A",
      responsibility: "执行任务",
      systemPrompt: "你是执行代理",
      allowHumanInput: true,
    });

    const updated = configService.updateNodeConfig("run_1", "node_1", {
      name: "执行代理-B",
      model: "glm-4.5",
      provider: "glm",
      useWorkspaceModelDefault: false,
    });

    expect(updated.name).toBe("执行代理-B");
    expect(updated.model).toBe("glm-4.5");

    const doc = configService.createNodeDocument({
      runId: "run_1",
      nodeId: "node_1",
      type: "skill",
      name: "skill.md",
      content: "# Skill\n- do x",
    });

    const docs = configService.listNodeDocuments("run_1", "node_1");
    expect(docs.length).toBe(1);
    expect(docs[0].id).toBe(doc.id);
    expect(config.id).toBeTruthy();
  });

  it("creates workflow versions and publishes a selected version", () => {
    const created = configService.saveWorkflow({
      name: "版本化工作流",
      rootTaskInput: "版本 1 输入",
      versionLabel: "初始版",
      nodes: [{ id: "n1", name: "节点1", role: "worker", taskSummary: "执行", responsibilitySummary: "执行任务" }],
      edges: [],
      tasks: [{ id: "t1", title: "任务1", status: "ready", assignedNodeId: "n1", summary: "执行任务1" }],
    });

    expect(created.currentVersionNumber).toBe(1);
    expect(created.versionsCount).toBe(1);

    const updated = configService.saveWorkflow({
      workflowId: created.id,
      name: "版本化工作流",
      rootTaskInput: "版本 2 输入",
      versionLabel: "观测增强版",
      versionNotes: "新增可观测字段",
      nodes: [{ id: "n1", name: "节点1", role: "worker", taskSummary: "执行", responsibilitySummary: "执行任务" }],
      edges: [],
      tasks: [{ id: "t1", title: "任务1", status: "ready", assignedNodeId: "n1", summary: "执行任务1" }],
    });

    expect(updated.currentVersionNumber).toBe(2);
    expect(updated.versionsCount).toBe(2);

    const versions = configService.listWorkflowVersions(created.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(2);

    const published = configService.publishWorkflowVersion(created.id, versions[1].id);
    expect(published.publishedVersionNumber).toBe(1);
  });
});
