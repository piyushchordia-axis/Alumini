import express from "express";

const app = express();
app.get("/api/v1/health", (_req, res) => {
  res.json({ data: { status: "ok" } });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
