const API_ROOT = import.meta.env.VITE_LALIGA_API_BASE || '/api/laliga';
const TOKEN_PATH = '/auth/provider/token';

export const AUTH_CONFIG = {
  emailClientId: import.meta.env.VITE_LALIGA_EMAIL_CLIENT_ID || 'af88bcff-1157-40a0-b579-030728aacf0b',
  webClientId: import.meta.env.VITE_LALIGA_CLIENT_ID || '6457fa17-1224-416a-b21a-ee6ce76e9bc0',
  oauthClientId: import.meta.env.VITE_LALIGA_OAUTH_CLIENT_ID || import.meta.env.VITE_LALIGA_EMAIL_CLIENT_ID || 'af88bcff-1157-40a0-b579-030728aacf0b',
  tokenPolicy: 'B2C_1A_ResourceOwnerv2',
  signInPolicy: 'B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN',
  redirectUri: import.meta.env.VITE_LALIGA_REDIRECT_URI || `${window.location.origin}/auth/callback`,
  nativeRedirectUri: 'authredirect://com.lfp.laligafantasy',
};

export const API_ENDPOINTS = {
  players: '/v1/competition/1/players',
  teams: '/v3/teams-master',
  currentWeek: '/v1/competition/1/week/current',
  calendar: (weekNumber) => `/v1/competition/1/calendar?weekNumber=${encodeURIComponent(weekNumber)}`,
  player: (id) => `/v1/competition/1/player/${encodeURIComponent(id)}`,
  playerValueHistory: (id) => `/v1/competition/1/player/${encodeURIComponent(id)}/market-value`,
  me: '/v4/user/me',
  leagues: '/v1/competition/1/leagues',
  standing: (leagueId) => `/v1/competition/1/leagues/${encodeURIComponent(leagueId)}/standing`,
  leagueTeam: (leagueId, teamId) => `/v1/competition/1/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}`,
  activity: (leagueId, index = 0) => `/v1/competition/1/leagues/${encodeURIComponent(leagueId)}/activity/${encodeURIComponent(index)}`,
  teamMoney: (teamId) => `/v1/competition/1/teams/${encodeURIComponent(teamId)}/money`,
  market: (leagueId) => `/v1/competition/1/league/${encodeURIComponent(leagueId)}/market`,
};

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function readResponse(response) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 240) };
    }
  }
  if (!response.ok) {
    const message = payload?.error_description || payload?.message || payload?.error || `Error ${response.status}`;
    throw new ApiError(String(message), response.status, payload);
  }
  return payload;
}

export async function apiGet(path, token, signal) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_ROOT}${path}`, {
    method: 'GET',
    headers,
    signal,
    credentials: 'same-origin',
  });
  return readResponse(response);
}

async function requestTokens(params, policy) {
  const response = await fetch(`${TOKEN_PATH}?p=${encodeURIComponent(policy)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    credentials: 'same-origin',
  });
  const result = await readResponse(response);
  if (!result?.access_token && !result?.id_token) {
    throw new ApiError('El proveedor no devolvió un token de sesión.', response.status, result);
  }
  return result;
}

export async function signInWithEmail(email, password) {
  const tokens = await requestTokens({
    grant_type: 'password',
    client_id: AUTH_CONFIG.emailClientId,
    scope: `openid ${AUTH_CONFIG.emailClientId} offline_access`,
    redirect_uri: AUTH_CONFIG.nativeRedirectUri,
    username: email,
    password,
    response_type: 'id_token',
  }, AUTH_CONFIG.tokenPolicy);
  return { ...tokens, client_id: AUTH_CONFIG.emailClientId };
}

