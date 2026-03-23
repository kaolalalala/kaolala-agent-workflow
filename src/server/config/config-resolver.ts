import { AgentDocument, AgentNodeConfig, WorkspaceConfig } from "@/server/domain";
import { configService } from "@/server/config/config-service";

export interface ResolvedAgentExecutionConfig {
  nodeId: string;
  name: string;
  systemPrompt: string;
  additionalPrompt?: string;
  responsibility?: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  promptDocuments: AgentDocument[];
  skillDocuments: AgentDocument[];
  referenceDocuments: AgentDocument[];
}

function resolveProvider(nodeConfig: AgentNodeConfig, workspace: WorkspaceConfig) {
  if (!nodeConfig.useWorkspaceModelDefault && nodeConfig.provider) {
    return nodeConfig.provider;
  }
  return workspace.defaultProvider ?? "mock";
}

function resolveModel(nodeConfig: AgentNodeConfig, workspace: WorkspaceConfig) {
  if (!nodeConfig.useWorkspaceModelDefault && nodeConfig.model) {
    return nodeConfig.model;
  }
  return workspace.defaultModel ?? "mock-agent-v1";
}

function resolveCredentialId(nodeConfig: AgentNodeConfig, workspace: WorkspaceConfig) {
  if (!nodeConfig.useWorkspaceModelDefault && nodeConfig.credentialId) {
    return nodeConfig.credentialId;
  }
  return workspace.defaultCredentialId;
}

function resolveTemperature(nodeConfig: AgentNodeConfig, workspace: WorkspaceConfig) {
  if (!nodeConfig.useWorkspaceModelDefault && typeof nodeConfig.temperature === "number") {
    return nodeConfig.temperature;
  }
  return workspace.defaultTemperature ?? 0.2;
}

export const configResolver = {
  resolveNodeExecutionConfig(runId: string, nodeId: string): ResolvedAgentExecutionConfig {
    const workspace = configService.ensureWorkspaceConfig();
    const nodeConfig = configService.getNodeConfig(runId, nodeId);
    if (!nodeConfig) {
      throw new Error("节点配置不存在");
    }

    const documents = configService.listNodeDocuments(runId, nodeId);
    const credentialId = resolveCredentialId(nodeConfig, workspace);

    return {
      nodeId,
      name: nodeConfig.name,
      systemPrompt: nodeConfig.systemPrompt ?? "",
      additionalPrompt: nodeConfig.additionalPrompt,
      responsibility: nodeConfig.responsibility,
      provider: resolveProvider(nodeConfig, workspace),
      model: resolveModel(nodeConfig, workspace),
      baseUrl: (!nodeConfig.useWorkspaceModelDefault && nodeConfig.baseUrl) ? nodeConfig.baseUrl : workspace.defaultBaseUrl,
      apiKey: configService.resolveCredentialApiKey(credentialId),
      temperature: resolveTemperature(nodeConfig, workspace),
      promptDocuments: documents.filter((doc) => doc.type === "prompt"),
      skillDocuments: documents.filter((doc) => doc.type === "skill"),
      referenceDocuments: documents.filter((doc) => doc.type === "reference"),
    };
  },
};
