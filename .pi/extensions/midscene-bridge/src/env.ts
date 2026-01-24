import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REQUIRED_ENV_KEYS = [
	"MIDSCENE_MODEL_BASE_URL",
	"MIDSCENE_MODEL_API_KEY",
	"MIDSCENE_MODEL_NAME",
	"MIDSCENE_MODEL_FAMILY",
	"MIDSCENE_PLANNING_MODEL_API_KEY",
	"MIDSCENE_PLANNING_MODEL_BASE_URL",
	"MIDSCENE_PLANNING_MODEL_NAME",
	"MIDSCENE_INSIGHT_MODEL_API_KEY",
	"MIDSCENE_INSIGHT_MODEL_BASE_URL",
	"MIDSCENE_INSIGHT_MODEL_NAME",
] as const;

export type MidsceneEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(extensionRoot, ".env");

let loaded = false;

export type EnvStatus = {
	envPath: string;
	missing: MidsceneEnvKey[];
};

export function loadMidsceneEnv(): EnvStatus {
	if (!loaded) {
		dotenv.config({ path: envPath });
		loaded = true;
	}

	const missing = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);
	return { envPath, missing };
}
