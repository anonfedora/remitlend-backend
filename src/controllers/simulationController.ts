import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const getRemittanceHistory = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    // Mock data simulation
    const history = [
        { month: 'January', amount: 500, status: 'Completed' },
        { month: 'February', amount: 500, status: 'Completed' },
        { month: 'March', amount: 500, status: 'Completed' },
    ];

    res.json({
        userId,
        score: 750,
        streak: 3,
        history
    });
});

export const simulatePayment = asyncHandler(async (req: Request, res: Response) => {
    const { userId, amount } = req.body;
    // Simulate payment logic
    res.json({
        success: true,
        message: `Payment of ${amount} for user ${userId} simulated.`,
        newScore: 760
    });
});
