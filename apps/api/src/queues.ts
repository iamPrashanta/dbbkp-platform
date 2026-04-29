import { Queue } from "bullmq";

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

export const backupQueue = new Queue("backup", { connection });
export const infraQueue  = new Queue("infra",  { connection });
export const pipelineQueue = new Queue("pipeline", { connection });
