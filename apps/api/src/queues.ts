import { Queue } from "bullmq";

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

export const backupQueue = new Queue("backup", { connection });
export const infraQueue  = new Queue("infra",  { connection });
export const pipelineQueue = new Queue("pipeline", { connection });
export const hostingQueue = new Queue("hosting", { connection });
export const databaseQueue = new Queue("database", { connection });
export const cronQueue = new Queue("cron", { connection });
