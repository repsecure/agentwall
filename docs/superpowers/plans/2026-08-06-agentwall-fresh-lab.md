# AgentWall Fresh Lab Implementation Plan

**Date:** 2026-08-06  
**Status:** Approved by the project owner  
**Scope:** Build and exercise a disposable AgentWall and OpenClaw integration lab on Proxmox.

## Goal

Create a clean, repeatable test environment that proves AgentWall behavior from installation through agent operation. The lab must show what AgentWall observes, allows, blocks, records, and cannot observe.

The lab does not use production credentials, customer data, live messaging accounts, or a hosted model. It uses local fixtures and a deterministic local model endpoint.

## Architecture

```text
Proxmox host
└── VM 100: current workstation
    └── LAB_VMID: new Ubuntu 24.04 guest
        ├── OpenClaw Gateway on loopback port 18789
        ├── AgentWall service and bootstrap UI on loopback ports 3000 and 3001
        ├── AgentWall forward proxy on port 3128
        ├── deterministic model fixture on port 4010
        ├── MCP fixture and AgentWall stdio wrapper
        └── evidence under /var/lib/agentwall-lab/evidence
```

The guest starts with its network adapter disconnected. The operator connects it only after the Proxmox firewall and guest firewall rules are active. The guest permits only the package and loopback routes required for the experiment. The guest blocks direct access to private and metadata ranges from the agent workload.

## Evidence contract

Each run stores these files under `/var/lib/agentwall-lab/evidence/<run-id>/`:

- `host-preflight.json`: Proxmox version, storage capacity, guest inventory, and selected VM ID.
- `guest-fingerprint.json`: guest image digest, kernel, Node version, OpenClaw version, AgentWall commit, and firewall state.
- `scenario-results.jsonl`: one result per scenario with command, exit status, expected result, observed result, and evidence path.
- `audit.jsonl` and all AgentWall sidecar evidence files.
- `openclaw-gateway.log`, `model-fixture.log`, and `mcp-fixture.log`.
- `cleanup.json`: stopped services, retained snapshot, and any failed cleanup operation.

The evidence excludes tokens, private keys, model credentials, user data, and full tool arguments. Evidence commands redact those values before they enter a report.

## Global constraints

1. Use a new disposable guest. Do not clone or reuse the existing client workload.
2. Use a temporary lab SSH key. Do not copy an operator key into the guest.
3. Use loopback-only control services unless a test requires another interface.
4. Use monitor mode for the first capture proof, then test guarded and strict modes separately.
5. Do not set `NO_PROXY` for the test runtime.
6. Treat a direct egress path as a test failure, not as a configuration shortcut.
7. Keep public documentation simple, professional, and compliant with ASD-STE100.
8. Keep competitor names and competitor URLs out of public repository content.
9. Do not call a mechanism proven until the lab records the end-to-end result.
10. Never delete a VM, snapshot, evidence directory, or source checkout without explicit approval.

## Task 1: Run Proxmox preflight

**Files and artifacts**

- Create `/tmp/agentwall-lab/host-preflight/host-preflight.json` on VM 100.
- Create `/tmp/agentwall-lab/host-preflight/route.txt` with the operator route used.

**Steps**

1. Use the approved Proxmox operator route, not the production workload route.
2. Record `pveversion --verbose`, `pvesh get /nodes`, `pvesh get /cluster/resources`, `qm list`, `pvesm status`, and `qm config 100`.
3. Confirm that VM 100 is the current workstation and that VM 101 remains untouched.
4. Confirm free CPU, memory, and storage for 2 vCPU, 4 GiB memory, and a 32 GiB guest disk.
5. Select the first unused numeric VM ID from `qm list` and record it as `LAB_VMID` in the evidence file.
6. Stop if the operator route cannot create, start, inspect, and stop a new VM.

**Verification**

The preflight file contains a reachable Proxmox node, an unused `LAB_VMID`, usable storage, and no production credential material.

## Task 2: Provision the isolated Ubuntu guest

**Files and artifacts**

- Create `/tmp/agentwall-lab/host-preflight/noble-server-cloudimg-amd64.img` on the Proxmox host.
- Create a temporary cloud-init user-data file with mode `0600`.
- Create VM `LAB_VMID` with the name `agentwall-lab`.

