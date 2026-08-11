import { afterEach, describe, expect, it } from "@jest/globals";
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  generateReleaseManifest,
  publicKeyForManifest,
  verifyReleaseManifest,
} from "../src/release/manifest";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentwall-release-manifest-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

describe("release manifest", () => {
  it("generates a signed manifest and verifies every artifact", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const keyPath = join(root, "release-key.pem");
    const manifestPath = join(artifacts, "release-manifest.json");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "z-last.txt"), "last\n");
    writeFileSync(join(artifacts, "a-first.txt"), "first\n");

    publicKeyForManifest(keyPath);
    const manifest = generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: manifestPath,
      keyPath,
      version: "9.9.9",
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(manifest.artifacts.map((artifact) => artifact.name)).toEqual(["a-first.txt", "z-last.txt"]);
    expect(manifest.publicKey).toBe(publicKeyForManifest(keyPath));
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
    expect(verifyReleaseManifest({ manifestPath, artifactsDir: artifacts })).toEqual({
      ok: true,
      problems: [],
      signatureStatus: "verified",
      verifiedArtifacts: 2,
      version: "9.9.9",
    });
  });

  it("reports an artifact hash mismatch after a release file changes", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const keyPath = join(root, "release-key.pem");
    const manifestPath = join(artifacts, "release-manifest.json");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "original\n");
    publicKeyForManifest(keyPath);
    generateReleaseManifest({ artifactDir: artifacts, outputPath: manifestPath, keyPath, version: "1.0.0" });
    writeFileSync(join(artifacts, "artifact.txt"), "changed\n");

    const result = verifyReleaseManifest({ manifestPath, artifactsDir: artifacts });

    expect(result.ok).toBe(false);
    expect(result.verifiedArtifacts).toBe(0);
    expect(result.problems).toContain("artifact.txt: sha256 does not match the release manifest");
  });

  it("reports a signature failure when signed manifest fields change", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const keyPath = join(root, "release-key.pem");
    const manifestPath = join(artifacts, "release-manifest.json");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");
    publicKeyForManifest(keyPath);
    generateReleaseManifest({ artifactDir: artifacts, outputPath: manifestPath, keyPath, version: "1.0.0" });

    const changed = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
    changed.version = "1.0.1";
    writeFileSync(manifestPath, `${JSON.stringify(changed, null, 2)}\n`);

    const result = verifyReleaseManifest({ manifestPath, artifactsDir: artifacts });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("release manifest signature does not verify");
  });

  it("rejects a public key that does not match the operator pin", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const keyPath = join(root, "release-key.pem");
    const otherKeyPath = join(root, "other-release-key.pem");
    const manifestPath = join(artifacts, "release-manifest.json");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");
    publicKeyForManifest(keyPath);
    generateReleaseManifest({ artifactDir: artifacts, outputPath: manifestPath, keyPath, version: "1.0.0" });

    const result = verifyReleaseManifest({
      manifestPath,
      artifactsDir: artifacts,
      publicKeyPin: publicKeyForManifest(otherKeyPath),
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("release manifest public key does not match the pinned key");
  });
  it("creates an unsigned inventory for keyless release provenance", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const manifestPath = join(artifacts, "release-manifest.json");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");

    const manifest = generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: manifestPath,
      version: "1.0.0",
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(manifest.publicKey).toBeNull();
    expect(manifest.signature).toBeNull();
    expect(verifyReleaseManifest({ manifestPath, artifactsDir: artifacts })).toEqual({
      ok: true,
      problems: [],
      signatureStatus: "unsigned",
      verifiedArtifacts: 1,
      version: "1.0.0",
    });
  });
  it("reports one clear problem when a pin is applied to an unsigned manifest", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const manifestPath = join(artifacts, "release-manifest.json");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");
    generateReleaseManifest({ artifactDir: artifacts, outputPath: manifestPath, version: "1.0.0" });

    const result = verifyReleaseManifest({
      manifestPath,
      artifactsDir: artifacts,
      publicKeyPin: "operator-pin",
    });

    expect(result.problems).toEqual(["cannot apply a public key pin to an unsigned release manifest"]);
  });

  it("rejects an empty artifact directory", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    mkdir(artifacts);

    expect(() => generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: join(artifacts, "release-manifest.json"),
      version: "1.0.0",
    })).toThrow("artifact directory contains no files");
  });

  it("requires an existing key for local signing", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");

    expect(() => generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: join(artifacts, "release-manifest.json"),
      keyPath: join(root, "missing-release-key.pem"),
      version: "1.0.0",
    })).toThrow("release signing key does not exist");
  });

  it("rejects output paths that overwrite signing keys directly or through symlinks", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const keyPath = join(root, "release-key.pem");
    const outputAlias = join(root, "manifest-alias.json");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");
    publicKeyForManifest(keyPath);

    expect(() => generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: keyPath,
      keyPath,
      version: "1.0.0",
    })).toThrow("release manifest output must not overwrite the signing key");

    symlinkSync(keyPath, outputAlias, "file");
    expect(() => generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: outputAlias,
      keyPath,
      version: "1.0.0",
    })).toThrow("release manifest output must not overwrite the signing key");
  });

  it("rejects signing-key hard links in output and artifact paths", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const keyPath = join(root, "release-key.pem");
    const outputHardLink = join(root, "manifest-hard-link.json");
    const artifactHardLink = join(artifacts, "release-key-copy.pem");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");
    publicKeyForManifest(keyPath);
    const keyBefore = readFileSync(keyPath);
    linkSync(keyPath, outputHardLink);

    expect(() => generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: outputHardLink,
      keyPath,
      version: "1.0.0",
    })).toThrow("release manifest output must not overwrite the signing key");
    expect(readFileSync(keyPath)).toEqual(keyBefore);

    linkSync(keyPath, artifactHardLink);
    expect(() => generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: join(root, "release-manifest.json"),
      keyPath,
      version: "1.0.0",
    })).toThrow("release signing key must not appear in the artifact directory");
  });

  it("rejects a signing key reached through an artifact-directory symlink", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const alias = join(root, "artifact-alias");
    const keyInside = join(artifacts, "release-key.pem");
    mkdir(artifacts);
    writeFileSync(join(artifacts, "artifact.txt"), "content\n");
    publicKeyForManifest(keyInside);
    symlinkSync(artifacts, alias, "dir");

    expect(() => generateReleaseManifest({
      artifactDir: artifacts,
      outputPath: join(root, "release-manifest.json"),
      keyPath: join(alias, "release-key.pem"),
      version: "1.0.0",
    })).toThrow("release signing key must be outside the artifact directory");
  });

  it("rejects symlinked path components during verification", () => {
    const root = temporaryDirectory();
    const artifacts = join(root, "artifacts");
    const outside = join(root, "outside");
    const manifestPath = join(artifacts, "release-manifest.json");
    const content = "content\n";
    mkdir(artifacts);
    mkdir(outside);
    writeFileSync(join(outside, "artifact.txt"), content);
    symlinkSync(outside, join(artifacts, "nested"), "dir");
    const manifest = {
      schema: "agentwall-release-manifest-v1",
      version: "1.0.0",
      generatedAt: "2026-08-06T00:00:00.000Z",
      artifacts: [{
        name: "nested/artifact.txt",
        sha256: createHash("sha256").update(content).digest("hex"),
        size: Buffer.byteLength(content),
      }],
      algorithm: "none",
      publicKey: null,
      signature: null,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = verifyReleaseManifest({ manifestPath, artifactsDir: artifacts });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("nested/artifact.txt: cannot read artifact: artifact path must not contain symlinks");
  });
});

function mkdir(directory: string): void {
  mkdirSync(directory, { recursive: true });
}
