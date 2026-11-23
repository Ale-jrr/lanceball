export const uclClubs = Object.freeze([
  'PSG', 'Real Madrid', 'Arsenal', 'Como', 'Barcelona', 'Aston Villa',
  'Manchester City', 'Liverpool', 'Borussia Dortmund', 'Bayern de Munique',
  'Inter de Milão', 'Manchester United', 'Atlético de Madrid', 'PSV',
  'Bodø/Glimt', 'Porto', 'Napoli', 'Villarreal', 'RB Leipzig',
  'Chelsea', 'Juventus', 'Milan', 'Benfica', 'Ajax',
]);

const clubIds = [9847, 8633, 9825, 10171, 8634, 10252, 8456, 8650, 9789, 9823,
  8636, 10260, 9906, 8640, 8402, 9773, 9875, 10205, 178475, 8455, 9885, 8564, 9772, 8593];

export const clubCrests = new Map(uclClubs.map((club, index) => [
  club, `https://images.fotmob.com/image_resources/logo/teamlogo/${clubIds[index]}.png`,
]));
