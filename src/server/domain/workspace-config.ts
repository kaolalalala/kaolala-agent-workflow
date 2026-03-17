export interface WorkspaceConfig {
  id: string;
  name: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultBaseUrl?: string;
  defaultCredentialId?: string;
  defaultTemperature?: number;
  createdAt: string;
  updatedAt: string;
}
