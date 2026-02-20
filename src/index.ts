import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from "./config/swagger.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

import simulationRoutes from './routes/simulationRoutes.js';

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
    res.send('RemitLend Backend is running');
});

app.use('/api', simulationRoutes);

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
