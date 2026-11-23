const positions = {
  GK: 'Goleiro', DEF: 'Defensor', MID: 'Meio-campista', FWD: 'Atacante',
  CB: 'Zagueiro', LB: 'Lateral-esquerdo', RB: 'Lateral-direito',
  LWB: 'Ala esquerdo', RWB: 'Ala direito',
  CDM: 'Volante', CM: 'Meia central', CAM: 'Meia-atacante',
  LM: 'Meia pela esquerda', RM: 'Meia pela direita',
  LW: 'Ponta-esquerda', RW: 'Ponta-direita', CF: 'Segundo atacante',
  ST: 'Centroavante', LF: 'Atacante pela esquerda', RF: 'Atacante pela direita',
};

export function positionName(code) {
  return Object.hasOwn(positions, code) ? positions[code] : null;
}

export function playerPositionName(player) {
  return positionName(player.primaryPosition) ?? positionName(player.position) ?? 'Posição não informada';
}
