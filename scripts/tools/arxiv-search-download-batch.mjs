import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const DEFAULT_OUTPUT_DIR = resolve(process.cwd(), process.env.AGENT_WORKFLOW_OUTPUT_DIR || ".output/v0_2");
const USER_AGENT = "agent-workflow/0.2 (+https://arxiv.org)";

function getInput() {
  try {
    return JSON.parse(process.env.TOOL_INPUT || "{}");
  } catch {
    return {};
  }
}

function decodeHtml(input) {
  return String(input || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(input) {
  return decodeHtml(String(input || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeArxivUrl(input) {
  return decodeHtml(String(input || ""))
    .replace(/^http:\/\/arxiv\.org\//i, "https://arxiv.org/")
    .replace(/^http:\/\/export\.arxiv\.org\//i, "https://export.arxiv.org/");
}

function pickTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}

function pickBlocks(xml, tag) {
  return Array.from(xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi")))
    .map((item) => item[1] || "");
}

function pickPdfUrl(entryBlock) {
  const match = entryBlock.match(/<link[^>]*title=["']pdf["'][^>]*href=["']([^"']+)["']/i);
  if (match?.[1]) {
    return normalizeArxivUrl(match[1]);
  }
  const absUrl = normalizeArxivUrl(pickTag(entryBlock, "id"));
  if (!absUrl) return "";
  return absUrl.replace("/abs/", "/pdf/") + ".pdf";
}

function pickAuthors(entryBlock) {
  return pickBlocks(entryBlock, "author")
    .map((block) => pickTag(block, "name"))
    .filter(Boolean);
}

function sanitizeFileName(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "paper";
}

function safeDate(input) {
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function pickArxivId(absUrl) {
  const match = String(absUrl || "").match(/arxiv\.org\/abs\/([^/?#]+)/i);
  return match?.[1]?.replace(/v\d+$/i, "") || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url, kind) {
  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (response.ok) {
        return await response.text();
      }
      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text().catch(() => "");
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`${kind} failed: HTTP ${response.status}${body ? ` ${body.slice(0, 120)}` : ""}`);
      }
      await sleep((1200 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 600));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep((1200 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 600));
    }
  }

  throw lastError ?? new Error(`${kind} failed`);
}

async function downloadPdfWithRetry(fileUrl, filePath) {
  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(fileUrl, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxAttempts) {
          throw new Error(`PDF download failed: HTTP ${response.status}`);
        }
        await sleep((1200 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 600));
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error("PDF download returned empty body");
      }
      writeFileSync(filePath, buffer);
      return buffer.length;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep((1200 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 600));
    }
  }

  throw lastError ?? new Error("PDF download failed");
}

async function fetchArxivEntries(query, startIndex, requestedCount) {
  const fetchCount = Math.min(Math.max(startIndex + (requestedCount * 4), requestedCount * 4), 120);
  const encoded = encodeURIComponent(query);
  const url =
    `https://export.arxiv.org/api/query?search_query=all:${encoded}` +
    `&start=0&max_results=${fetchCount}&sortBy=relevance&sortOrder=descending`;
  const xml = await fetchTextWithRetry(url, "arXiv query");
  const entries = pickBlocks(xml, "entry").map((entryBlock) => {
    const absUrl = normalizeArxivUrl(pickTag(entryBlock, "id"));
    const arxivId = pickArxivId(absUrl);
    return {
      arxivId,
      title: pickTag(entryBlock, "title"),
      summary: pickTag(entryBlock, "summary"),
      publishedAt: safeDate(pickTag(entryBlock, "published") || pickTag(entryBlock, "updated")),
      authors: pickAuthors(entryBlock),
      absUrl,
      pdfUrl: pickPdfUrl(entryBlock),
    };
  }).filter((item) => item.title && item.pdfUrl);
  const uniqueEntries = [];
  const seenIds = new Set();
  for (const entry of entries) {
    const dedupeKey = entry.arxivId || entry.absUrl || entry.pdfUrl;
    if (!dedupeKey || seenIds.has(dedupeKey)) {
      continue;
    }
    seenIds.add(dedupeKey);
    uniqueEntries.push(entry);
  }
  return uniqueEntries.slice(startIndex);
}

async function downloadPdf(fileUrl, filePath) {
  return downloadPdfWithRetry(fileUrl, filePath);
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      results.push(await worker(current));
    }
  });
  await Promise.all(runners);
  return results;
}

function buildManifestMarkdown(query, papers, failures) {
  const lines = [
    "# arXiv Download Batch",
    "",
    `Query: ${query}`,
    `Generated At: ${new Date().toISOString()}`,
    `Downloaded Count: ${papers.length}`,
    "",
    "## Papers",
  ];

  if (papers.length === 0) {
    lines.push("- (none)");
  } else {
    for (const paper of papers) {
      lines.push(`- ${paper.title}`);
      lines.push(`  - arXiv ID: ${paper.arxivId || "unknown"}`);
      lines.push(`  - PDF: ${paper.pdfUrl}`);
      lines.push(`  - File: ${paper.filePath}`);
      if (paper.authors.length > 0) {
        lines.push(`  - Authors: ${paper.authors.join(", ")}`);
      }
      if (paper.publishedAt) {
        lines.push(`  - Published: ${paper.publishedAt}`);
      }
      if (paper.summary) {
        lines.push(`  - Summary: ${paper.summary.slice(0, 320)}`);
      }
    }
  }

  if (failures.length > 0) {
    lines.push("");
    lines.push("## Failures");
    for (const failure of failures) {
      lines.push(`- ${failure.title || failure.pdfUrl || "unknown"}: ${failure.message}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const input = getInput();
  const query = String(input.query || "").trim();
  if (!query) {
    throw new Error("query is required");
  }

  const startIndex = Math.max(0, Number(input.startIndex || 0));
  const requestedCount = Math.min(20, Math.max(1, Number(input.maxResults || 10)));
  const rootOutputDir = resolve(process.env.TOOL_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  const batchDir = join(
    rootOutputDir,
    "paper_batches",
    `${String(startIndex).padStart(3, "0")}_${String(startIndex + requestedCount - 1).padStart(3, "0")}`,
  );
  mkdirSync(batchDir, { recursive: true });

  const entries = await fetchArxivEntries(query, startIndex, requestedCount);
  const failures = [];
  const selected = entries.slice(0, Math.max(requestedCount * 2, requestedCount));
  const downloaded = [];

  await runWithConcurrency(selected, 3, async (entry) => {
    if (downloaded.length >= requestedCount) {
      return null;
    }
    try {
      const fileStem = sanitizeFileName(`${entry.arxivId || "paper"}_${entry.title}`);
      const filePath = join(batchDir, `${fileStem}.pdf`);
      const bytes = await downloadPdf(entry.pdfUrl, filePath);
      if (downloaded.length >= requestedCount) {
        rmSync(filePath, { force: true });
        return null;
      }
      downloaded.push({
        ...entry,
        filePath,
        bytes,
      });
    } catch (error) {
      failures.push({
        title: entry.title,
        pdfUrl: entry.pdfUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  });

  const papers = downloaded.slice(0, requestedCount);
  const manifestMarkdown = buildManifestMarkdown(query, papers, failures);
  const manifestPath = join(batchDir, "manifest.md");
  writeFileSync(manifestPath, manifestMarkdown, "utf8");
  writeFileSync(join(batchDir, "manifest.json"), JSON.stringify({ query, papers, failures }, null, 2), "utf8");

  process.stdout.write(JSON.stringify({
    ok: true,
    query,
    startIndex,
    requestedCount,
    downloadedCount: papers.length,
    outputDir: batchDir,
    manifestPath,
    papers,
    failures,
  }));
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
