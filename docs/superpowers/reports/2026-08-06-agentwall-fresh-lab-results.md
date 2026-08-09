# AgentWall fresh lab results

**Run dates:** 2026-08-08 through 2026-08-09  
**Status:** The full matrix did not pass. Eleven scenarios passed, three were partial, and one failed.  
**Scope:** Disposable AgentWall and OpenClaw integration lab on VM 102.

## Executive result

The lab proved several important controls and found one containment failure.

AgentWall blocked hostile MCP inventory, hostile tool output, malformed server output, and baseline drift.

AgentWall also enforced approval identity, session controls, lockdown, and audit-chain recovery after restart.

The guest perimeter did not stop a direct model request after proxy removal.

That bypass returned HTTP 200, reached the model fixture, and created no AgentWall network audit record.

The lab therefore does not support an enterprise containment claim.

## Product changes from the lab

The repository now includes these lab-driven fixes:

- The setup command writes a starter policy that loads with an empty host list.
- Control CLI requests use the generated operator token.
- Malformed server output returns JSON-RPC error `-32001` with a null identifier.
- The stdio wrapper keeps valid and malformed events in source order.
- The MCP documentation states the malformed-response behavior.
- Regression tests cover truncated output, mixed valid and malformed output, and the setup policy.

## Lab boundary

The lab used Ubuntu 24.04 on VM 102.

It used no customer data, production credential, hosted model, or live message account.

The first run proved the model and MCP transport paths.

The completion run executed the scenarios that the first run left incomplete.

The durable evidence directories are:

- `/home/reese/agentwall-lab-evidence/lab-20260808/`
- `/home/reese/agentwall-lab-evidence/lab-20260808-completion-final/`

The consolidated matrix is `lab-20260808-completion-final/matrix-summary.json`.

## Scenario matrix

| Scenario | Result | Evidence and limit |
| --- | --- | --- |
| Loopback health | Pass | `loopback-health.json` reports service status `ok`. |
| Allowed model request | Partial | The request used AgentWall, but the transparent audit recorded an unattributed agent. |
| Denied egress | Pass | The strict policy denied `hostile.test` before the fixture received a request. |
| Direct bypass | **Fail** | A direct request returned HTTP 200 and bypassed the AgentWall audit path. |
| Secret redaction | Partial | The authenticated DLP probe redacted the synthetic value. The proxy did not prove request-body rewrite. |
| MCP clean inventory | Pass | The wrapper allowed the clean inventory and tool call. |
| MCP tool poisoning | Pass | The client received an error, and no later poisoned tool call occurred. |
| MCP response injection | Pass | AgentWall replaced the hostile tool result with an error before client use. |
| MCP malformed frame | Pass | AgentWall blocked malformed output and returned the documented protocol error. |
| MCP baseline drift | Pass | A changed descriptor failed against the locked clean baseline. |
| Approval control | Pass | The operator approval returned 200. A forged operator returned 403. |
| Session controls | Pass | Pause, resume, boost, reset, confirmation, termination, and post-termination denial matched the contract. |
| Lockdown | Pass | Engage and release returned 200. The proxy denied the test destination during lockdown. |
| Restart recovery | Pass | The next audit record linked to the previous record after restart. |
| Audit integrity | Partial | Chained and linked checks passed. The anchor check failed because no off-box anchor exists. |

## Verified strengths

1. The MCP wrapper fails closed for the tested poisoned, injected, malformed, and drift cases.
2. The control API rejects a forged approver and enforces terminal session states.
3. Lockdown blocks the tested proxy request and records both state transitions.
4. The local audit chain resumes across restart without an undeclared drop.
5. The repository gates pass after the lab-driven fixes.

## Enterprise blockers

### Direct bypass

Proxy environment variables are not a containment boundary.

The guest perimeter must deny direct agent traffic before onboarding can claim capture.

Onboarding must test a planted direct bypass and refuse success when that request reaches its destination.

