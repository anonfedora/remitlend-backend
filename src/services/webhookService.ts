import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  "LoanRequested",
  "LoanApproved",
  "LoanRepaid",
  "LoanDefaulted",
  "Seized",
  "Paused",
  "Unpaused",
  "MinScoreUpdated",
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENT_TYPES)[number];

export interface IndexedLoanEvent {
  eventId: string;
  eventType: WebhookEventType;
  loanId?: number;
  borrower: string;
  amount?: string;
  interestRateBps?: number;
  termLedgers?: number;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

export class WebhookService {
  /**
   * Identifies if an event is relevant for webhooks
   */
  static isSupported(type: string): type is WebhookEventType {
    return SUPPORTED_WEBHOOK_EVENT_TYPES.includes(type as WebhookEventType);
  }

  /**
   * Dispatches events to registered webhooks.
   * Currently, we just log them or store them in a way that
   * an external consumer can poll/receive them.
   */
  async dispatch(event: IndexedLoanEvent): Promise<void> {
    logger.info(`Dispatching webhook event: ${event.eventType}`, {
      loanId: event.loanId,
      borrower: event.borrower,
    });

    try {
      // 1. Fetch active webhooks for this borrower / event type
      // (Simplified: broadcast to all registered global webhooks)
      const webhooks = await query(
        "SELECT id, url, secret FROM webhooks WHERE is_active = true",
        [],
      );

      for (const hook of webhooks.rows) {
        // In a real implementation, this would be an async worker task
        // with retries, exponential backoff, etc.
        this.sendToWebhook(hook.url, hook.secret, event).catch((err) => {
          logger.error(`Failed to send to webhook ${hook.url}:`, err);
        });
      }
    } catch (error) {
      logger.error("Error during webhook dispatch:", error);
    }
  }

  private async sendToWebhook(
    url: string,
    secret: string,
    payload: IndexedLoanEvent,
  ): Promise<void> {
    // Implementation for signing and sending the POST request
    // const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    // await axios.post(url, payload, { headers: { 'X-RemitLend-Signature': signature } });
    logger.debug(`[Mock] Sending ${payload.eventType} to ${url}`);
  }
}

export const webhookService = new WebhookService();
