/**
 * 75-ball bingo card logic.
 * A card is stored as 5 columns (B, I, N, G, O) of 5 numbers each, so
 * card[col][row]. Numbers are unique per column and drawn from its range.
 */
const COLUMN_RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

export const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'];

function sample(range, count) {
  const pool = [];
  for (let n = range[0]; n <= range[1]; n += 1) pool.push(n);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function generateCard() {
  const card = COLUMN_RANGES.map((range) => sample(range, 5));
  card[2][2] = 0; // free space
  return card;
}

export function isMarked(card, calledSet) {
  return card.map((column) => column.map((n) => n === 0 || calledSet.has(n)));
}

/**
 * All 12 winning lines on a 5x5 grid as [col, row] pairs.
 */
export function winningLines() {
  const lines = [];
  for (let row = 0; row < 5; row += 1) {
    lines.push(Array.from({ length: 5 }, (_, col) => [col, row]));
  }
  for (let col = 0; col < 5; col += 1) {
    lines.push(Array.from({ length: 5 }, (_, row) => [col, row]));
  }
  lines.push(Array.from({ length: 5 }, (_, i) => [i, i]));
  lines.push(Array.from({ length: 5 }, (_, i) => [i, 4 - i]));
  return lines;
}

const LINES = winningLines();

function lineComplete(card, calledSet, line) {
  return line.every(([col, row]) => {
    const n = card[col][row];
    return n === 0 || calledSet.has(n);
  });
}

export function hasLine(card, calledSet) {
  return LINES.some((line) => lineComplete(card, calledSet, line));
}

/**
 * Returns the first completed line on a card as [col, row] pairs, or null.
 * Used by the winner screen to highlight the winning selection.
 */
export function winningLineFor(card, calledSet) {
  return LINES.find((line) => lineComplete(card, calledSet, line)) || null;
}

export function cardHasBingo(cards, calledSet) {
  return (cards || []).some((card) => hasLine(card, calledSet));
}

export function shuffleDeck() {
  const deck = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function columnOf(number) {
  if (number >= 1 && number <= 15) return 0;
  if (number <= 30) return 1;
  if (number <= 45) return 2;
  if (number <= 60) return 3;
  return 4;
}
