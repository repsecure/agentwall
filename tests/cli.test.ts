import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  commandApprovalMode,
  commandNormal,
  commandSessionBoost,
  commandSessionControl,
  commandSessionReset,
  commandShield,
  commandStatus,
  createBaseUrl,
  formatStatusReport,
  parseFlags,
  printHelp,
  reportCliFailure,
  resolveApprovalMode,
} from "../src/cli";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const previousOperatorToken = process.env.AGENTWALL_OPERATOR_TOKEN;
const temporaryDirectories: string[] = [];

/** A quiet dashboard payload, enough for `commandStatus --json` to print and return. */
const QUIET_STATE = {
  brand: "Agentwall",
  generatedAt: new Date().toISOString(),
  service: {
    status: "operational",
    attentionRequired: false,
    operatorSummary: "Quiet runtime.",
    host: "127.0.0.1",
    port: 3000,
  },
  posture: {
    highestRisk: "low",
    pendingApprovals: 0,
    criticalSignals: 0,
    activeAgents: 1,
    totalRequests: 4,
  },
  controls: { approvalMode: "auto" },
  stats: { sessionCounts: {} },
  priorityQueue: [],
};

function dashboardStateFetch() {
  return jest.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(QUIET_STATE),
  }));
}

function authorizationHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

/**
 * A setup directory that is not the working directory.
 *
 * `agentwall setup` writes the config and `.agentwall/operator.env` side by side, so the
 * tests below point --config at a directory the test process never enters. That is the shape
 * of a real operator who runs the CLI from a project while the service files live elsewhere.
 */
