// action execution — runs the tools daimon calls
// daimon: you can ADD new handlers here. go wild.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { ethers } = require("ethers");
const { REPO_ROOT, BASE_RPC, DAIMON_WALLET_KEY, ZEROX_API_KEY } = require("./config");
const { githubAPI, addToProject } = require("./github");
// inference import removed — web_search now uses DuckDuckGo directly

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const filesChanged = new Set();

const BASE_CHAIN_ID = 8453;
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

function normalizeToken(token) {
  if (!token) throw new Error("token is required");
  if (token.toUpperCase() === "ETH") return ETH_SENTINEL;
  return token;
}

function isNativeToken(token) {
  return token === ETH_SENTINEL;
}

function getWallet() {
  if (!DAIMON_WALLET_KEY) throw new Error("DAIMON_WALLET_KEY is not set");
  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  return new ethers.Wallet(DAIMON_WALLET_KEY, provider);
}

// executes a tool call and returns the result string
async function executeTool(name, args) {
  switch (name) {
    case "write_file": {
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, args.content, "utf-8");
      filesChanged.add(args.path);
      log(`wrote: ${args.path} (${args.content.length} chars)`);
      return `wrote ${args.path} (${args.content.length} chars)`;
    }
    case "append_file": {
      // block append on JSON files — corrupts them
      if (args.path.endsWith(".json")) {
        log(`blocked append_file on JSON: ${args.path}`);
        return `error: cannot append to JSON files — use write_file() with the full valid JSON instead. read the file first, modify it, then write_file() the complete content.`;
      }
      // block append to old daily journal format
      if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(args.path)) {
        log(`blocked append to deprecated daily journal: ${args.path}`);
        return `error: daily journal format (memory/YYYY-MM-DD.md) is deprecated. write your journal to memory/cycles/<cycle_number>.md instead using write_file().`;
      }
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.appendFileSync(fullPath, "\n" + args.content, "utf-8");
      filesChanged.add(args.path);
      log(`appended: ${args.path}`);
      return `appended to ${args.path}`;
    }
    case "read_file": {
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      if (!fs.existsSync(fullPath)) return `file not found: ${args.path}`;
      const raw = fs.readFileSync(fullPath, "utf-8");
      const lines = raw.split("\n");
      const totalLines = lines.length;

      // support offset/limit for partial reads
      const offset = Math.max(1, args.offset || 1);
      const limit = args.limit || totalLines;
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const content = slice.join("\n");

      const rangeInfo = args.offset || args.limit
        ? ` (lines ${offset}-${offset + slice.length - 1} of ${totalLines})`
        : "";
      log(`read: ${args.path}${rangeInfo} (${content.length} chars)`);
      return content.length > 4000
        ? content.slice(0, 4000) + `\n... (truncated, ${totalLines} total lines)`
        : content + (rangeInfo ? `\n--- ${totalLines} total lines ---` : "");
    }
    case "create_issue": {
      const issue = await githubAPI("/issues", {
        method: "POST",
        body: JSON.stringify({
          title: args.title,
          body: args.body || "",
          labels: args.labels || [],
        }),
      });
      log(`created issue #${issue.number}: ${issue.title}`);
      if (issue.node_id) await addToProject(issue.node_id);
      return `created issue #${issue.number}: ${issue.title}`;
    }
    case "close_issue": {
      if (args.comment) {
        await githubAPI(`/issues/${args.number}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: args.comment }),
        });
      }
      await githubAPI(`/issues/${args.number}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed" }),
      });
      log(`closed issue #${args.number}`);
      return `closed issue #${args.number}`;
    }
    case "comment_issue": {
      await githubAPI(`/issues/${args.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: args.body }),
      });
      log(`commented on issue #${args.number}`);
      return `commented on issue #${args.number}`;
    }
    case "web_search": {
      log(`searching: ${args.query}`);
      try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
        const res = await fetch(searchUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; daimon/1.0)" },
        });
        const html = await res.text();
        // extract result titles, snippets, and URLs from DDG HTML
        const results = [];
        const blocks = html.split(/class="result results_links/g).slice(1, 8);
        for (const block of blocks) {
          const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)/);
          const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
          const urlMatch = block.match(/class="result__url"[^>]*href="([^"]+)"/);
          if (titleMatch) {
            const title = titleMatch[1].trim();
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";
            const url = urlMatch ? urlMatch[1].trim() : "";
            results.push(`${title}\n  ${url}\n  ${snippet}`);
          }
        }
        const output = results.length > 0
          ? results.join("\n\n")
          : "(no results found)";
        log(`search: ${results.length} results for "${args.query}"`);
        return output.length > 4000 ? output.slice(0, 4000) + "\n... (truncated)" : output;
      } catch (e) {
        log(`search failed: ${e.message}`);
        return `search error: ${e.message}`;
      }
    }
    case "run_command": {
      // block git commands — run.js handles git automatically at end of cycle
      const gitPattern = /^\s*(git\s+(add|commit|push|pull|rebase|checkout|reset|stash))/i;
      if (gitPattern.test(args.command)) {
        log(`blocked git command: ${args.command.slice(0, 60)}`);
        return `error: git commands are not allowed. all changes are automatically committed and pushed at the end of your cycle. just use write_file() and your changes will be saved.`;
      }
      log(`running: ${args.command}`);
      try {
        const output = execSync(args.command, {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            OPENROUTER_API_KEY: "",
            GH_TOKEN: "",
            DAIMON_WALLET_KEY: "",
          },
        });
        log(`command output: ${output.slice(0, 150)}`);
        return output.length > 4000
          ? output.slice(0, 4000) + "\n... (truncated)"
          : output || "(no output)";
      } catch (e) {
        const stderr = e.stderr || e.message;
        log(`command failed: ${stderr.slice(0, 150)}`);
        return `error (exit ${e.status || "?"}): ${stderr.slice(0, 2000)}`;
      }
    }
    case "list_dir": {
      const dirPath = args.path || ".";
      const fullPath = path.resolve(REPO_ROOT, dirPath);
      if (!fullPath.startsWith(REPO_ROOT + "/") && fullPath !== REPO_ROOT) throw new Error("path escape attempt");
      if (!fs.existsSync(fullPath)) return `directory not found: ${dirPath}`;
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const listing = entries
        .filter((e) => !e.name.startsWith(".git") || e.name === ".github")
        .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
        .join("\n");
      log(`listed: ${dirPath} (${entries.length} entries)`);
      return listing || "(empty directory)";
    }
    case "search_files": {
      log(`searching for: ${args.pattern}`);
      try {
        if (/[`$();<>|&\\]/.test(args.pattern)) {
          return "error: pattern contains invalid characters";
        }
        const globArg = args.glob ? `--include="${args.glob.replace(/[^a-zA-Z0-9.*_-]/g, "")}"` : "";
        const searchPath = args.path || ".";
        const fullPath = path.resolve(REPO_ROOT, searchPath);
        if (!fullPath.startsWith(REPO_ROOT + "/") && fullPath !== REPO_ROOT) {
          throw new Error("path escape attempt");
        }
        const output = execSync(
          `grep -rn ${globArg} --max-count=5 -F "${args.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`,
          { cwd: REPO_ROOT, encoding: "utf-8", timeout: 10000 }
        );
        return output || "no matches found";
      } catch (e) {
        if (e.status === 1) return "no matches found";
        return `search error: ${e.message.slice(0, 200)}`;
      }
    }
    case "delete_file": {
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      if (!fs.existsSync(fullPath)) return `file not found: ${args.path}`;
      fs.unlinkSync(fullPath);
      filesChanged.add(args.path);
      log(`deleted: ${args.path}`);
      return `deleted ${args.path}`;
    }
    case "fetch_url": {
      log(`fetching: ${args.url}`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(args.url, {
          headers: { "User-Agent": "daimon/1.0" },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return `fetch failed: HTTP ${res.status}`;
        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();
        // if JSON, return as-is; if HTML, strip tags
        let content;
        if (contentType.includes("json")) {
          content = text;
        } else {
          content = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
        log(`fetched: ${args.url} (${content.length} chars)`);
        return content.length > 4000
          ? content.slice(0, 4000) + "\n... (truncated)"
          : content;
      } catch (e) {
        return `fetch error: ${e.message}`;
      }
    }
    case "search_memory": {
      log(`searching memory for: ${args.query}`);
      try {
        const memDir = path.resolve(REPO_ROOT, "memory");
        // collect all searchable files: top-level + cycles/
        const topFiles = fs.readdirSync(memDir)
          .filter(f => f.endsWith(".md") || f.endsWith(".json"))
          .map(f => ({ rel: `memory/${f}`, full: path.join(memDir, f) }));
        const cyclesDir = path.join(memDir, "cycles");
        const cycleFiles = fs.existsSync(cyclesDir)
          ? fs.readdirSync(cyclesDir)
              .filter(f => f.endsWith(".md"))
              .map(f => ({ rel: `memory/cycles/${f}`, full: path.join(cyclesDir, f) }))
          : [];
        const allFiles = [...topFiles, ...cycleFiles];
        const results = [];
        let pattern;
        try {
          pattern = new RegExp(args.query, "i");
        } catch (e) {
          return `invalid search pattern: ${e.message}`;
        }
        for (const file of allFiles) {
          const content = fs.readFileSync(file.full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length - 1, i + 1);
              const snippet = lines.slice(start, end + 1).join("\n");
              results.push(`${file.rel}:${i + 1}\n${snippet}`);
            }
          }
        }
        if (results.length === 0) return `no matches for "${args.query}" in memory/`;
        const output = results.slice(0, 20).join("\n---\n");
        log(`memory search: ${results.length} matches`);
        return output.length > 3000 ? output.slice(0, 3000) + "\n... (truncated)" : output;
      } catch (e) {
        return `memory search error: ${e.message}`;
      }
    }
    case "get_token_balance": {
      try {
        const provider = new ethers.JsonRpcProvider(BASE_RPC);
        const wallet = args.wallet || (DAIMON_WALLET_KEY ? new ethers.Wallet(DAIMON_WALLET_KEY).address : null);
        if (!wallet) return "error: wallet not provided and DAIMON_WALLET_KEY is not set";

        const token = normalizeToken(args.token);
        if (isNativeToken(token)) {
          const bal = await provider.getBalance(wallet);
          return JSON.stringify({
            wallet,
            token: "ETH",
            raw: bal.toString(),
            formatted: ethers.formatEther(bal),
          });
        }

        const contract = new ethers.Contract(token, ERC20_ABI, provider);
        const [balance, symbol, decimals] = await Promise.all([
          contract.balanceOf(wallet),
          contract.symbol().catch(() => "TOKEN"),
          contract.decimals().catch(() => 18),
        ]);

        return JSON.stringify({
          wallet,
          token,
          symbol,
          decimals,
          raw: balance.toString(),
          formatted: ethers.formatUnits(balance, decimals),
        });
      } catch (e) {
        return `balance error: ${e.message}`;
      }
    }
    case "trade_tokens": {
      try {
        const sellToken = normalizeToken(args.sellToken);
        const buyToken = normalizeToken(args.buyToken);
        const sellAmount = args.sellAmount?.toString();
        const slippageBps = Number.isInteger(args.slippageBps) ? args.slippageBps : 100;
        const dryRun = args.dryRun !== false;

        if (!/^\d+$/.test(sellAmount || "")) return "trade error: sellAmount must be an integer string in base units";
        if (!ZEROX_API_KEY) return "trade error: ZEROX_API_KEY is not set";

        const wallet = getWallet();
        const quoteParams = new URLSearchParams({
          chainId: String(BASE_CHAIN_ID),
          sellToken,
          buyToken,
          sellAmount,
          taker: wallet.address,
          slippageBps: String(slippageBps),
        });

        const quoteRes = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${quoteParams.toString()}`, {
          headers: {
            "0x-api-key": ZEROX_API_KEY,
            "0x-version": "v2",
          },
        });

        const quote = await quoteRes.json().catch(() => ({}));
        if (!quoteRes.ok) {
          return `trade quote error: HTTP ${quoteRes.status} ${JSON.stringify(quote).slice(0, 300)}`;
        }

        if (dryRun) {
          return JSON.stringify({
            mode: "dry_run",
            sellToken,
            buyToken,
            sellAmount,
            expectedBuyAmount: quote.buyAmount,
            minBuyAmount: quote.minBuyAmount,
            gas: quote.transaction?.gas,
            gasPrice: quote.transaction?.gasPrice,
            allowanceTarget: quote.allowanceTarget,
            issues: quote.issues || null,
          });
        }

        if (!isNativeToken(sellToken)) {
          const token = new ethers.Contract(sellToken, ERC20_ABI, wallet);
          const allowanceTarget = quote?.allowanceTarget;
          if (!allowanceTarget) return "trade error: quote missing allowanceTarget";
          const allowance = await token.allowance(wallet.address, allowanceTarget);
          if (allowance < BigInt(sellAmount)) {
            const approveTx = await token.approve(allowanceTarget, BigInt(sellAmount));
            await approveTx.wait();
          }
        }

        const txReq = quote.transaction || {};
        const sent = await wallet.sendTransaction({
          to: txReq.to,
          data: txReq.data,
          value: txReq.value ? BigInt(txReq.value) : 0n,
          gasLimit: txReq.gas ? BigInt(txReq.gas) : undefined,
          gasPrice: txReq.gasPrice ? BigInt(txReq.gasPrice) : undefined,
        });
        const receipt = await sent.wait();

        return JSON.stringify({
          mode: "executed",
          hash: sent.hash,
          blockNumber: receipt?.blockNumber,
          status: receipt?.status,
          expectedBuyAmount: quote.buyAmount,
          minBuyAmount: quote.minBuyAmount,
        });
      } catch (e) {
        return `trade error: ${e.message}`;
      }
    }

    case "github_search": {
      const type = args.type || "repositories";
      log(`github search (${type}): ${args.query}`);
      try {
        const q = encodeURIComponent(args.query);
        const data = await githubAPI(
          `https://api.github.com/search/${type}?q=${q}&per_page=10`,
          { raw: true }
        );
        if (type === "repositories") {
          return (data.items || [])
            .map((r) => `${r.full_name} (${r.stargazers_count}★) — ${r.description || "no description"}\n  ${r.html_url}`)
            .join("\n\n") || "no results";
        } else if (type === "code") {
          return (data.items || [])
            .map((r) => `${r.repository.full_name}: ${r.path}\n  ${r.html_url}`)
            .join("\n\n") || "no results";
        } else {
          return (data.items || [])
            .map((r) => `#${r.number}: ${r.title} (${r.state}) — ${r.repository_url}\n  ${r.html_url}`)
            .join("\n\n") || "no results";
        }
      } catch (e) {
        return `github search error: ${e.message}`;
      }
    }
    default:
      log(`unknown tool: ${name}`);
      return `unknown tool: ${name}`;
  }
}

module.exports = { executeTool, filesChanged };
