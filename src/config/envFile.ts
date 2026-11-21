/** Parses a dotenv-style file. Later lines override earlier ones. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = body.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = body.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    env[key] = unquote(body.slice(separator + 1).trim());
  }

  return env;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      const inner = value.slice(1, -1);
      return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\"/g, '"') : inner;
    }
  }
  return value;
}
