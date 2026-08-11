# AgentWall Fresh Lab Design

- **Status:** Approved by the project owner
- **Date:** 2026-08-06
- **Scope:** A disposable AgentWall and OpenClaw integration lab on Proxmox
- **Primary result:** A repeatable test environment with recorded evidence

## 1. Purpose

Create a clean environment that tests AgentWall from installation through agent operation.

The lab must show where AgentWall observes, allows, blocks, records, and cannot observe agent actions.

The lab must not use production credentials, client data, wallet data, or billable model calls.

The lab must produce a test report that supports business deployment decisions.

## 2. Scope

The first lab includes:

- One new Ubuntu Server 24.04 LTS virtual machine.
- One OpenClaw Gateway instance.
- One AgentWall instance from the `integration/phase1` branch.
- One deterministic local OpenAI-compatible test model.
- One local MCP test server.
- One local hostile-tool test server.
- AgentWall service, bootstrap UI, forward proxy, and audit path.
- OpenClaw Gateway health and capture checks.
- Network, MCP, policy, approval, credential, budget, and audit tests.
- A business deployment observation report.

The first lab does not include:

- Production provider credentials.
- External messaging credentials.
- Production network access.
- Client data.
- VM 101 or any client workload.
- Public deployment.
- Automatic policy changes.
- A central fleet control plane.
- A claim that the lab proves full production coverage.

## 3. Recommended VM design

Create a new VM. Do not clone or reuse VM 101.

| Resource | Value |
|---|---|
| Guest OS | Ubuntu Server 24.04 LTS, x86-64 |
| vCPU | 2 |
| RAM | 4 GiB fixed, no ballooning |
| Disk | 32 GiB thin volume on `local-lvm` |
| Network | Disconnected during initial setup |
| Initial services | Loopback only |
| SSH | Dedicated temporary lab key |

The independent Proxmox operator route must confirm an unused VMID before creation.

The operator must confirm host memory and thin-pool headroom before disk allocation.

The lab firewall must deny access to the LAN, Proxmox, VM 100, VM 101, and private networks.

The lab firewall may allow DNS, package sources, test targets, and one operator path.

The lab must not receive existing SSH keys, tokens, cookies, environment files, or backup data.

## 4. Service layout

| Component | Bind address | Port |
|---|---|---:|
| AgentWall service | `127.0.0.1` | 3000 |
| AgentWall bootstrap UI | `127.0.0.1` | 3001 |
| AgentWall forward proxy | `127.0.0.1` | 3128 |
| OpenClaw Gateway | `127.0.0.1` | 18789 |
| Local test model | `127.0.0.1` | 4010 |
| MCP test listeners | `127.0.0.1` | Ephemeral |

The test model uses a local hostname mapped to loopback.

The OpenClaw process must use AgentWall proxy variables during capture tests.

The capture tests must clear both `NO_PROXY` and `no_proxy`.

TLS interception remains disabled in the first lab pass.

## 5. Software setup

Install Node.js 24.15 or newer.

This runtime meets the current OpenClaw and AgentWall runtime requirements.

Install Git, npm, Python 3, a C compiler, and standard certificate packages.

Install OpenClaw at one recorded version and pin that version in the lab report.

Clone AgentWall from the `integration/phase1` branch at commit `b156e11`.

Use `npm ci` for the AgentWall source checkout.

Run `npm run build` before the service test.

Use the AgentWall bootstrap path first:

```text
agentwall ui
Setup
Start service
Open the authenticated dashboard
```

Use the direct CLI path only for a separate repeatability check.

## 6. Test stages

### Stage A: Guest and supply-chain baseline

Record the guest image digest, kernel, CPU, memory, disk, firewall rules, Node version, npm version, OpenClaw version, AgentWall commit, and package lock digest.

Reject the test if any production credential or client file enters the guest.

### Stage B: Installation and health

Run the AgentWall setup path in monitor mode.

Confirm the expected configuration files and protected file modes.

Confirm the AgentWall health endpoint.

Confirm the OpenClaw Gateway health and readiness endpoints.

Confirm the operator dashboard requires authentication.

### Stage C: Agent capture

Run AgentWall onboarding for the OpenClaw identity.

