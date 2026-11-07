# Testing Guide

Tests are defined in `test/index.test.ts` using Vitest, validating the core resolution logic, edge cases, and middleware integration.

## Test Coverage

- **Resolution Logic**: Verifies path matching, header matching (case-insensitive), and default version fallback.
- **Conflict Detection**: Ensures divergent path/header versions return `400 version_conflict`.
- **RFC Compliance**: Confirms `Deprecation` and `Sunset` headers match RFC 9745 and RFC 8594 requirements (e.g., structured dates, IMF-fixdates).
- **Sunset Enforcement**: Tests 410 responses when `now >= sunsetAt` and correct headers just before the sunset deadline.
- **Configuration Validation**: Ensures `VersioningError` is thrown for invalid configs (e.g., missing default, sunset before deprecation, invalid URL schemes).
- **Middleware Integration**: Validates header setting (`res.setHeader`), `req.apiVersion` storage, and RFC 9457 Gone body generation.
- **Edge Cases**: Validates path cleaning, header array handling, and length limits (path length, version format).
