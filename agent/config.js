// daimon config — constants and environment
// daimon: you can change MODEL and MAX_TOKENS but don't remove SAFETY_MODEL

const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

// repo identity — auto-detected from GITHUB_REPOSITORY env var (set by GitHub Actions)
const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || "your-username/your-repo").split("/");

// LLM provider — supports venice or openrouter (set one during spawn)
const VENICE_KEY = process.env.VENICE_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const LLM_KEY = VENICE_KEY || OPENROUTER_KEY;
const LLM_PROVIDER = VENICE_KEY ? "venice" : "openrouter";
const GROQ_KEY = process.env.GROQ_API_KEY;
const GH_TOKEN = process.env.GH_TOKEN;

// model names differ per provider
const MODELS = {
  venice: { main: "zai-org-glm-5", safety: "openai-gpt-oss-120b" },
  openrouter: { main: "z-ai/glm-5", safety: "openai/gpt-oss-safeguard-20b" },
};
const MODEL = MODELS[LLM_PROVIDER].main;
const MAX_TOKENS = 16384;
const MAX_STEPS = 40; // max inference calls per cycle (prevents runaway)
const SAFETY_MODEL = MODELS[LLM_PROVIDER].safety;

// wallet — your daimon's onchain identity
const DAIMON_WALLET_KEY = process.env.DAIMON_WALLET_KEY;
// const SAFE_ADDRESS = "0x0000000000000000000000000000000000000000"; // uncomment + set if you use a Safe
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const ZEROX_API_KEY = process.env.ZEROX_API_KEY || "";

module.exports = {
  REPO_ROOT, OWNER, REPO, LLM_KEY, LLM_PROVIDER, GROQ_KEY, GH_TOKEN,
  MODEL, MAX_TOKENS, MAX_STEPS, SAFETY_MODEL,
  DAIMON_WALLET_KEY, BASE_RPC, ZEROX_API_KEY,
};
