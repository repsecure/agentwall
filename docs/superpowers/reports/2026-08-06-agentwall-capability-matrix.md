# AgentWall capability matrix

**Date:** 2026-08-08  
**Purpose:** Record the public capability classes, current limits, and upgrade targets.

This matrix uses simple public wording. It contains no competitor name or competitor URL.

A private market review informed the target classes. This file records only AgentWall behavior and evidence.

## Current capability matrix

| Capability class | Current behavior | Evidence | Current limit | Upgrade target |
| --- | --- | --- | --- | --- |
| Setup | The CLI creates local operator files and starter policy files. | `docs/onboarding.md` and setup tests | The operator must protect the local files. | Add signed setup bundles and a guided recovery path. |
| Operator control | The UI and CLI expose the same supported control actions. | `docs/operator-guide.md` and UI route tests | One local bearer token represents the operator. | Add OIDC, roles, and separate approval identity. |
| Egress policy | AgentWall applies host, scheme, port, and budget rules. | `docs/enforcement.md` and policy tests | Capture can fail if a runtime bypasses the configured path. | Make onboarding refuse success until capture proof passes. |
| Transparent capture | The Linux perimeter redirects selected agent traffic to AgentWall. | Perimeter tests and fresh lab evidence | The transparent path can record an unattributed agent. | Add stronger host identity and explicit unattributed alerts. |
| Agent identity | The runtime can bind requests to a credential, UID, process name, or no identity. | `docs/fleet.md` and fleet tests | UID and process-name identity remain local and weak. | Require a credential tier for enterprise use. |
| MCP | The wrapper supports stdio, Streamable HTTP, and SSE paths. | `docs/mcp.md` and MCP test suites | MCP output remains subject to the documented inspection limits. | Add signed tool inventories and fleet-wide baseline management. |
| Prompt injection | The content path checks tool descriptors and tool results for hostile instructions. | `docs/mcp.md`, injection tests, and audit records | Content inspection has size and transport limits. | Add policy packs for application-specific tool trust. |
| Secret handling | The DLP path detects and redacts supported secret patterns. | `docs/decoy.md`, DLP tests, and benchmark data | HTTPS body inspection needs explicit interception. | Add managed certificate trust and stronger coverage reports. |
| SSRF control | The egress path checks host and private-range rules. | `docs/limits.md` and SSRF tests | DNS and protocol edge cases remain stated limits. | Add resolver binding and independent DNS evidence. |
| Evidence | AgentWall writes a hash chain, rotates segments, and verifies records. | `docs/verification.md`, verifier corpus, and lab logs | Local evidence has no managed receipt or retention service. | Add immutable receipt, retention, legal hold, and export. |
| Independent verification | Go, Rust, Python, and TypeScript verifiers share a conformance corpus. | `docs/verification.md` and conformance workflow | Internal agreement is not an external security review. | Add independent review and a pinned enterprise trust key. |
| Sandboxing | Landlock and seccomp controls limit supported Linux workloads. | `docs/sandbox.md` and sandbox tests | Non-Linux and container paths need separate deployment designs. | Ship a tested sidecar and deployment contract. |
| Fleet control | A local fleet view can inspect operator-delivered evidence. | `docs/fleet-evidence.md` and fleet tests | The repository has no managed policy or evidence service. | Add signed policy distribution and read-only evidence receipt. |
| Release trust | The release workflow creates checksums, SBOM data, provenance, and a signed image digest. | Release workflow and supply-chain tests | One signed manifest does not cover every release asset. | Sign one complete release manifest. |

## Capability strength rules

- A behavior is **shipped** only when the repository implements it.
- A behavior is **verified** only when a test or lab record proves it.
- A behavior is **partial** when a documented limit remains.
- A behavior is **planned** when the repository does not provide the required control.

AgentWall must not use a planned control in a public shipped feature list.

## Priority upgrade order

1. Prove capture during onboarding.
2. Add fleet credential issue, rotation, and revocation.
3. Add signed policy distribution and rollback.
4. Add immutable fleet evidence receipt and retention.
5. Add OIDC, mTLS, RBAC, and separate approval.
6. Add supported container and Kubernetes deployment controls.
7. Complete independent security and privacy review.

See [enterprise controls](../../enterprise-controls.md) and [the enterprise roadmap](../../enterprise-roadmap.md) for the complete exit tests.
