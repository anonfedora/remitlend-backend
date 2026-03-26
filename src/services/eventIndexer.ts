import { SorobanRpc, xdr, scValToNative } from "@stellar/stellar-sdk";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import {
  WebhookEventType,
  IndexedLoanEvent,
  webhookService,
} from "./webhookService.js";
import { eventStreamService } from "./eventStreamService.js";

// Typing for raw Soroban events
interface SorobanRawEvent {
  id: string;
  pagingToken: string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
}

interface LoanEvent extends IndexedLoanEvent {
  amount?: string;
  loanId?: number;
  borrower: string;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
  interestRateBps?: number;
  termLedgers?: number;
}

export class EventIndexer {
  private rpc: SorobanRpc.Server;
  private contractId: string;

  constructor(rpcUrl: string, contractId: string) {
    this.rpc = new SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
  }

  /**
   * Main entry point to process contract events from a sequence range
   */
  async processEvents(startLedger: number, endLedger: number): Promise<number> {
    try {
      const response = await this.rpc.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [this.contractId],
          },
        ],
      });

      const events = response.events as unknown as SorobanRawEvent[];
      if (events.length === 0) return endLedger;

      logger.info(`Found ${events.length} events from contract ${this.contractId}`);

      const processed = await this.storeEvents(events);
      return processed;
    } catch (error) {
      logger.error("Error processing events:", error);
      throw error;
    }
  }

  private async storeEvents(events: SorobanRawEvent[]): Promise<number> {
    const result: LoanEvent[] = [];

    for (const e of events) {
      try {
        const type = this.decodeEventType(e.topic[0]);
        if (!type) continue;

        let borrower = "";
        let loanId: number | undefined;
        let amount: string | undefined;
        let interestRateBps: number | undefined;
        let termLedgers: number | undefined;

        if (type === "LoanRequested") {
          borrower = this.decodeAddress(e.topic[1]);
          amount = this.decodeAmount(e.value);
        } else if (type === "LoanApproved") {
          loanId = this.decodeLoanId(e.topic[1]);
          if (loanId === undefined) continue;
          // Capture current contract defaults at time of approval
          interestRateBps = 1200; // Matches contract DEFAULT_INTEREST_RATE_BPS
          termLedgers = 17280; // Matches contract DEFAULT_TERM_LEDGERS
        } else if (type === "LoanRepaid") {
          if (!e.topic[2]) continue;
          borrower = this.decodeAddress(e.topic[1]);
          loanId = this.decodeLoanId(e.topic[2]);
          amount = this.decodeAmount(e.value);
        } else if (type === "LoanDefaulted") {
          loanId = this.decodeLoanId(e.topic[1]);
          if (loanId === undefined) continue;
          borrower = this.decodeAddress(e.value);
        } else if (type === "Seized") {
          borrower = this.decodeAddress(e.topic[1]);
        }

        const evt: LoanEvent = {
          eventId: e.id,
          eventType: type,
          ledger: e.ledger,
          ledgerClosedAt: new Date(e.ledgerClosedAt),
          txHash: e.txHash,
          contractId: e.contractId.toString(),
          topics: e.topic.map((t) => t.toXDR("base64")),
          value: e.value.toXDR("base64"),
          ...(amount !== undefined ? { amount } : {}),
          ...(loanId !== undefined ? { loanId } : {}),
          ...(interestRateBps !== undefined ? { interestRateBps } : {}),
          ...(termLedgers !== undefined ? { termLedgers } : {}),
          borrower,
        };
        result.push(evt);
      } catch (err) {
        logger.warn(`Failed to parse event ${e.id}:`, err);
      }
    }

    if (result.length === 0) return events[events.length - 1].ledger;

    // Use transaction for database insertion
    await query("BEGIN", []);
    try {
      for (const e of result) {
        // Check for duplicates
        const ex = await query(
          "SELECT 1 FROM loan_events WHERE event_id = $1",
          [e.eventId],
        );
        if (ex.rows.length) continue;
        await query(
          `INSERT INTO loan_events (event_id, event_type, loan_id, borrower, amount, ledger, ledger_closed_at, tx_hash, contract_id, topics, value, interest_rate_bps, term_ledgers)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            e.eventId,
            e.eventType,
            e.loanId || null,
            e.borrower || null,
            e.amount || null,
            e.ledger,
            e.ledgerClosedAt,
            e.txHash,
            e.contractId,
            JSON.stringify(e.topics),
            e.value,
            e.interestRateBps || null,
            e.termLedgers || null,
          ],
        );

        // Update score in bi-directional way (increase on repay, decrease on default)
        if (e.eventType === "LoanRepaid") {
          await this.updateUserScore(e.borrower, 15); // +15 for repayment
        } else if (e.eventType === "LoanDefaulted") {
          await this.updateUserScore(e.borrower, -50); // penalty for default
        }

        // Dispatch webhooks
        webhookService.dispatch(e).catch((err) => {
          logger.error(`Webhook dispatch failed for ${e.eventId}:`, err);
        });

        // Broadcast to SSE clients for real-time updates
        eventStreamService.broadcast({
          eventId: e.eventId,
          eventType: e.eventType,
          ...(e.loanId !== undefined ? { loanId: e.loanId } : {}),
          borrower: e.borrower,
          ...(e.amount !== undefined ? { amount: e.amount } : {}),
          ledger: e.ledger,
          ledgerClosedAt: e.ledgerClosedAt.toISOString(),
          txHash: e.txHash,
        });

        // Trigger notifications
        this.triggerNotification(e).catch((err) => {
          logger.error(`Notification trigger failed for ${e.eventId}:`, err);
        });
      }
      await query("COMMIT", []);
    } catch (err) {
      await query("ROLLBACK", []);
      throw err;
    }

    return events[events.length - 1].ledger;
  }

  private async updateUserScore(userId: string, delta: number): Promise<void> {
    if (!userId) return;
    try {
      await query(
        `INSERT INTO scores (user_id, current_score)
         VALUES ($1, $2)
         ON CONFLICT (user_id) 
         DO UPDATE SET 
           current_score = LEAST(850, GREATEST(300, scores.current_score + $3)),
           updated_at = CURRENT_TIMESTAMP`,
        [userId, 500 + delta, delta],
      );
      logger.info(`Updated score for user ${userId} by ${delta} points`);
    } catch (error) {
      logger.error(`Failed to update score for user ${userId}:`, error);
    }
  }

  private async triggerNotification(event: LoanEvent): Promise<void> {
    if (!event.borrower) return;

    let title = "";
    let message = "";

    switch (event.eventType) {
      case "LoanApproved":
        title = "Loan Approved";
        message = event.loanId
          ? `Your loan #${event.loanId} has been approved.`
          : "Your loan has been approved.";
        break;
      case "LoanRepaid":
        title = "Repayment Confirmed";
        message = event.loanId
          ? `Repayment for loan #${event.loanId} has been confirmed.`
          : "Your loan repayment has been confirmed.";
        break;
      case "LoanDefaulted":
        title = "Loan Defaulted";
        message = event.loanId
          ? `Loan #${event.loanId} has been marked as defaulted.`
          : "A loan has been marked as defaulted.";
        break;
    }

    if (title && message) {
      await query(
        `INSERT INTO notifications (user_id, title, message, loan_id)
         VALUES ($1, $2, $3, $4)`,
        [event.borrower, title, message, event.loanId || null],
      );
    }
  }

  // Decoding helpers
  private decodeAddress(x: xdr.ScVal): string {
    return scValToNative(x).toString();
  }

  private decodeAmount(x: xdr.ScVal): string {
    return scValToNative(x).toString(); // BigInt amount
  }

  private decodeLoanId(x: xdr.ScVal): number | undefined {
    try {
      return Number(scValToNative(x));
    } catch {
      return undefined;
    }
  }

  private decodeEventType(x: xdr.ScVal): WebhookEventType | null {
    try {
      const s = x.sym().toString();
      const supported: string[] = [
        "LoanRequested",
        "LoanApproved",
        "LoanRepaid",
        "LoanDefaulted",
        "Seized",
        "Paused",
        "Unpaused",
        "MinScoreUpdated",
      ];
      return supported.includes(s) ? (s as WebhookEventType) : null;
    } catch {
      return null;
    }
  }
}
