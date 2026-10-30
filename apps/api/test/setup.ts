import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

process.env.NODE_ENV = "test";
loadDotenv({ path: resolve(process.cwd(), ".env.test"), quiet: true });
