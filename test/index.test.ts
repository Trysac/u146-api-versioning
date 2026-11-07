import { describe, expect, it, vi } from "vitest";
import { createVersioning, toConnectMiddleware, VersioningError } from "../src/index.js";

describe("@trysac/api-versioning", () => {
  const now = new Date("2026-03-15T12:00:00Z");

  describe("Acceptance item 1: path and header resolution", () => {
    it("resolve({ path: '/v2/users', headers: {} }, now) returns { ok: true, version: '2', path: '/users', source: 'path' } and a request with header 'api-version: 1' and path '/users' returns version '1' with source 'header' (header lookup is case-insensitive)", () => {
      const v = createVersioning({
        versions: [{ version: "1" }, { version: "2" }],
        defaultVersion: "1",
      });

      const pathResult = v.resolve({ path: "/v2/users", headers: {} }, now);
      expect(pathResult).toEqual({
        ok: true,
        version: "2",
        path: "/users",
        source: "path",
        headers: {
          Vary: "API-Version",
        },
      });

      const headerResult = v.resolve(
        { path: "/users", headers: { "api-version: 1": undefined, "api-version": "1" } },
        now,
      );
      expect(headerResult).toEqual({
        ok: true,
        version: "1",
        path: "/users",
        source: "header",
        headers: {
          Vary: "API-Version",
        },
      });
    });
  });

  describe("Acceptance item 2: default version, conflict, and unsupported version", () => {
    it("No path or header version returns the configured defaultVersion with source 'default'; path '/v2/x' with header 'API-Version: 1' returns { ok: false, status: 400, code: 'version_conflict' } and version '9' returns { ok: false, status: 400, code: 'unsupported_version' }", () => {
      const v = createVersioning({
        versions: [{ version: "1" }, { version: "2" }],
        defaultVersion: "1",
      });

      const defaultResult = v.resolve({ path: "/users", headers: {} }, now);
      expect(defaultResult).toEqual({
        ok: true,
        version: "1",
        path: "/users",
        source: "default",
        headers: {
          Vary: "API-Version",
        },
      });

      const conflictResult = v.resolve({ path: "/v2/x", headers: { "API-Version": "1" } }, now);
      expect(conflictResult).toEqual({
        ok: false,
        status: 400,
        code: "version_conflict",
      });

      const unsupportedResult = v.resolve({ path: "/v9/x", headers: {} }, now);
      expect(unsupportedResult).toEqual({
        ok: false,
        status: 400,
        code: "unsupported_version",
      });

      const unsupportedHeaderResult = v.resolve(
        { path: "/x", headers: { "API-Version": "9" } },
        now,
      );
      expect(unsupportedHeaderResult).toEqual({
        ok: false,
        status: 400,
        code: "unsupported_version",
      });
    });
  });

  describe("Acceptance item 3: RFC 9745 Deprecation structured field date", () => {
    it("For version '1' with deprecatedAt new Date('2026-01-01T00:00:00Z'), headersFor('1', now) includes 'Deprecation': '@1767225600'", () => {
      const v = createVersioning({
        versions: [
          {
            version: "1",
            deprecatedAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
        defaultVersion: "1",
      });

      const headers = v.headersFor("1", now);
      expect(headers).toMatchObject({
        Deprecation: "@1767225600",
      });
      expect(headers.Deprecation).toBe("@1767225600");
    });
  });

  describe("Acceptance item 4: RFC 8594 Sunset IMF-fixdate and Link header", () => {
    it("With sunsetAt new Date('2026-07-01T00:00:00Z') and deprecationLink 'https://example.com/docs/v1', headersFor returns 'Sunset': 'Wed, 01 Jul 2026 00:00:00 GMT' and 'Link': '<https://example.com/docs/v1>; rel=\"deprecation\"; type=\"text/html\"'", () => {
      const v = createVersioning({
        versions: [
          {
            version: "1",
            sunsetAt: new Date("2026-07-01T00:00:00Z"),
            deprecationLink: "https://example.com/docs/v1",
          },
        ],
        defaultVersion: "1",
      });

      const headers = v.headersFor("1", now);
      expect(headers).toEqual({
        Sunset: "Wed, 01 Jul 2026 00:00:00 GMT",
        Link: '<https://example.com/docs/v1>; rel="deprecation"; type="text/html"',
      });
    });
  });

  describe("Acceptance item 5: 410 sunset enforcement", () => {
    it("At now >= sunsetAt, resolve for version '1' returns { ok: false, status: 410, code: 'version_sunset' }, and one millisecond earlier it returns ok: true with the deprecation headers", () => {
      const sunsetAt = new Date("2026-07-01T00:00:00Z");
      const deprecatedAt = new Date("2026-01-01T00:00:00Z");
      const v = createVersioning({
        versions: [
          {
            version: "1",
            deprecatedAt,
            sunsetAt,
            deprecationLink: "https://example.com/docs/v1",
          },
        ],
        defaultVersion: "1",
      });

      const atSunset = v.resolve({ path: "/v1/resource", headers: {} }, sunsetAt);
      expect(atSunset).toEqual({
        ok: false,
        status: 410,
        code: "version_sunset",
      });

      const oneMsBefore = new Date(sunsetAt.getTime() - 1);
      const beforeSunset = v.resolve({ path: "/v1/resource", headers: {} }, oneMsBefore);
      expect(beforeSunset).toEqual({
        ok: true,
        version: "1",
        path: "/resource",
        source: "path",
        headers: {
          Vary: "API-Version",
          Deprecation: "@1767225600",
          Sunset: "Wed, 01 Jul 2026 00:00:00 GMT",
          Link: '<https://example.com/docs/v1>; rel="deprecation"; type="text/html"',
        },
      });
    });
  });

  describe("Acceptance item 6: configuration validation and VersioningError", () => {
    it("createVersioning throws VersioningError with code 'invalid_config' when defaultVersion is not in versions, when sunsetAt is before deprecatedAt, or when versions contain '01' and '1'", () => {
      // defaultVersion not in versions
      expect(() =>
        createVersioning({
          versions: [{ version: "1" }],
          defaultVersion: "2",
        }),
      ).toThrowError(VersioningError);
      try {
        createVersioning({
          versions: [{ version: "1" }],
          defaultVersion: "2",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(VersioningError);
        expect((err as VersioningError).code).toBe("invalid_config");
      }

      // sunsetAt before deprecatedAt
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              deprecatedAt: new Date("2026-07-01T00:00:00Z"),
              sunsetAt: new Date("2026-01-01T00:00:00Z"),
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrowError(VersioningError);
      try {
        createVersioning({
          versions: [
            {
              version: "1",
              deprecatedAt: new Date("2026-07-01T00:00:00Z"),
              sunsetAt: new Date("2026-01-01T00:00:00Z"),
            },
          ],
          defaultVersion: "1",
        });
      } catch (err) {
        expect((err as VersioningError).code).toBe("invalid_config");
      }

      // versions contain '01' and '1'
      expect(() =>
        createVersioning({
          versions: [{ version: "01" }, { version: "1" }],
          defaultVersion: "1",
        }),
      ).toThrowError(VersioningError);
      try {
        createVersioning({
          versions: [{ version: "01" }, { version: "1" }],
          defaultVersion: "1",
        });
      } catch (err) {
        expect((err as VersioningError).code).toBe("invalid_config");
      }
    });
  });

  describe("Acceptance item 7: Connect middleware integration and RFC 9457 Gone body", () => {
    it('toConnectMiddleware(v) on a fake req and res sets the resolved headers via res.setHeader, stores req.apiVersion and calls next(); on 410 it ends with status 410, Content-Type \'application/problem+json\' and body \'{"type":"about:blank","title":"Gone","status":410,"detail":"API version 1 is no longer available"}\'', () => {
      const sunsetAt = new Date("2026-07-01T00:00:00Z");
      const v = createVersioning({
        versions: [{ version: "1", sunsetAt }, { version: "2" }],
        defaultVersion: "2",
      });

      // Success case (version 2)
      const successMiddleware = toConnectMiddleware(v, {
        now: () => new Date("2026-08-01T00:00:00Z"),
      });

      const successReq: Record<string, unknown> = {
        path: "/v2/items",
        headers: {},
      };
      const headersSet = new Map<string, string>();
      const successRes = {
        setHeader: vi.fn((name: string, value: string) => {
          headersSet.set(name, value);
        }),
        end: vi.fn(),
      };
      const successNext = vi.fn();

      successMiddleware(successReq, successRes, successNext);
      expect(successRes.setHeader).toHaveBeenCalledWith("Vary", "API-Version");
      expect(successReq.apiVersion).toBe("2");
      expect(successNext).toHaveBeenCalledTimes(1);
      expect(successRes.end).not.toHaveBeenCalled();

      // 410 Gone case (version 1 after sunset)
      const sunsetReq: Record<string, unknown> = {
        path: "/v1/items",
        headers: {},
      };
      const sunsetHeaders = new Map<string, string>();
      const sunsetRes = {
        statusCode: 200,
        setHeader: vi.fn((name: string, value: string) => {
          sunsetHeaders.set(name, value);
        }),
        end: vi.fn(),
      };
      const sunsetNext = vi.fn();

      successMiddleware(sunsetReq, sunsetRes, sunsetNext);
      expect(sunsetNext).not.toHaveBeenCalled();
      expect(sunsetRes.statusCode).toBe(410);
      expect(sunsetRes.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
      expect(sunsetRes.end).toHaveBeenCalledWith(
        '{"type":"about:blank","title":"Gone","status":410,"detail":"API version 1 is no longer available"}',
      );
    });
  });

  describe("Adversarial and Edge Cases", () => {
    it("handles path '/v2' alone, returning path '/'", () => {
      const v = createVersioning({
        versions: [{ version: "2" }],
        defaultVersion: "2",
      });
      const res = v.resolve({ path: "/v2", headers: {} }, now);
      expect(res).toEqual({
        ok: true,
        version: "2",
        path: "/",
        source: "path",
        headers: { Vary: "API-Version" },
      });
    });

    it("handles path '/v2/' returning path '/'", () => {
      const v = createVersioning({
        versions: [{ version: "2" }],
        defaultVersion: "2",
      });
      const res = v.resolve({ path: "/v2/", headers: {} }, now);
      expect(res).toEqual({
        ok: true,
        version: "2",
        path: "/",
        source: "path",
        headers: { Vary: "API-Version" },
      });
    });

    it("handles '/v20/x' when only '2' exists (unsupported_version)", () => {
      const v = createVersioning({
        versions: [{ version: "2" }],
        defaultVersion: "2",
      });
      const res = v.resolve({ path: "/v20/x", headers: {} }, now);
      expect(res).toEqual({
        ok: false,
        status: 400,
        code: "unsupported_version",
      });
    });

    it("handles repeated header values as array, using the first value", () => {
      const v = createVersioning({
        versions: [{ version: "1" }, { version: "2" }],
        defaultVersion: "1",
      });
      const res = v.resolve({ path: "/users", headers: { "API-Version": ["2", "1"] } }, now);
      expect(res).toEqual({
        ok: true,
        version: "2",
        path: "/users",
        source: "header",
        headers: { Vary: "API-Version" },
      });
    });

    it("returns invalid_header when header is over 16 characters or non-digits", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
      });
      // non-digits
      expect(v.resolve({ path: "/users", headers: { "API-Version": "abc" } }, now)).toEqual({
        ok: false,
        status: 400,
        code: "invalid_header",
      });

      expect(v.resolve({ path: "/users", headers: { "API-Version": "1.0" } }, now)).toEqual({
        ok: false,
        status: 400,
        code: "invalid_header",
      });

      expect(v.resolve({ path: "/users", headers: { "API-Version": "" } }, now)).toEqual({
        ok: false,
        status: 400,
        code: "invalid_header",
      });

      expect(v.resolve({ path: "/users", headers: { "API-Version": "   " } }, now)).toEqual({
        ok: false,
        status: 400,
        code: "invalid_header",
      });

      // > 16 characters
      expect(
        v.resolve({ path: "/users", headers: { "API-Version": "12345678901234567" } }, now),
      ).toEqual({ ok: false, status: 400, code: "invalid_header" });
    });

    it("returns invalid_header before conflict if header is malformed on a versioned path", () => {
      const v = createVersioning({
        versions: [{ version: "2" }],
        defaultVersion: "2",
      });
      const res = v.resolve({ path: "/v2/items", headers: { "API-Version": "bad!" } }, now);
      expect(res).toEqual({ ok: false, status: 400, code: "invalid_header" });
    });

    it("allows identical path and header without conflict", () => {
      const v = createVersioning({
        versions: [{ version: "2" }],
        defaultVersion: "2",
      });
      const res = v.resolve({ path: "/v2/items", headers: { "API-Version": "2" } }, now);
      expect(res).toEqual({
        ok: true,
        version: "2",
        path: "/items",
        source: "path",
        headers: { Vary: "API-Version" },
      });
    });

    it("deprecatedAt in the future is still sent in headers (RFC 9745)", () => {
      const futureDeprecation = new Date("2030-01-01T00:00:00Z");
      const v = createVersioning({
        versions: [{ version: "1", deprecatedAt: futureDeprecation }],
        defaultVersion: "1",
      });
      const headers = v.headersFor("1", now);
      expect(headers.Deprecation).toBe("@1893456000");
    });

    it("versions without dates return no extra lifecycle headers", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
      });
      expect(v.headersFor("1", now)).toEqual({});
    });

    it("headersFor on an unknown version returns an empty object", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
      });
      expect(v.headersFor("999", now)).toEqual({});
    });

    it("appends RFC 8594 sunset link when both deprecationLink and sunsetLink are provided", () => {
      const v = createVersioning({
        versions: [
          {
            version: "1",
            deprecationLink: "https://example.com/docs/dep",
            sunsetLink: "https://example.com/docs/sunset",
          },
        ],
        defaultVersion: "1",
      });
      const headers = v.headersFor("1", now);
      expect(headers.Link).toBe(
        '<https://example.com/docs/dep>; rel="deprecation"; type="text/html", <https://example.com/docs/sunset>; rel="sunset"',
      );
    });

    it("supports sunsetLink alone", () => {
      const v = createVersioning({
        versions: [
          {
            version: "1",
            sunsetLink: "https://example.com/docs/sunset",
          },
        ],
        defaultVersion: "1",
      });
      const headers = v.headersFor("1", now);
      expect(headers.Link).toBe('<https://example.com/docs/sunset>; rel="sunset"');
    });

    it("uses custom header name and reflects it in Vary", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
        header: "X-API-Version",
      });
      const res = v.resolve({ path: "/items", headers: { "x-api-version": "1" } }, now);
      expect(res).toEqual({
        ok: true,
        version: "1",
        path: "/items",
        source: "header",
        headers: { Vary: "X-API-Version" },
      });
    });

    it("supports custom pathPattern", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
        pathPattern: /^\/api\/v(\d{1,3})(?=\/|$)/,
      });
      const res = v.resolve({ path: "/api/v1/users", headers: {} }, now);
      expect(res).toEqual({
        ok: true,
        version: "1",
        path: "/users",
        source: "path",
        headers: { Vary: "API-Version" },
      });
    });

    it("rejects paths exceeding maximum length limit", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
      });
      const longPath = `/v1/${"a".repeat(4096)}`;
      const res = v.resolve({ path: longPath, headers: {} }, now);
      expect(res).toEqual({
        ok: false,
        status: 400,
        code: "unsupported_version",
      });
    });

    it("validates input types on resolve", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
      });
      expect(() =>
        v.resolve(null as unknown as { path: string; headers: Record<string, string> }, now),
      ).toThrow(TypeError);
      expect(() => v.resolve({ path: 123 as unknown as string, headers: {} }, now)).toThrow(
        TypeError,
      );
      expect(() =>
        v.resolve({ path: "/", headers: null as unknown as Record<string, string> }, now),
      ).toThrow(TypeError);
      expect(() => v.resolve({ path: "/", headers: {} }, "bad date" as unknown as Date)).toThrow(
        TypeError,
      );
    });
  });

  describe("Configuration validation edge cases", () => {
    it("throws on non-object config or empty versions", () => {
      expect(() =>
        createVersioning(null as unknown as { versions: []; defaultVersion: "1" }),
      ).toThrow(VersioningError);
      expect(() => createVersioning({ versions: [], defaultVersion: "1" })).toThrow(
        VersioningError,
      );
    });

    it("throws on more than 100 versions", () => {
      const versions = Array.from({ length: 101 }, (_, i) => ({
        version: String(i + 1),
      }));
      expect(() => createVersioning({ versions, defaultVersion: "1" })).toThrow(VersioningError);
    });

    it("throws on invalid version formats (e.g. 0, non-digits, leading zeros, > 3 digits)", () => {
      expect(() => createVersioning({ versions: [{ version: "0" }], defaultVersion: "0" })).toThrow(
        VersioningError,
      );
      expect(() =>
        createVersioning({ versions: [{ version: "v1" }], defaultVersion: "v1" }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({ versions: [{ version: "1000" }], defaultVersion: "1000" }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [null as unknown as { version: "1" }],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
    });

    it("throws on duplicate versions", () => {
      expect(() =>
        createVersioning({
          versions: [{ version: "1" }, { version: "1" }],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
    });

    it("throws on invalid Date instances", () => {
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              deprecatedAt: new Date("invalid-date"),
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              sunsetAt: new Date("invalid-date"),
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
    });

    it("throws on invalid links (whitespace, '>', non-https, invalid url)", () => {
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              deprecationLink: "http://insecure.example.com/docs",
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              deprecationLink: "https://example.com/docs>v1",
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              deprecationLink: "https://example.com/docs v1",
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              sunsetLink: "not-a-url",
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [
            {
              version: "1",
              deprecationLink: 123 as unknown as string,
            },
          ],
          defaultVersion: "1",
        }),
      ).toThrow(VersioningError);
    });

    it("throws on invalid header name or pathPattern", () => {
      expect(() =>
        createVersioning({
          versions: [{ version: "1" }],
          defaultVersion: "1",
          header: "Invalid Header With Spaces",
        }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [{ version: "1" }],
          defaultVersion: "1",
          pathPattern: "not a regex" as unknown as RegExp,
        }),
      ).toThrow(VersioningError);
      expect(() =>
        createVersioning({
          versions: [{ version: "1" }],
          defaultVersion: 123 as unknown as string,
        }),
      ).toThrow(VersioningError);
    });
  });

  describe("Connect middleware edge cases", () => {
    it("falls back to req.url when req.path is undefined", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
      });
      const middleware = toConnectMiddleware(v);
      const req: Record<string, unknown> = { url: "/v1/search?q=test" };
      const res = { setHeader: vi.fn(), end: vi.fn() };
      const next = vi.fn();
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.apiVersion).toBe("1");
    });

    it("handles 400 errors (conflict, unsupported, invalid header) with problem details", () => {
      const v = createVersioning({
        versions: [{ version: "1" }],
        defaultVersion: "1",
      });
      const middleware = toConnectMiddleware(v);

      // conflict
      const res1 = {
        statusCode: 200,
        status: vi.fn(),
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      middleware({ path: "/v1/x", headers: { "API-Version": "2" } }, res1, vi.fn());
      expect(res1.statusCode).toBe(400);
      expect(res1.end).toHaveBeenCalledWith(
        '{"type":"about:blank","title":"Bad Request","status":400,"detail":"Version conflict between path and header"}',
      );

      // unsupported
      const res2 = {
        statusCode: 200,
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      middleware({ path: "/v9/x", headers: {} }, res2, vi.fn());
      expect(res2.statusCode).toBe(400);
      expect(res2.end).toHaveBeenCalledWith(
        '{"type":"about:blank","title":"Bad Request","status":400,"detail":"Requested API version is not supported"}',
      );

      // invalid header
      const res3 = {
        statusCode: 200,
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      middleware({ path: "/x", headers: { "API-Version": "xyz" } }, res3, vi.fn());
      expect(res3.statusCode).toBe(400);
      expect(res3.end).toHaveBeenCalledWith(
        '{"type":"about:blank","title":"Bad Request","status":400,"detail":"Invalid API version header"}',
      );
    });
  });
});
