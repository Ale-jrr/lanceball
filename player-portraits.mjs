function commons(file, folder, width, author, license, label) {
  const name = encodeURIComponent(file).replaceAll('(', '%28').replaceAll(')', '%29');
  return {
    src: `https://thumb.wikimedia.org/wikipedia/commons/thumb/${folder}/${name}/${width}px-${name}`,
    original: `https://upload.wikimedia.org/wikipedia/commons/${folder}/${name}`,
    source: 'https://commons.wikimedia.org/wiki/File:' + name,
    license: 'https://creativecommons.org/licenses/' + license + '/',
    label,
    author,
  };
}

const portraits = new Map([
  ['231747', commons('Kylian_Mbappé_2018.jpg', 'e/e5', 250, 'Anton Zaitsev', 'by-sa/3.0', 'CC BY-SA 3.0')],
  ['239085', commons('Erling_Haaland_2023.jpg', '1/10', 250, 'Jacek Stanislawek', 'by-sa/4.0', 'CC BY-SA 4.0')],
  ['252371', commons('Jude_Bellingham_Laureus_2024_(cropped2).jpg', '8/88', 250, 'Barcex', 'by-sa/4.0', 'CC BY-SA 4.0')],
  ['209331', commons('Mo_Salah_2018_(cropped).jpg', 'b/bd', 250, 'Kevin Walsh', 'by/2.0', 'CC BY 2.0')],
  ['203376', commons('Virgil_van_Dijk_2019.jpg', '1/11', 120, '@cfcunofficial (Chelsea Debs) London', 'by-sa/2.0', 'CC BY-SA 2.0')],
]);

export function playerPortrait(id) {
  return portraits.get(id) ?? null;
}
