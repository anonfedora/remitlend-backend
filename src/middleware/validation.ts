import type { Request, Response, NextFunction } from 'express';
import { type ZodSchema } from 'zod';

/**
 * Express middleware factory that validates incoming requests against
 * a Zod schema. On validation failure the error is forwarded to the
 * global error handler via `next(error)`.
 */
export const validate = (schema: ZodSchema) => {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            schema.parse({
                body: req.body,
                query: req.query,
                params: req.params
            });
            next();
        } catch (error) {
            next(error);
        }
    };
};
