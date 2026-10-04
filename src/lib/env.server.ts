import fs from "node:fs";
import path from "node:path";

let isLoaded = false;

export function ensureServerEnv(): void {
  if (isLoaded) return;
  isLoaded = true;

  if (typeof (process as any).loadEnvFile === "function") {
    try {
      (process as any).loadEnvFile();
    } catch {}
  }

  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const fileContent = fs.readFileSync(envPath, "utf-8");
      for (const line of fileContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[EnvServer] Warning reading .env:", err);
  }
}

ensureServerEnv();
