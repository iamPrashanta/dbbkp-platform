import express from "express";
import cors from "cors";
import backupRouter from "./routes/backup";
import infraRouter from "./routes/infra";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/backup", backupRouter);
app.use("/api/infra", infraRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Control Plane API] Listening on port ${PORT}`);
});
