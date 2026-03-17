function getInput() {
  try {
    return JSON.parse(process.env.TOOL_INPUT || "{}");
  } catch {
    return {};
  }
}

function readPath(target, path) {
  const keys = String(path).split(".").filter(Boolean);
  let current = target;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = current[key];
  }
  return current;
}

function main() {
  const input = getInput();
  const rawJson = String(input.json || "");
  const paths = Array.isArray(input.paths) ? input.paths.map((item) => String(item)) : [];
  if (!rawJson.trim()) {
    throw new Error("json is required");
  }
  if (paths.length === 0) {
    throw new Error("paths is required");
  }

  const parsed = JSON.parse(rawJson);
  const values = {};
  for (const path of paths) {
    values[path] = readPath(parsed, path);
  }

  process.stdout.write(JSON.stringify({ ok: true, values }));
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
}
