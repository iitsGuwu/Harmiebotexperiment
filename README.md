# Harmie Discord Bot

Discord extension for [harmie.xyz](https://harmie.xyz/) with:

- `/pageant` for one-hour Harmie matchups
- `/rankings` and `/harmie` backed by live site data
- `/unburn` for a random recovered burnt Harmie from `assets/burnt`
- `/meme` for a shuffled-cycle Harmie meme from `assets/harmie-memes`
- `/cis prompt`, `/cis random`, and `/cis status` for Harmie CIS image generation
- `/link-wallet`, `/reverify-wallet`, `/unlink-wallet`, and `/wallet`
- `/community-stats` plus `/wallet-audit`
- collection-wide `Buys/Sales` trade posts from Magic Eden

## Wallet Verification

Wallet linking now uses Sign-In with Solana instead of a raw custom `signMessage` flow.

- verification starts from Discord with an ephemeral embed
- the web page uses Wallet Standard discovery for compatible Solana wallets
- the server generates the SIWS input and verifies the returned signature server-side
- no transaction is sent, no approvals are requested, and signatures are not stored
- users can link multiple wallets, re-verify an existing wallet, and unlink old wallets
- linked wallets are reconciled in the background and stale links show up in `/wallet-audit`

Security hardening added in this pass:

- short-lived SIWS challenges with signed `requestId`
- origin checks and same-site CSRF cookie protection
- per-IP and per-Discord-user verification rate limits
- structured wallet-verification audit logs in SQLite
- encrypted-at-rest site auth tokens when `TOKEN_ENCRYPTION_KEY` is set

## Pageant Behavior

Pageant supports three vote modes:

- `discord`: vote lives only inside the bot's local tracker
- `site`: the bot calls the public `submit_vote` RPC directly
- `relay`: the bot calls a private backend or Supabase Edge Function with a shared secret

Recommended production setup is `PAGEANT_VOTE_MODE=relay`:

- the bot sends signed server-to-server vote requests
- the website keeps Captcha/Attack Protection enabled for public users
- if the relay is down, the Discord pageant silently keeps the vote locally for that matchup window so users do not hit a dead end
- `/rankings` still shows the live site rankings only

## Supabase Relay Deployment

This repo includes a ready-to-deploy Supabase Edge Function scaffold under [supabase/functions/pageant-vote/index.ts](/Users/wallaby/harmie-bot/supabase/functions/pageant-vote/index.ts) plus SQL under [supabase/migrations/20260424_pageant_vote_relay.sql](/Users/wallaby/harmie-bot/supabase/migrations/20260424_pageant_vote_relay.sql).

What the site developer needs to do:

1. Apply the SQL migration in their Supabase project.
2. Deploy the `pageant-vote` Edge Function.
3. Set `PAGEANT_BOT_SHARED_SECRET` in the function secrets.
4. Give you the deployed function URL and the same shared secret.
5. Have the bot set:

```bash
PAGEANT_VOTE_MODE=relay
PAGEANT_RELAY_URL=https://YOUR-PROJECT.supabase.co/functions/v1/pageant-vote
PAGEANT_RELAY_SECRET=your-shared-secret
```

The scaffold is designed so they can either:

- use the included SQL vote writer as-is, or
- swap the SQL function body to call their existing internal ranking/vote logic instead

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env file:

```bash
cp .env.example .env
```

3. Fill in your Discord app credentials and wallet/security settings.

4. Point the bot at the Harmie CIS backend:

```bash
HARMIE_CIS_BASE_URL=https://your-harmie-cis.example.com
```

`/cis status` will report the exact base URL the bot is using and whether it can reach that CIS app.

If the CIS app is only running locally but Neuko still needs to fetch the bundled reference images from a public URL, point the bot at its own public verifier domain and proxy to the local CIS app:

```bash
HARMIE_CIS_BASE_URL=https://verify.your-domain.example/harmie-cis/
HARMIE_CIS_PROXY_TARGET=http://127.0.0.1:3001
```

5. Register slash commands:

```bash
npm run register
```

6. Start the bot:

```bash
npm start
```

## Production Notes

- `PUBLIC_BASE_URL` must be reachable by users and must use `https://` outside localhost.
- `HARMIE_CIS_BASE_URL` should point at the running CIS app. If Neuko or the CIS frontend needs bundled reference images from that app, use a publicly reachable `https://` URL.
- `HARMIE_CIS_PROXY_TARGET` can stay on localhost when the bot server is proxying CIS through its public domain.
- `SOLANA_RPC_URL` should be a DAS-capable RPC that supports `searchAssets`.
- Set `SECURITY_SIGNING_KEY` to a 32-byte base64url secret.
- Set `TOKEN_ENCRYPTION_KEY` to a 32-byte base64url secret if you want Supabase session tokens encrypted at rest.
- Create a real production domain for the verifier, then complete Phantom domain verification with the DNS TXT record flow in Phantom Portal.
- For mobile users, the verification page includes an “Open in Phantom mobile” deeplink.

## Storage

- SQLite data lives at `./data/harmie-bot.sqlite` by default.
- Existing single-wallet rows are migrated into the new multi-wallet store on startup.
