# Unified API Version Resolution with RFC 9745 and RFC 8594 Standard Headers

Status: accepted (generated, pending human review)

## Context

API version negotiation is often fragmented across multiple router files and custom header checks. Deprecation and sunset timelines are frequently announced out-of-band and forgotten in code, leaving API clients unaware of impending decommissioning. Furthermore, discrepancies between path-based and header-based versions cause silent routing conflicts.

## Decision

Implement a centralized, zero-dependency Versioning engine that resolves API versions from paths or headers with explicit precedence, detects conflicts, emits standard RFC 9745 Deprecation and RFC 8594 Sunset and Link headers, and enforces sunset deadlines by automatically returning RFC 9457 Problem Details with HTTP 410 Gone.

## Consequences

API lifecycles are configured once and applied consistently across path and header requests. Standard HTTP clients and proxies can inspect standard cache and deprecation headers. Date-based or content-negotiation versioning strategies remain out of scope for this major release.
