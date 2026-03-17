import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/* ── Types ── */

export interface LocalEnvironment {
  id: string;
  name: string;
  runtimeType: "python";
  source: "system" | "conda";
  pythonPath: string;
  version: string;
  isAvailable: boolean;
}

/* ── Cache ── */

let cachedEnvironments: LocalEnvironment[] | null = null;

/* ── Helpers ── */

function tryExec(cmd: string, timeoutMs = 8000): string {
  try {
    return execSync(cmd, {
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

function getPythonVersion(pythonPath: string): string {
  const out = tryExec(`"${pythonPath}" --version`, 5000);
  // Output: "Python 3.11.5"
  const match = out.match(/Python\s+([\d.]+)/i);
  return match?.[1] ?? "";
}

function isExecutable(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

function dedup(envs: LocalEnvironment[]): LocalEnvironment[] {
  const seen = new Set<string>();
  return envs.filter((e) => {
    // Normalize path for dedup
    const key = resolve(e.pythonPath).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeId(source: string, name: string): string {
  return `${source}_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/* ── Scanners ── */

function scanSystemPython(): LocalEnvironment[] {
  const results: LocalEnvironment[] = [];
  const isWin = process.platform === "win32";

  if (isWin) {
    // `where python` may return multiple lines
    const wherePython = tryExec("where python");
    if (wherePython) {
      for (const line of wherePython.split(/\r?\n/)) {
        const p = line.trim();
        if (p && isExecutable(p)) {
          const version = getPythonVersion(p);
          if (version) {
            results.push({
              id: makeId("system", `python_${version}`),
              name: `Python ${version}`,
              runtimeType: "python",
              source: "system",
              pythonPath: p,
              version,
              isAvailable: true,
            });
          }
        }
      }
    }

    // `py -0p` lists installed Python versions with paths
    const pyList = tryExec("py -0p");
    if (pyList) {
      for (const line of pyList.split(/\r?\n/)) {
        // Format: " -3.11-64  C:\Users\...\python.exe" or similar
        const match = line.match(/(-[\d.]+\S*)\s+(.+)/);
        if (match) {
          const tag = match[1].trim();
          let p = match[2].trim();
          // py -0p sometimes returns directory, append python.exe
          if (p && !p.toLowerCase().endsWith(".exe")) {
            p = join(p, "python.exe");
          }
          if (p && isExecutable(p)) {
            const version = getPythonVersion(p);
            if (version) {
              results.push({
                id: makeId("system", `py${tag}_${version}`),
                name: `Python ${version} (py ${tag})`,
                runtimeType: "python",
                source: "system",
                pythonPath: p,
                version,
                isAvailable: true,
              });
            }
          }
        }
      }
    }
  } else {
    // Unix: which python3, which python
    for (const cmd of ["python3", "python"]) {
      const p = tryExec(`which ${cmd}`);
      if (p && isExecutable(p)) {
        const version = getPythonVersion(p);
        if (version) {
          results.push({
            id: makeId("system", cmd),
            name: `${cmd} ${version}`,
            runtimeType: "python",
            source: "system",
            pythonPath: p,
            version,
            isAvailable: true,
          });
        }
      }
    }
  }

  return results;
}

function scanCondaEnvironments(): LocalEnvironment[] {
  const results: LocalEnvironment[] = [];
  const isWin = process.platform === "win32";

  // Try `conda env list` first
  const condaEnvList = tryExec("conda env list");
  if (condaEnvList) {
    for (const line of condaEnvList.split(/\r?\n/)) {
      // Skip comments and empty lines
      if (line.startsWith("#") || !line.trim()) continue;
      // Format: "envname   *  /path/to/env" or "envname  /path/to/env"
      const parts = line.trim().split(/\s+/);
      // Last part is the path, first part is the name
      const envPath = parts[parts.length - 1];
      let envName = parts[0];
      if (!envPath || !existsSync(envPath)) continue;

      // The active env has * in the middle
      if (envName === "*") continue;
      if (envName === "") continue;

      const pythonExe = isWin
        ? join(envPath, "python.exe")
        : join(envPath, "bin", "python");

      if (!isExecutable(pythonExe)) continue;

      const version = getPythonVersion(pythonExe);
      if (!version) continue;

      results.push({
        id: makeId("conda", envName),
        name: `Conda: ${envName} (${version})`,
        runtimeType: "python",
        source: "conda",
        pythonPath: pythonExe,
        version,
        isAvailable: true,
      });
    }
  }

  // Also scan common Conda envs directories directly (fallback)
  if (isWin) {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    const condaDirs = [
      join(home, "anaconda3", "envs"),
      join(home, "miniconda3", "envs"),
      join(home, "Anaconda3", "envs"),
      join(home, "Miniconda3", "envs"),
      // Common install locations
      "C:\\ProgramData\\anaconda3\\envs",
      "C:\\ProgramData\\miniconda3\\envs",
    ];

    // Also scan base environments
    const baseDirs = [
      join(home, "anaconda3"),
      join(home, "miniconda3"),
      join(home, "Anaconda3"),
      join(home, "Miniconda3"),
    ];

    for (const baseDir of baseDirs) {
      const pythonExe = join(baseDir, "python.exe");
      if (isExecutable(pythonExe)) {
        const version = getPythonVersion(pythonExe);
        if (version) {
          const dirName = baseDir.split(/[\\/]/).pop() ?? "base";
          results.push({
            id: makeId("conda", `${dirName}_base`),
            name: `Conda: base (${dirName}, ${version})`,
            runtimeType: "python",
            source: "conda",
            pythonPath: pythonExe,
            version,
            isAvailable: true,
          });
        }
      }
    }

    for (const envsDir of condaDirs) {
      if (!existsSync(envsDir)) continue;
      try {
        const entries = readdirSync(envsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const pythonExe = join(envsDir, entry.name, "python.exe");
          if (!isExecutable(pythonExe)) continue;
          const version = getPythonVersion(pythonExe);
          if (!version) continue;
          results.push({
            id: makeId("conda", entry.name),
            name: `Conda: ${entry.name} (${version})`,
            runtimeType: "python",
            source: "conda",
            pythonPath: pythonExe,
            version,
            isAvailable: true,
          });
        }
      } catch {
        // skip unreadable directories
      }
    }
  } else {
    const home = process.env.HOME ?? "";
    const condaDirs = [
      join(home, "anaconda3", "envs"),
      join(home, "miniconda3", "envs"),
    ];
    for (const envsDir of condaDirs) {
      if (!existsSync(envsDir)) continue;
      try {
        const entries = readdirSync(envsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const pythonExe = join(envsDir, entry.name, "bin", "python");
          if (!isExecutable(pythonExe)) continue;
          const version = getPythonVersion(pythonExe);
          if (!version) continue;
          results.push({
            id: makeId("conda", entry.name),
            name: `Conda: ${entry.name} (${version})`,
            runtimeType: "python",
            source: "conda",
            pythonPath: pythonExe,
            version,
            isAvailable: true,
          });
        }
      } catch {
        // skip
      }
    }
  }

  return results;
}

/* ── Public API ── */

export const environmentService = {
  /** Scan and return all available local Python/Conda environments */
  scan(): LocalEnvironment[] {
    const systemEnvs = scanSystemPython();
    const condaEnvs = scanCondaEnvironments();
    const all = dedup([...systemEnvs, ...condaEnvs]);
    cachedEnvironments = all;
    return all;
  },

  /** Return cached environments or scan if not yet cached */
  list(): LocalEnvironment[] {
    if (cachedEnvironments) return cachedEnvironments;
    return this.scan();
  },

  /** Force re-scan and return fresh list */
  refresh(): LocalEnvironment[] {
    cachedEnvironments = null;
    return this.scan();
  },

  /** Find environment by ID */
  findById(id: string): LocalEnvironment | undefined {
    return this.list().find((e) => e.id === id);
  },

  /** Test an environment by running `python --version` and `sys.executable` */
  test(id: string): { success: boolean; output: string } {
    const env = this.findById(id);
    if (!env) return { success: false, output: `环境 ${id} 未找到` };

    try {
      const out = tryExec(
        `"${env.pythonPath}" -c "import sys; print(f'executable: {sys.executable}'); print(f'version: {sys.version}')"`,
        5000,
      );
      return { success: true, output: out };
    } catch {
      return { success: false, output: `无法执行 ${env.pythonPath}` };
    }
  },
};
