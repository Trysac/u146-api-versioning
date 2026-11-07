# Project Record

## Objective

To provide a framework-agnostic, testable TypeScript library that centralizes API versioning resolution, enforces RFC-compliant deprecation/sunset workflows, and automatically manages the transition to 410 Gone status.

## Scope

- Version resolution: Integer major versions (1-999) extracted via path prefix or custom request headers.
- Conflict handling: Automatic 400 Bad Request if path and header versions diverge.
- Standard headers: RFC 9745 (`Deprecation` structured dates, `Link` rel="deprecation"), RFC 8594 (`Sunset` IMF-fixdate, `Link` rel="sunset").
- Lifecycle: Automatic 410 Gone responses (RFC 9457) when current time exceeds `sunsetAt`.
- Integration: Connect/Express middleware for automatic resolution and header injection.

## Out of Scope

- Date-based versioning (e.g., `2024-06-01`).
- Content-type negotiation via `Accept` headers.
- Router dispatch or internal route handling.
- OpenAPI/Swagger schema generation.

## Factory run u146 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | gemini-3.8-flash | yes | 4374 | 53046 | 0 | 0 | 0.1011 |
| fix-1 | gemini-3.8-flash | no | 28625 | 7968 | 0 | 51034 | 0.0552 |
| fix-2 | gemini-3.8-flash | no | 36544 | 315 | 0 | 99161 | 0.0360 |
| audit | gemini-3.1-flash-lite | no | 59197 | 224 | 0 | 162792 | 0.0192 |
| docs | gemini-3.1-flash-lite | no | 17412 | 1481 | 0 | 0 | 0.0066 |

Total: $0.2181. Prices: Anthropic list prices.