Run `agentwall verify-capture --agent openclaw`.

Require an exit code of zero and a credential binding.

Run one deterministic OpenClaw turn against the local test model.

Confirm that the audit chain records the OpenClaw identity and destination.

### Stage D: Network policy

Test a clean request through the forward proxy.

Test a denied destination in guarded mode.

Test an unlisted destination in strict mode.

Test a secret in a URL and request body.

Test a direct request that bypasses proxy variables.

Record direct bypass as a coverage limit if AgentWall cannot observe it.

### Stage E: MCP protection

Run a clean MCP server through the stdio wrapper.

Run a clean MCP server through the HTTP wrapper.

Test malformed JSON-RPC frames.

Test invalid tool inventory pages.

Test tool description injection.

Test tool schema changes and inventory drift.

Test secrets in tool arguments.

Test prompt injection in tool results and errors.

Test blocked frames and audit records.

Verify that blocked inventories do not become baselines.

### Stage F: Operator controls

Test monitor, guarded, and strict policy modes.

Test automatic, always-approve, and never-approve behavior.

Test session pause, resume, reset, boost, and termination controls.

Test agent credential issue, rotation, and revocation.

Test per-agent destinations and budget limits.

Test a service restart during active audit collection.

Test a control-service outage and record the safe state.

### Stage G: Evidence verification

Run the bundled TypeScript verifier.

Run the independent Go verifier.

Run the independent Rust verifier.

Run the independent Python verifier.

Alter a copy of the audit chain and require every verifier to reject it.

Record the difference between chain integrity and record completeness.

## 7. Acceptance criteria

The lab passes only when all required results have evidence.

- A clean VM starts with no production or client data.
- AgentWall installs from the pinned source commit.
- OpenClaw starts at the recorded version.
- AgentWall health and OpenClaw readiness return success.
- AgentWall proves capture for the OpenClaw identity.
- One deterministic agent turn produces an attributed audit record.
- Each required allow and deny case produces the expected result.
- Each required MCP attack case receives the expected result.
- Direct bypass remains visible as a stated limit.
- All independent verifiers agree on clean evidence.
- All independent verifiers reject altered evidence.
- Every failed case appears in the final report.

A missing result is not a pass.

A simulated result is not a pass.

## 8. Business deployment observations

The final report must classify each control as `works`, `partial`, `fails`, or `not tested`.

The report must cover these operating models:

1. One user with one local agent.
2. Several agents on one host.
3. Agents with different tool and network permissions.
4. Human approval for high-impact actions.
5. Credential rotation and revocation.
6. Policy rollout and rollback.
7. Evidence export and retention.
8. SIEM or alert delivery.
9. Control-service outage.
10. Host replacement and recovery.

The report must state which controls require a future central service.

The report must not describe planned controls as shipped controls.

## 9. Training-ground follow-up

The next phase creates a separate scenario harness.

The harness will contain an agent, a clean tool server, a hostile tool server, an evidence collector, and an operator console.

Each scenario will define an input, an expected decision, an expected audit record, and a cleanup step.

The harness will support repeatable runs for network, MCP, identity, policy, approval, budget, outage, and recovery scenarios.

A later enterprise design may add signed policy distribution, fleet identity, role separation, managed evidence receipt, revocation delivery, deployment admission, backup, restore, and service objectives.

Those controls remain planned until their code, documentation, and evidence pass a defined exit test.

## 10. Cleanup

The lab must use temporary credentials and temporary external registrations only.

Before VM deletion, revoke test credentials and remove test registrations.

The operator must verify the VMID, disks, snapshots, firewall objects, DNS entries, and backup artifacts.

Delete the guest only after the evidence report is copied to the approved project location.

A human must approve destructive VM deletion.

## 11. Sources

- [AgentWall installation guide](https://github.com/repsecure/agentwall/blob/integration/phase1/docs/install.md)
- [AgentWall onboarding guide](https://github.com/repsecure/agentwall/blob/integration/phase1/docs/onboarding.md)
- [OpenClaw installation guide](https://docs.openclaw.ai/install)
- [OpenClaw Gateway guide](https://docs.openclaw.ai/gateway)
- [OpenClaw local model guide](https://docs.openclaw.ai/gateway/local-models)
