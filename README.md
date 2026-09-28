# Avalon · The Round Table

**Play now: https://tristanmatthias.github.io/avalon/**

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
2. **Two message paths at once.**
   - *Direct WebRTC:* [Trystero](https://github.com/dmotz/trystero) finds the other phones through public Nostr relays and BitTorrent WebSocket trackers, then connects them directly over encrypted WebRTC data channels.
   - *Encrypted relay (`src/relay.js`):* the same messages also go through several public MQTT brokers over ordinary secure WebSockets. This works on networks where direct connections fail, such as mobile data or Wi-Fi that isolates devices.

   Every message carries an ID, so whichever copy arrives first is used and the duplicate is dropped. Relay traffic is encrypted with a key derived from the room ID, so the brokers only see noise. Messages meant for one player, like their role or a quest card, are also encrypted with a key only the sender and that player share (ECDH), so the other players in the room can't read them either.
3. **Authoritative host.** The person who created the game runs the rules engine (`src/game.js`) in their browser. Each player sends their actions (propose, vote, play a card…) to the host. The host validates them and sends every player a view personalised for them (`viewFor`). Your role and what you know only ever travel to your own phone, and nobody else's device receives them.
4. **Identity.** Each phone keeps a random secret token in `localStorage`, and the host maps it to a public seat ID. That lets players reload or reconnect without losing their seat, and one player can't act as another.

**Trade-off:** the host's browser holds the full game state, so a determined host could open dev tools and peek at roles. That's fine between friends. Fixing it properly would need a "mental poker" cryptographic protocol, which is a lot of complexity for a party game. If the host's phone goes to sleep, everyone waits until it comes back, and the app keeps the screen awake to help avoid that.

**If someone is stuck on "Seeking the host…",** that screen says which step is failing:

- *Can't reach any signalling servers*: the network blocks them. Switch between Wi-Fi and mobile data.
- *Waiting for the host's phone to answer*: the host's tab is closed or their screen is off.
- *Couldn't open a direct connection*: the two networks won't allow a direct link (common on some mobile carriers). Put everyone on the same Wi-Fi, or add a TURN server via `turnConfig` in `src/net.js`.

For troubleshooting you can force specific servers in the URL with `?relay=wss://…` (Nostr), `?tracker=wss://…` (BitTorrent) or `?mqtt=wss://…` (relay). Use `none` to switch a path off. The build ID shown on the home and "Seeking the host…" screens tells you which version a phone has loaded.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # rules-engine unit tests
npm run build    # static site in dist/
```

**Testing without several phones:** add `?local` to the URL (for example `http://localhost:5173/?local`). The app then syncs between browser tabs using `BroadcastChannel` instead of WebRTC, and each tab is its own player. Create a game in one tab, then open the game link in four more tabs.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` runs the tests, builds the site and publishes it whenever the repository's default branch is pushed (other branches only build and test).

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Pages for private repositories needs a paid GitHub plan. Otherwise, make the repo public.

The build uses relative paths, so it works at `https://<user>.github.io/<repo>/` or on any other static host (Netlify, Cloudflare Pages, a USB stick…).

## Code map

| File | What it does |
| --- | --- |
| `src/game.js` | Pure rules engine: roles, knowledge, voting, quests, Lady of the Lake, assassination, per-player views |
| `src/session.js` | Host and client logic: authoritative state, personalised views, reconnection |
| `src/net.js` | Transports: direct WebRTC and the encrypted relay combined, or `BroadcastChannel` for local testing |
| `src/relay.js` | Minimal MQTT-over-WebSocket client with room and per-player (ECDH) encryption |
| `src/main.js` | Mobile UI: lobby, round table, voting, quest cards and announcements |
| `src/style.css`, `src/icons.js` | Arthurian theme, heraldry and icons |