**Steps**

1. Download the official Ubuntu 24.04 cloud image and its official SHA-256 manifest.
2. Run `sha256sum --ignore-missing --check` before importing the image.
3. Create the VM with 2 vCPU, 4096 MiB memory, QEMU guest agent support, and a 32 GiB thin-provisioned disk.
4. Attach a cloud-init drive and a temporary SSH public key.
5. Create the dedicated `agentwall-agent` user with a fixed lab-only UID, no login shell, and no host key.
6. Configure one VirtIO NIC with Proxmox firewall support and `link_down=1`.
7. Set `onboot=0` and boot only from the imported system disk.
8. Start the VM with the NIC disconnected.
9. Wait for the guest agent, record `qm guest exec` output, and create the `clean-os` snapshot.

**Verification**

`qm config LAB_VMID` shows the requested resources, the guest agent responds, the NIC remains disconnected, and the `clean-os` snapshot exists.

## Task 3: Apply network isolation before connection

**Files and artifacts**

- Create the Proxmox guest firewall rules for `LAB_VMID`.
- Create `/etc/nftables.conf` in the guest.
- Create `/var/lib/agentwall-lab/evidence/firewall-plan.txt` and `firewall-status.txt`.

**Steps**

1. Set the Proxmox firewall policy to deny inbound traffic and allow only the operator management path.
2. Allow outbound DNS and HTTPS only for the package installation window.
3. Deny RFC1918, loopback aliases, link-local, and cloud metadata destinations from the `agentwall-agent` UID.
4. Apply the guest nftables rules before reconnecting the NIC.
5. Verify that the firewall parser accepts the rules and that the default policy is active.
6. Reconnect the NIC with the complete, known `net0` definition.
7. Test package access, loopback access, a private-range destination, and the metadata address as `agentwall-agent`.

**Verification**

The guest reaches approved package sources. The guest does not reach private-range or metadata destinations. The operator can still use the approved management path.

## Task 4: Install the guest base system

**Files and artifacts**

- Create `/var/lib/agentwall-lab/evidence/<run-id>/guest-fingerprint.json`.
- Create `/var/lib/agentwall-lab/evidence/<run-id>/base-install.log`.

**Steps**

1. Install Git, CA certificates, build tools, Python 3, jq, nftables, and process utilities.
2. Download Node.js 24.15.0 and its official SHA-256 manifest.
3. Verify the Node.js archive before extraction.
4. Install Node.js under `/opt/node-v24.15.0` and expose it through `/usr/local/bin`.
5. Confirm Node.js, npm, Git, Python, and nftables versions.
6. Disable cloud-init only after the first successful boot and package setup.
7. Record the guest hostname, kernel, architecture, mount table, route table, and active firewall state.

**Verification**

The guest reports Node.js 24.15.0 or the exact approved patch version from the official release manifest. Package installation succeeds without a private-network exception.

## Task 5: Install and isolate OpenClaw

**Files and artifacts**

- Create `/opt/agentwall-lab/openclaw-state/`.
- Create `/opt/agentwall-lab/openclaw-config.json5` with mode `0600`.
- Create `/var/lib/agentwall-lab/evidence/<run-id>/openclaw-install.log`.

**Steps**

1. Install the pinned OpenClaw release from the official package source.
2. Record the exact installed version and package integrity data.
3. Set `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` to the lab paths.
4. Configure a loopback Gateway on port 18789 with a random temporary Gateway token.
5. Configure one OpenAI-compatible provider named `lab-model` with base URL `http://model.test:4010/v1`, API `openai-completions`, and model ID `agentwall-test-model`.
6. Set `request.allowPrivateNetwork` only for the exact fixture origin.
7. Configure one stdio MCP server through `agentwall mcp wrap`, with server name `lab-tools` and agent ID `openclaw`.
8. Start the Gateway with `openclaw gateway --port 18789`.
9. Verify `openclaw gateway status --require-rpc`, `openclaw status`, and `openclaw mcp doctor lab-tools --probe`.

**Verification**

