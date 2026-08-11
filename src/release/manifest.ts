import {
  createHash,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, relative, resolve, sep } from "path";
import { loadOrCreateKeys, publicKeyFingerprint } from "../audit/signing";

export const RELEASE_MANIFEST_SCHEMA = "agentwall-release-manifest-v1" as const;
export const RELEASE_MANIFEST_ALGORITHM = "ed25519" as const;
export const RELEASE_MANIFEST_UNSIGNED_ALGORITHM = "none" as const;

export interface ReleaseArtifact {
  name: string;
  sha256: string;
  size: number;
}

export interface UnsignedReleaseManifest {
  schema: typeof RELEASE_MANIFEST_SCHEMA;
  version: string;
  generatedAt: string;
  artifacts: ReleaseArtifact[];
  algorithm: typeof RELEASE_MANIFEST_ALGORITHM | typeof RELEASE_MANIFEST_UNSIGNED_ALGORITHM;
  publicKey: string | null;
}

export interface ReleaseManifest extends UnsignedReleaseManifest {
  signature: string | null;
}

export interface GenerateReleaseManifestOptions {
  artifactDir: string;
  outputPath: string;
  keyPath?: string;
  version: string;
  now?: () => Date;
}

export interface VerifyReleaseManifestOptions {
  manifestPath: string;
  artifactsDir?: string;
  publicKeyPin?: string;
}

export interface ReleaseManifestVerification {
  ok: boolean;
  problems: string[];
  signatureStatus: "verified" | "unsigned" | "invalid";
  verifiedArtifacts: number;
  version?: string;
}

/**
 * Generate a hash manifest for every regular file below `artifactDir`.
 *
 * When `keyPath` is present, the manifest also carries an Ed25519 signature. The private key
 * must stay outside the artifact directory. The output file may be inside the directory because
 * the generator excludes that exact path from the artifact list.
 *
 * A release workflow can omit `keyPath` and bind this inventory to keyless SLSA provenance.
 */
export function generateReleaseManifest(options: GenerateReleaseManifestOptions): ReleaseManifest {
  const artifactDir = resolve(options.artifactDir);
  const outputPath = resolve(options.outputPath);
  const keyPath = options.keyPath ? resolve(options.keyPath) : undefined;
  assertDirectory(artifactDir, "artifact directory");
  const realArtifactDir = realpathSync(artifactDir);
  if (keyPath && !existsSync(keyPath)) {
    throw new Error(`release signing key does not exist: ${keyPath}`);
  }
  const keyIdentity = keyPath ? fileIdentity(keyPath) : undefined;
  if (keyPath && keyIdentity) {
    const realKeyPath = realpathSync(keyPath);
    const outputExists = existsSync(outputPath);
    const realOutputPath = outputExists ? realpathSync(outputPath) : outputPath;
    if (
      outputPath === keyPath
      || realOutputPath === realKeyPath
      || (outputExists && sameFileIdentity(outputPath, keyIdentity))
    ) {
      throw new Error("release manifest output must not overwrite the signing key");
    }
    if (isPathInside(artifactDir, keyPath) || isPathInside(realArtifactDir, realKeyPath)) {
      throw new Error("release signing key must be outside the artifact directory");
    }
  }
  if (!options.version.trim()) {
    throw new Error("release version must not be empty");
  }
  const artifacts = collectArtifacts(artifactDir, outputPath, keyIdentity);
  if (artifacts.length === 0) {
    throw new Error("artifact directory contains no files");
  }

  const keys = keyPath ? loadOrCreateKeys(keyPath) : undefined;
  const unsigned: UnsignedReleaseManifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    version: options.version,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    artifacts,
    algorithm: keys ? RELEASE_MANIFEST_ALGORITHM : RELEASE_MANIFEST_UNSIGNED_ALGORITHM,
    publicKey: keys ? publicKeyFingerprint(keys) : null,
  };
  const signature = keys
    ? cryptoSign(null, releaseManifestPayload(unsigned), keys.privateKey).toString("base64")
    : null;
  const manifest: ReleaseManifest = { ...unsigned, signature };

  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o755 });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

/**
 * Return the base64 DER public key for a release signing key, creating the key if it does not
 * exist. A public key pin is the operator's external trust decision; the manifest's own key only
 * proves that its fields and listed files stayed together.
 */
export function publicKeyForManifest(keyPath: string): string {
  return publicKeyFingerprint(loadOrCreateKeys(resolve(keyPath)));
}