### Transparent identity

The transparent path recorded the model request without the declared `openclaw` identity.

Enterprise use needs a strong identity binding or a mandatory alert for unattributed traffic.

### Secret redaction scope

The completion run proved the authenticated DLP probe.

It did not prove that the forward proxy rewrites a request body before delivery.

Public wording must keep this distinction.

### Evidence anchoring

The local chain detects edits inside the stored segment.

It cannot prove that an operator did not replace the complete local evidence set.

A production release needs an off-box receipt and a pinned trust key.

## Repository verification

The final working tree passed this gate:

```text
npm run build && npm test && node scripts/check-public-copy.js && git diff --check HEAD
```

Observed results:

- 85 test suites passed.
- 1,377 tests passed.
- The public-copy check passed for 34 files.
- The diff check returned no error.

The focused MCP regression also passed:

```text
npm test -- tests/mcp-stdio.test.ts -t "truncated response|wire order"
```

Two focused tests passed.

## Evidence retention and cleanup

The local completion directory contains the final scenario artifacts and a consolidated matrix.

VM 102 is stopped.

The snapshot `lab-20260808-evidence` contains the pre-completion evidence state.

The durable local copy contains the later completion evidence.

No lab service remains active on VM 102.

## Product decision

AgentWall is ready for continued hardening and controlled lab use.

It is not ready for an enterprise containment claim.

The highest-priority fix is a fail-closed host perimeter with a planted bypass proof during onboarding.

The next priorities are transparent identity, off-box evidence receipts, and precise DLP transport claims.

## Reasoning ledger

### Objective and stakes

The objective was to finish the lab, preserve proof, correct product defects, and update the repository without overstating security.

This work is high-stakes because it affects a security product and public claims.

### Assumptions and contradictions

| Assumption | Verification | Result |
| --- | --- | --- |
| The first report described final status. | Compared it with the completion evidence. | False. The report still marked eleven scenarios incomplete. |
| The completion evidence was preserved locally. | Checked both durable evidence directories. | False before repair. The final evidence existed only on VM 102. |
| VM 102 was stopped. | Queried Proxmox with `qm status 102`. | False before repair. The VM was running with no lab service. |
| The full matrix passed. | Compared every scenario with the written acceptance criteria. | False. One failed and three were partial. |

### Plan and results

1. Locate the final VM evidence. Result: 108 artifacts existed in the completion directory.
2. Copy the completion evidence to durable local storage. Result: the local copy now exists.
3. Compare each scenario with the original acceptance criteria. Result: eleven pass, three partial, and one fail.
4. Correct this repository report. Result: the stale incomplete status is removed.
5. Stop the idle lab VM. Result: Proxmox reports `status: stopped`.
6. Run repository gates. Result: all listed gates passed.

### Adversarial checks

| Conclusion | Strongest counter-hypothesis | Result | Evidence |
| --- | --- | --- | --- |
| Direct bypass failed containment. | The request still passed through AgentWall. | Rejected. | The fixture count increased while the AgentWall network count did not. |
| Secret redaction fully passed. | Only the probe path performed redaction. | Confirmed. | The preserved result came from the authenticated DLP probe. |
| Audit verification fully passed. | The chain lacked an off-box anchor. | Confirmed. | `control-audit-verify.txt` reports an anchor failure. |
| The earlier final report was current. | Later evidence changed the matrix. | Confirmed. | The completion directory contains the later scenario results. |

### Success criteria

- [x] Every planned scenario has a recorded result.
- [x] The final evidence has a durable local copy.
- [x] The repository report states the failed and partial controls.
- [x] The malformed MCP behavior has regression coverage.
- [x] The full repository gate passes.
- [x] VM 102 is stopped.
- [ ] The full security matrix passes.

### Escalation note

No scarce architect tier was required.

The live evidence and an independent code review exposed the important contradictions.
