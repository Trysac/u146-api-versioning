# @trysac/api-versioning

Framework-agnostic API version resolution from path or header, with RFC 9745 Deprecation, RFC 8594 Sunset, and Link headers, and automatic 410 Gone responses after sunset.

## The Problem

APIs often announce deprecations in blog posts while removing versions on dates unknown to clients. Versioning logic is frequently scattered across disparate routers, and the standard `Deprecation` and `Sunset` headers are omitted. Furthermore, path-based and header-based versioning often conflict silently when clients provide both.

## Installation

```bash
npm install @trysac/api-versioning
```

## Usage

```ts
import { createVersioning } from "@trysac/api-versioning";
const v = createVersioning({
  versions: [{ version: "1" }, { version: "2" }],
  defaultVersion: "1",
});
const res = v.resolve({ path: "/v2/users", headers: {} }, new Date());
if (res.ok) console.log(`Version: ${res.version}, Path: ${res.path}`);
```

## Public API Summary

### Configuration Options (`VersioningConfig`)
- `versions`: `VersionInfo[]` (required, max 100 entries)
- `defaultVersion`: `string` (required, must exist in `versions`)
- `header`: `string` (optional, defaults to `API-Version`, must be alphanumeric)
- `pathPattern`: `RegExp` (optional, defaults to `/^\/v(\d{1,3})(?=\/|$)/`)

### Error Codes
- `invalid_config`: Thrown when configuration constraints are violated (e.g., duplicate versions, invalid URLs, sunset before deprecation).
- `400 / 410 (via Resolution)`: `version_conflict` (divergent path/header), `unsupported_version` (missing version), `version_sunset` (version removed), `invalid_header` (malformed header).

### Limits
- Path length: 4096 characters.
- Version format: 1-3 digits, no leading zeros.
- Header value: Max 16 characters, digits only.

## Why not ad hoc router prefixes?

Ad hoc solutions suffer from lack of standard header support and fragmented logic. This library provides a single source of truth for resolution and lifecycle, making the versioning policy testable in isolation without a full server implementation.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and input validation limits.