export async function renewSession(refreshToken, clientId = AUTH_CONFIG.webClientId) {
  const result = await requestTokens({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    scope: 'openid offline_access',
  }, AUTH_CONFIG.signInPolicy);
  return { ...result, client_id: clientId };
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function randomVerifier() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function buildGoogleSignInUrl() {
  if (!window.isSecureContext && window.location.hostname !== 'localhost') {
    throw new Error('El inicio de sesión requiere una conexión HTTPS.');
  }
  const verifier = randomVerifier();
  const challenge = await sha256Base64Url(verifier);
  const state = randomVerifier();
  const nonce = randomVerifier();
  sessionStorage.setItem('fantasy-oauth-pkce', JSON.stringify({ verifier, state, nonce, createdAt: Date.now() }));
  const params = new URLSearchParams({
    p: AUTH_CONFIG.signInPolicy,
    client_id: AUTH_CONFIG.oauthClientId,
    response_type: 'code',
    redirect_uri: AUTH_CONFIG.redirectUri,
    scope: 'openid offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return `https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeAuthorizationCode(code, verifier) {
  const result = await requestTokens({
    grant_type: 'authorization_code',
    client_id: AUTH_CONFIG.oauthClientId,
    code,
    redirect_uri: AUTH_CONFIG.redirectUri,
    code_verifier: verifier,
    scope: 'openid offline_access',
  }, AUTH_CONFIG.signInPolicy);
  return { ...result, client_id: AUTH_CONFIG.oauthClientId };
}

export function decodeToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const decoded = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(Array.from(decoded, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
  } catch {
    return null;
  }
}

export function userFromTokens(tokens) {
  const claims = decodeToken(tokens?.id_token || tokens?.access_token) || {};
  return {
    id: claims.sub || claims.oid || claims.userId || null,
    name: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || claims.unique_name || 'Manager',
    email: claims.email || claims.emails?.[0] || claims.unique_name || '',
    provider: claims.idp?.toLowerCase?.().includes('google') ? 'Google' : 'LALIGA Fantasy',
    expiresAt: Number(tokens?.expires_on || 0) || (Date.now() / 1000 + Number(tokens?.expires_in || 0)),
  };
}

export function accessTokenFrom(tokens) {
  // The API accepts the B2C access token. A few legacy responses only expose an
  // id_token, so keep that as a compatibility fallback rather than losing login.
  return tokens?.access_token || tokens?.id_token || '';
}

export function sessionIsExpiring(tokens, marginSeconds = 180) {
  const user = userFromTokens(tokens);
  return Boolean(user.expiresAt && user.expiresAt < Date.now() / 1000 + marginSeconds);
}

export function unwrapList(payload, candidates = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of candidates) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === 'object' && payload[key] !== payload) {
      const nested = unwrapList(payload[key], candidates);
      if (nested.length) return nested;
    }
  }
  for (const key of ['data', 'result', 'response', 'payload']) {
    if (payload[key] && payload[key] !== payload) {
      const found = unwrapList(payload[key], candidates);
      if (found.length) return found;
    }
  }
  return [];
}

const POSITION_NAMES = {
  1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL', 5: 'ENT',
  goalkeeper: 'POR', portero: 'POR', porter: 'POR',
  defender: 'DEF', defensa: 'DEF', defendera: 'DEF',
  midfielder: 'MED', centrocampista: 'MED', medio: 'MED',
  forward: 'DEL', striker: 'DEL', delantero: 'DEL', atacante: 'DEL',
  coach: 'ENT', entrenador: 'ENT',
};

function toMillions(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.abs(parsed) > 1000 ? parsed / 1_000_000 : parsed;
}

export function normalizePlayer(raw, teamMap = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const first = raw.firstName || raw.firstname || raw.first_name || '';
  const last = raw.lastName || raw.lastname || raw.last_name || '';
  const name = raw.name || raw.fullName || raw.full_name || [first, last].filter(Boolean).join(' ') || raw.playerName || '';
  if (!name) return null;
  const rawPosition = raw.positionId ?? raw.position_id ?? raw.position?.id ?? raw.position?.name ?? raw.position ?? raw.role;
  const positionKey = typeof rawPosition === 'string' ? rawPosition.toLowerCase() : rawPosition;
  const position = POSITION_NAMES[positionKey] || POSITION_NAMES[String(positionKey).toLowerCase()] || 'MED';
  const teamValue = raw.teamName || raw.team_name || raw.clubName || raw.club?.name || raw.team?.name || raw.team || '';
  const teamId = raw.teamId || raw.team_id || raw.clubId || raw.team?.id || '';
  const clubName = typeof teamValue === 'string' ? teamValue : (teamMap[teamId] || 'LaLiga');
  const price = toMillions(raw.price ?? raw.marketValue ?? raw.market_value ?? raw.value ?? raw.cost ?? raw.amount ?? 0);
  const points = Number(raw.points ?? raw.totalPoints ?? raw.total_points ?? raw.pointsTotal ?? raw.score ?? raw.lastSeasonPoints ?? 0) || 0;
  const id = raw.id ?? raw.playerId ?? raw.player_id ?? raw.code ?? name.toLowerCase().replace(/\s+/g, '-');
  return {
    ...raw,
    id: String(id),
    name,
    position,
    club: clubName || 'LaLiga',
    clubCode: (raw.teamCode || raw.clubCode || raw.shortName || clubName || 'LL').toString().slice(0, 3).toUpperCase(),
    price,
    points,
    form: Number(raw.form ?? raw.averagePoints ?? raw.average_points ?? 0) || 0,
    status: raw.status || raw.availability || raw.playerStatus || 'Disponible',
    trend: Number(raw.priceChange ?? raw.price_change ?? raw.valueChange ?? 0) || 0,
    raw,
  };
}

export function normalizePlayers(payload, teamMap = {}) {
  const list = unwrapList(payload, ['players', 'teamPlayers', 'team_players', 'squad', 'roster', 'lineup', 'footballers', 'members', 'items', 'elements', 'content', 'results']);
  return list.map((item) => normalizePlayer(item.player || item.footballer || item, teamMap)).filter((player) => player && player.position !== 'ENT');
}

