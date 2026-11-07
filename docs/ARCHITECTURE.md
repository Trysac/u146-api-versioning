# Architecture

## Overview

`@trysac/api-versioning` is a zero-dependency, framework-agnostic TypeScript library designed to centralize API versioning policy, resolution, header negotiation, and sunset lifecycles.

Rather than embedding ad hoc version routing prefixes in separate routers, a single configuration drives:
1. Path version resolution (`/v1/...` -> version `'1'`, path stripped).
2. Header version negotiation (`API-Version: 1`, case-insensitive).
3. Conflict detection when a request contains diverging path and header version indicators.
4. Standard RFC 9745 Deprecation headers.
5. Standard RFC 8594 Sunset and Link headers.
6. Automatic 410 Gone enforcement once sunset cutoff dates are reached.
7. Standard RFC 9457 Problem Details responses.

## Resolution Pipeline

When `resolve(req, now)` is called, the engine processes the request through explicit stages:

1. **Path Matching**: The request path is tested against `pathPattern` (default `/^\/v(\d{1,3})(?=\/|$)/`). If matched, the version number is extracted and the prefix is stripped from the path (e.g. `/v2/users` -> `/users`, `/v2` -> `/`).
2. **Header Matching**: The request headers are inspected case-insensitively for the configured header name (`API-Version`). The first value of repeated headers is trimmed and validated against size (<= 16 characters) and digit-only constraints. Invalid headers immediately yield `status: 400, code: 'invalid_header'`.
3. **Conflict Detection**: If both a path version and a header version are present and differ, the resolver returns `status: 400, code: 'version_conflict'`.
4. **Fallback**: If neither path nor header specifies a version, `defaultVersion` is selected with `source: 'default'`.
5. **Support Verification**: The resolved version is verified against the configured version catalog. Unknown versions yield `status: 400, code: 'unsupported_version'`.
6. **Sunset Enforcement**: If `now >= versionInfo.sunsetAt`, the version is decommissioned and the resolver returns `status: 410, code: 'version_sunset'`.
7. **Success & Header Generation**: If valid, the engine emits `Vary` (for cache segregation) alongside `Deprecation`, `Sunset`, and `Link` headers as configured.

## Middleware Architecture

`toConnectMiddleware(v, opts)` wraps the resolution engine in a Connect/Express-compatible handler `(req, res, next)`. On success, it calls `res.setHeader()` for all resolved headers, sets `req.apiVersion`, and invokes `next()`. On 410 Gone or 400 Bad Request, it immediately ends the response with status 410/400, Content-Type `application/problem+json`, and an RFC 9457 compliant JSON body.
