# AgentWall enterprise upgrade roadmap

**Date:** 2026-08-08  
**Status:** Planned. AgentWall is not enterprise-ready.  
**Source:** [Enterprise controls](../../enterprise-controls.md) and [enterprise roadmap](../../enterprise-roadmap.md).

## Decision

AgentWall must keep local enforcement on every host.

A central service may distribute policy and collect evidence. It must not sit on the egress hot path.

A service outage must reduce visibility, not remove local protection.

A control moves from Planned to Shipped only after code, operator documentation, and exit evidence pass for one supported release.

## Staged roadmap

### Stage 1: Trust foundation

- **Owner:** Release engineering lead. The security lead approves the trust policy.
- **Threat:** An attacker replaces an artifact, hides a dependency, misuses a key, or causes unsafe resource use.
- **Control:** Sign one manifest for every release asset. Bind the manifest to SBOM data, provenance, source, and release identity. Reproduce the verifier builds. Define key rotation and resource limits.
- **Evidence:** Signed manifest, SBOM files, provenance, build logs, reproduction results, key events, and performance reports.
- **Failure behavior:** The release workflow stops. The prior release remains current.
- **Exit test:** A clean host rejects one changed asset. Clean builds produce identical verifier digests. A rotated key preserves valid checks and rejects the old key. The load test stays inside each published limit.

### Stage 2: Fleet control

- **Owner:** Fleet security administrator.
- **Threat:** An attacker injects policy, keeps a revoked credential, or causes unsafe partial rollout.
- **Control:** Distribute signed, versioned policy bundles. Add a credential authority with issue, rotation, revocation, expiry, and rollback.
- **Evidence:** Policy bundles, signatures, host receipts, active digests, credential events, rollout decisions, and rollback records.
- **Failure behavior:** A host rejects an invalid or expired bundle and keeps the last verified policy. New sessions fail closed after signed state expiry.
- **Exit test:** Two hosts accept one signed bundle, reject a changed bundle, restore an exact prior digest, and reject a revoked credential within the target time.

### Stage 3: Fleet evidence service

- **Owner:** Evidence service owner.
- **Threat:** An attacker deletes evidence, changes a chain, hides a host, or makes incomplete data look clean.
- **Control:** Receive original evidence through an authenticated write-only path. Verify each chain with an independent implementation. Add retention, legal hold, export, freshness, and incomplete states.
- **Evidence:** Original chains, receipts, verification results, retention events, export digests, and service health records.
- **Failure behavior:** Hosts keep local evidence when the service fails. The fleet view reports stale or incomplete data.
- **Exit test:** Three hosts deliver evidence. A changed chain shows FAIL. A missing host shows INCOMPLETE. Recovery accepts queued evidence without a gap.

### Stage 4: Identity and access

- **Owner:** Identity and access administrator.
- **Threat:** A shared token leaks. A user impersonates a host, exceeds permission, or approves a request without separation.
- **Control:** Add OIDC for human operators, mTLS for service identity, RBAC, separate approval, emergency access, and complete principal records.
- **Evidence:** Identity decisions, certificate identities, role checks, approval records, emergency events, and denial records.
- **Failure behavior:** Identity failure never falls back to the shared token. New sessions fail closed. Existing sessions end at normal expiry.
- **Exit test:** The route matrix passes all required allow and deny cases. Invalid claims and certificates fail. High-impact actions fail without a separate approver. An identity outage causes no downgrade.

### Stage 5: Deployment

- **Owner:** Platform engineering lead.
- **Threat:** A workload bypasses AgentWall, runs an unverified image, uses unsafe privileges, or remains broken after an upgrade.
- **Control:** Define a supported sidecar contract. Pin image digests. Add Kubernetes admission checks. Define upgrade compatibility and rollback.
- **Evidence:** Signed manifests, image checks, admission decisions, upgrade reports, rollback records, and compatibility results.
- **Failure behavior:** Admission failure denies new protected workloads. Existing workloads keep local enforcement. A failed upgrade restores the prior image and policy.
- **Exit test:** A conforming workload starts. The same workload fails without the AgentWall path. A forced upgrade fault restores prior image and policy digests. Every decision has evidence.

### Stage 6: Operations and support

- **Owner:** Service operations lead.
- **Threat:** A silent outage delays policy changes, loses evidence, exceeds recovery limits, or leaves operators without a tested response.
- **Control:** Set service objectives, alerts, incident procedures, backup, restore, support, and routine key rotation.
- **Evidence:** SLI reports, alerts, incident exercises, support records, backup manifests, restore results, and key-rotation records.
- **Failure behavior:** Central mutations stop during a control outage. Hosts keep the last verified policy. Evidence stays local during an evidence outage.
- **Exit test:** All stated targets pass for 30 days. An isolated restore meets the 15-minute recovery point and four-hour recovery time objectives. An incident exercise meets the acknowledgment target. Key rotation creates no downgrade or evidence gap.

### Stage 7: Assurance

- **Owner:** Assurance lead. The product security lead owns remediation.
- **Threat:** Internal tests miss design defects, unsafe defaults, privacy risks, or unsupported control claims.
- **Control:** Commission independent security, penetration, and privacy reviews. Publish scope, limits, findings, retests, and a release evidence pack.
- **Evidence:** Review reports, test scope, findings, remediation, retests, privacy decision, and control evidence.
- **Failure behavior:** An open critical or high finding blocks the enterprise release. Missing evidence keeps the control Planned.
- **Exit test:** An independent reviewer assesses the complete release scope, confirms closure of critical and high findings, approves the data flow, and finds current evidence for every enterprise control.

## Current limits

AgentWall currently provides local policy, local identity storage, local audit, local verification, a local operator API, and a container build.

AgentWall currently lacks enterprise OIDC, mTLS, RBAC, a managed credential authority, signed policy distribution, managed evidence receipt, retention, supported Kubernetes admission, enterprise SLOs, and independent review.

The current system must not describe these planned controls as shipped capabilities.

## First implementation order

1. Finish trust foundation and capture proof for onboarding.
2. Add fleet credentials and signed policy distribution.
3. Add independent fleet evidence receipt and retention.
4. Add OIDC, mTLS, RBAC, and separate approval.
5. Define and test the container sidecar.
6. Add Kubernetes admission and rollback.
7. Complete operations, privacy review, and independent security review.

The complete roadmap receives PASS only when all seven stages pass for one supported release line.
