import { parse } from "node:path";

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

function pickTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}

function pickBlocks(xml, tag) {
  return Array.from(xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))).map((item) => item[1] || "");
}

function safeDate(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toISOString();
}

async function fetchNews(query, maxNews) {
  const q = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "agent-workflow/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`news fetch failed: HTTP ${response.status}`);
  }
  const xml = await response.text();
  const items = pickBlocks(xml, "item")
    .slice(0, maxNews)
    .map((item) => ({
      title: pickTag(item, "title"),
      link: pickTag(item, "link"),
      publishedAt: safeDate(pickTag(item, "pubDate")),
      source: pickTag(item, "source"),
      summary: pickTag(item, "description"),
      kind: "news",
    }));

  return items;
}

async function fetchPapers(query, maxPapers) {
  const q = encodeURIComponent(query);
  const url =
    `https://export.arxiv.org/api/query?search_query=all:${q}` +
    `&start=0&max_results=${Math.max(1, maxPapers)}&sortBy=submittedDate&sortOrder=descending`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "agent-workflow/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`paper fetch failed: HTTP ${response.status}`);
  }
  const xml = await response.text();
  const entries = pickBlocks(xml, "entry")
    .slice(0, maxPapers)
    .map((entry) => ({
      title: pickTag(entry, "title"),
      link: pickTag(entry, "id"),
      publishedAt: safeDate(pickTag(entry, "published") || pickTag(entry, "updated")),
      source: "arXiv",
      summary: pickTag(entry, "summary"),
      kind: "paper",
    }));

  return entries;
}

function toMarkdown(query, news, papers) {
  const lines = [];
  lines.push(`# Agent OS Latest Digest`);
  lines.push("");
  lines.push(`Query: ${query}`);
  lines.push(`Generated At: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## News");
  if (news.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of news) {
      lines.push(`- ${item.title}`);
      lines.push(`  - Source: ${item.source || "Unknown"}`);
      lines.push(`  - Date: ${item.publishedAt || "Unknown"}`);
      lines.push(`  - Link: ${item.link}`);
      if (item.summary) {
        lines.push(`  - Note: ${item.summary}`);
      }
    }
  }
  lines.push("");
  lines.push("## Papers");
  if (papers.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of papers) {
      lines.push(`- ${item.title}`);
      lines.push(`  - Source: ${item.source || "Unknown"}`);
      lines.push(`  - Date: ${item.publishedAt || "Unknown"}`);
      lines.push(`  - Link: ${item.link}`);
      if (item.summary) {
        lines.push(`  - Abstract: ${item.summary}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const input = getInput();
  const query = String(input.query || "agent os").trim();
  const maxNews = Math.min(20, Math.max(1, Number(input.maxNews || 8)));
  const maxPapers = Math.min(20, Math.max(1, Number(input.maxPapers || 6)));

  const [newsResult, papersResult] = await Promise.allSettled([fetchNews(query, maxNews), fetchPapers(query, maxPapers)]);
  const news = newsResult.status === "fulfilled" ? newsResult.value : [];
  const papers = papersResult.status === "fulfilled" ? papersResult.value : [];
  const markdown = toMarkdown(query, news, papers);

  const output = {
    ok: true,
    query,
    generatedAt: new Date().toISOString(),
    news,
    papers,
    markdown,
    stats: {
      newsCount: news.length,
      paperCount: papers.length,
    },
    errors: [
      ...(newsResult.status === "rejected" ? [{ source: "news", message: String(newsResult.reason?.message || newsResult.reason) }] : []),
      ...(papersResult.status === "rejected" ? [{ source: "papers", message: String(papersResult.reason?.message || papersResult.reason) }] : []),
    ],
    meta: {
      script: parse(import.meta.url).base,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