function temporaryOperatorDirectory(options: { host: string; port: number; token?: string }): string {
  const directory = mkdtempSync(join(tmpdir(), "agentwall-cli-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "agentwall.config.yaml"), `host: ${options.host}\nport: ${options.port}\n`);
  if (options.token) {
    mkdirSync(join(directory, ".agentwall"), { recursive: true });
    writeFileSync(join(directory, ".agentwall", "operator.env"), `AGENTWALL_OPERATOR_TOKEN=${options.token}\n`, { mode: 0o600 });
  }
  return directory;
}

function runCli(...args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["-r", "ts-node/register", join(__dirname, "..", "src", "cli.ts"), ...args],
    {
      cwd: join(__dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "1" },
    },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("Agentwall CLI helpers", () => {
  afterEach(() => {
    delete (global as { fetch?: unknown }).fetch;
    if (previousOperatorToken === undefined) {
      delete process.env.AGENTWALL_OPERATOR_TOKEN;
    } else {
      process.env.AGENTWALL_OPERATOR_TOKEN = previousOperatorToken;
    }
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
    // Spies here replace console and process globals. Left installed they follow the suite
    // into every later test, so the cleanup restores them beside the environment it resets.
    jest.restoreAllMocks();
  });

  it("parses flags and positional arguments together", () => {
    const parsed = parseFlags(["session-42", "--minutes", "15", "--json", "tail"]);
    expect(parsed.positionals).toEqual(["session-42", "tail"]);
    expect(parsed.flags.minutes).toBe("15");
    expect(parsed.flags.json).toBe(true);
  });

  it("treats confirm as a boolean flag so terminate still keeps the session positional", () => {
    const parsed = parseFlags(["--confirm", "session-42"]);
    expect(parsed.flags.confirm).toBe(true);
    expect(parsed.positionals).toEqual(["session-42"]);
  });

  it("lists guided setup and the separately launchable UI", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    printHelp();

    expect(log).toHaveBeenCalledWith(expect.stringContaining("setup               Create safe local operator files"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ui                  Start the loopback setup"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--service-port <port>"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("start               Start Agentwall server"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("release-manifest    Write a SHA-256 inventory"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--proxy <url>"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--generated-at <iso>"));
  });

  it("creates and verifies an unsigned release manifest through the CLI", () => {
    const root = mkdtempSync(join(tmpdir(), "agentwall-release-cli-"));
    temporaryDirectories.push(root);
    const artifacts = join(root, "artifacts");
    const manifest = join(artifacts, "release-manifest.json");
    mkdirSync(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "cli smoke\n");

    const created = runCli(
      "release-manifest",
      "--input",
      artifacts,
      "--output",
      manifest,
      "--version",
      "1.2.3",
      "--generated-at",
      "2026-08-06T00:00:00.000Z",
    );
    expect(created.status).toBe(0);
    expect(created.stdout).toContain("Release manifest created:");

    const verified = runCli("verify-release", "--manifest", manifest, "--artifacts", artifacts);
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain("Release manifest verified: 1.2.3");
    expect(verified.stdout).toContain("Artifacts verified: 1");
  });

  it("returns usage exit code 2 for an invalid release timestamp", () => {
    const root = mkdtempSync(join(tmpdir(), "agentwall-release-cli-"));
    temporaryDirectories.push(root);
    const artifacts = join(root, "artifacts");
    mkdirSync(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "cli smoke\n");

    const result = runCli(
      "release-manifest",
      "--input",
      artifacts,
      "--generated-at",
      "not-a-timestamp",
    );

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("--generated-at must be a valid ISO timestamp.");
  });

  it("prints a fatal command error before exiting", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => reportCliFailure(new Error("capture command timed out"))).toThrow("exit:1");
    expect(error).toHaveBeenCalledWith("capture command timed out");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("prefers explicit url when creating API base url", () => {
    expect(createBaseUrl({ url: "http://127.0.0.1:4444/" })).toBe("http://127.0.0.1:4444");
  });

  it("formats status output with queue and floodguard details", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "2 approval(s) open, 1 critical signal(s), 1 session(s) paused.",
        recommendedActions: [
          "Review the pending approval queue starting with bash_exec.",
          "Inspect paused sessions before resuming runtime traffic.",
        ],
        host: "127.0.0.1",
        port: 3000,
      },
      posture: {
        highestRisk: "critical",
        pendingApprovals: 2,
        criticalSignals: 1,
        activeAgentsNow: 3,
        activeAgents: 3,
        totalRequests: 48,
      },
      controls: {
        approvalMode: "always",
      },
      stats: {
        sessionCounts: { paused: 1, terminated: 2 },
      },
      floodGuard: {
        mode: "shield",
        blockedTotal: 5,
        blockedByCategory: { queue: 3, approval_request: 2 },
        pressureByCategory: { queue: 2, approval_request: 1 },
        pressureBySession: [
          { sessionId: "session-42", pressure: 0.87, blocked: 4 },
          { sessionId: "session-7", pressure: 0.51, blocked: 1 },
        ],
        recentBlocks: [
          {
            timestamp: new Date(Date.now() - 45_000).toISOString(),
            category: "queue",
            reason: "Pending approval queue cap reached",
            sessionId: "session-42",
            pressure: 0.87,
          },
        ],
        shieldUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
        sessionOverrides: [{ sessionId: "session-42", multiplier: 1.5, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }],
        operatorGuidance: {
          status: "active",
          summary: "Shield mode is active while approval queue pressure is elevated around session-42.",
          recommendedAction: "Clear the critical approval queue before returning to normal mode.",
          hottestSessionId: "session-42",
          pressure: 0.87,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      priorityQueue: [
        {
          category: "approval",
          title: "bash_exec awaiting decision",
          owner: "agent-ops",
          status: "pending",
          timestamp: new Date().toISOString(),
          summary: "tool plane · critical risk · waiting 4m",
          primaryAction: "Review",
        },
      ],
    });

    expect(report).toContain("Agentwall OPERATIONAL");
    expect(report).toContain("Control target: http://127.0.0.1:3000");
    expect(report).toContain("FloodGuard: shield");
    expect(report).toMatch(/Session overrides: session-42×1\.5 \(\d+m remaining\)/);
    expect(report).toContain("FloodGuard guidance: Shield mode is active while approval queue pressure is elevated around session-42.");
    expect(report).toContain("FloodGuard next move: Clear the critical approval queue before returning to normal mode.");
    expect(report).toContain("FloodGuard pressure: 87% · hottest session session-42");
    expect(report).toContain("FloodGuard blocked by type: queue 3, approval request 2");
    expect(report).toContain("FloodGuard pressure by type: queue 2, approval request 1");
    expect(report).toContain("FloodGuard hottest sessions: session-42 87% (4 blocked), session-7 51% (1 blocked)");
    expect(report).toContain("Latest FloodGuard block: queue · Pending approval queue cap reached · session-42");
    expect(report).toContain("Tracked sessions terminated: 2");
    expect(report).toContain("Recommended actions:");
    expect(report).toContain("Review the pending approval queue starting with bash_exec.");
    expect(report).toContain("CLI next moves:");
    expect(report).not.toContain("agentwall normal");
    expect(report).toContain('agentwall pause session-42 --note "Investigate FloodGuard pressure"');
    expect(report).toContain("Top queue:");
    expect(report).toContain("agent-ops · bash_exec awaiting decision");
    expect(report).toContain("next review");
    expect(report).toContain("tool plane · critical risk · waiting 4m");
  });

  it("suggests shield and approval hardening commands when pressure is rising", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "Pressure rising.",
        recommendedActions: [],
        host: "127.0.0.1",
        port: 3000,
      },
      posture: {
        highestRisk: "high",
        pendingApprovals: 3,
        criticalSignals: 1,
        activeAgentsNow: 2,
        activeAgents: 2,
        totalRequests: 14,
      },
      controls: {
        approvalMode: "auto",
      },
      stats: {
        sessionCounts: { paused: 0, terminated: 0 },
      },
      floodGuard: {
        mode: "normal",
        blockedTotal: 2,
        operatorGuidance: {
          status: "recommend",
          summary: "Approval queue pressure is already causing FloodGuard blocks for session-hot.",
          recommendedAction: "Enable shield mode for 10 minutes, review session-hot, and clear the highest-risk approvals first.",
          hottestSessionId: "session-hot",
          pressure: 0.91,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      priorityQueue: [],
    });

    expect(report).toContain("CLI next moves:");
    expect(report).toContain("agentwall shield --minutes 10");
    expect(report).toContain("agentwall approval-mode always");
    expect(report).toContain('agentwall pause session-hot --note "Investigate FloodGuard pressure"');
  });

  it("keeps CLI next moves copy-pasteable for explicit live targets", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "Pressure rising.",
        recommendedActions: [],
        host: "127.0.0.1",
        port: 3015,
      },
      posture: {
        highestRisk: "high",
        pendingApprovals: 3,
        criticalSignals: 1,
        activeAgentsNow: 2,
        activeAgents: 2,
        totalRequests: 14,
      },
      controls: {
        approvalMode: "auto",
      },
      stats: {
        sessionCounts: { paused: 0, terminated: 0 },
      },
      floodGuard: {
        mode: "normal",
        blockedTotal: 2,
        operatorGuidance: {
          status: "recommend",
          summary: "Approval queue pressure is already causing FloodGuard blocks for session-hot.",
          recommendedAction: "Enable shield mode for 10 minutes, review session-hot, and clear the highest-risk approvals first.",
          hottestSessionId: "session-hot",
          pressure: 0.91,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      priorityQueue: [],
    }, { url: "http://127.0.0.1:3015" });

    expect(report).toContain("Control target: http://127.0.0.1:3015");
    expect(report).toContain("agentwall shield --minutes 10 --url http://127.0.0.1:3015");
    expect(report).toContain("agentwall approval-mode always --url http://127.0.0.1:3015");
    expect(report).toContain('agentwall pause session-hot --note "Investigate FloodGuard pressure" --url http://127.0.0.1:3015');
  });

  it("does not suggest pausing a session that is already contained", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "Pressure is elevated but the hottest session is already paused.",
        recommendedActions: [],
        host: "127.0.0.1",
        port: 3015,
      },
      posture: {
        highestRisk: "high",
        pendingApprovals: 2,
        criticalSignals: 1,
        activeAgentsNow: 1,
        activeAgents: 1,
        totalRequests: 18,
      },
      controls: {
        approvalMode: "auto",
      },
      stats: {
        sessionCounts: { paused: 1, terminated: 0 },
      },
      floodGuard: {
        mode: "normal",
        blockedTotal: 2,
        operatorGuidance: {
          status: "recommend",
          summary: "Pressure is elevated around session-calm.",
          recommendedAction: "Enable shield mode and clear the approval queue.",
          hottestSessionId: "session-calm",
          pressure: 0.88,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      sessions: {
        recent: [{ sessionId: "session-calm", status: "paused" }],
      },
      priorityQueue: [],
    }, { config: "./agentwall.config.yaml" });

    expect(report).toContain("CLI next moves:");
    expect(report).toContain("agentwall shield --minutes 10 --config ./agentwall.config.yaml");
    expect(report).toContain("agentwall approval-mode always --config ./agentwall.config.yaml");
    expect(report).not.toContain('agentwall pause session-calm --note "Investigate FloodGuard pressure"');
  });

  it("does not suggest pausing a hottest session that is already contained outside the recent-session slice", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "Pressure is elevated around an older paused session.",
        recommendedActions: [],
        host: "127.0.0.1",
        port: 3015,
      },
      posture: {
        highestRisk: "high",
        pendingApprovals: 2,
        criticalSignals: 1,
        activeAgentsNow: 1,
        activeAgents: 2,
        totalRequests: 19,
      },
      controls: {
        approvalMode: "auto",
      },
      stats: {
        sessionCounts: { paused: 1, terminated: 0 },
      },
      floodGuard: {
        mode: "normal",
        blockedTotal: 2,
        operatorGuidance: {
          status: "recommend",
          summary: "Pressure is elevated around session-cold.",
          recommendedAction: "Enable shield mode and clear the approval queue.",
          hottestSessionId: "session-cold",
          pressure: 0.9,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      sessions: {
        recent: [{ sessionId: "session-hot", status: "active" }],
        statusById: { "session-cold": "paused", "session-hot": "active" },
      },
      priorityQueue: [],
    }, { url: "http://127.0.0.1:3015" });

    expect(report).toContain("agentwall shield --minutes 10 --url http://127.0.0.1:3015");
    expect(report).toContain("agentwall approval-mode always --url http://127.0.0.1:3015");
    expect(report).not.toContain('agentwall pause session-cold --note "Investigate FloodGuard pressure"');
  });

  it("suggests normalization commands once pressure settles", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: false,
        operatorSummary: "Runtime is back inside normal limits.",
        recommendedActions: [],
        host: "127.0.0.1",
        port: 3015,
      },
      posture: {
        highestRisk: "low",
        pendingApprovals: 0,
        criticalSignals: 0,
        activeAgentsNow: 1,
        activeAgents: 1,
        totalRequests: 24,
      },
      controls: {
        approvalMode: "always",
      },
      stats: {
        sessionCounts: { paused: 0, terminated: 0 },
      },
      floodGuard: {
        mode: "normal",
        blockedTotal: 2,
        sessionOverrides: [{ sessionId: "session-calm", multiplier: 1.5, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }],
        operatorGuidance: {
          status: "normal",
          summary: "FloodGuard is operating inside normal limits.",
          recommendedAction: "No FloodGuard action needed right now.",
          hottestSessionId: "session-calm",
          pressure: 0.24,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      priorityQueue: [],
    }, { config: "./agentwall.config.yaml" });

    expect(report).toContain("CLI next moves:");
    expect(report).toContain("agentwall approval-mode auto --config ./agentwall.config.yaml");
    expect(report).toContain("agentwall session-reset session-calm --config ./agentwall.config.yaml");
    expect(report).not.toContain('agentwall pause session-calm --note "Investigate FloodGuard pressure"');
  });

  it("does not suggest shield normalization while paused sessions still need review", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "One session is paused for review.",
        recommendedActions: ["Inspect paused sessions before resuming runtime traffic."],
        host: "127.0.0.1",
        port: 3015,
      },
      posture: {
        highestRisk: "medium",
        pendingApprovals: 0,
        criticalSignals: 0,
        activeAgentsNow: 1,
        activeAgents: 1,
        totalRequests: 12,
      },
      controls: {
        approvalMode: "always",
      },
      stats: {
        sessionCounts: { paused: 1, terminated: 0 },
      },
      floodGuard: {
        mode: "shield",
        blockedTotal: 0,
        operatorGuidance: {
          status: "normal",
          summary: "FloodGuard is operating inside normal limits.",
          recommendedAction: "No FloodGuard action needed right now.",
          hottestSessionId: "session-live",
          pressure: 0.12,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      sessions: {
        recent: [{ sessionId: "session-live", status: "paused" }],
      },
      priorityQueue: [],
    }, { url: "http://127.0.0.1:3015" });

    expect(report).toContain("Inspect paused sessions before resuming runtime traffic.");
    expect(report).not.toContain("agentwall normal --url http://127.0.0.1:3015");
    expect(report).not.toContain("agentwall approval-mode auto --url http://127.0.0.1:3015");
  });

  it("does not suggest approval-mode cleanup while terminated sessions still need review", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "Containment landed but review is still pending.",
        recommendedActions: ["Inspect terminated sessions and capture audit evidence before normalizing controls."],
        host: "127.0.0.1",
        port: 3015,
      },
      posture: {
        highestRisk: "critical",
        pendingApprovals: 0,
        criticalSignals: 1,
        activeAgentsNow: 0,
        activeAgents: 1,
        totalRequests: 24,
      },
      controls: {
        approvalMode: "always",
      },
      stats: {
        sessionCounts: { paused: 0, terminated: 1 },
      },
      floodGuard: {
        mode: "normal",
        blockedTotal: 0,
        operatorGuidance: {
          status: "normal",
          summary: "FloodGuard is operating inside normal limits.",
          recommendedAction: "No FloodGuard action needed right now.",
          hottestSessionId: "session-calm",
          pressure: 0.18,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      priorityQueue: [],
    }, { url: "http://127.0.0.1:3015" });

    expect(report).toContain("Inspect terminated sessions and capture audit evidence before normalizing controls.");
    expect(report).not.toContain("agentwall approval-mode auto --url http://127.0.0.1:3015");
  });

  it("shows the operator's explicit live target even when the server advertises a different bind address", () => {
    const report = formatStatusReport({
      brand: "Agentwall",
      generatedAt: new Date().toISOString(),
      service: {
        status: "operational",
        attentionRequired: true,
        operatorSummary: "Driving a remote instance.",
        recommendedActions: [],
        host: "0.0.0.0",
        port: 3015,
      },
      posture: {
        highestRisk: "medium",
        pendingApprovals: 1,
        criticalSignals: 0,
        activeAgentsNow: 1,
        activeAgents: 1,
        totalRequests: 6,
      },
      controls: {
        approvalMode: "auto",
      },
      stats: {
        sessionCounts: { paused: 0, terminated: 0 },
      },
      floodGuard: {
        mode: "normal",
        blockedTotal: 0,
        operatorGuidance: {
          status: "recommend",
          summary: "One remote session is warming up.",
          recommendedAction: "Watch it for another minute before tightening controls.",
          hottestSessionId: "session-remote",
          pressure: 0.41,
        },
      },
      freshness: {
        hasLiveActivity: true,
        isFresh: true,
        lastLiveEventAt: new Date().toISOString(),
      },
      priorityQueue: [],
    }, { url: "http://agentwall.local:3015" });

    expect(report).toContain("Control target: http://agentwall.local:3015 (server advertises http://0.0.0.0:3015)");
    expect(report).toContain("agentwall shield --minutes 10 --url http://agentwall.local:3015");
    expect(report).not.toContain("--url http://0.0.0.0:3015");
  });

  it("resolves approval mode from positional or flag input", () => {
    expect(resolveApprovalMode({}, ["always"])).toBe("always");
    expect(resolveApprovalMode({ mode: "never" }, [])).toBe("never");
    expect(() => resolveApprovalMode({}, [])).toThrow("approval mode required");
  });

  // The fetch stubs below declare the URL and init parameters the CLI passes, even though the
  // stub bodies ignore them. toHaveBeenCalledWith is arity checked against the stub's own
  // signature, so a parameterless stub makes the two argument call assertions a type error and
  // the suite stops compiling. Deleting the unused parameters removes the assertions with them.
  it("posts approval mode changes to the live control API", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ mode: "always" }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await commandApprovalMode({ url: "http://127.0.0.1:3000" }, ["always"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/control/approval-mode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "always" }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith("Approval mode set to always · target http://127.0.0.1:3000");
  });

  it("posts session pause controls with operator notes", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ session: { sessionId: "session-42", status: "paused", note: "Hold investigation" } }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await commandSessionControl("pause", { url: "http://127.0.0.1:3000" }, ["session-42", "Hold", "investigation"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/control/session/session-42",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "pause", note: "Hold investigation" }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith("Session session-42 paused · Hold investigation · target http://127.0.0.1:3000");
  });

  it("requires explicit confirmation before terminating a session", async () => {
    await expect(commandSessionControl("terminate", { url: "http://127.0.0.1:3000" }, ["session-42"]))
      .rejects.toThrow("terminate requires --confirm");
  });

  it("posts terminate controls once explicit confirmation is present", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ session: { sessionId: "session-42", status: "terminated", note: "Containment" } }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await commandSessionControl("terminate", { url: "http://127.0.0.1:3000", confirm: true, note: "Containment" }, ["session-42"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/control/session/session-42",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "terminate", confirm: true, note: "Containment" }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith("Session session-42 terminated · Containment · target http://127.0.0.1:3000");
  });

  it("explains how to recover when a live session control targets a missing session", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => JSON.stringify({ error: "Session not found" }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;

    await expect(commandSessionControl("pause", { url: "http://127.0.0.1:3000" }, ["missing-session"]))
      .rejects.toThrow("Seed a live session first with /evaluate or another runtime request");
  });

  it("keeps terminated sessions closed when a resume hits hard containment", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () => JSON.stringify({ error: "Session session-42 is terminated and cannot be resumed. Start a new runtime session instead." }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;

    await expect(commandSessionControl("resume", { url: "http://127.0.0.1:3000" }, ["session-42"]))
      .rejects.toThrow("Hard containment stays closed");
    await expect(commandSessionControl("resume", { url: "http://127.0.0.1:3000" }, ["session-42"]))
      .rejects.toThrow("start a new runtime session instead");
  });

  it("explains how to recover when the CLI targets the wrong Agentwall instance", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => {
      throw new TypeError("fetch failed");
    });
    (global as { fetch?: unknown }).fetch = fetchMock;

    await expect(commandStatus({ url: "http://127.0.0.1:3000" }))
      .rejects.toThrow("Could not reach Agentwall at http://127.0.0.1:3000/api/dashboard/state");
    await expect(commandStatus({ url: "http://127.0.0.1:3000" }))
      .rejects.toThrow("pass --url for the live instance");
    await expect(commandStatus({ url: "http://127.0.0.1:3000" }))
      .rejects.toThrow("http://127.0.0.1:3015");
  });

  it("flags auth-like dashboard errors as likely wrong-target mistakes", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized",
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;

    await expect(commandStatus({ url: "http://127.0.0.1:3000" }))
      .rejects.toThrow("responded with 401 while fetching Agentwall dashboard state");
    await expect(commandStatus({ url: "http://127.0.0.1:3000" }))
      .rejects.toThrow("wrong service or port");
    await expect(commandStatus({ url: "http://127.0.0.1:3000" }))
      .rejects.toThrow("http://127.0.0.1:3015");
  });

  it("prints raw status json when requested", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({
        brand: "Agentwall",
        generatedAt: new Date().toISOString(),
        service: {
          status: "operational",
          attentionRequired: false,
          operatorSummary: "Quiet runtime.",
          host: "127.0.0.1",
          port: 3000,
        },
        posture: {
          highestRisk: "low",
          pendingApprovals: 0,
          criticalSignals: 0,
          activeAgents: 1,
          totalRequests: 4,
        },
        controls: { approvalMode: "auto" },
        stats: { sessionCounts: {} },
        priorityQueue: [],
      }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({ url: "http://127.0.0.1:3000", json: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/state",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer test-operator-token" },
      })
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"brand": "Agentwall"'));
  });

  it("posts shield mode controls with explicit duration", async () => {
    const shieldUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ mode: "shield", shieldUntil }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await commandShield({ url: "http://127.0.0.1:3000", minutes: "5" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/control/floodguard-mode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "shield", durationMs: 300000 }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith(`FloodGuard shield enabled for 5m · until ${shieldUntil} · target http://127.0.0.1:3000`);
  });

  it("returns FloodGuard to normal mode", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ mode: "normal" }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await commandNormal({ url: "http://127.0.0.1:3000" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/control/floodguard-mode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "normal" }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith("FloodGuard normal · target http://127.0.0.1:3000");
  });

  it("posts session boost overrides to the live control API", async () => {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ override: { sessionId: "session-42", multiplier: 2, expiresAt } }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await commandSessionBoost({ url: "http://127.0.0.1:3000", session: "session-42", multiplier: "2", minutes: "15" }, []);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/control/floodguard-session/session-42",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "set", multiplier: 2, durationMs: 900000 }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith(`FloodGuard override set for session-42 ×2 until ${expiresAt} · target http://127.0.0.1:3000`);
  });

  it("clears session overrides from the live control API", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ cleared: true }),
    }));
    (global as { fetch?: unknown }).fetch = fetchMock;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await commandSessionReset({ url: "http://127.0.0.1:3000" }, ["session-42"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/control/floodguard-session/session-42",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "clear" }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith("FloodGuard override cleared for session-42 · target http://127.0.0.1:3000");
  });

  it("keeps the operator token off a target that is not this host's Agentwall", async () => {
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({ url: "http://attacker.example.com:3000", json: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://attacker.example.com:3000/api/dashboard/state",
      expect.objectContaining({ method: "GET" })
    );
    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBeUndefined();
  });

  it("sends the operator token to the configured loopback origin", async () => {
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({ url: "http://127.0.0.1:3000", json: true });

    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBe("Bearer test-operator-token");
  });

  it("keeps the operator token off another loopback address on the configured port", async () => {
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({ url: "http://127.0.0.2:3000", json: true });

    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBeUndefined();
  });
  it("keeps the operator token off an HTTPS loopback alias for an HTTP wildcard bind", async () => {
    const directory = temporaryOperatorDirectory({ host: "0.0.0.0", port: 3000 });
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({
      url: "https://127.0.0.1:3000",
      config: join(directory, "agentwall.config.yaml"),
      json: true,
    });

    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBeUndefined();
  });

  it("keeps the operator token off an unrelated loopback port", async () => {
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({ url: "http://localhost:3001", json: true });

    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBeUndefined();
  });


  it("sends the operator token to the origin the resolved config declares", async () => {
    const directory = temporaryOperatorDirectory({ host: "10.1.2.3", port: 4321 });
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({ url: "http://10.1.2.3:4321", config: join(directory, "agentwall.config.yaml"), json: true });

    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBe("Bearer test-operator-token");
  });

  it("keeps the operator token off another host that shares the configured port", async () => {
    const directory = temporaryOperatorDirectory({ host: "10.1.2.3", port: 4321 });
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.AGENTWALL_OPERATOR_TOKEN = "test-operator-token";

    await commandStatus({ url: "http://10.9.9.9:4321", config: join(directory, "agentwall.config.yaml"), json: true });

    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBeUndefined();
  });

  it("reads the generated operator token from the config directory, not the working directory", async () => {
    const directory = temporaryOperatorDirectory({ host: "127.0.0.1", port: 3000, token: "generated-operator-token" });
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    delete process.env.AGENTWALL_OPERATOR_TOKEN;

    await commandStatus({ config: join(directory, "agentwall.config.yaml"), json: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/dashboard/state",
      expect.objectContaining({ method: "GET" })
    );
    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBe("Bearer generated-operator-token");
  });
  it("does not borrow a current-directory token for an external config", async () => {
    const configuredDirectory = temporaryOperatorDirectory({ host: "10.1.2.3", port: 4321 });
    const workingDirectory = temporaryOperatorDirectory({
      host: "127.0.0.1",
      port: 3000,
      token: "wrong-instance-token",
    });
    const previousDirectory = process.cwd();
    process.chdir(workingDirectory);

    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    delete process.env.AGENTWALL_OPERATOR_TOKEN;

    try {
      await commandStatus({
        url: "http://10.1.2.3:4321",
        config: join(configuredDirectory, "agentwall.config.yaml"),
        json: true,
      });
    } finally {
      process.chdir(previousDirectory);
    }

    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBeUndefined();
  });


  it("names the unreadable operator environment instead of leaking a raw read error", async () => {
    const directory = temporaryOperatorDirectory({ host: "127.0.0.1", port: 3000 });
    // A directory where the file belongs fails the read for every user, including root, so
    // this covers the same escape path as a bad mode without depending on who runs the suite.
    mkdirSync(join(directory, ".agentwall", "operator.env"), { recursive: true });
    const fetchMock = dashboardStateFetch();
    (global as { fetch?: unknown }).fetch = fetchMock;
    delete process.env.AGENTWALL_OPERATOR_TOKEN;

    await expect(commandStatus({ config: join(directory, "agentwall.config.yaml"), json: true }))
      .rejects.toThrow(/generated operator environment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Last on purpose. It asserts the suite's own cleanup, so it needs the tests above to have
  // installed the spies it checks for.
  it("restores every spy between tests", () => {
    expect(jest.isMockFunction(console.log)).toBe(false);
    expect(jest.isMockFunction(console.error)).toBe(false);
    expect(jest.isMockFunction(process.exit)).toBe(false);
  });
});
