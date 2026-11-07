# Security Model

## Defended Threats

- **Resource Exhaustion (DoS)**: Paths are limited to 4096 characters to prevent excessive memory usage. The version catalog is strictly capped at 100 entries to prevent memory exhaustion from large configurations.
- **Input Sanitization**: Version headers are strictly validated against digits and a 16-character limit. Non-digit, malformed, or oversized headers are rejected with `invalid_header`.
- **Header Injection**: Deprecation and sunset links are validated during configuration; they must be absolute `https:` URLs and cannot contain illegal characters like `>` or whitespace, preventing header injection or response splitting.

## Not Defended

- **Upstream Security**: The library does not sanitize or validate request bodies, nor does it protect against standard web vulnerabilities (e.g., CSRF, XSS) inherent to the HTTP handlers the user provides.
- **Clock Tampering**: Time-based enforcement relies on the provided `Date` instance or the system clock; accuracy depends on the host environment.
