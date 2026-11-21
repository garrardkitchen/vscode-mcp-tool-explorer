import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConfigProblem, ResolvedServer } from "../types.js";
import { candidateOrigins, type Origin, type WorkspaceFolder } from "./origins.js";
import { parseConfigText } from "./parse.js";
import type { VariableContext } from "./variables.js";

export interface LoadedConfig {
  servers: ResolvedServer[];
  problems: ConfigProblem[];
  /** Every config path that was considered, including files that are absent. */
  searched: string[];
}

export function loadConfigs(input: {
  workspaceFolders: readonly WorkspaceFolder[];
  profileDirectory: string;
  homeDirectory?: string;
  copilotHome?: string;
  env?: NodeJS.ProcessEnv;
}): LoadedConfig {
  const homeDirectory = input.homeDirectory ?? os.homedir();
  const env = input.env ?? process.env;
  const origins = candidateOrigins({
    workspaceFolders: input.workspaceFolders,
    profileDirectory: input.profileDirectory,
    homeDirectory,
    copilotHome: input.copilotHome,
  });

  const servers: ResolvedServer[] = [];
  const problems: ConfigProblem[] = [];
  for (const origin of origins) {
    if (!fs.existsSync(origin.file)) {
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(origin.file, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push({ file: origin.file, message: `Could not read ${origin.label}: ${message}` });
      continue;
    }
    const parsed = parseConfigText({
      origin,
      text,
      variables: variablesFor(origin, env, homeDirectory),
      readEnvFile: (filePath) => {
        try {
          return fs.readFileSync(filePath, "utf8");
        } catch {
          return undefined;
        }
      },
    });
    servers.push(...parsed.servers);
    problems.push(...parsed.problems);
  }

  return { servers, problems, searched: origins.map((origin) => origin.file) };
}

function variablesFor(origin: Origin, env: NodeJS.ProcessEnv, homeDirectory: string): VariableContext {
  return {
    env,
    userHome: homeDirectory,
    pathSeparator: path.sep,
    workspaceFolder: origin.workspaceFolder,
    workspaceFolderBasename: origin.workspaceFolder ? path.basename(origin.workspaceFolder) : undefined,
  };
}
