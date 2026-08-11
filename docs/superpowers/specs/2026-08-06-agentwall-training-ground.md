# AgentWall training ground specification

**Date:** 2026-08-08  
**Status:** Design for a disposable test harness.  
**Purpose:** Prove AgentWall behavior before a production deployment.

## Design rules

The training ground must use local fixtures and disposable identities.

The training ground must not use customer data, production credentials, live messaging accounts, or a hosted model.

Every scenario must record the command, expected result, observed result, exit status, and evidence path.

A missing log does not count as a pass.

An inferred decision does not count as a pass.

The harness must preserve the clean snapshot and the complete evidence directory.

## Components

| Component | Required behavior |
| --- | --- |
| Clean agent | Runs with one declared identity and no direct production access. |
| Hostile tool server | Returns fixed prompt injection, secret, malformed, and tool-poisoning cases. |
| AgentWall service | Runs the local policy, approval, DLP, MCP, audit, and operator routes. |
| Transparent proxy | Tests the host firewall capture path. |
| Evidence collector | Preserves audit files and fixture logs without changing source bytes. |
| Operator console | Exercises every supported UI and CLI action. |
| Identity service | Optional in the local lab. Required for multi-user scenarios. |
| Policy service | Optional in the local lab. Required for rollout and rollback scenarios. |
| Model fixture | Returns deterministic model responses and deterministic tool calls. |

## Test roles

| Role | Allowed test actions |
| --- | --- |
| Employee | Start an agent and view permitted local status. |
| Administrator | Change policy, manage identities, and start recovery actions. |
| Approver | Approve a declared high-impact action. |
| Auditor | Read evidence and verify the result without mutation rights. |
| Attacker | Attempt bypass, SSRF, prompt injection, tool poisoning, secret access, and role abuse. |

The approver must use an identity that differs from the requester for high-impact tests.

## Test planes

### Network plane

Test HTTP, HTTPS, WebSocket, DNS, private ranges, metadata ranges, redirects, proxy bypass, and direct sockets.

Record the destination, identity tier, policy decision, audit record, and fixture result.

### Agent protocol plane

Test MCP stdio, Streamable HTTP, SSE, and A2A messages.

Test clean inventory, poisoned inventory, malformed frames, hostile tool output, and baseline drift.

The wrapper must block the unsafe frame before the agent consumes it.

### Content plane

Test prompt injection, tool poisoning, secret detection, secret redaction, oversized content, and response inspection.

Record the content decision and the documented visibility limit.

### Identity plane

Test credential issue, credential overlap, revocation, minimum binding tier, UID changes, process-name changes, and unattributed traffic.

A revoked credential must fail in the declared target time.

### Control plane

Test approval queues, approval expiry, self-approval, changed parameters, pause, resume, temporary limits, reset, termination, lockdown, and recovery.

The control plane must record the requester, approver, reason, result, and action parameters.

### Evidence plane

Test hash chaining, rotation, checkpoint signing, independent verification, tampered records, removed records, missing segments, and off-box anchoring.

The harness must show the difference between chained, linked, and anchored results.

### Deployment plane

Test signed policy rollout, last-good policy retention, rollback, container sidecar behavior, admission denial, restart recovery, backup restore, and resource limits.

A policy or evidence service outage must not disable local enforcement.

## Minimum scenario set

1. Allowed model request through the transparent path.
2. Denied host request with no hostile fixture request.
3. Direct bypass denied by the host perimeter.
4. MCP clean inventory allowed.
5. MCP poisoned inventory denied.
6. MCP hostile tool output denied.
7. MCP malformed frame refused with a protocol error.
8. MCP baseline drift refused.
9. Synthetic secret redacted.
10. SSRF private-range and metadata requests denied.
11. WebSocket and A2A messages receive the declared policy decision.
12. Approval requires a separate approver.
13. Credential rotation keeps the declared overlap and rejects the old credential after expiry.
14. Signed policy change applies on two hosts with one active digest.
15. Changed policy bundle is rejected and the last-good bundle remains active.
16. Evidence receipt marks a missing host as incomplete.
17. Tampered evidence fails independent verification.
18. AgentWall restart keeps the last-good policy and evidence path.
19. Backup restore meets the declared recovery objectives.
20. Resource limits stay inside the published test range.

## Evidence contract

Each run must preserve these files:

- `host-preflight.json`
- `guest-fingerprint.json`
- `scenario-results.jsonl`
- `audit.jsonl`
- audit sidecar files and segment manifests
- `openclaw-gateway.log`
- `model-fixture.log`
- `mcp-fixture.log`
- `verification.json`
- `cleanup.json`

The harness must redact tokens, private keys, credentials, full tool arguments, and customer data.

The evidence directory must identify the code revision, policy digest, model fixture digest, and runtime versions.

## Fresh lab findings used by this design

The fresh lab proved that the model path and MCP tool path can work together through AgentWall.

The fresh lab also showed that the runtime needs an agent-owned state path and audit path.

The fresh lab showed that a transparent proxy needs an exact model host, scheme, and port policy.

The fresh lab showed that local gateway replies need an explicit loopback firewall rule.

The fresh lab did not create an off-box anchor. The training ground must include that test before a release claim.

## Exit rule

A training-ground release receives PASS only when every required scenario has a recorded result.

A failed or incomplete scenario blocks the related capability claim.

The harness must report verified behavior, partial behavior, untested behavior, and known limits separately.