The Gateway runs on loopback, the provider points to the deterministic fixture, the wrapped MCP server responds, and no hosted provider credential exists in the guest.

## Task 6: Build and configure AgentWall

**Files and artifacts**

- Clone AgentWall into `/opt/agentwall-lab/agentwall-src` at the approved `integration/phase1` commit.
- Create `/opt/agentwall-lab/agentwall-work/agentwall.config.yaml`.
- Create `/opt/agentwall-lab/agentwall-work/policy.yaml`.
- Create `/opt/agentwall-lab/agentwall-work/.agentwall/operator.env` with mode `0600`.
- Create `/var/lib/agentwall-lab/evidence/<run-id>/agentwall-build.log`.

**Steps**

1. Clone the repository without copying any host credentials.
2. Run `npm ci`, `npm run build`, and the repository test command.
3. Install the package from the local build so the `agentwall` command uses the tested commit.
4. Run `agentwall setup --mode monitor` in the lab work directory.
5. Run `agentwall onboard openclaw --json --allow model.test` and keep the returned secret only in the current process environment.
6. Set `AGENTWALL_PROXY_PORT=3128`, `AGENTWALL_AUDIT_FILE=/var/lib/agentwall-lab/evidence/<run-id>/audit.jsonl`, and the generated OpenClaw proxy variables.
7. Start AgentWall and verify `/health`, `/ready`, `agentwall status --json`, and the bootstrap UI.
8. Run `agentwall verify-capture --agent openclaw --json` before any other scenario.

**Verification**

The build and repository tests pass. The OpenClaw credential is stored only as a digest. The proxy listens on port 3128. The first capture proof exits with status `0` and reports credential binding.

## Task 7: Create deterministic local fixtures

**Files and artifacts**

- Create `/opt/agentwall-lab/fixtures/model-server.js`.
- Create `/opt/agentwall-lab/fixtures/mcp-server.js`.
- Create `/opt/agentwall-lab/fixtures/hostile-http-server.js`.
- Create `/opt/agentwall-lab/fixtures/case-files/` with clean, poisoned, secret, malformed, and drift responses.

**Steps**

1. Implement an OpenAI-compatible `/v1/models` and `/v1/chat/completions` server.
2. Make the model server return deterministic text, one permitted tool call, and one controlled hostile tool call.
3. Implement a newline-delimited JSON-RPC MCP server with `initialize`, `tools/list`, and `tools/call`.
4. Make the MCP server expose one clean tool, one tool with an instruction override, and one tool that returns a prompt injection.
5. Make the hostile HTTP server record whether it receives a request and return a fixed response.
6. Bind all fixtures to loopback and map `model.test`, `hostile.test`, and `mcp.test` to loopback in `/etc/hosts`.
7. Keep fixture logs separate from AgentWall audit files.

**Verification**

Each fixture returns the same bytes on every run. The hostile server shows no request when AgentWall blocks the route.

## Task 8: Run the end-to-end scenario matrix

**Files and artifacts**

- Create `/var/lib/agentwall-lab/evidence/<run-id>/scenario-results.jsonl`.
- Create `/var/lib/agentwall-lab/evidence/<run-id>/commands/` with redacted command records.

**Scenarios**

1. **Loopback health:** AgentWall and OpenClaw health checks return success.
2. **Allowed model request:** OpenClaw sends one model request through AgentWall. The fixture receives it, AgentWall records it, and the audit record names `openclaw`.
3. **Denied egress:** The agent proxy requests `hostile.test`. AgentWall denies the destination and the hostile fixture records no request.
4. **Direct bypass:** Remove the proxy variables for one agent process. The guest perimeter denies the destination. A direct success is a failure.
5. **Secret redaction:** Send a synthetic credential through an inspected request. The response and audit record omit the original value.
6. **MCP clean inventory:** The wrapped server returns the clean descriptor and the client receives it.
7. **MCP tool poisoning:** The wrapped server returns a descriptor with an instruction override. AgentWall denies it and the server does not receive a later call based on it.
8. **MCP response injection:** The server returns hostile tool output. AgentWall denies the response before OpenClaw consumes it.
9. **MCP malformed frame:** Send invalid JSON-RPC. AgentWall returns the documented protocol error and does not forward the bytes.
10. **MCP baseline drift:** Learn a clean inventory, lock it, alter one descriptor field, and confirm the changed inventory fails closed.
11. **Approval control:** Set `agentwall approval-mode always`, submit a high-risk control request, confirm the queue record, then respond through the approved operator route.
12. **Session controls:** Exercise pause, resume, temporary limit boost, reset, and explicit termination confirmation.
13. **Lockdown:** Engage and release the safety shield. Confirm both transitions appear in the audit chain.
14. **Restart recovery:** Stop and restart AgentWall and OpenClaw. Confirm the last-good policy and evidence path remain active.
15. **Audit integrity:** Run `agentwall verify --audit ...` and the independent verifier against the same evidence.

