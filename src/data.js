export const CLUB_COLORS = {
  ATH: '#e8414b', FCB: '#eb4254', ATM: '#df4b56', VAL: '#f2a934', BET: '#23a77c',
  RMA: '#6f8cdb', RSO: '#58a2dc', GIR: '#e95c55', VIL: '#e7cb43', CEL: '#6dad58',
  SEV: '#d75263', OSA: '#bd343d', GET: '#4c8bbc', ALV: '#3c95a8', ESP: '#3896d4',
};

export const DEMO_SQUAD = [
  { id: 'd1', name: 'Unai Simón', position: 'POR', club: 'Athletic Club', clubCode: 'ATH', price: 6.8, points: 54, form: 6.8, trend: 0.3, initials: 'US' },
  { id: 'd2', name: 'Dani Vivian', position: 'DEF', club: 'Athletic Club', clubCode: 'ATH', price: 5.7, points: 61, form: 7.6, trend: 0.2, initials: 'DV' },
  { id: 'd3', name: 'Pau Cubarsí', position: 'DEF', club: 'FC Barcelona', clubCode: 'FCB', price: 7.4, points: 66, form: 8.1, trend: 0.8, initials: 'PC' },
  { id: 'd4', name: 'Robin Le Normand', position: 'DEF', club: 'Atlético de Madrid', clubCode: 'ATM', price: 6.1, points: 49, form: 6.1, trend: -0.1, initials: 'LN' },
  { id: 'd5', name: 'José Gayà', position: 'DEF', club: 'Valencia CF', clubCode: 'VAL', price: 5.2, points: 45, form: 5.6, trend: 0.1, initials: 'JG' },
  { id: 'd6', name: 'Pedri', position: 'MED', club: 'FC Barcelona', clubCode: 'FCB', price: 12.8, points: 88, form: 9.4, trend: 0.9, initials: 'PE' },
  { id: 'd7', name: 'Oihan Sancet', position: 'MED', club: 'Athletic Club', clubCode: 'ATH', price: 9.6, points: 75, form: 8.3, trend: 0.4, initials: 'OS' },
  { id: 'd8', name: 'Isco', position: 'MED', club: 'Real Betis', clubCode: 'BET', price: 10.4, points: 71, form: 7.9, trend: 0.5, initials: 'IS' },
  { id: 'd9', name: 'Lamine Yamal', position: 'DEL', club: 'FC Barcelona', clubCode: 'FCB', price: 18.2, points: 112, form: 11.2, trend: 1.2, initials: 'LY' },
  { id: 'd10', name: 'Kylian Mbappé', position: 'DEL', club: 'Real Madrid', clubCode: 'RMA', price: 21.5, points: 105, form: 10.1, trend: 0.6, initials: 'KM' },
  { id: 'd11', name: 'Raphinha', position: 'DEL', club: 'FC Barcelona', clubCode: 'FCB', price: 15.4, points: 96, form: 9.1, trend: 0.8, initials: 'RA' },
];

export const DEMO_BENCH = [
  { id: 'b1', name: 'Álex Remiro', position: 'POR', club: 'Real Sociedad', clubCode: 'RSO', price: 5.9, points: 42, form: 5.2, trend: 0.1, initials: 'AR' },
  { id: 'b2', name: 'Marc Bartra', position: 'DEF', club: 'Real Betis', clubCode: 'BET', price: 3.1, points: 26, form: 4.4, trend: -0.1, initials: 'MB' },
  { id: 'b3', name: 'Fermín López', position: 'MED', club: 'FC Barcelona', clubCode: 'FCB', price: 7.6, points: 51, form: 7.2, trend: 0.6, initials: 'FL' },
  { id: 'b4', name: 'Take Kubo', position: 'DEL', club: 'Real Sociedad', clubCode: 'RSO', price: 11.3, points: 68, form: 7.8, trend: 0.3, initials: 'TK' },
];

