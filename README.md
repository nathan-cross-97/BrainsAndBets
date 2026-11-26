# Brains & Bets

A party game for 2–7 players. Every answer is a number: everyone guesses, the guesses line up on a betting mat, and you bet on whose guess is closest without going over. One big screen shows the game; everyone plays on their phone.

## Play

```
npm install
npm start
```

1. Open **http://localhost:3000/host** on the laptop or TV everyone can see.
2. Players scan the QR code with their phones (same Wi-Fi as the host computer).
3. Press **Start game**.

To play with people who are not on your Wi-Fi, deploy this folder to any Node host (it reads `PORT`); the QR code then points at that address.

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

## Customize

- Questions: `src/questions.json` (`q` text, `a` numeric answer, `year: true` to show without a thousands separator).
- Odds, space colors and bonuses: the constants at the top of `src/game.js`.
- Timer (30/60/90 seconds or off) is set in the lobby.

## Test

```
npm test
```
