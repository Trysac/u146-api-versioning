/**
 * Public API of @trysac/api-versioning.
 *
 * Framework-agnostic API version resolution from path or header,
 * emitting RFC 9745 Deprecation, RFC 8594 Sunset, and Link headers,
 * with automatic 410 responses after sunset dates.
 */

/**
 * Version metadata and lifecycle information.
 */
export interface VersionInfo {
  /**
   * Major version string (1 to 3 digits, no leading zero).
   */
  version: string;
  /**
   * Date when this API version became deprecated (RFC 9745).
   */
  deprecatedAt?: Date | undefined;
  /**
   * Date when this API version will be or was sunset/decommissioned (RFC 8594).
   */
  sunsetAt?: Date | undefined;
  /**
   * Absolute https URL describing the deprecation.
   */
  deprecationLink?: string | undefined;
  /**
   * Absolute https URL describing the sunset.
   */
  sunsetLink?: string | undefined;
}

/**
 * Configuration options for the versioning resolver.
 */
export interface VersioningConfig {
  /**
   * List of supported API versions and their lifecycle settings.
   */
  versions: VersionInfo[];
  /**
   * Default version to select when no version is provided in the path or header.
   */
  defaultVersion: string;
  /**
   * Name of the HTTP request header used for version negotiation. Defaults to 'API-Version'.
   */
  header?: string | undefined;
  /**
   * Regular expression pattern used to match and extract version from URL path.
   * Defaults to /^\/v(\d{1,3})(?=\/|$)/.
   */
  pathPattern?: RegExp | undefined;
}

/**
 * Result of resolving an API version for an incoming request.
 */
export type Resolution =
  | {
      ok: true;
      version: string;
      path: string;
      source: "path" | "header" | "default";
      headers: Record<string, string>;
    }
  | {
      ok: false;
      status: 400 | 410;
      code: "version_conflict" | "unsupported_version" | "version_sunset" | "invalid_header";
    };

/**
 * Versioning engine instance providing resolution and header generation.
 */
export interface Versioning {
  /**
   * Resolves the API version for a request given its path and headers at the specified time.
   */
  resolve(
    req: {
      path: string;
      headers: Record<string, string | string[] | undefined>;
    },
    now: Date,
  ): Resolution;
  /**
   * Computes lifecycle headers (Deprecation, Sunset, Link) for a version.
   */
  headersFor(version: string, now: Date): Record<string, string>;
}

/**
 * Options for Connect-compatible middleware.
 */
export interface ConnectMiddlewareOptions {
  /**
   * Clock provider returning the current timestamp. Defaults to () => new Date().
   */
  now?: (() => Date) | undefined;
}

/**
 * Connect-compatible middleware handler signature.
 */
export type ConnectMiddleware = (
  req: {
    path?: string | undefined;
    url?: string | undefined;
    headers?: Record<string, string | string[] | undefined> | undefined;
    apiVersion?: string | undefined;
    [key: string]: unknown;
  },
  res: {
    statusCode?: number | undefined;
    setHeader(name: string, value: string): void;
    status?(code: number): unknown;
    end(chunk?: string): void;
    [key: string]: unknown;
  },
  next: (err?: unknown) => void,
) => void;

/**
 * Base error class for versioning configuration errors.
 */
export class VersioningError extends Error {
  readonly code: "invalid_config";

