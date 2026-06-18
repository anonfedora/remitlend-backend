import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "@jest/globals";
import {
  Keypair,
  Account,
  nativeToScVal,
  TransactionBuilder,
  Operation,
} from "@stellar/stellar-sdk";
import { AppError } from "../errors/AppError.js";

// Mock the logger to prevent cluttering stdout and to check log calls if needed
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule("../utils/logger.js", () => ({
  default: mockLogger,
  logger: mockLogger,
}));

// Mock the stellar config module
const mockCreateSorobanRpcServer = jest.fn<any>();
const mockGetStellarNetworkPassphrase = jest.fn<any>();
const mockGetStellarRpcUrl = jest.fn<any>();

jest.unstable_mockModule("../config/stellar.js", () => ({
  createSorobanRpcServer: mockCreateSorobanRpcServer,
  getStellarNetworkPassphrase: mockGetStellarNetworkPassphrase,
  getStellarRpcUrl: mockGetStellarRpcUrl,
}));

// Now dynamically import the service under test
const { sorobanService } = await import("../services/sorobanService.js");

describe("SorobanService", () => {
  const originalEnv = { ...process.env };

  const dummyUser = "GC35VRXT7EDRGEKC53D6YVKTKNKNHUGPW7QTUREWCV5TBWH4ZIKHZAKV";
  const dummyContract =
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  const dummySecret =
    "SAACQXICHBTMMZQXM5ISR4VG6ADO3M3VB5PEJ3PP7CMLSSPO4UZSYRZH";

  let dummyTxXdr: string;

  // Mocked RPC Server implementation
  const mockRpcServer = {
    getHealth: jest.fn<any>(),
    getLatestLedger: jest.fn<any>(),
    getAccount: jest.fn<any>(),
    prepareTransaction: jest.fn<any>(),
    sendTransaction: jest.fn<any>(),
    pollTransaction: jest.fn<any>(),
    simulateTransaction: jest.fn<any>(),
  };

  beforeAll(() => {
    // Generate a valid dummy transaction envelope XDR for fromXDR parsing
    const kp = Keypair.fromSecret(dummySecret);
    const acc = new Account(kp.publicKey(), "100");
    const tx = new TransactionBuilder(acc, {
      fee: "100",
      networkPassphrase: "Test SDF Network ; September 2015",
    })
      .addOperation(
        Operation.bumpSequence({
          bumpTo: "101",
        }),
      )
      .setTimeout(30)
      .build();
    dummyTxXdr = tx.toXDR();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockRpcServer.getHealth.mockReset();
    mockRpcServer.getLatestLedger.mockReset();
    mockRpcServer.getAccount.mockReset();
    mockRpcServer.prepareTransaction.mockReset();
    mockRpcServer.sendTransaction.mockReset();
    mockRpcServer.pollTransaction.mockReset();
    mockRpcServer.simulateTransaction.mockReset();

    mockCreateSorobanRpcServer.mockReturnValue(mockRpcServer);
    mockGetStellarNetworkPassphrase.mockReturnValue(
      "Test SDF Network ; September 2015",
    );
    mockGetStellarRpcUrl.mockReturnValue("https://soroban-testnet.stellar.org");

    // Setup standard test environment variables
    process.env.LOAN_MANAGER_CONTRACT_ID = dummyContract;
    process.env.LENDING_POOL_CONTRACT_ID = dummyContract;
    process.env.POOL_TOKEN_ADDRESS = dummyContract;
    process.env.REMITTANCE_NFT_CONTRACT_ID = dummyContract;
    process.env.SCORE_RECONCILIATION_SOURCE_SECRET = dummySecret;
    process.env.LOAN_MANAGER_ADMIN_SECRET = dummySecret;
    process.env.DEFAULT_CREDIT_SCORE = "500";
    process.env.SCORE_DELTA_REPAY = "15";
    process.env.SCORE_DELTA_DEFAULT = "50";
    process.env.SCORE_DELTA_LATE = "5";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("validateConfig", () => {
    it("should succeed when all environment variables are valid and RPC is reachable", async () => {
      mockRpcServer.getHealth.mockResolvedValue({ status: "healthy" });

      await expect(sorobanService.validateConfig()).resolves.not.toThrow();
      expect(mockRpcServer.getHealth).toHaveBeenCalled();
    });

    it("should throw AppError if LOAN_MANAGER_CONTRACT_ID is missing", async () => {
      delete process.env.LOAN_MANAGER_CONTRACT_ID;

      await expect(sorobanService.validateConfig()).rejects.toThrow(
        "LOAN_MANAGER_CONTRACT_ID is not configured",
      );
    });

    it("should throw AppError if LOAN_MANAGER_CONTRACT_ID is invalid", async () => {
      process.env.LOAN_MANAGER_CONTRACT_ID = "invalid-contract";

      await expect(sorobanService.validateConfig()).rejects.toThrow(
        'LOAN_MANAGER_CONTRACT_ID is not a valid Stellar contract address: "invalid-contract"',
      );
    });

    it("should throw AppError if getStellarRpcUrl throws", async () => {
      mockGetStellarRpcUrl.mockImplementation(() => {
        throw new Error("Missing stellar config");
      });

      await expect(sorobanService.validateConfig()).rejects.toThrow(
        "Missing stellar config",
      );
    });

    it("should throw AppError if RPC getHealth fails", async () => {
      mockRpcServer.getHealth.mockRejectedValue(
        new Error("Connection refused"),
      );

      await expect(sorobanService.validateConfig()).rejects.toThrow(
        "Stellar RPC is unreachable at https://soroban-testnet.stellar.org: Connection refused",
      );
    });
  });

  describe("healthCheck and ping", () => {
    it("ping should return 'ok' when RPC is reachable", async () => {
      mockRpcServer.getLatestLedger.mockResolvedValue({ sequence: 100 });

      await expect(sorobanService.ping()).resolves.toBe("ok");
    });

    it("ping should return 'error' when RPC is unreachable", async () => {
      mockRpcServer.getLatestLedger.mockRejectedValue(new Error("Timeout"));

      await expect(sorobanService.ping()).resolves.toBe("error");
    });

    it("healthCheck should return connected true and the sequence number", async () => {
      mockRpcServer.getLatestLedger.mockResolvedValue({ sequence: 999 });

      const res = await sorobanService.healthCheck();
      expect(res).toEqual({ connected: true, latestLedger: 999 });
    });

    it("healthCheck should return connected false and error message on failure", async () => {
      mockRpcServer.getLatestLedger.mockRejectedValue(new Error("RPC Timeout"));

      const res = await sorobanService.healthCheck();
      expect(res).toEqual({ connected: false, error: "RPC Timeout" });
    });
  });

  describe("build*Tx methods", () => {
    beforeEach(() => {
      mockRpcServer.getAccount.mockResolvedValue(new Account(dummyUser, "100"));
      mockRpcServer.prepareTransaction.mockResolvedValue({
        toXDR: () => "mocked-prepared-tx-xdr",
      });
    });

    it("buildRequestLoanTx should call RPC and return unsigned XDR", async () => {
      const res = await sorobanService.buildRequestLoanTx(dummyUser, 1000);

      expect(res).toEqual({
        unsignedTxXdr: "mocked-prepared-tx-xdr",
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      expect(mockRpcServer.getAccount).toHaveBeenCalledWith(dummyUser);
      expect(mockRpcServer.prepareTransaction).toHaveBeenCalled();
    });

    it("buildRepayTx should call RPC and return unsigned XDR", async () => {
      const res = await sorobanService.buildRepayTx(dummyUser, 42, 500);

      expect(res).toEqual({
        unsignedTxXdr: "mocked-prepared-tx-xdr",
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      expect(mockRpcServer.getAccount).toHaveBeenCalledWith(dummyUser);
      expect(mockRpcServer.prepareTransaction).toHaveBeenCalled();
    });

    it("buildDepositTx should call RPC and return unsigned XDR", async () => {
      const res = await sorobanService.buildDepositTx(
        dummyUser,
        dummyContract,
        750,
      );

      expect(res.unsignedTxXdr).toBe("mocked-prepared-tx-xdr");
    });

    it("buildWithdrawTx should call RPC and return unsigned XDR", async () => {
      const res = await sorobanService.buildWithdrawTx(
        dummyUser,
        dummyContract,
        100,
      );

      expect(res.unsignedTxXdr).toBe("mocked-prepared-tx-xdr");
    });

    it("buildApproveLoanTx should call RPC and return unsigned XDR", async () => {
      const res = await sorobanService.buildApproveLoanTx(dummyUser, 12);

      expect(res.unsignedTxXdr).toBe("mocked-prepared-tx-xdr");
    });
  });

  describe("submitSignedTx", () => {
    it("should submit transaction and poll successfully", async () => {
      mockRpcServer.sendTransaction.mockResolvedValue({
        hash: "tx-hash-12345",
        status: "PENDING",
      });
      mockRpcServer.pollTransaction.mockResolvedValue({
        status: "SUCCESS",
        resultXdr: {
          toXDR: () => "result-xdr-base64",
        },
      });

      const res = await sorobanService.submitSignedTx(dummyTxXdr);

      expect(res).toEqual({
        txHash: "tx-hash-12345",
        status: "SUCCESS",
        resultXdr: "result-xdr-base64",
      });
      expect(mockRpcServer.sendTransaction).toHaveBeenCalled();
      expect(mockRpcServer.pollTransaction).toHaveBeenCalledWith(
        "tx-hash-12345",
        expect.any(Object),
      );
    });

    it("should throw AppError if transaction submission does not return a hash", async () => {
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "ERROR",
      });

      await expect(sorobanService.submitSignedTx(dummyTxXdr)).rejects.toThrow(
        "Transaction submission returned no hash",
      );
    });

    it("should return status without resultXdr if poll transaction does not succeed", async () => {
      mockRpcServer.sendTransaction.mockResolvedValue({
        hash: "tx-hash-12345",
        status: "PENDING",
      });
      mockRpcServer.pollTransaction.mockResolvedValue({
        status: "FAILED",
      });

      const res = await sorobanService.submitSignedTx(dummyTxXdr);

      expect(res).toEqual({
        txHash: "tx-hash-12345",
        status: "FAILED",
      });
    });
  });

  describe("getOnChainCreditScore (Score Fallback Logic)", () => {
    const adminPublicKey =
      "GC35VRXT7EDRGEKC53D6YVKTKNKNHUGPW7QTUREWCV5TBWH4ZIKHZAKV";

    beforeEach(() => {
      mockRpcServer.getAccount.mockResolvedValue(
        new Account(adminPublicKey, "100"),
      );
    });

    it("should return the score on successful simulation", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal(620),
        },
      });

      const score = await sorobanService.getOnChainCreditScore(dummyUser);

      expect(score).toBe(620);
      expect(mockRpcServer.simulateTransaction).toHaveBeenCalledTimes(1);
    });

    it("should fallback to default score when simulation returns a missing-score error", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: "HostError: Error(Value, NotFound)",
      });

      const score = await sorobanService.getOnChainCreditScore(dummyUser);

      expect(score).toBe(500); // Default score configured in process.env
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Falling back to default credit score",
        expect.objectContaining({
          reason: "HostError: Error(Value, NotFound)",
        }),
      );
    });

    it("should retry on transient simulation error and succeed if second attempt succeeds", async () => {
      mockRpcServer.simulateTransaction
        .mockResolvedValueOnce({
          error: "RPC Timeout calling simulateTransaction",
        })
        .mockResolvedValueOnce({
          result: {
            retval: nativeToScVal(700),
          },
        });

      const score = await sorobanService.getOnChainCreditScore(dummyUser);

      expect(score).toBe(700);
      expect(mockRpcServer.simulateTransaction).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Retrying get_score simulation after transient RPC failure",
        expect.objectContaining({
          attempt: 1,
          error: "RPC Timeout calling simulateTransaction",
        }),
      );
    });

    it("should retry and fallback to default score if all attempts return transient errors", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: "503 Service Unavailable",
      });

      const score = await sorobanService.getOnChainCreditScore(dummyUser);

      expect(score).toBe(500); // Fallback
      expect(mockRpcServer.simulateTransaction).toHaveBeenCalledTimes(2); // Retries once (attempts: 1, 2)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Falling back to default credit score",
        expect.objectContaining({
          reason: "503 Service Unavailable",
        }),
      );
    });

    it("should throw AppError if simulation returns a hard error", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: "Contract panic: index out of bounds",
      });

      await expect(
        sorobanService.getOnChainCreditScore(dummyUser),
      ).rejects.toThrow(
        "Failed to simulate get_score for GC35VRXT7EDRGEKC53D6YVKTKNKNHUGPW7QTUREWCV5TBWH4ZIKHZAKV: Contract panic: index out of bounds",
      );
      expect(mockRpcServer.simulateTransaction).toHaveBeenCalledTimes(1); // No retry for hard errors
    });

    it("should fallback to default score if simulation returns empty object or no result/error", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({} as any);

      const score = await sorobanService.getOnChainCreditScore(dummyUser);

      expect(score).toBe(500);
    });

    it("should fallback to default score if simulation retval is missing", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {},
      } as any);

      const score = await sorobanService.getOnChainCreditScore(dummyUser);

      expect(score).toBe(500);
    });

    it("should fallback to default score if simulation retval is not a finite number", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal("not-a-number"),
        },
      });

      const score = await sorobanService.getOnChainCreditScore(dummyUser);

      expect(score).toBe(500);
    });
  });

  describe("getOnChainScoreHistory", () => {
    const adminPublicKey =
      "GC35VRXT7EDRGEKC53D6YVKTKNKNHUGPW7QTUREWCV5TBWH4ZIKHZAKV";

    beforeEach(() => {
      mockRpcServer.getAccount.mockResolvedValue(
        new Account(adminPublicKey, "100"),
      );
    });

    it("should return history sorted ascending by timestamp", async () => {
      const mockHistory = [
        { ledger: 200, old_score: 550, new_score: 565, reason: "Repay" },
        { ledger: 150, old_score: 500, new_score: 550, reason: "Repay" },
      ];

      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal(mockHistory),
        },
      });

      const history = await sorobanService.getOnChainScoreHistory(dummyUser);

      expect(history).toEqual([
        { score: 550, timestamp: 150, reason: "Repay" },
        { score: 565, timestamp: 200, reason: "Repay" },
      ]);
    });

    it("should filter out invalid history entries", async () => {
      const mockHistory = [
        { ledger: 200, old_score: 550, new_score: 565, reason: "Repay" },
        { ledger: "invalid", old_score: 500, new_score: 550, reason: "Repay" }, // filtered out
        { ledger: 150, old_score: 500, new_score: 550, reason: "" }, // filtered out (empty reason)
      ];

      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal(mockHistory),
        },
      });

      const history = await sorobanService.getOnChainScoreHistory(dummyUser);

      expect(history).toEqual([
        { score: 565, timestamp: 200, reason: "Repay" },
      ]);
    });

    it("should return empty array if simulation retval is missing", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {},
      } as any);

      const history = await sorobanService.getOnChainScoreHistory(dummyUser);

      expect(history).toEqual([]);
    });

    it("should throw AppError if simulation returns error", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: "Contract execution failed",
      });

      await expect(
        sorobanService.getOnChainScoreHistory(dummyUser),
      ).rejects.toThrow(
        "Failed to simulate get_score_history for GC35VRXT7EDRGEKC53D6YVKTKNKNHUGPW7QTUREWCV5TBWH4ZIKHZAKV: Contract execution failed",
      );
    });
  });

  describe("getPoolBalance", () => {
    const adminPublicKey =
      "GC35VRXT7EDRGEKC53D6YVKTKNKNHUGPW7QTUREWCV5TBWH4ZIKHZAKV";

    beforeEach(() => {
      mockRpcServer.getAccount.mockResolvedValue(
        new Account(adminPublicKey, "100"),
      );
    });

    it("should return pool balance on success", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal(1000000000000n),
        },
      });

      const balance = await sorobanService.getPoolBalance();

      expect(balance).toBe(1000000000000);
    });

    it("should throw AppError if simulation fails", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: "Simulation failed",
      });

      await expect(sorobanService.getPoolBalance()).rejects.toThrow(
        "Failed to simulate pool balance: Simulation failed",
      );
    });

    it("should throw AppError if retval is missing", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {},
      } as any);

      await expect(sorobanService.getPoolBalance()).rejects.toThrow(
        "No balance returned by pool token",
      );
    });

    it("should throw AppError if balance is not a finite number", async () => {
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal("not-a-number"),
        },
      });

      await expect(sorobanService.getPoolBalance()).rejects.toThrow(
        "Invalid on-chain balance returned",
      );
    });
  });

  describe("getScoreConfig and validateScoreConfig", () => {
    it("should successfully return score configs", () => {
      const config = sorobanService.getScoreConfig();

      expect(config).toEqual({
        repaymentDelta: 15,
        defaultPenalty: 50,
        latePenalty: 5,
      });
    });

    it("should succeed validation with default values", () => {
      expect(() => sorobanService.validateScoreConfig()).not.toThrow();
    });

    it("should throw AppError if a config is not a valid integer", () => {
      process.env.SCORE_DELTA_REPAY = "abc";

      expect(() => sorobanService.validateScoreConfig()).toThrow(
        'SCORE_DELTA_REPAY must be a valid integer: "abc"',
      );
    });

    it("should throw AppError if a positive-required config is negative or zero", () => {
      process.env.SCORE_DELTA_DEFAULT = "0";

      expect(() => sorobanService.validateScoreConfig()).toThrow(
        "SCORE_DELTA_DEFAULT must be a positive integer: 0",
      );
    });
  });
});
