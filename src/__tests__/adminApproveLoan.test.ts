import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = "test-internal-key";
const TEST_ADMIN = Keypair.random().publicKey();
const TEST_BORROWER = Keypair.random().publicKey();

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.INTERNAL_API_KEY = VALID_API_KEY;
process.env.ADMIN_WALLETS = TEST_ADMIN;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const mockRelease = jest.fn();
const mockClient: any = {
  query: mockQuery,
  release: mockRelease,
};

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest
    .fn<() => Promise<typeof mockClient>>()
    .mockResolvedValue(mockClient),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    get: jest.fn<() => Promise<any>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

const mockBuildApproveLoanTx =
  jest.fn<
    (
      adminPublicKey: string,
      loanId: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockSubmitSignedTx =
  jest.fn<
    (
      signedTxXdr: string,
    ) => Promise<{ txHash: string; status: string; resultXdr?: string }>
  >();

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    buildApproveLoanTx: mockBuildApproveLoanTx,
    submitSignedTx: mockSubmitSignedTx,
  },
}));

await import("../db/connection.js");
await import("../services/sorobanService.js");
const { default: app } = await import("../app.js");

const mockedQuery = mockQuery;

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

beforeEach(() => {
  mockedQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.ADMIN_WALLETS;
});

// ---------------------------------------------------------------------------
// POST /admin/approve-loan
// ---------------------------------------------------------------------------
describe("POST /admin/approve-loan", () => {
  it("should build an approve_loan transaction for admin", async () => {
    mockBuildApproveLoanTx.mockResolvedValueOnce({
      unsignedTxXdr: "unsigned-approve-xdr",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const response = await request(app)
      .post("/api/admin/approve-loan")
      .set(bearer(TEST_ADMIN))
      .send({ loanId: 1 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe("unsigned-approve-xdr");
    expect(response.body.networkPassphrase).toBe(
      "Test SDF Network ; September 2015",
    );
    expect(mockBuildApproveLoanTx).toHaveBeenCalledWith(TEST_ADMIN, 1);
  });

  it("should reject non-admin user", async () => {
    const response = await request(app)
      .post("/api/admin/approve-loan")
      .set(bearer(TEST_BORROWER))
      .send({ loanId: 1 });

    expect(response.status).toBe(403);
  });

  it("should reject missing loanId", async () => {
    const response = await request(app)
      .post("/api/admin/approve-loan")
      .set(bearer(TEST_ADMIN))
      .send({});

    expect(response.status).toBe(400);
  });

  it("should reject invalid loanId (non-positive integer)", async () => {
    const response = await request(app)
      .post("/api/admin/approve-loan")
      .set(bearer(TEST_ADMIN))
      .send({ loanId: -1 });

    expect(response.status).toBe(400);
  });

  it("should reject missing authentication", async () => {
    const response = await request(app)
      .post("/api/admin/approve-loan")
      .send({ loanId: 1 });

    expect(response.status).toBe(401);
  });
});
