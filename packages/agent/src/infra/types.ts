/**
 * @author Codex
 * @description Agent 离线基础设施清单与安装结果类型
 */

export interface InfraResource {
  id: string;
  version: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  source: string;
  file: string;
  target: string;
  sha256: string;
  executable: boolean;
}

export interface InfraManifest {
  schemaVersion: number;
  infraVersion: string;
  resources: InfraResource[];
}

export interface InstallInfraOptions {
  agentDir: string;
  infraDir: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  force?: boolean;
}

export interface InstalledInfra {
  binDir: string;
  environment: NodeJS.ProcessEnv;
}
