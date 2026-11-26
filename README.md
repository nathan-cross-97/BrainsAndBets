# Brains & Bets

A party game for 2–7 players. Every answer is a number: everyone guesses, the guesses line up on a betting mat, and you bet on whose guess is closest without going over. One big screen shows the game; everyone plays on their phone.

## How to run

You need [Node.js](https://nodejs.org) 18 or newer on the computer that will host the game.

```
git clone https://github.com/nathan-cross-97/BrainsAndBets.git
cd BrainsAndBets
npm install
npm start
```

The terminal prints two addresses: the host screen and the address for phones.

### Start a game

1. On the host computer, open **http://localhost:3000/host** and put it on a screen everyone can see.
2. Each player scans the QR code with their phone camera and types a name. Phones must be on the same Wi-Fi as the host computer. No app or account is needed.
3. Pick a timer in the lobby (30, 60 or 90 seconds per phase, or off) and press **Start game**. You need 2 to 7 players.

The host screen only shows the game. To play yourself, join from your own phone like everyone else.

### Options

- **Different port:** `PORT=8080 npm start`
- **Stop the server:** press `Ctrl+C` in the terminal. Games live in memory, so stopping the server ends them.
- **Friends who are not on your Wi-Fi:** deploy this folder to any Node host (it reads `PORT` and needs no database). The QR code then points at that address.

### If phones can't connect

- Check that the phone is on the same Wi-Fi network as the host computer, not on mobile data or a guest network.
- Allow Node through the computer's firewall when it asks (private networks).
- If the QR code shows the wrong address (for example when a VPN is on), type the address the terminal printed under "Players on the same Wi-Fi" into the phone's browser, or turn the VPN off and restart.
- If a phone locks or reloads mid-game, reopening the page puts that player back in their seat.

## Rules

- 7 questions. Most chips at the end wins; ties share the win.
- **Guess:** everyone types a number. Guesses stay hidden until guessing closes.
- **Mat:** guesses sit smallest to largest, one per space, filling outward from the middle. Odds are 2:1 in the middle, then 3:1, 4:1 and 5:1 at the edges. Spaces with no guess are blocked (5 guesses block both 5:1 spaces, 6 block the 2:1 space, 7 block none).
- **Bet:** you have two tokens and must bet both every round, on the same space or two different ones:
  - any space holding a guess,
  - **All too high** (6:1), which wins if every guess is over the answer,
  - **Red** or **Black** (1:1), which win if the winning guess sits on a space of that color.
- **Chips:** from the second question on you can stack chips you have won under a token. A token counts as 1. A winning bet pays (1 + stacked chips) × the odds and keeps its chips. A losing bet loses its stacked chips; tokens always come back.
- **Winner:** the closest guess without going over. If several people wrote it, every space holding it pays and each of them gets the bonus.
- **Bonus:** whoever wrote the winning guess gets chips equal to the round number (1 to 7). If every guess is too high, only **All too high** pays and there is no bonus.
- Tokens still off the mat when betting closes go on your own guess.
- **Skip:** while guessing is open, anyone can vote to skip the question. When more than half of the players have voted, it is swapped for a new one and the round restarts (2 of 2, 2 of 3, 3 of 4, 3 of 5, 4 of 6, 4 of 7).

## Customize

- Questions: `src/questions.json` (`q` text, `a` numeric answer, `year: true` to show without a thousands separator).
- Odds, space colors and bonuses: the constants at the top of `src/game.js`.
- Timer (30/60/90 seconds or off) is set in the lobby.

## Test

```
npm test
```
