# Avalon · The Round Table

A mobile-first, peer-to-peer web version of **The Resistance: Avalon** for 5–10 players. One person creates a game and shares the link (or QR code). Everyone else opens it on their phone, enters a name and takes a seat. There's no backend or account, and nothing to install.

## Features

- Standard rules for 5–10 players: team sizes, quest sizes, and the double-fail rule on quest 4 with 7 or more players.
- Secret role dealing, with the right night-phase knowledge for each role.
- Optional characters: **Merlin & Assassin**, **Percival**, **Morgana**, **Mordred**, **Oberon** and **Lady of the Lake**.
- Team proposals by a rotating leader. Votes are simultaneous and revealed together, and five rejected proposals in a row hands the win to evil.
- Secret Success/Fail quest cards. Loyal servants can only succeed, and only the number of fails is revealed.
- An Assassin phase at the end, and a full role reveal when the game is over.
- A running chronicle of every proposal, vote and quest result.
- Players can refresh or rejoin and keep their seat. The host's game survives a refresh too, because it's saved in their browser.

## How the peer-to-peer part works

```
   ┌──────────┐  signalling only (encrypted offers)  ┌──────────────────┐
   │  Phone A │ ───────────────────────────────────▶ │ public Nostr     │
   │  (host)  │ ◀─────────────────────────────────── │ relays           │
   └────┬─────┘                                      └──────────────────┘
        │  direct WebRTC data channels (end-to-end encrypted)
   ┌────┴─────┬───────────┬───────────┐
   │ Phone B  │  Phone C  │  Phone D  │ …
```

1. **Room link.** The game link is `https://…/#<room-id>`. The room ID is 10 random characters and never leaves the URL fragment, so it isn't sent to any web server.
2. **Finding each other.** [Trystero](https://github.com/dmotz/trystero) uses public Nostr relays only to exchange WebRTC connection offers. Those offers are encrypted with the room ID as the password, so the relays can't read them. After that, all game traffic goes directly between phones over encrypted WebRTC data channels.
3. **Authoritative host.** The person who created the game runs the rules engine (`src/game.js`) in their browser. Each player sends their actions (propose, vote, play a card…) to the host. The host validates them and sends every player a view personalised for them (`viewFor`). Your role and what you know only ever travel to your own phone, and nobody else's device receives them.
4. **Identity.** Each phone keeps a random secret token in `localStorage`, and the host maps it to a public seat ID. That lets players reload or reconnect without losing their seat, and one player can't act as another.

**Trade-off:** the host's browser holds the full game state, so a determined host could open dev tools and peek at roles. That's fine between friends. Fixing it properly would need a "mental poker" cryptographic protocol, which is a lot of complexity for a party game. If the host's phone goes to sleep, everyone waits until it comes back, and the app keeps the screen awake to help avoid that.

If some phones can't connect (for example on strict carrier or corporate networks), put everyone on the same Wi-Fi, or add a TURN server via `turnConfig` in `src/net.js`.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # rules-engine unit tests
npm run build    # static site in dist/
```

**Testing without several phones:** add `?local` to the URL (for example `http://localhost:5173/?local`). The app then syncs between browser tabs using `BroadcastChannel` instead of WebRTC, and each tab is its own player. Create a game in one tab, then open the game link in four more tabs.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` runs the tests, builds the site and publishes it whenever the repository's default branch is pushed.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Pages for private repositories needs a paid GitHub plan. Otherwise, make the repo public.

The build uses relative paths, so it works at `https://<user>.github.io/<repo>/` or on any other static host (Netlify, Cloudflare Pages, a USB stick…).

## Code map

| File | What it does |
| --- | --- |
| `src/game.js` | Pure rules engine: roles, knowledge, voting, quests, Lady of the Lake, assassination, per-player views |
| `src/session.js` | Host and client logic: authoritative state, personalised views, reconnection |
| `src/net.js` | Transports: Trystero/Nostr WebRTC, or `BroadcastChannel` for local testing |
| `src/main.js` | Mobile UI: lobby, round table, voting, quest cards and announcements |
| `src/style.css`, `src/icons.js` | Arthurian theme, heraldry and icons |
