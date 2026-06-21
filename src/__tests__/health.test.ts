import { jest } from "@jest/globals";
import request from "supertest";

// Use unstable_mockModule for robust ESM mocking
jest.unstable_mockModule("../db/connection.js", () => ({
  default: {
    query: jest
      .fn<() => Promise<any>>()
      .mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  query: jest
    .fn<() => Promise<any>>()
    .mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

// Use dynamic import for app to ensure mocks are applied
const { default: app } = await import("../app.js");

describe("GET /health", () => {
  it("should return 200 or 503 with a status field", async () => {
    const response = await request(app).get("/health");

    expect([200, 503]).toContain(response.status);
    expect(["ok", "degraded"]).toContain(response.body.status);
  });

  it("should always report api check as ok", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("checks");
    expect(response.body.checks.api).toBe("ok");
  });

  it("should include soroban_rpc in checks", async () => {
    const response = await request(app).get("/health");

    expect(response.body.checks).toHaveProperty("soroban_rpc");
    expect(["ok", "error"]).toContain(response.body.checks.soroban_rpc);
  });

  it("should return uptime as a number", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("uptime");
    expect(typeof response.body.uptime).toBe("number");
  });

  it("should return timestamp as a number", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("timestamp");
    expect(typeof response.body.timestamp).toBe("number");
  });
});

describe("GET /health resilience", () => {
  // Allow generous time for module re-imports + supertest boot on slow CI.
  jest.setTimeout(15000);

  const ORIGINAL_TIMEOUT_ENV = process.env.HEALTH_CHECK_TIMEOUT_MS;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    // Always restore the env so a failed assertion can't leak state into
    // other tests in the suite.
    if (ORIGINAL_TIMEOUT_ENV === undefined) {
      delete process.env.HEALTH_CHECK_TIMEOUT_MS;
    } else {
      process.env.HEALTH_CHECK_TIMEOUT_MS = ORIGINAL_TIMEOUT_ENV;
    }
  });

  it("returns within a bounded timeout when a dependency hangs", async () => {
    // Force a tight per-check timeout so the assertion window is short
    // and the test does not depend on the 2-second default.
    process.env.HEALTH_CHECK_TIMEOUT_MS = "200";

    jest.unstable_mockModule("../db/connection.js", () => ({
      default: {
        // Simulate a database that never settles — mirrors a stuck TCP socket.
        query: jest.fn<() => Promise<unknown>>(
          () => new Promise(() => {}) as Promise<unknown>,
        ),
      },
      query: jest.fn<() => Promise<unknown>>(
        () => new Promise(() => {}) as Promise<unknown>,
      ),
      getClient: jest.fn(),
      withTransaction: jest.fn(),
    }));

    jest.unstable_mockModule("../services/cacheService.js", () => ({
      cacheService: {
        ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
      },
    }));

    jest.unstable_mockModule("../services/sorobanService.js", () => ({
      sorobanService: {
        ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
      },
    }));

    const { default: appWithStuckDb } = await import("../app.js");

    const start = Date.now();
    const response = await request(appWithStuckDb).get("/health");
    const elapsed = Date.now() - start;

    // The per-check timeout is 200ms; assert the endpoint failed fast
    // with the hung dep marked as error, well under jest's 5s window.
    expect(elapsed).toBeLessThan(1500);
    expect(response.status).toBe(503);
    expect(response.body.checks.database).toBe("error");
    expect(response.body.status).toBe("down");
  });

  it("honors a tiny HEALTH_CHECK_TIMEOUT_MS override", async () => {
    process.env.HEALTH_CHECK_TIMEOUT_MS = "1";

    jest.unstable_mockModule("../db/connection.js", () => ({
      default: {
        query: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          rows: [],
          rowCount: 0,
        }),
      },
      query: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        rows: [],
        rowCount: 0,
      }),
      getClient: jest.fn(),
      withTransaction: jest.fn(),
    }));

    jest.unstable_mockModule("../services/cacheService.js", () => ({
      cacheService: {
        ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
      },
    }));

    // A Soroban ping that hangs forever — the 1ms override must kick in.
    jest.unstable_mockModule("../services/sorobanService.js", () => ({
      sorobanService: {
        ping: jest.fn<() => Promise<string>>(
          () => new Promise(() => {}) as Promise<string>,
        ),
      },
    }));

    const { default: appWithCustomTimeout } = await import("../app.js");

    const start = Date.now();
    const response = await request(appWithCustomTimeout).get("/health");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(response.body.checks.soroban_rpc).toBe("error");
  });
});