export function normalizeTeams(payload) {
  const list = unwrapList(payload, ['teams', 'items', 'clubs', 'content', 'results']);
  const map = {};
  for (const team of list) {
    const id = team.id ?? team.teamId ?? team.team_id;
    const name = team.name ?? team.teamName ?? team.fullName;
    if (id != null && name) map[id] = name;
  }
  return map;
}

export function normalizeLeagues(payload) {
  const list = unwrapList(payload, ['leagues', 'items', 'competitions', 'content', 'results']);
  return list.map((item, index) => ({
    ...item,
    id: String(item.id ?? item.leagueId ?? item.league_id ?? item.competitionId ?? `league-${index}`),
    name: item.name ?? item.leagueName ?? item.title ?? `Liga ${index + 1}`,
    teamId: item.teamId ?? item.team_id ?? item.userTeamId ?? item.fantasyTeamId ?? item.myTeam?.id ?? item.ownTeam?.id ?? null,
    size: item.numberOfTeams ?? item.teamsCount ?? item.teamCount ?? null,
  }));
}

export function normalizeStanding(payload) {
  const list = unwrapList(payload, ['standing', 'standings', 'teams', 'items', 'ranking', 'content', 'results']);
  return list.map((row, index) => {
    const manager = (typeof row.manager === 'string' ? row.manager : row.manager?.name) || row.managerName || row.owner?.name || row.user?.name || row.name || row.teamName || row.team_name || `Manager ${index + 1}`;
    return {
      ...row,
      rank: Number(row.rank ?? row.position ?? row.place ?? row.order ?? index + 1) || index + 1,
      teamId: String(row.teamId ?? row.team_id ?? row.team?.id ?? row.id ?? row.fantasyTeamId ?? ''),
      userId: row.userId ?? row.ownerId ?? row.managerId ?? row.owner?.id ?? row.manager?.id ?? row.user?.id ?? null,
      manager,
      teamName: row.teamName || row.team_name || row.squadName || row.team?.name || manager,
      points: Number(row.points ?? row.totalPoints ?? row.total_points ?? row.score ?? row.value ?? 0) || 0,
      value: toMillions(row.value ?? row.teamValue ?? row.team_value ?? 0),
      isMine: Boolean(row.isMine || row.isUser || row.currentUser === true || row.mine),
    };
  }).filter((row) => row.manager);
}

export function normalizeMarket(payload, teamMap = {}) {
  const list = unwrapList(payload, ['market', 'players', 'items', 'sales', 'marketPlayers', 'market_players', 'content', 'results']);
  return list.map((item) => {
    const player = normalizePlayer(item.player || item.footballer || item, teamMap);
    if (!player) return null;
    return {
      ...player,
      seller: item.seller?.name || item.owner?.name || item.managerName || item.sellerName || '',
      expiresAt: item.expiresAt || item.endDate || item.expirationDate || null,
      clause: Boolean(item.clause || item.releaseClause || item.isClause),
      bid: Number(item.currentBid ?? item.bid ?? item.offer ?? 0) || 0,
    };
  }).filter((player) => player && player.position !== 'ENT');
}

export function normalizeWeek(payload) {
  const value = payload?.data ?? payload?.week ?? payload?.currentWeek ?? payload?.result ?? payload;
  if (typeof value === 'number' || typeof value === 'string') return { number: Number(value) || value, name: `Jornada ${value}` };
  if (!value || typeof value !== 'object') return null;
  const number = Number(value.weekNumber ?? value.number ?? value.matchday ?? value.currentWeek ?? value.id ?? 0) || 0;
  return { ...value, number, name: value.name || value.title || `Jornada ${number || 'actual'}` };
}

export function normalizeFixtures(payload) {
  const list = unwrapList(payload, ['fixtures', 'matches', 'calendar', 'games', 'items', 'content', 'results']);
  return list.map((item) => {
    const home = item.homeTeam?.name || item.homeTeamName || item.localTeam?.name || item.localTeamName || item.home || item.local || 'Local';
    const away = item.awayTeam?.name || item.awayTeamName || item.visitorTeam?.name || item.visitorTeamName || item.away || item.visitor || 'Visitante';
    return {
      ...item,
      id: String(item.id ?? `${home}-${away}`),
      home,
      away,
      homeCode: (item.homeTeam?.shortName || item.homeTeam?.code || home).toString().slice(0, 3).toUpperCase(),
      awayCode: (item.awayTeam?.shortName || item.awayTeam?.code || away).toString().slice(0, 3).toUpperCase(),
      kickoff: item.date || item.kickoff || item.startDate || item.matchDate || null,
      status: item.status || 'Programado',
    };
  });
}

export function normalizeActivity(payload) {
  return unwrapList(payload, ['activity', 'activities', 'items', 'transactions', 'content', 'results']).map((item, index) => ({
    id: String(item.id ?? `activity-${index}`),
    text: item.description || item.message || item.title || item.action || 'Movimiento de la liga',
    time: item.date || item.createdAt || item.timestamp || '',
    player: item.playerName || item.player?.name || '',
  }));
}