/** Verify the signature and every listed artifact without contacting a service. */
export function verifyReleaseManifest(options: VerifyReleaseManifestOptions): ReleaseManifestVerification {
  const manifestPath = resolve(options.manifestPath);
  const artifactsDir = resolve(options.artifactsDir ?? dirname(manifestPath));
  let manifest: ReleaseManifest;

  try {
    manifest = parseReleaseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch (error) {
    return {
      ok: false,
      problems: [`cannot read release manifest: ${errorMessage(error)}`],
      signatureStatus: "invalid",
      verifiedArtifacts: 0,
    };
  }

  const problems: string[] = [];
  let signatureStatus: ReleaseManifestVerification["signatureStatus"] = "unsigned";
  if (options.publicKeyPin && manifest.publicKey !== null && manifest.publicKey !== options.publicKeyPin) {
    problems.push("release manifest public key does not match the pinned key");
  }
  if (manifest.publicKey === null && manifest.signature === null) {
    if (manifest.algorithm !== RELEASE_MANIFEST_UNSIGNED_ALGORITHM) {
      signatureStatus = "invalid";
      problems.push("unsigned release manifest must use algorithm none");
    }
    if (options.publicKeyPin) {
      problems.push("cannot apply a public key pin to an unsigned release manifest");
    }
  } else if (manifest.publicKey === null || manifest.signature === null) {
    signatureStatus = "invalid";
    problems.push("release manifest must contain both publicKey and signature, or neither");
  } else if (manifest.algorithm !== RELEASE_MANIFEST_ALGORITHM) {
    signatureStatus = "invalid";
    problems.push("signed release manifest must use algorithm ed25519");
  } else {
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(manifest.publicKey, "base64"),
        format: "der",
        type: "spki",
      });
      if (cryptoVerify(
        null,
        releaseManifestPayload(unsignedManifest(manifest)),
        publicKey,
        Buffer.from(manifest.signature, "base64"),
      )) {
        signatureStatus = "verified";
      } else {
        signatureStatus = "invalid";
        problems.push("release manifest signature does not verify");
      }
    } catch (error) {
      signatureStatus = "invalid";
      problems.push(`release manifest signature is malformed: ${errorMessage(error)}`);
    }
  }

  let verifiedArtifacts = 0;
  for (const artifact of manifest.artifacts) {
    let artifactPath: string;
    try {
      artifactPath = safeArtifactPath(artifactsDir, artifact.name);
    } catch (error) {
      problems.push(`${artifact.name}: ${errorMessage(error)}`);
      continue;
    }

    try {
      assertNoSymlinkComponents(artifactsDir, artifactPath);
      const stat = lstatSync(artifactPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        problems.push(`${artifact.name}: artifact is not a regular file`);
        continue;
      }
      const bytes = readFileSync(artifactPath);
      const sizeMatches = stat.size === artifact.size;
      if (!sizeMatches) {
        problems.push(`${artifact.name}: size does not match the release manifest`);
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const hashMatches = hash === artifact.sha256;
      if (!hashMatches) {
        problems.push(`${artifact.name}: sha256 does not match the release manifest`);
      }
      if (sizeMatches && hashMatches) {
        verifiedArtifacts += 1;
      }
    } catch (error) {
      problems.push(`${artifact.name}: cannot read artifact: ${errorMessage(error)}`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    signatureStatus,
    verifiedArtifacts,
    version: manifest.version,
  };
}

/** The exact UTF-8 bytes signed by the release key. Field order is part of the format. */
export function releaseManifestPayload(manifest: UnsignedReleaseManifest): Buffer {
  return Buffer.from(JSON.stringify({
    schema: manifest.schema,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    artifacts: manifest.artifacts,
    algorithm: manifest.algorithm,
    publicKey: manifest.publicKey,
  }), "utf8");
}

function unsignedManifest(manifest: ReleaseManifest): UnsignedReleaseManifest {
  const { signature: _signature, ...unsigned } = manifest;
  return unsigned;
}

type FileIdentity = { dev: number; ino: number };

function fileIdentity(filePath: string): FileIdentity {
  const stats = statSync(filePath);
  return { dev: stats.dev, ino: stats.ino };
}

function sameFileIdentity(filePath: string, identity: FileIdentity): boolean {
  const candidate = fileIdentity(filePath);
  return candidate.dev === identity.dev && candidate.ino === identity.ino;
}

function collectArtifacts(root: string, outputPath: string, signingKeyIdentity?: FileIdentity): ReleaseArtifact[] {
  const paths = walkFiles(root).filter((filePath) => resolve(filePath) !== outputPath);
  return paths
    .map((filePath) => {
      if (signingKeyIdentity && sameFileIdentity(filePath, signingKeyIdentity)) {
        throw new Error(`release signing key must not appear in the artifact directory: ${filePath}`);
      }
      const bytes = readFileSync(filePath);
      return {
        name: relative(root, filePath).split(sep).join("/"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`artifact directory contains unsupported entry: ${entry.name}`);
    }
    files.push(entryPath);
  }
  return files;
}

function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("manifest must be a JSON object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== RELEASE_MANIFEST_SCHEMA) {
    throw new Error(`unsupported manifest schema: ${String(candidate.schema)}`);
  }
  if (typeof candidate.version !== "string" || candidate.version.trim() === "") {
    throw new Error("manifest version must be a non-empty string");
  }
  if (typeof candidate.generatedAt !== "string" || candidate.generatedAt.trim() === "") {
    throw new Error("manifest generatedAt must be a non-empty string");
  }
  if (candidate.algorithm !== RELEASE_MANIFEST_ALGORITHM && candidate.algorithm !== RELEASE_MANIFEST_UNSIGNED_ALGORITHM) {
    throw new Error(`unsupported manifest algorithm: ${String(candidate.algorithm)}`);
  }
  if (candidate.publicKey !== null && (typeof candidate.publicKey !== "string" || candidate.publicKey.length === 0)) {
    throw new Error("manifest publicKey must be null or a non-empty base64 string");
  }
  if (candidate.signature !== null && (typeof candidate.signature !== "string" || candidate.signature.length === 0)) {
    throw new Error("manifest signature must be null or a non-empty base64 string");
  }
  if (!Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) {
    throw new Error("manifest artifacts must be a non-empty array");
  }

  const artifacts = candidate.artifacts.map((value, index) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`manifest artifact ${index} must be an object`);
    }
    const artifact = value as Record<string, unknown>;
    if (typeof artifact.name !== "string" || artifact.name.length === 0) {
      throw new Error(`manifest artifact ${index} name must be a non-empty string`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(artifact.sha256))) {
      throw new Error(`manifest artifact ${index} sha256 must be a lowercase SHA-256 digest`);
    }
    if (typeof artifact.size !== "number" || !Number.isSafeInteger(artifact.size) || artifact.size < 0) {
      throw new Error(`manifest artifact ${index} size must be a non-negative integer`);
    }
    return { name: artifact.name, sha256: String(artifact.sha256), size: artifact.size };
  });

  const manifest: ReleaseManifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    version: candidate.version as string,
    generatedAt: candidate.generatedAt as string,
    artifacts,
    algorithm: candidate.algorithm as typeof RELEASE_MANIFEST_ALGORITHM | typeof RELEASE_MANIFEST_UNSIGNED_ALGORITHM,
    publicKey: candidate.publicKey as string | null,
    signature: candidate.signature as string | null,
  };
  assertSafeArtifactNames(manifest.artifacts);
  return manifest;
}

