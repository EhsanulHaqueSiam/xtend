// @effect-diagnostics nodeBuiltinImport:off -- launchctl is a local binary and the plist a local file.
import * as ChildProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const LAUNCHD_LABEL = "com.xtend.service";

const plistPath = () =>
  path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface PlistInput {
  /** Program plus arguments, e.g. [node, bin.mjs, "--base-dir", dir]. */
  readonly programArguments: ReadonlyArray<string>;
  readonly baseDir: string;
  readonly logPath: string;
  /** PATH for the service so `treg` and `node` resolve under launchd's bare environment. */
  readonly pathEnv: string;
  /** The program is Electron run as Node (the packaged app's binary); without the flag launchd opens the app. */
  readonly electronAsNode: boolean;
}

/** A launchd user agent that keeps the service up and restarts it after a crash or login. */
export const renderPlist = (input: PlistInput): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${input.programArguments.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(input.baseDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>XTEND_SUPERVISOR</key><string>launchd</string>
    <key>PATH</key><string>${escapeXml(input.pathEnv)}</string>${input.electronAsNode ? "\n    <key>ELECTRON_RUN_AS_NODE</key><string>1</string>" : ""}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${escapeXml(input.logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(input.logPath)}</string>
</dict>
</plist>
`;

const launchctl = (...args: ReadonlyArray<string>) =>
  ChildProcess.spawnSync("launchctl", args, { encoding: "utf8" });

const domain = () => `gui/${os.userInfo().uid}`;

export interface ServiceOptions {
  readonly baseDir: string;
  readonly port: number;
  readonly host: string | undefined;
}

/** Writes the plist for this binary and loads it; a loaded agent is replaced. */
export const install = (options: ServiceOptions): string => {
  const file = plistPath();
  const serviceArgs = ["--base-dir", options.baseDir, "--port", String(options.port)];
  if (options.host !== undefined) serviceArgs.push("--host", options.host);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(options.baseDir, { recursive: true });
  fs.writeFileSync(
    file,
    renderPlist({
      programArguments: [process.execPath, path.resolve(process.argv[1] ?? ""), ...serviceArgs],
      baseDir: options.baseDir,
      logPath: path.join(options.baseDir, "service.log"),
      pathEnv: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      electronAsNode: process.versions["electron"] !== undefined,
    }),
  );
  launchctl("bootout", `${domain()}/${LAUNCHD_LABEL}`);
  const result = launchctl("bootstrap", domain(), file);
  if (result.status !== 0) throw new Error(`launchctl bootstrap failed: ${result.stderr.trim()}`);
  return file;
};

export const uninstall = (): boolean => {
  const file = plistPath();
  launchctl("bootout", `${domain()}/${LAUNCHD_LABEL}`);
  const existed = fs.existsSync(file);
  fs.rmSync(file, { force: true });
  return existed;
};

export const status = (): { readonly installed: boolean; readonly loaded: boolean } => ({
  installed: fs.existsSync(plistPath()),
  loaded: launchctl("print", `${domain()}/${LAUNCHD_LABEL}`).status === 0,
});
