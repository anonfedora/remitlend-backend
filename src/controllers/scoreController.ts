import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";

// ---------------------------------------------------------------------------
// Score computation helpers
// ---------------------------------------------------------------------------

/** Credit bands matching typical lending tiers */
type CreditBand = "Excellent" | "Good" | "Fair" | "Poor";

function getCreditBand(score: number): CreditBand {
  if (score >= 750) return "Excellent";
  if (score >= 670) return "Good";
  if (score >= 580) return "Fair";
  return "Poor";
}

/**
 * Derive a deterministic base score from a userId so that every call to
 * getScore for the same user returns consistent data without a database.
 * Range: 500–850 (typical credit score window).
 */
function baseScore(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return 500 + (hash % 351); // [500, 850]
}

// ---------------------------------------------------------------------------
// Score delta constants (tunable)
// ---------------------------------------------------------------------------
/** Points awarded for an on-time repayment */
const ON_TIME_DELTA = 15;
/** Points deducted for a late / missed repayment */
const LATE_DELTA = -30;

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/**
 * GET /api/score/:userId
 *
 * Returns the current credit score for a user along with their credit band
 * and the key factors that influence the score.  Intended to be called by
 * LoanManager and other contracts that need to make lending decisions.
 */
export const getScore = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  const score = baseScore(userId);
  const band = getCreditBand(score);

  res.json({
    success: true,
    userId,
    score,
    band,
    factors: {
      repaymentHistory: "On-time payments increase score by 15 pts each",
      latePaymentPenalty: "Late payments decrease score by 30 pts each",
      range: "500 (Poor) – 850 (Excellent)",
    },
  });
});

/**
 * POST /api/score/update
 *
 * Updates a user's credit score based on a single repayment event.
 * Protected by the `requireApiKey` middleware — only authorised internal
 * services (e.g. LoanManager workers) may call this endpoint.
 *
 * Body: { userId: string, repaymentAmount: number, onTime: boolean }
 */
export const updateScore = asyncHandler(async (req: Request, res: Response) => {
  const { userId, repaymentAmount, onTime } = req.body as {
    userId: string;
    repaymentAmount: number;
    onTime: boolean;
  };

  const oldScore = baseScore(userId);
  const delta = onTime ? ON_TIME_DELTA : LATE_DELTA;

  // Clamp new score within the valid credit-score window [300, 850]
  const newScore = Math.min(850, Math.max(300, oldScore + delta));
  const band = getCreditBand(newScore);

  res.json({
    success: true,
    userId,
    repaymentAmount,
    onTime,
    oldScore,
    delta,
    newScore,
    band,
  });
});
