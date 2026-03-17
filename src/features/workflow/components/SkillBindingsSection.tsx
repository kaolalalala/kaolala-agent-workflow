"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  runtimeClient,
  type SkillAssetView,
  type SkillBindingView,
} from "@/features/workflow/adapters/runtime-client";

interface SkillBindingsSectionProps {
  runId?: string;
  nodeId: string;
}

const shellCardClass =
  "rounded-[24px] border border-black/6 bg-white/72 shadow-none dark:border-white/10 dark:bg-white/[0.04]";

export function SkillBindingsSection({ runId, nodeId }: SkillBindingsSectionProps) {
  const [skills, setSkills] = useState<SkillAssetView[]>([]);
  const [bindings, setBindings] = useState<SkillBindingView[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const hasRun = Boolean(runId);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const skillsPayload = await runtimeClient.listSkillAssets();
      setSkills(skillsPayload.skills.filter((s) => s.enabled));

      if (runId) {
        const bindingsPayload = await runtimeClient.listSkillBindings(runId, nodeId);
        setBindings(bindingsPayload.bindings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载技能失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, nodeId]);

  const toggleSkill = async (skillId: string) => {
    if (!runId) return;
    setSaving(skillId);
    setError("");
    try {
      const existing = bindings.find((b) => b.skillId === skillId);
      const nextEnabled = existing ? !existing.enabled : true;
      const result = await runtimeClient.upsertSkillBinding(runId, nodeId, skillId, nextEnabled);
      setBindings((prev) => {
        const filtered = prev.filter((b) => b.skillId !== skillId);
        return [...filtered, result.binding];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存绑定失败");
    } finally {
      setSaving(null);
    }
  };

  const isEnabled = (skillId: string) => {
    const binding = bindings.find((b) => b.skillId === skillId);
    return binding?.enabled ?? false;
  };

  return (
    <Card className={shellCardClass}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Skill 绑定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasRun ? (
          <p className="text-xs text-slate-400">需要先启动运行才能绑定 Skill</p>
        ) : loading ? (
          <p className="text-xs text-slate-400">加载中…</p>
        ) : skills.length === 0 ? (
          <p className="text-xs text-slate-400">暂无可用技能资产（请先在资产中心创建）</p>
        ) : (
          <div className="space-y-1.5">
            {skills.map((skill) => {
              const enabled = isEnabled(skill.id);
              return (
                <div
                  key={skill.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-700">{skill.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{skill.description || "暂无描述"}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={enabled ? "default" : "ghost"}
                    className="h-7 px-2.5 text-xs"
                    disabled={saving === skill.id}
                    onClick={() => void toggleSkill(skill.id)}
                  >
                    {saving === skill.id ? "…" : enabled ? "已挂载" : "挂载"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {error ? <p className="text-xs text-rose-500">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