  constructor(message: string, code: "invalid_config" = "invalid_config") {
    super(message.slice(0, 200));
    this.name = "VersioningError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const VERSION_PATTERN = /^[1-9]\d{0,2}$/;
const HEADER_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEFAULT_PATH_PATTERN = /^\/v(\d{1,3})(?=\/|$)/;
const DEFAULT_HEADER = "API-Version";
const MAX_PATH_LENGTH = 4096;
const MAX_VERSIONS_COUNT = 100;
const MAX_HEADER_VERSION_LENGTH = 16;

/**
 * Internal WeakMap to track sunset versions associated with 410 resolution objects.
 */
const sunsetVersionMap = new WeakMap<object, string>();

function validateLink(link: unknown, fieldName: string): string {
  if (typeof link !== "string") {
    throw new VersioningError(`${fieldName} must be a string`, "invalid_config");
  }
  if (/[\s>]/.test(link)) {
    throw new VersioningError(`${fieldName} must not contain '>' or whitespace`, "invalid_config");
  }
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new VersioningError(`${fieldName} must be a valid absolute URL`, "invalid_config");
  }
  if (parsed.protocol !== "https:") {
    throw new VersioningError(`${fieldName} must be an absolute https URL`, "invalid_config");
  }
  return link;
}

/**
 * Creates an API versioning resolver configured with the provided version definitions.
 *
 * @param config - Version definitions, default version, and optional header/path matching rules.
 * @returns A configured Versioning instance.
 * @throws {VersioningError} If configuration constraints are violated.
 */
export function createVersioning(config: VersioningConfig): Versioning {
  if (!config || typeof config !== "object") {
    throw new VersioningError("config must be an object", "invalid_config");
  }
  if (!Array.isArray(config.versions) || config.versions.length === 0) {
    throw new VersioningError("versions must be a non-empty array", "invalid_config");
  }
  if (config.versions.length > MAX_VERSIONS_COUNT) {
    throw new VersioningError(
      `versions count must not exceed ${MAX_VERSIONS_COUNT}`,
      "invalid_config",
    );
  }

  const versionMap = new Map<string, VersionInfo>();
  for (const info of config.versions) {
    if (!info || typeof info !== "object") {
      throw new VersioningError("VersionInfo must be an object", "invalid_config");
    }
    if (typeof info.version !== "string" || !VERSION_PATTERN.test(info.version)) {
      throw new VersioningError(
        `Invalid version '${info.version}'. Version must be 1 to 3 digits without leading zeros.`,
        "invalid_config",
      );
    }
    if (versionMap.has(info.version)) {
      throw new VersioningError(
        `Duplicate version '${info.version}' in versions`,
        "invalid_config",
      );
    }

    if (info.deprecatedAt !== undefined) {
      if (!(info.deprecatedAt instanceof Date) || Number.isNaN(info.deprecatedAt.getTime())) {
        throw new VersioningError(
          `deprecatedAt for version '${info.version}' must be a valid Date`,
          "invalid_config",
        );
      }
    }
    if (info.sunsetAt !== undefined) {
      if (!(info.sunsetAt instanceof Date) || Number.isNaN(info.sunsetAt.getTime())) {
        throw new VersioningError(
          `sunsetAt for version '${info.version}' must be a valid Date`,
          "invalid_config",
        );
      }
    }
    if (
      info.deprecatedAt &&
      info.sunsetAt &&
      info.sunsetAt.getTime() < info.deprecatedAt.getTime()
    ) {
      throw new VersioningError(
        `sunsetAt must not be before deprecatedAt for version '${info.version}'`,
        "invalid_config",
      );
    }

    if (info.deprecationLink !== undefined) {
      validateLink(info.deprecationLink, "deprecationLink");
    }
    if (info.sunsetLink !== undefined) {
      validateLink(info.sunsetLink, "sunsetLink");
    }

    versionMap.set(info.version, { ...info });
  }

  if (typeof config.defaultVersion !== "string") {
    throw new VersioningError("defaultVersion must be a string", "invalid_config");
  }
  if (!versionMap.has(config.defaultVersion)) {
    throw new VersioningError(
      `defaultVersion '${config.defaultVersion}' is not in configured versions`,
      "invalid_config",
    );
  }

  const configuredHeader = config.header ?? DEFAULT_HEADER;
  if (
    typeof configuredHeader !== "string" ||
    configuredHeader.length === 0 ||
    configuredHeader.length > 100 ||
    !HEADER_TOKEN_PATTERN.test(configuredHeader)
  ) {
    throw new VersioningError(`Invalid header name: '${configuredHeader}'`, "invalid_config");
  }

  if (config.pathPattern !== undefined && !(config.pathPattern instanceof RegExp)) {
    throw new VersioningError("pathPattern must be a RegExp", "invalid_config");
  }
  const configuredPathPattern = config.pathPattern ?? DEFAULT_PATH_PATTERN;

  const headerNameLower = configuredHeader.toLowerCase();

  function headersFor(version: string, _now: Date): Record<string, string> {
    const info = versionMap.get(version);
    if (!info) {
      return {};
    }
    const headers: Record<string, string> = {};
    if (info.deprecatedAt !== undefined) {
      headers.Deprecation = `@${Math.floor(info.deprecatedAt.getTime() / 1000)}`;
    }
    if (info.sunsetAt !== undefined) {
      headers.Sunset = info.sunsetAt.toUTCString();
    }

    const links: string[] = [];
    if (info.deprecationLink !== undefined) {
      links.push(`<${info.deprecationLink}>; rel="deprecation"; type="text/html"`);
    }
    if (info.sunsetLink !== undefined) {
      links.push(`<${info.sunsetLink}>; rel="sunset"`);
    }
    if (links.length > 0) {
      headers.Link = links.join(", ");
    }
    return headers;
  }

  function resolve(
    req: {
      path: string;
      headers: Record<string, string | string[] | undefined>;
    },
    now: Date,
  ): Resolution {
    if (!req || typeof req !== "object") {
      throw new TypeError("req must be an object");
    }
    if (typeof req.path !== "string") {
      throw new TypeError("req.path must be a string");
    }
    if (!req.headers || typeof req.headers !== "object") {
      throw new TypeError("req.headers must be an object");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("now must be a valid Date");
    }
    if (req.path.length > MAX_PATH_LENGTH) {
      return { ok: false, status: 400, code: "unsupported_version" };
    }

    // 1. Path match
    let pathVersion: string | undefined;
    let strippedPath = req.path;
    const pathMatch = configuredPathPattern.exec(req.path);
    if (pathMatch && pathMatch[1] !== undefined) {
      pathVersion = pathMatch[1];
      const matchedPrefixLength = pathMatch[0].length;
      let remaining = req.path.slice(matchedPrefixLength);
      if (remaining === "" || !remaining.startsWith("/")) {
        remaining = `/${remaining.replace(/^\/+/, "")}`;
      }
      strippedPath = remaining;
    }

    // 2. Header match
    let rawHeaderValue: string | string[] | undefined;
    for (const key of Object.keys(req.headers)) {
      if (key.toLowerCase() === headerNameLower) {
        rawHeaderValue = req.headers[key];
        break;
      }
    }

    let headerVersion: string | undefined;
    if (rawHeaderValue !== undefined) {
      let candidateString: string | undefined;
      if (Array.isArray(rawHeaderValue)) {
        if (rawHeaderValue.length > 0 && typeof rawHeaderValue[0] === "string") {
          candidateString = rawHeaderValue[0];
        }
      } else if (typeof rawHeaderValue === "string") {
        candidateString = rawHeaderValue;
      }

      if (candidateString !== undefined) {
        const trimmed = candidateString.trim();
        if (
          trimmed.length === 0 ||
          trimmed.length > MAX_HEADER_VERSION_LENGTH ||
          !/^\d+$/.test(trimmed)
        ) {
          return { ok: false, status: 400, code: "invalid_header" };
        }
        headerVersion = trimmed;
      }
    }

    // 3. Conflict check
    if (pathVersion !== undefined && headerVersion !== undefined) {
      if (pathVersion !== headerVersion) {
        return { ok: false, status: 400, code: "version_conflict" };
      }
    }

    // Determine candidate version and source
    let version: string;
    let source: "path" | "header" | "default";
    let finalPath: string;

    if (pathVersion !== undefined) {
      version = pathVersion;
      source = "path";
      finalPath = strippedPath;
    } else if (headerVersion !== undefined) {
      version = headerVersion;
      source = "header";
      finalPath = req.path;
    } else {
      version = config.defaultVersion;
      source = "default";
      finalPath = req.path;
    }

    // 4. Supported check
    const info = versionMap.get(version);
    if (!info) {
      return { ok: false, status: 400, code: "unsupported_version" };
    }

    // 5. Sunset check
    if (info.sunsetAt !== undefined && now.getTime() >= info.sunsetAt.getTime()) {
      const failureResult: Resolution = {
        ok: false,
        status: 410,
        code: "version_sunset",
      };
      sunsetVersionMap.set(failureResult, version);
      return failureResult;
    }

    // 6. Success
    const lifecycleHeaders = headersFor(version, now);
    return {
      ok: true,
      version,
      path: finalPath,
      source,
      headers: {
        Vary: configuredHeader,
        ...lifecycleHeaders,
      },
    };
  }

  return {
    resolve,
    headersFor,
  };
}

/**
 * Converts a Versioning instance into a Connect/Express-style middleware handler.
 *
 * @param v - A Versioning engine instance.
 * @param opts - Middleware options including optional time injection.
 * @returns Connect middleware handler (req, res, next).
 */
export function toConnectMiddleware(
  v: Versioning,
  opts?: ConnectMiddlewareOptions,
): ConnectMiddleware {
  const getNow = opts?.now ?? (() => new Date());

  return (req, res, next) => {
    let path = "/";
    if (typeof req.path === "string") {
      path = req.path;
    } else if (typeof req.url === "string") {
      path = req.url.split("?")[0] ?? "/";
    }

    const headers = req.headers ?? {};
    const now = getNow();
    const resolution = v.resolve({ path, headers }, now);

    if (resolution.ok) {
      for (const [header, val] of Object.entries(resolution.headers)) {
        res.setHeader(header, val);
      }
      req.apiVersion = resolution.version;
      next();
      return;
    }

    if (resolution.status === 410) {
      const version =
        sunsetVersionMap.get(resolution) ?? extractVersionCandidate(path, headers) ?? "1";
      const body = JSON.stringify({
        type: "about:blank",
        title: "Gone",
        status: 410,
        detail: `API version ${version} is no longer available`,
      });
      if (typeof res.status === "function") {
        res.status(410);
      }
      res.statusCode = 410;
      res.setHeader("Content-Type", "application/problem+json");
      res.end(body);
      return;
    }

    // 400 Bad Request responses
    let detail = "Bad Request";
    if (resolution.code === "version_conflict") {
      detail = "Version conflict between path and header";
    } else if (resolution.code === "unsupported_version") {
      detail = "Requested API version is not supported";
    } else if (resolution.code === "invalid_header") {
      detail = "Invalid API version header";
    }

    const body = JSON.stringify({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail,
    });
    if (typeof res.status === "function") {
      res.status(400);
    }
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/problem+json");
    res.end(body);
  };
}

function extractVersionCandidate(
  path: string,
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const pathMatch = /^\/v(\d{1,3})(?=\/|$)/.exec(path);
  if (pathMatch && pathMatch[1] !== undefined) {
    return pathMatch[1];
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "api-version") {
      if (Array.isArray(v)) {
        return v[0]?.trim();
      }
      if (typeof v === "string") {
        return v.trim();
      }
    }
  }
  return undefined;
}
