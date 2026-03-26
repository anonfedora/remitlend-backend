import type { Response } from "express";
import logger from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoanEventPayload {
  eventId: string;
  eventType: string;
  loanId?: number;
  borrower: string;
  amount?: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
}

// ─── SSE client registry ──────────────────────────────────────────────────────

type SseClient = Response;

/** Borrower-specific SSE clients: borrowerPublicKey → Set<Response> */
const borrowerClients = new Map<string, Set<SseClient>>();

/** Admin SSE clients listening to all events */
const adminClients = new Set<SseClient>();

// ─── Event Stream Service ─────────────────────────────────────────────────────

class EventStreamService {
  /**
   * Registers an SSE client for a specific borrower's events.
   * Returns an unsubscribe function for cleanup on disconnect.
   */
  subscribeBorrower(borrower: string, res: SseClient): () => void {
    if (!borrowerClients.has(borrower)) {
      borrowerClients.set(borrower, new Set());
    }
    borrowerClients.get(borrower)!.add(res);

    logger.info("SSE client subscribed to borrower events", { borrower });

    return () => {
      borrowerClients.get(borrower)?.delete(res);
      if (borrowerClients.get(borrower)?.size === 0) {
        borrowerClients.delete(borrower);
      }
      logger.info("SSE client unsubscribed from borrower events", { borrower });
    };
  }

  /**
   * Registers an SSE client for all events (admin stream).
   * Returns an unsubscribe function for cleanup on disconnect.
   */
  subscribeAll(res: SseClient): () => void {
    adminClients.add(res);

    logger.info("SSE admin client subscribed to all events");

    return () => {
      adminClients.delete(res);
      logger.info("SSE admin client unsubscribed from all events");
    };
  }

  /**
   * Broadcasts a loan event to relevant SSE clients:
   * - Borrower-specific clients for that borrower
   * - All admin clients
   */
  broadcast(event: LoanEventPayload): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;

    // Push to borrower-specific clients
    if (event.borrower) {
      const clients = borrowerClients.get(event.borrower);
      if (clients?.size) {
        for (const res of clients) {
          try {
            res.write(data);
          } catch (err) {
            logger.error("SSE write error (borrower)", {
              borrower: event.borrower,
              err,
            });
            clients.delete(res);
          }
        }
      }
    }

    // Push to admin clients
    for (const res of adminClients) {
      try {
        res.write(data);
      } catch (err) {
        logger.error("SSE write error (admin)", { err });
        adminClients.delete(res);
      }
    }
  }

  /** Returns the number of active SSE connections. */
  getConnectionCount(): { borrower: number; admin: number; total: number } {
    let borrowerCount = 0;
    for (const clients of borrowerClients.values()) {
      borrowerCount += clients.size;
    }
    return {
      borrower: borrowerCount,
      admin: adminClients.size,
      total: borrowerCount + adminClients.size,
    };
  }
}

export const eventStreamService = new EventStreamService();
