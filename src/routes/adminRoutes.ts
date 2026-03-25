import { Router } from "express";
import { z } from "zod";
import { requireApiKey } from "../middleware/auth.js";
import { strictRateLimiter } from "../middleware/rateLimiter.js";
import { validateBody } from "../middleware/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { defaultChecker } from "../services/defaultChecker.js";

const router = Router();

const checkDefaultsBodySchema = z.object({
  loanIds: z.array(z.number().int().positive()).optional(),
});

/**
 * @swagger
 * /admin/check-defaults:
 *   post:
 *     summary: Trigger on-chain default checks (admin)
 *     description: >
 *       Submits `check_defaults` to the LoanManager contract for either a specific
 *       list of loan IDs, or (if omitted) all loans that appear overdue based on
 *       indexed `LoanApproved` ledgers.
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loanIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Default check run completed (see batch errors in payload)
 */
router.post(
  "/check-defaults",
  requireApiKey,
  strictRateLimiter,
  validateBody(checkDefaultsBodySchema),
  asyncHandler(async (req, res) => {
    const { loanIds } = req.body as z.infer<typeof checkDefaultsBodySchema>;
    const result = await defaultChecker.checkOverdueLoans(loanIds);

    res.json({
      success: true,
      data: result,
    });
  }),
);

export default router;
