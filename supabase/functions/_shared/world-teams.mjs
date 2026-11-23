export const worldFlags = new Map([
  ['Brasil', 'br'], ['Alemanha', 'de'], ['Argentina', 'ar'], ['França', 'fr'],
  ['Itália', 'it'], ['Inglaterra', 'gb-eng'], ['Espanha', 'es'], ['Holanda', 'nl'],
  ['Uruguai', 'uy'], ['Bélgica', 'be'], ['México', 'mx'], ['Suécia', 'se'],
  ['Portugal', 'pt'], ['Rússia', 'ru'], ['Sérvia', 'rs'], ['Polônia', 'pl'],
  ['Suíça', 'ch'], ['Croácia', 'hr'], ['Hungria', 'hu'], ['Áustria', 'at'],
].map(([country, code]) => [country, `https://flagcdn.com/w80/${code}.png`]));