function assertSafeArtifactNames(artifacts: ReleaseArtifact[]): void {
  const names = new Set<string>();
  for (const artifact of artifacts) {
    if (names.has(artifact.name)) {
      throw new Error(`manifest contains duplicate artifact name: ${artifact.name}`);
    }
    names.add(artifact.name);
    assertSafeArtifactName(artifact.name);
  }
}

function assertSafeArtifactName(name: string): void {
  if (
    isAbsolute(name)
    || /^[A-Za-z]:[\\/]/u.test(name)
    || name.startsWith("\\\\")
    || name.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("artifact path must stay inside the artifact directory");
  }
}

function safeArtifactPath(root: string, name: string): string {
  assertSafeArtifactName(name);
  const resolvedRoot = resolve(root);
  const artifactPath = resolve(resolvedRoot, name);
  if (artifactPath !== resolvedRoot && !artifactPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("artifact path must stay inside the artifact directory");
  }
  return artifactPath;
}

function assertNoSymlinkComponents(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  let current = resolvedRoot;
  for (const component of relative(resolvedRoot, candidate).split(sep)) {
    if (!component) continue;
    current = resolve(current, component);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error("artifact path must not contain symlinks");
    }
  }
}
function assertDirectory(directory: string, label: string): void {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`${label} does not exist: ${directory}`);
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
