import {
  spawn as spawnChild,
  spawnSync,
} from "node:child_process";
import { extname } from "node:path";

export function isCommandUnavailableResult(
  result,
  command,
  { platform = process.platform } = {},
) {
  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.code !== "number" ||
    typeof result.stderr !== "string" ||
    typeof command !== "string" ||
    command.length === 0
  ) {
    return false;
  }
  const normalizedStderr = result.stderr.toLowerCase();
  const name = command.toLowerCase();
  if (!normalizedStderr.includes(name)) return false;
  if (result.code === 127) {
    return normalizedStderr.includes(`${name} not found on path`) ||
      normalizedStderr.includes(`${name} was not found; install ${name} and make it available on path.`);
  }
  return platform === "win32" && result.code === 1;
}

export function resolveCommandInvocation(
  command,
  args,
  {
    comspec = process.env.ComSpec,
    platform = process.platform,
  } = {},
) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string")
  ) {
    throw new TypeError("command and arguments must be non-empty strings");
  }
  const extension = extname(command).toLowerCase();
  if (
    platform !== "win32" ||
    (extension !== ".bat" && extension !== ".cmd")
  ) {
    return { args, command };
  }
  return {
    args: ["/d", "/c", command, ...args],
    command:
      typeof comspec === "string" && comspec.length > 0
        ? comspec
        : "cmd.exe",
  };
}

export function spawnCommand(
  command,
  args,
  options,
  {
    comspec = process.env.ComSpec,
    platform = process.platform,
    spawnProcess = spawnChild,
  } = {},
) {
  if (typeof spawnProcess !== "function") {
    throw new TypeError("spawnProcess must be a function");
  }
  const invocation = resolveCommandInvocation(command, args, {
    comspec,
    platform,
  });
  return spawnProcess(
    invocation.command,
    invocation.args,
    options,
  );
}

function taskkillProcessTree(pid) {
  spawnSync(
    "taskkill",
    ["/PID", String(pid), "/T", "/F"],
    { stdio: "ignore" },
  );
}

export function signalCommandProcessTree(
  child,
  signal,
  {
    killProcess = process.kill,
    killWindowsTree = taskkillProcessTree,
    platform = process.platform,
  } = {},
) {
  if (
    child?.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return false;
  }
  try {
    if (platform === "win32") {
      killWindowsTree(child.pid);
    } else {
      killProcess(-child.pid, signal);
    }
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}
