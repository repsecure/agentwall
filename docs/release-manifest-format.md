# Release manifest

A release manifest lists the files in an Agentwall release. It stores a SHA-256 digest and a byte size for each file.

The manifest gives an offline file check. It does not prove the release source, the build process, or the signer identity by itself.

## Official releases

The Agentwall release workflow creates an unsigned hash inventory. The workflow then includes the inventory in `checksums.txt`.

The SLSA provenance signs the checksum subject list with the workflow OIDC identity. This design does not create a release private key.

Run these checks in the release directory:

```bash
sha256sum -c checksums.txt
slsa-verifier verify-artifact release-manifest.json \
  --provenance-path <the .intoto.jsonl asset> \
  --source-uri github.com/repsecure/agentwall \
  --source-tag v0.2.0
agentwall verify-release --manifest release-manifest.json
```

The checksum command checks file consistency against the downloaded checksum list. It does not authenticate the list.

The first `slsa-verifier` command checks the manifest against the signed workflow subjects.
The `agentwall verify-release` command then checks every file listed in the authenticated manifest.
It does not contact a server.

The official manifest has `publicKey: null` and `signature: null`. The SLSA provenance is its external trust path.

## Create a local signed manifest

Use an existing separate private key for a local release bundle. Do not place the private key in the artifact directory.

```bash
agentwall release-manifest \
  --input dist-release \
  --output dist-release/release-manifest.json \
  --key-file ~/.config/agentwall/release-key.pem \
  --version 0.2.0
```

The key path must already exist and remain outside `dist-release`.
The command signs the manifest with Ed25519. The manifest carries the base64 DER public key and the base64 signature.

Verify the local bundle with the expected public key:

```bash
agentwall verify-release \
  --manifest dist-release/release-manifest.json \
  --artifacts dist-release \
  --public-key <base64 DER SPKI public key>
```

A public key pin is required when the check must prove signer identity. Without a pin, the check proves only internal signature consistency.

## File format

The manifest uses this JSON shape:

```json
{
  "schema": "agentwall-release-manifest-v1",
  "version": "0.2.0",
  "generatedAt": "2026-08-06T00:00:00.000Z",
  "artifacts": [
    {
      "name": "agentwall-verify-linux-amd64",
      "sha256": "<64 lowercase hexadecimal characters>",
      "size": 123456
    }
  ],
  "algorithm": "none",
  "publicKey": null,
  "signature": null
}
```

The generator sorts artifact names by name. It uses forward slashes for names inside nested directories.

The manifest excludes its own output file. Generate the manifest before creating an outer checksum file.

A signed manifest signs every field except `signature`. The signed bytes use the field order shown by the implementation.

## Verification results

`agentwall verify-release` uses these exit codes:

- `0`: The manifest and every listed artifact pass.
- `1`: A signature, key pin, file, path, size, or digest check fails.
- `2`: The command arguments are not valid.

The verifier rejects absolute paths, parent-directory paths, duplicate names, symlinks, and non-file entries.

The verifier checks files listed in the manifest. It does not report extra files in the directory. Use `checksums.txt` to check the complete release asset set.