export const DEMO_MARKET = [
  { id: 'm1', name: 'Mikel Oyarzabal', position: 'DEL', club: 'Real Sociedad', clubCode: 'RSO', price: 13.1, points: 83, form: 8.5, trend: 0.7, initials: 'MO', seller: '', tag: 'En forma' },
  { id: 'm2', name: 'Nico Williams', position: 'DEL', club: 'Athletic Club', clubCode: 'ATH', price: 14.7, points: 77, form: 8.9, trend: 1.1, initials: 'NW', seller: '', tag: 'Subiendo' },
  { id: 'm3', name: 'Jude Bellingham', position: 'MED', club: 'Real Madrid', clubCode: 'RMA', price: 16.4, points: 91, form: 8.2, trend: 0.4, initials: 'JB', seller: 'Pablo FC', tag: 'Disponible' },
  { id: 'm4', name: 'Álex Baena', position: 'MED', club: 'Villarreal CF', clubCode: 'VIL', price: 10.2, points: 73, form: 7.4, trend: 0.6, initials: 'AB', seller: '', tag: 'En forma' },
  { id: 'm5', name: 'Antoine Griezmann', position: 'DEL', club: 'Atlético de Madrid', clubCode: 'ATM', price: 13.8, points: 84, form: 7.5, trend: -0.2, initials: 'AG', seller: 'Racing Sant', tag: 'Cláusula' },
  { id: 'm6', name: 'Aleix García', position: 'MED', club: 'Girona FC', clubCode: 'GIR', price: 7.9, points: 62, form: 6.9, trend: 0.2, initials: 'AG', seller: '', tag: 'Disponible' },
  { id: 'm7', name: 'Iñaki Williams', position: 'DEL', club: 'Athletic Club', clubCode: 'ATH', price: 9.1, points: 60, form: 6.4, trend: -0.1, initials: 'IW', seller: '', tag: 'Disponible' },
  { id: 'm8', name: 'Dani Ceballos', position: 'MED', club: 'Real Madrid', clubCode: 'RMA', price: 4.8, points: 39, form: 5.8, trend: 0.1, initials: 'DC', seller: '', tag: 'Oportunidad' },
];

export const DEMO_STANDING = [
  { rank: 1, teamId: 't1', manager: 'Pablo FC', teamName: 'Pablo FC', points: 1782, change: 1 },
  { rank: 2, teamId: 't2', manager: 'Racing Sant', teamName: 'Racing Sant', points: 1714, change: -1 },
  { rank: 3, teamId: 't3', manager: 'Marcos', teamName: 'Los Galácticos', points: 1684, change: 2, isMine: true },
  { rank: 4, teamId: 't4', manager: 'Atleti del Sur', teamName: 'Atleti del Sur', points: 1635, change: 0 },
  { rank: 5, teamId: 't5', manager: 'Real de Barrio', teamName: 'Real de Barrio', points: 1579, change: -1 },
  { rank: 6, teamId: 't6', manager: 'La Banda del Patio', teamName: 'La Banda', points: 1542, change: 0 },
];

export const DEMO_ACTIVITY = [
  { id: 'a1', text: 'Pablo FC ha fichado a Bryan Zaragoza', time: 'Hace 12 min', player: 'Bryan Zaragoza' },
  { id: 'a2', text: 'Racing Sant ha lanzado una puja por Álex Baena', time: 'Hace 38 min', player: 'Álex Baena' },
  { id: 'a3', text: 'Tu equipo ha sumado 68 puntos en la jornada 8', time: 'Ayer', player: '' },
];

export const DEMO_FIXTURES = [
  { id: 'f1', home: 'Athletic Club', away: 'RCD Mallorca', homeCode: 'ATH', awayCode: 'MLL', kickoff: 'Vie · 21:00', status: 'Programado' },
  { id: 'f2', home: 'FC Barcelona', away: 'Sevilla FC', homeCode: 'FCB', awayCode: 'SEV', kickoff: 'Sáb · 16:15', status: 'Programado' },
  { id: 'f3', home: 'Real Madrid', away: 'Villarreal CF', homeCode: 'RMA', awayCode: 'VIL', kickoff: 'Sáb · 21:00', status: 'Programado' },
  { id: 'f4', home: 'Real Sociedad', away: 'Atlético de Madrid', homeCode: 'RSO', awayCode: 'ATM', kickoff: 'Dom · 18:30', status: 'Programado' },
];

export const DEMO_VALUE_HISTORY = [46, 47, 46, 49, 48, 50, 51, 50, 53, 55, 54, 59, 60, 63, 61, 67, 69, 68, 73, 72, 77, 78, 76, 82];

export const DEMO_PROFILE = {
  id: 'demo-manager',
  name: 'Marcos',
  email: 'marcos@fantasy.demo',
  provider: 'Modo demo',
};
