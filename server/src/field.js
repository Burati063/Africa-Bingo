export function field(text, labels) {
  const re = new RegExp(`${labels[0]}\\s*[:：-]?\\s*([^\\n]{1,160})`, 'i');
  const match = text.match(re);
  if (match && match[1].trim()) return match[1].trim();
  return null;
}
