import { configService } from "@/server/config/config-service";
import { outputManager } from "@/server/runtime/output-manager";
import { executeDevAgent } from "@/server/runtime/execution/dev-agent-executor";

export interface MetaAgentSkillResource {
  id: string;
  name: string;
  description?: string;
  guideContent?: string;
  outputDescription?: string;
  parameterSchema: Record<string, unknown>;
  localPath: string;
  runCommand: string;
  environmentId?: string;
  searchAliases?: string[];
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQueryTokens(value: string) {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9]{2,}/g)) {
    tokens.add(match[0]);
  }
  const cjkChars = Array.from(normalized).filter((char) => /[\u4e00-\u9fff]/.test(char));
  for (const char of cjkChars) {
    tokens.add(char);
  }
  // bigrams
  for (let index = 0; index < cjkChars.length - 1; index += 1) {
    tokens.add(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }
  // trigrams — give longer CJK phrases a chance to match skill names like "论文下载"
  for (let index = 0; index < cjkChars.length - 2; index += 1) {
    tokens.add(`${cjkChars[index]}${cjkChars[index + 1]}${cjkChars[index + 2]}`);
  }
  return Array.from(tokens);
}

function buildSkillSearchText(skill: MetaAgentSkillResource) {
  return normalizeText([
    skill.id,
    skill.name,
    skill.description,
    skill.guideContent,
    skill.outputDescription,
    ...(skill.searchAliases ?? []),
    JSON.stringify(skill.parameterSchema),
  ].filter(Boolean).join("\n"));
}

function scoreSkillRelevance(query: string, skill: MetaAgentSkillResource) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;

  const haystack = buildSkillSearchText(skill);
  let score = 0;

  if (normalizedQuery.length >= 6 && haystack.includes(normalizedQuery)) {
    score += 12;
  }

  const tokens = extractQueryTokens(normalizedQuery);
  for (const token of tokens) {
    if (!token) continue;
    if (haystack.includes(token)) {
      const isCjk = /[\u4e00-\u9fff]/.test(token);
      if (isCjk) {
        // CJK: single char=1, bigram=4, trigram=7
        // Longer CJK matches are far more discriminative than single characters.
        score += token.length >= 3 ? 7 : token.length === 2 ? 4 : 1;
      } else {
        // Latin/numeric: short=1, medium=2, long=4
        score += token.length >= 6 ? 4 : token.length >= 3 ? 2 : 1;
      }
    }
  }

  return score;
}

export function listMetaAgentSkillResources(limit = 12): MetaAgentSkillResource[] {
  const resources: MetaAgentSkillResource[] = [];
  for (const skill of configService.listSkillAssets()) {
    if (!skill.enabled) {
      continue;
    }
    const script = configService.getScriptAsset(skill.scriptId);
    if (!script || !script.enabled) {
      continue;
    }
    resources.push({
      id: skill.id,
      name: skill.name,
      description: skill.description ?? undefined,
      guideContent: skill.guideContent ?? undefined,
      outputDescription: skill.outputDescription ?? undefined,
      parameterSchema: script.parameterSchema,
      localPath: script.localPath,
      runCommand: script.runCommand,
      environmentId: script.defaultEnvironmentId,
      searchAliases: [
        script.id,
        script.name,
        script.description,
        script.runCommand,
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    });
    if (resources.length >= limit) {
      break;
    }
  }
  return resources;
}

export function selectMetaAgentSkillResources(query: string, limit = 8): MetaAgentSkillResource[] {
  const resources = listMetaAgentSkillResources(Math.max(limit, 24));
  const scored = resources
    .map((skill, index) => ({
      skill,
      index,
      score: scoreSkillRelevance(query, skill),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const positive = scored.filter((item) => item.score > 0).slice(0, limit).map((item) => item.skill);
  if (positive.length > 0) {
    return positive;
  }
  return resources.slice(0, limit);
}

export async function executeMetaAgentSkillResource(
  toolId: string,
  args: Record<string, unknown>,
  options?: {
    runId?: string;
    todoId?: string;
  },
): Promise<Record<string, unknown>> {
  if (!toolId.startsWith("skill:")) {
    throw new Error(`Unsupported skill tool id: ${toolId}`);
  }
  const skillId = toolId.slice("skill:".length);
  const skill = configService.getSkillAsset(skillId);
  if (!skill || !skill.enabled) {
    throw new Error(`Skill asset not found or disabled: ${skillId}`);
  }
  const script = configService.getScriptAsset(skill.scriptId);
  if (!script || !script.enabled) {
    throw new Error(`Skill script not found or disabled for: ${skill.name}`);
  }

  const templateParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    templateParams[key] = typeof value === "string" ? value : JSON.stringify(value);
  }

  const result = await executeDevAgent({
    workspaceId: "",
    entryFile: "",
    runCommand: script.runCommand,
    resolvedInput: JSON.stringify(args),
    cwdOverride: script.localPath,
    environmentId: script.defaultEnvironmentId,
    templateParams,
    outputDirOverride:
      options?.runId && options?.todoId
        ? outputManager.getRunNodeOutputDir(options.runId, options.todoId)
        : undefined,
  });

  if (!result.success) {
    throw new Error(result.stderr.slice(0, 500) || `Skill execution failed: ${skill.name}`);
  }

  const stdoutText = result.stdout.trim();
  if (!stdoutText) {
    return {
      ok: true,
      text: "",
      durationMs: result.durationMs,
      outputFiles: result.outputFiles,
    };
  }

  try {
    const parsed = JSON.parse(stdoutText) as Record<string, unknown>;
    return {
      ...parsed,
      durationMs: result.durationMs,
      outputFiles: result.outputFiles,
    };
  } catch {
    return {
      ok: true,
      text: stdoutText,
      durationMs: result.durationMs,
      outputFiles: result.outputFiles,
    };
  }
}
