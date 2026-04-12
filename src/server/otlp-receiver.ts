import { Router, type Request, type Response } from "express";
import type { MetricsStore } from "../store/metrics-store.js";
import type { OtlpMetricsPayload, OtlpLogsPayload, OtlpTracesPayload } from "../types/otlp.js";

export function createOtlpRouter(store: MetricsStore): Router {
  const router = Router();

  // OTLP metrics endpoint
  router.post("/v1/metrics", (req: Request, res: Response) => {
    try {
      const payload = req.body as OtlpMetricsPayload;
      if (payload && payload.resourceMetrics) {
        store.ingestMetrics(payload);
      }
      // OTLP spec: return partial success
      res.status(200).json({ partialSuccess: {} });
    } catch (err) {
      console.error("[OTLP] Error processing metrics:", err);
      res.status(400).json({ error: "Invalid metrics payload" });
    }
  });

  // OTLP logs endpoint
  router.post("/v1/logs", (req: Request, res: Response) => {
    try {
      const payload = req.body as OtlpLogsPayload;
      if (payload && payload.resourceLogs) {
        store.ingestLogs(payload);
      }
      res.status(200).json({ partialSuccess: {} });
    } catch (err) {
      console.error("[OTLP] Error processing logs:", err);
      res.status(400).json({ error: "Invalid logs payload" });
    }
  });

  // OTLP traces endpoint
  router.post("/v1/traces", (req: Request, res: Response) => {
    try {
      const payload = req.body as OtlpTracesPayload;
      if (payload && payload.resourceSpans) {
        store.ingestTraces(payload);
      }
      res.status(200).json({ partialSuccess: {} });
    } catch (err) {
      console.error("[OTLP] Error processing traces:", err);
      res.status(400).json({ error: "Invalid traces payload" });
    }
  });

  // Health check
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: Date.now() });
  });

  return router;
}
