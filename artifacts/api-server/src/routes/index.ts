import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scrapeRouter from "./scrape";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scrapeRouter);

export default router;
