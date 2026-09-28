"use client";

import type { ReactNode } from "react";

interface SimpleMarkdownPreviewProps {
  content: string;
  emptyText?: string;
  className?: string;
}

function joinClassName(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`link-${match.index}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-600 underline underline-offset-2"
        >
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-700"
        >
          {match[4]}
        </code>,
      );
    } else if (match[5]) {
      nodes.push(
        <strong key={`strong-${match.index}`} className="font-semibold text-slate-900">
          {match[5]}
        </strong>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderParagraph(lines: string[], key: string) {
  return (
    <p key={key} className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
      {renderInline(lines.join(" "))}
    </p>
  );
}

function renderList(lines: string[], key: string) {
  const ordered = /^\d+\.\s/.test(lines[0] ?? "");
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      key={key}
      className={ordered ? "list-decimal space-y-1 pl-5 text-sm text-slate-700" : "list-disc space-y-1 pl-5 text-sm text-slate-700"}
    >
      {lines.map((line, index) => {
        const text = line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
        return <li key={`${key}-${index}`}>{renderInline(text)}</li>;
      })}
    </Tag>
  );
}

function renderBlockquote(lines: string[], key: string) {
  return (
    <blockquote
      key={key}
      className="border-l-4 border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-600"
    >
      {lines.map((line, index) => (
        <p key={`${key}-${index}`}>{renderInline(line.replace(/^>\s?/, ""))}</p>
      ))}
    </blockquote>
  );
}

function renderHeading(line: string, key: string) {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) {
    return renderParagraph([line], key);
  }
  const level = match[1].length;
  const text = match[2];
  const className = level === 1
    ? "text-2xl font-semibold text-slate-950"
    : level === 2
      ? "text-xl font-semibold text-slate-900"
      : level === 3
        ? "text-lg font-semibold text-slate-900"
        : "text-base font-semibold text-slate-800";
  if (level === 1) {
    return <h1 key={key} className={className}>{renderInline(text)}</h1>;
  }
  if (level === 2) {
    return <h2 key={key} className={className}>{renderInline(text)}</h2>;
  }
  if (level === 3) {
    return <h3 key={key} className={className}>{renderInline(text)}</h3>;
  }
  if (level === 4) {
    return <h4 key={key} className={className}>{renderInline(text)}</h4>;
  }
  if (level === 5) {
    return <h5 key={key} className={className}>{renderInline(text)}</h5>;
  }
  return <h6 key={key} className={className}>{renderInline(text)}</h6>;
}

function parseMarkdown(content: string) {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        buffer.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].startsWith("```")) {
        index += 1;
      }
      blocks.push(
        <div key={`code-${blocks.length}`} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
          {language ? (
            <div className="border-b border-slate-800 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              {language}
            </div>
          ) : null}
          <pre className="overflow-x-auto p-4 text-xs leading-6 text-slate-100">
            <code>{buffer.join("\n")}</code>
          </pre>
        </div>,
      );
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      blocks.push(renderHeading(line, `heading-${blocks.length}`));
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buffer: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        buffer.push(lines[index]);
        index += 1;
      }
      blocks.push(renderBlockquote(buffer, `quote-${blocks.length}`));
      continue;
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const buffer: string[] = [];
      while (
        index < lines.length &&
        (ordered ? /^\d+\.\s+/.test(lines[index]) : /^[-*]\s+/.test(lines[index]))
      ) {
        buffer.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(buffer, `list-${blocks.length}`));
      continue;
    }

    const buffer: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("```") &&
      !/^#{1,6}\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index])
    ) {
      buffer.push(lines[index]);
      index += 1;
    }
    blocks.push(renderParagraph(buffer, `paragraph-${blocks.length}`));
  }

  return blocks;
}

export function SimpleMarkdownPreview({
  content,
  emptyText = "暂无内容",
  className,
}: SimpleMarkdownPreviewProps) {
  const trimmed = content.trim();
  if (!trimmed) {
    return (
      <div
        className={joinClassName(
          "rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-400",
          className,
        )}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div
      className={joinClassName(
        "space-y-4 rounded-xl border border-slate-200 bg-white px-4 py-4",
        className,
      )}
    >
      {parseMarkdown(trimmed)}
    </div>
  );
}