**Verification**

Every scenario produces a pass or a named failure. No scenario receives a pass from a missing log, an absent fixture request, or an inferred decision.

## Task 9: Record business deployment observations

**Files and artifacts**

- Create `docs/superpowers/reports/2026-08-06-agentwall-fresh-lab-results.md`.
- Create `docs/superpowers/reports/2026-08-06-agentwall-capability-matrix.md`.

**Steps**

1. Summarize installation time, operator actions, required privileges, resource use, recovery steps, and common failure messages.
2. State the simplest supported path for a non-technical operator.
3. Separate verified behavior, partial behavior, untested behavior, and known limits.
4. Compare AgentWall capability classes against the competitor's published feature surface in a private matrix.
5. Describe stronger AgentWall behavior only when the fresh lab proves it.
6. Keep competitor names and URLs out of public docs and README content.
7. Rewrite any new public text in ASD-STE100 and use one term for one meaning.

**Verification**

The results report links every claim to a local evidence file or labels it as an unresolved question. The capability matrix contains no public link to the competitor.

## Task 10: Design the training ground and enterprise upgrade path

**Files and artifacts**

- Create `docs/superpowers/specs/2026-08-06-agentwall-training-ground.md`.
- Create `docs/superpowers/reports/2026-08-06-agentwall-enterprise-roadmap.md`.

**Training-ground scope**

Define a separate test harness with one clean agent, one hostile tool server, one AgentWall process, one evidence collector, one operator console, and optional identity and policy services. Define test roles for an employee, an administrator, an approver, an auditor, and an attacker.

The harness must cover HTTP, WebSocket, MCP, A2A, prompt injection, SSRF, tool poisoning, DLP, signed evidence, credential rotation, approval separation, policy rollout, rollback, rate limits, containment, and recovery.

**Enterprise roadmap scope**

Document staged upgrades for:

- multi-user identity and RBAC;
- separate approval authority;
- mTLS and service identity;
- fleet credential issue, rotation, and revocation;
- signed policy distribution and rollback;
- immutable evidence receipt, retention, and legal hold;
- SBOM, signed releases, and reproducible verifier builds;
- container sidecar and Kubernetes admission controls;
- deployment rollback and recovery objectives;
- independent security and privacy review;
- measured performance, support, and service objectives.

Each stage must define an owner, threat, control, evidence, failure behavior, and binary exit test.

**Verification**

The training-ground specification uses the fresh lab findings. The enterprise roadmap states limits and does not claim enterprise readiness before the required controls and independent review exist.

## Task 11: Run advisor and final gates

**Commands**

```bash
gbrain advisor
npm run build
npm test
node scripts/check-public-copy.js
```

Run `gbrain advisor` from the AgentWall checkout. Review every actionable finding. Fix repository findings that this work introduced. Record unrelated brain findings separately without changing unrelated pages.

**Verification**

The final evidence packet includes the advisor output, build output, test output, public-copy result, scenario result summary, and cleanup state. The final report states the exact commands and exit statuses.

## Cleanup

1. Stop fixture processes, OpenClaw, and AgentWall.
2. Preserve the `clean-os` snapshot and the complete evidence directory.
3. Stop the lab VM without deleting it.
4. Record the VM ID, snapshot name, evidence path, and next approved action.
5. Do not delete or reuse the VM until the project owner approves the next lab phase.
