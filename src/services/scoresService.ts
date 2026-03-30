import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

/**
 * Apply multiple user score deltas. The `updates` map contains userId => delta
 * (can be positive or negative). For each user, we insert a row with an initial
 * score of 500 + delta and on conflict update by adding the delta.
 */
export async function updateUserScoresBulk(
  updates: Map<string, number>,
): Promise<void> {
  if (!updates || updates.size === 0) return;

  try {
    for (const [userId, delta] of updates) {
      // skip empty user ids
      if (!userId) continue;

      const currentScore = 500 + delta;
      await query(
        `INSERT INTO scores (user_id, current_score)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET
           current_score = LEAST(850, GREATEST(300, scores.current_score + $3)),
           updated_at = CURRENT_TIMESTAMP`,
        [userId, currentScore, delta],
      );
    }
    logger.info("Applied bulk user score updates", {
      updatedCount: updates.size,
    });
  } catch (error) {
    logger.error("Failed to apply bulk user score updates", { error });
    throw error;
  }
}
