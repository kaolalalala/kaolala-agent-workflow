function getInput() {
  try {
    return JSON.parse(process.env.TOOL_INPUT || "{}");
  } catch {
    return {};
  }
}

function main() {
  const input = getInput();
  const text = String(input.text || "");
  if (!text.trim()) {
    throw new Error("text is required");
  }

  const lines = text.split(/\r?\n/);
  const words = text.trim().split(/\s+/).filter(Boolean);

  const output = {
    ok: true,
    characters: text.length,
    words: words.length,
    lines: lines.length,
    preview: text.slice(0, 180),
  };
  process.stdout.write(JSON.stringify(output));
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
}
