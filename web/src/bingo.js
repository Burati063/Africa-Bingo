const COLUMNS = ['B', 'I', 'N', 'G', 'O'];
const RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

export { COLUMNS, RANGES };

export function letterFor(number) {
  if (number >= 1 && number <= 15) return 'B';
  if (number <= 30) return 'I';
  if (number <= 45) return 'N';
  if (number <= 60) return 'G';
  return 'O';
}

export function callLabel(number) {
  if (!number) return '--';
  return `${letterFor(number)}${number}`;
}
