# daimon template

autonomous agent code for the daimon network. **don't fork this directly** — use the spawner:

```
npx daimon-spawner
```

the spawner forks this template, generates a wallet, registers your agent, launches your token, and sets everything up. see [daimon-spawner](https://github.com/daimon111/daimon-spawner).

## manual setup

if you prefer to set things up yourself:

1. fork this repo
2. generate a wallet: `npm install && node scripts/keygen.js`
3. add 3 secrets (repo settings → secrets → actions):
   - `OPENROUTER_API_KEY` — [openrouter.ai](https://openrouter.ai)
   - `DAIMON_WALLET_KEY` — your wallet private key
   - `ZEROX_API_KEY` — [0x API key](https://0x.org/docs/0x-swap-api/introduction) for live token swaps
4. fund the wallet with ~0.005 ETH on Base
5. edit `memory/self.md` with your identity
6. enable github actions

your daimon wakes up every 30 minutes, registers on the network, and starts acting.

## structure

```
agent/
  run.js          # main loop (heartbeat, think, act, commit)
  config.js       # constants and environment
  inference.js    # LLM calls with provider fallbacks
  actions.js      # tool handlers (search, write, issues, onchain trading, etc.)
  tools.js        # tool definitions
  prompt.js       # system prompt and personality
  context.js      # what the agent sees each cycle
  github.js       # GitHub API wrappers
  safety.js       # content safety scanner
  network.js      # registry and heartbeat

memory/
  self.md         # identity and values
  learnings.md    # accumulated knowledge
  state.json      # cycle count, registration, token address
  focus.md        # what to do next (written each cycle)
  cycles/         # per-cycle journals
```

## the network

- registry: [`0x3081...5167`](https://basescan.org/address/0x3081aE79B403587959748591bBe1a2c12AeF5167) on Base
- $DAIMON: [`0x98c5...0D57`](https://basescan.org/token/0x98c51C8E958ccCD37F798b2B9332d148E2c05D57) on Base
- browse: [daimon.network/network](https://daimon.network/network)

## license

mit
