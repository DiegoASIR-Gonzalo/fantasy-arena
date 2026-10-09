import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Award, BarChart3, Bell,
  CalendarDays, Check, ChevronDown, ChevronRight, CircleAlert, CircleHelp,
  Clock3, Coins, Crown, ExternalLink, Eye, EyeOff, Filter, Flame, Info,
  LayoutDashboard, Loader2, LockKeyhole, LogIn, LogOut, Mail, Menu,
  MoreHorizontal, Search, Shield, ShieldCheck, Shirt, SlidersHorizontal,
  Sparkles, Star, TrendingDown, TrendingUp, Trophy, UserRound, Users,
  Wallet, X, Zap,
} from 'lucide-react';
import {
  accessTokenFrom, API_ENDPOINTS, apiGet, buildGoogleSignInUrl, decodeToken, exchangeAuthorizationCode,
  normalizeActivity, normalizeFixtures, normalizeLeagues, normalizeMarket, normalizePlayer,
  normalizePlayers, normalizeStanding, normalizeTeams, normalizeWeek, renewSession,
  sessionIsExpiring, signInWithEmail, unwrapList, userFromTokens,
} from './api.js';
import {
  CLUB_COLORS, DEMO_ACTIVITY, DEMO_BENCH, DEMO_FIXTURES, DEMO_MARKET,
  DEMO_PROFILE, DEMO_SQUAD, DEMO_STANDING, DEMO_VALUE_HISTORY,
} from './data.js';

const SESSION_KEY = 'laliga-fantasy-session-v1';
const LEAGUE_KEY = 'laliga-fantasy-league-v1';
const FAVORITES_KEY = 'laliga-fantasy-watchlist-v1';

const NAV_ITEMS = [
  { id: 'home', label: 'Inicio', icon: LayoutDashboard },
  { id: 'team', label: 'Mi equipo', icon: Shirt },
  { id: 'market', label: 'Mercado', icon: Coins },
  { id: 'leagues', label: 'Ligas', icon: Trophy },
  { id: 'fixtures', label: 'Jornada', icon: CalendarDays },
];

const PAGE_TITLES = {
  home: ['Centro de mando', 'Todo lo que necesitas para dominar tu liga.'],
  team: ['Mi equipo', 'La plantilla que te acerca a la victoria.'],
  market: ['Mercado', 'Encuentra el próximo fichaje diferencial.'],
  leagues: ['Mis ligas', 'La clasificación no miente.'],
  fixtures: ['Jornada', 'Prepara el once. El fútbol no espera.'],
  profile: ['Mi perfil', 'Tu cuenta y tus conexiones.'],
};

function readSavedSession() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return parsed?.tokens ? parsed : null;
  } catch {
    return null;
  }
}

function readFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function initials(name = '') {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'LF';
}

function money(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const amount = Number(value);
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(amount)} M€`;
}

function integer(value) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function friendlyError(error) {
  const raw = String(error?.message || 'No se ha podido completar la operación.');
  if (/failed to fetch|network|fetch/i.test(raw)) return 'No se pudo conectar con el servicio. Comprueba la conexión y vuelve a intentarlo.';
  if (/invalid_grant|invalid username|password|AADB2C/i.test(raw)) return 'LaLiga no ha podido validar el acceso. Revisa tus datos o inténtalo de nuevo.';
  if (/redirect_uri|redirect uri/i.test(raw)) return 'LALIGA ha rechazado la URL de retorno. Debe estar autorizada para esta aplicación.';
  return raw.length > 190 ? `${raw.slice(0, 187)}…` : raw;
}

function getUserFromApi(payload, fallback) {
  const raw = payload?.user || payload?.profile || payload?.data || payload || {};
  const name = raw.name || raw.displayName || raw.fullName || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || fallback?.name;
  return {
    ...fallback,
    id: raw.id ?? raw.userId ?? raw.sub ?? fallback?.id ?? null,
    name: name || 'Manager',
    email: raw.email || raw.mail || raw.username || fallback?.email || '',
    provider: fallback?.provider || 'LALIGA Fantasy',
    avatar: raw.avatar || raw.picture || raw.photo || null,
  };
}

function extractTeamPlayers(payload, teamMap = {}) {
  const list = unwrapList(payload, ['players', 'teamPlayers', 'team_players', 'squad', 'roster', 'lineup', 'footballers', 'members', 'items', 'content', 'results']);
  return list.map((item) => normalizePlayer(item.player || item.footballer || item, teamMap)).filter(Boolean);
}

function extractMoney(payload) {
  if (typeof payload === 'number') return Math.abs(payload) > 1000 ? payload / 1_000_000 : payload;
  const raw = payload?.money ?? payload?.cash ?? payload?.balance ?? payload?.budget ?? payload?.amount ?? payload?.data?.money ?? payload?.data?.cash;
  if (raw == null) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  return Math.abs(amount) > 1000 ? amount / 1_000_000 : amount;
}

function pageFromHash() {
  const page = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return PAGE_TITLES[page] ? page : 'home';
}

function App() {
  const [page, setPage] = useState(pageFromHash);
  const [session, setSession] = useState(readSavedSession);
  const [publicData, setPublicData] = useState({ players: [], teams: {}, week: null, fixtures: [] });
  const [viewWeek, setViewWeek] = useState(null);
  const [calendarByWeek, setCalendarByWeek] = useState({});
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState('loading');
  const [apiError, setApiError] = useState('');
  const [privateData, setPrivateData] = useState({ me: null, leagues: [], standing: [], market: [], activity: [], squad: [], money: null });
  const [selectedLeagueId, setSelectedLeagueId] = useState(() => {
    try { return localStorage.getItem(LEAGUE_KEY) || ''; } catch { return ''; }
  });
  const [privateLoading, setPrivateLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [favorites, setFavorites] = useState(readFavorites);
  const [toast, setToast] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const currentLeague = privateData.leagues.find((league) => league.id === selectedLeagueId) || privateData.leagues[0] || null;
  const currentUser = session?.user || DEMO_PROFILE;
  const connected = Boolean(session?.tokens);
  const pageMeta = PAGE_TITLES[page] || PAGE_TITLES.home;

  const notify = useCallback((message, kind = 'success') => {
    setToast({ message, kind, id: Date.now() });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadLeagueData = useCallback(async (tokens, preferredLeagueId = '') => {
    const bearer = accessTokenFrom(tokens);
    if (!bearer) return;
    setPrivateLoading(true);
    try {
      const [meResult, leaguesResult] = await Promise.allSettled([
        apiGet(API_ENDPOINTS.me, bearer),
        apiGet(API_ENDPOINTS.leagues, bearer),
      ]);
      const mePayload = meResult.status === 'fulfilled' ? meResult.value : null;
      const leaguesPayload = leaguesResult.status === 'fulfilled' ? leaguesResult.value : null;
      const user = getUserFromApi(mePayload, session?.user || userFromTokens(tokens));
      const leagues = normalizeLeagues(leaguesPayload);
      const wanted = preferredLeagueId || selectedLeagueId;
      const league = leagues.find((item) => item.id === wanted) || leagues[0] || null;

      if (leagues.length && league) {
        setSelectedLeagueId(league.id);
        try { localStorage.setItem(LEAGUE_KEY, league.id); } catch { /* storage may be disabled */ }
      }
      setPrivateData((previous) => ({ ...previous, me: user, leagues }));
      setSession((previous) => {
        if (!previous) return previous;
        const next = { ...previous, user };
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* session still works in memory */ }
        return next;
      });

      if (!league) {
        setPrivateData((previous) => ({ ...previous, standing: [], market: [], activity: [], squad: [], money: null }));
        if (leaguesResult.status === 'rejected' && meResult.status === 'rejected') {
          setApiError('La sesión está activa, pero no se pudo leer el perfil o las ligas.');
        }
        return;
      }

      const [standingResult, marketResult, activityResult] = await Promise.allSettled([
        apiGet(API_ENDPOINTS.standing(league.id), bearer),
        apiGet(API_ENDPOINTS.market(league.id), bearer),
        apiGet(API_ENDPOINTS.activity(league.id, 0), bearer),
      ]);
      const standingPayload = standingResult.status === 'fulfilled' ? standingResult.value : null;
      const standing = normalizeStanding(standingPayload);
      const market = marketResult.status === 'fulfilled' ? normalizeMarket(marketResult.value, publicData.teams) : [];
      const activity = activityResult.status === 'fulfilled' ? normalizeActivity(activityResult.value) : [];
      const meId = String(user?.id || '');
      const mine = standing.find((row) => row.isMine || String(row.userId || row.ownerId || row.managerId || '') === meId);
      const meRecord = mePayload?.user || mePayload?.profile || mePayload?.data || mePayload || {};
      const teamId = String(league.teamId || mine?.teamId || meRecord.teamId || meRecord.team_id || meRecord.fantasyTeamId || meRecord.team?.id || '');
      let squad = [];
      let balance = null;
      if (teamId) {
        const [teamResult, moneyResult] = await Promise.allSettled([
          apiGet(API_ENDPOINTS.leagueTeam(league.id, teamId), bearer),
          apiGet(API_ENDPOINTS.teamMoney(teamId), bearer),
        ]);
        if (teamResult.status === 'fulfilled') squad = extractTeamPlayers(teamResult.value, publicData.teams);
        if (moneyResult.status === 'fulfilled') balance = extractMoney(moneyResult.value);
      }
      setPrivateData({ me: user, leagues, standing, market, activity, squad, money: balance });
      const anyLeagueData = [standingResult, marketResult, activityResult].some((result) => result.status === 'fulfilled');
      if (!anyLeagueData) setApiError('No se pudieron cargar los datos de esta liga; prueba a actualizar la sesión.');
      else setApiError('');
    } catch (error) {
      setApiError(friendlyError(error));
    } finally {
      setPrivateLoading(false);
    }
  }, [publicData.teams, selectedLeagueId, session?.user]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function loadPublicData() {
      const [playersResult, teamsResult, weekResult] = await Promise.allSettled([
        apiGet(API_ENDPOINTS.players, '', controller.signal),
        apiGet(API_ENDPOINTS.teams, '', controller.signal),
        apiGet(API_ENDPOINTS.currentWeek, '', controller.signal),
      ]);
      if (!active) return;
      const teams = teamsResult.status === 'fulfilled' ? normalizeTeams(teamsResult.value) : {};
      const players = playersResult.status === 'fulfilled' ? normalizePlayers(playersResult.value, teams) : [];
      const week = weekResult.status === 'fulfilled' ? normalizeWeek(weekResult.value) : null;
      let fixtures = [];
      if (week?.number) {
        try {
          const calendar = await apiGet(API_ENDPOINTS.calendar(week.number), '', controller.signal);
          fixtures = normalizeFixtures(calendar);
        } catch { /* calendar is optional; keep the app usable if the route changes */ }
      }
      if (!active) return;
      setPublicData({ players, teams, week, fixtures });
      if (week?.number) setViewWeek((current) => current ?? Number(week.number));
      if (week?.number && fixtures.length) setCalendarByWeek((previous) => ({ ...previous, [String(week.number)]: fixtures }));
      const okCount = [playersResult, teamsResult, weekResult].filter((result) => result.status === 'fulfilled').length;
      setApiStatus(okCount >= 2 ? 'online' : okCount === 1 ? 'partial' : 'demo');
      if (okCount === 0) setApiError('La API pública no respondió. Puedes seguir explorando el modo demo.');
      else setApiError('');
    }
    loadPublicData().catch(() => {
      if (active) setApiStatus('demo');
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!session?.tokens) return undefined;
    let active = true;
    async function refreshIfNeeded() {
      if (!sessionIsExpiring(session.tokens) || !session.tokens.refresh_token) return;
      try {
        const renewed = await renewSession(session.tokens.refresh_token, session.tokens.client_id);
        if (!active) return;
        const next = { tokens: renewed, user: { ...session.user, ...userFromTokens(renewed), provider: session.user?.provider } };
        setSession(next);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      } catch {
        // Keep the current token for this visit; private endpoints will explain if it is no longer valid.
      }
    }
    refreshIfNeeded();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session?.tokens) loadLeagueData(session.tokens, selectedLeagueId);
    // Only reload when the account signs in or a league is explicitly changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.tokens?.access_token, selectedLeagueId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');
    if (!code && !oauthError) return;
    setAuthOpen(true);
    setPage('home');
    async function finishOAuthCallback() {
      try {
        if (oauthError) throw new Error(params.get('error_description') || oauthError);
        const saved = JSON.parse(sessionStorage.getItem('fantasy-oauth-pkce') || 'null');
        if (!saved?.verifier || !saved?.state || saved.state !== params.get('state')) {
          throw new Error('La validación de seguridad del inicio de sesión no coincide. Vuelve a empezar.');
        }
        const tokens = await exchangeAuthorizationCode(code, saved.verifier);
        const claims = decodeToken(tokens.id_token || tokens.access_token);
        if (claims?.nonce && claims.nonce !== saved.nonce) throw new Error('La validación del inicio de sesión no coincide. Vuelve a empezar.');
        sessionStorage.removeItem('fantasy-oauth-pkce');
        const user = userFromTokens(tokens);
        const next = { tokens, user };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
        setSession(next);
        setAuthOpen(false);
        setAuthError('');
        setAuthNotice('');
        notify('¡Ya estás dentro! Cargando tus ligas…');
      } catch (error) {
        setAuthError(friendlyError(error));
        setAuthNotice('');
      } finally {
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      }
    }
    finishOAuthCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); } catch { /* storage optional */ }
  }, [favorites]);

  const goTo = (nextPage) => {
    setPage(nextPage);
    setMobileNavOpen(false);
    setNotificationsOpen(false);
    if (window.location.hash !== `#${nextPage}`) window.location.hash = nextPage;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEmailLogin = async (email, password) => {
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const tokens = await signInWithEmail(email, password);
      const user = userFromTokens(tokens);
      const next = { tokens, user };
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* use in-memory session */ }
      setSession(next);
      setAuthOpen(false);
      notify('¡Sesión iniciada! Sincronizando tus ligas…');
    } catch (error) {
      setAuthError(friendlyError(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const url = await buildGoogleSignInUrl();
      window.location.assign(url);
    } catch (error) {
      setAuthError(friendlyError(error));
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('fantasy-oauth-pkce');
    setSession(null);
    setPrivateData({ me: null, leagues: [], standing: [], market: [], activity: [], squad: [], money: null });
    setSelectedLeagueId('');
    setApiError('');
    notify('Has cerrado la sesión.');
  };

  const handleLeagueChange = (id) => {
    setSelectedLeagueId(id);
    try { localStorage.setItem(LEAGUE_KEY, id); } catch { /* optional */ }
    if (!session?.tokens) notify('Conecta tu cuenta de LALIGA Fantasy para cargar otra liga.', 'info');
  };

  const handleWeekChange = async (nextWeek) => {
    if (!Number.isFinite(nextWeek) || nextWeek < 1 || apiStatus === 'demo') return;
    if (calendarByWeek[String(nextWeek)]) {
      setViewWeek(nextWeek);
      return;
    }
    setCalendarLoading(true);
    try {
      const payload = await apiGet(API_ENDPOINTS.calendar(nextWeek));
      const fixtures = normalizeFixtures(payload);
      setCalendarByWeek((previous) => ({ ...previous, [String(nextWeek)]: fixtures }));
      setViewWeek(nextWeek);
    } catch (error) {
      notify(`No se ha podido cargar la jornada ${nextWeek}: ${friendlyError(error)}`, 'info');
    } finally {
      setCalendarLoading(false);
    }
  };

  const toggleFavorite = (id) => {
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  };

  const actualSquad = privateData.squad;
  const displaySquad = actualSquad.length ? actualSquad : connected ? [] : DEMO_SQUAD;
  const displayBench = connected ? [] : DEMO_BENCH;
  const displayStanding = privateData.standing.length ? privateData.standing : connected ? [] : DEMO_STANDING;
  const displayActivity = privateData.activity.length ? privateData.activity : connected ? [] : DEMO_ACTIVITY;
  const displayMarket = privateData.market.length
    ? privateData.market
    : publicData.players.length
      ? publicData.players.slice(0, 24)
      : connected ? [] : DEMO_MARKET;
  const matchday = viewWeek ?? publicData.week?.number ?? (connected ? '—' : 9);
  const currentFixtures = calendarByWeek[String(matchday)] || (Number(matchday) === Number(publicData.week?.number) ? publicData.fixtures : []);
  const fixturesAreDemo = !currentFixtures.length && (!connected || apiStatus === 'demo');
  const displayFixtures = currentFixtures.length ? currentFixtures : fixturesAreDemo ? DEMO_FIXTURES : [];
  const pageIsSample = !connected;
  const availablePlayerCount = publicData.players.length || (connected ? 0 : DEMO_MARKET.length);
  const myStanding = privateData.standing.find((row) => row.isMine || row.manager === currentUser?.name) || null;
  const myPoints = connected
    ? (myStanding?.points ?? privateData.me?.points ?? privateData.me?.totalPoints ?? null)
    : 1684;
  const myBalance = connected ? privateData.money : 2.4;
  const teamValue = actualSquad.length
    ? actualSquad.reduce((sum, player) => sum + Number(player.price || 0), 0)
    : connected ? null : 81.6;

  const openLogin = () => {
    setAuthError('');
    setAuthNotice('');
    setAuthOpen(true);
  };

  const pageContent = () => {
    if (page === 'team') return (
      <TeamPage
        squad={displaySquad}
        bench={displayBench}
        teamValue={teamValue}
        balance={myBalance}
        demo={pageIsSample}
        onPlayer={setSelectedPlayer}
        onMarket={() => goTo('market')}
      />
    );
    if (page === 'market') return (
      <MarketPage
        players={displayMarket}
        sourceCount={availablePlayerCount}
        connected={connected}
        privateMarketCount={privateData.market.length}
        favorites={favorites}
        onFavorite={toggleFavorite}
        onPlayer={setSelectedPlayer}
        onConnect={openLogin}
        demo={pageIsSample}
      />
    );
    if (page === 'leagues') return (
      <LeaguesPage
        connected={connected}
        user={currentUser}
        leagues={privateData.leagues}
        league={currentLeague}
        standing={displayStanding}
        activity={displayActivity}
        loading={privateLoading}
        demo={pageIsSample}
        apiError={apiError}
        onLeague={handleLeagueChange}
        onConnect={openLogin}
      />
    );
    if (page === 'fixtures') return (
      <FixturesPage
        fixtures={displayFixtures}
        week={matchday}
        connected={connected}
        demo={fixturesAreDemo}
        canChangeWeek={Number.isFinite(Number(matchday)) && Number(matchday) > 0 && apiStatus !== 'demo'}
        loadingWeek={calendarLoading}
        onWeekChange={handleWeekChange}
        onTeam={() => goTo('team')}
      />
    );
    if (page === 'profile') return (
      <ProfilePage
        user={privateData.me || currentUser}
        connected={connected}
        league={currentLeague}
        apiStatus={apiStatus}
        apiError={apiError}
        loading={privateLoading}
        onConnect={openLogin}
        onLogout={handleLogout}
        onRefresh={() => session?.tokens && loadLeagueData(session.tokens, selectedLeagueId)}
      />
    );
    return (
      <Dashboard
        user={currentUser}
        squad={displaySquad}
        standings={displayStanding}
        market={displayMarket}
        activity={displayActivity}
        fixtures={displayFixtures}
        points={myPoints}
        balance={myBalance}
        teamValue={teamValue}
        week={matchday}
        league={currentLeague}
        connected={connected}
        demo={pageIsSample}
        onPage={goTo}
        onPlayer={setSelectedPlayer}
      />
    );
  };

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        onPage={goTo}
        user={currentUser}
        connected={connected}
        apiStatus={apiStatus}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onConnect={openLogin}
      />
      <div className="main-shell">
        <Header
          page={page}
          title={pageMeta[0]}
          subtitle={pageMeta[1]}
          user={currentUser}
          connected={connected}
          league={currentLeague}
          leagues={privateData.leagues}
          onPage={goTo}
          onLeague={handleLeagueChange}
          onConnect={openLogin}
          notificationsOpen={notificationsOpen}
          onNotifications={() => setNotificationsOpen((value) => !value)}
          onMenu={() => setMobileNavOpen((value) => !value)}
        />
        <main className="page-content">
          {apiError && connected && (
            <div className="inline-alert" role="status">
              <CircleAlert size={16} />
              <span>{apiError}</span>
              <button type="button" className="alert-action" onClick={() => session?.tokens && loadLeagueData(session.tokens, selectedLeagueId)}>Reintentar</button>
            </div>
          )}
          {pageContent()}
          <footer className="page-footer">
            <span>LALIGA Fantasy Companion <span className="footer-dot">·</span> Proyecto no oficial</span>
            <span>Los datos de ejemplo están señalizados. LaLiga puede cambiar su API sin previo aviso.</span>
          </footer>
        </main>
      </div>

      {authOpen && (
        <AuthModal
          loading={authLoading}
          error={authError}
          notice={authNotice}
          onEmail={handleEmailLogin}
          onGoogle={handleGoogleLogin}
          onClose={() => { setAuthOpen(false); setAuthError(''); setAuthNotice(''); }}
        />
      )}
      {selectedPlayer && (
        <PlayerDetails
          player={selectedPlayer}
          favorite={favorites.has(String(selectedPlayer.id))}
          onFavorite={() => toggleFavorite(selectedPlayer.id)}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
      {toast && <Toast message={toast.message} kind={toast.kind} />}
    </div>
  );
}

function Brand({ compact = false }) {
  return (
    <div className={`brand-lockup ${compact ? 'compact' : ''}`}>
      <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="brand-copy"><strong>LALIGA</strong><span>FANTASY</span></div>
    </div>
  );
}

function Sidebar({ page, onPage, user, connected, apiStatus, mobileOpen, onClose, onConnect }) {
  const apiText = apiStatus === 'loading' ? 'Conectando API' : apiStatus === 'online' ? 'API pública activa' : apiStatus === 'partial' ? 'API parcial' : 'Modo demostración';
  const statusClass = apiStatus === 'online' ? 'online' : apiStatus === 'partial' ? 'partial' : apiStatus === 'loading' ? 'loading' : 'demo';
  return (
    <>
      {mobileOpen && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <button type="button" className="sidebar-close icon-button" aria-label="Cerrar menú" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="season-chip"><span className="season-pulse" /> TEMPORADA <strong>26/27</strong></div>
        <nav className="sidebar-nav" aria-label="Navegación principal">
          <span className="nav-caption">TU FANTASY</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button type="button" key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => onPage(item.id)}>
                <Icon size={18} strokeWidth={1.9} />
                <span>{item.label}</span>
                {item.id === 'market' && <span className="nav-spark">NEW</span>}
              </button>
            );
          })}
          <span className="nav-caption nav-caption-spaced">CUENTA</span>
          <button type="button" className={`nav-item ${page === 'profile' ? 'active' : ''}`} onClick={() => onPage('profile')}>
            <UserRound size={18} strokeWidth={1.9} /><span>Mi perfil</span>
          </button>
        </nav>
        <div className="sidebar-grow" />
        <div className={`api-status-card ${statusClass}`}>
          <span className="api-status-icon"><ShieldCheck size={15} /></span>
          <span className="api-status-copy"><strong>{apiText}</strong><small>{connected ? 'Sesión de usuario guardada' : 'Conéctate para sincronizar tu liga'}</small></span>
          <span className="api-status-light" />
        </div>
        {!connected && (
          <button className="sidebar-connect" type="button" onClick={onConnect}><LogIn size={16} /> Conectar cuenta</button>
        )}
        <button type="button" className="sidebar-profile" onClick={() => onPage('profile')}>
          <Avatar name={user?.name} image={user?.avatar} size="small" />
          <span className="sidebar-profile-text"><strong>{user?.name || 'Manager'}</strong><small>{connected ? 'Cuenta conectada' : 'Vista de invitado'}</small></span>
          <MoreHorizontal size={17} className="profile-more" />
        </button>
        <div className="sidebar-footnote">HECHO PARA GANAR <span>✦</span></div>
      </aside>
    </>
  );
}

function Header({ page, title, subtitle, user, connected, league, leagues, onPage, onLeague, onConnect, notificationsOpen, onNotifications, onMenu }) {
  const [leagueMenu, setLeagueMenu] = useState(false);
  const openProfile = () => onPage('profile');
  return (
    <header className="topbar">
      <button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={onMenu}><Menu size={21} /></button>
      <div className="topbar-title"><span className="breadcrumb">LALIGA FANTASY <ChevronRight size={13} /> {page === 'home' ? 'OVERVIEW' : page.toUpperCase()}</span><h1>{title}</h1><p>{subtitle}</p></div>
      <div className="topbar-actions">
        {connected && leagues.length > 0 && (
          <div className="league-switch-wrap">
            <button type="button" className={`league-switch ${leagueMenu ? 'is-open' : ''}`} onClick={() => setLeagueMenu((value) => !value)}>
              <span className="switch-cup"><Trophy size={15} /></span>
              <span className="league-switch-copy"><small>JUGANDO EN</small><strong>{league?.name || 'Mis ligas'}</strong></span>
              <ChevronDown size={15} />
            </button>
            {leagueMenu && (
              <>
                <button className="dropdown-dismiss" aria-label="Cerrar ligas" onClick={() => setLeagueMenu(false)} />
                <div className="league-dropdown">
                  {leagues.map((item) => <button type="button" key={item.id} onClick={() => { onLeague(item.id); setLeagueMenu(false); }}><span className="league-dropdown-icon"><Trophy size={14} /></span><span>{item.name}</span>{item.id === league?.id && <Check size={15} />}</button>)}
                </div>
              </>
            )}
          </div>
        )}
        {!connected && <div className="header-week"><span className="week-live-dot" /><span>JORNADA 9</span></div>}
        <div className="notification-wrap">
          <button type="button" className={`icon-button notification-button ${notificationsOpen ? 'active' : ''}`} aria-label="Notificaciones" onClick={onNotifications}><Bell size={19} /><i /></button>
          {notificationsOpen && (
            <>
              <button className="dropdown-dismiss" aria-label="Cerrar notificaciones" onClick={onNotifications} />
              <div className="notification-popover"><div className="popover-head"><strong>Notificaciones</strong><span>AL DÍA</span></div><div className="empty-notifications"><span><Sparkles size={18} /></span><strong>Estás al día</strong><small>Te avisaremos cuando haya novedades en tu liga.</small></div></div>
            </>
          )}
        </div>
        <button type="button" className="top-avatar-button" onClick={openProfile} aria-label="Abrir perfil"><Avatar name={user?.name} image={user?.avatar} size="medium" /><span className="avatar-status" /></button>
        {!connected && <button type="button" className="button button-primary header-connect" onClick={onConnect}><LogIn size={15} /> <span>Conectar cuenta</span></button>}
      </div>
    </header>
  );
}

function Avatar({ name, image, size = 'medium' }) {
  return <span className={`avatar avatar-${size}`}>{image ? <img src={image} alt="" /> : initials(name)}</span>;
}

function DataTag({ children = 'EJEMPLO' }) {
  return <span className="data-tag"><span />{children}</span>;
}

function Dashboard({ user, squad, standings, market, activity, fixtures, points, balance, teamValue, week, league, connected, demo, onPage, onPlayer }) {
  const myPosition = standings.find((row) => row.isMine || row.manager === user?.name)?.rank ?? (demo ? 3 : null);
  const recentPlayers = market.slice(0, 3);
  const fixture = fixtures[0];
  const teamName = league?.name || 'Liga del Barrio';
  return (
    <div className="page-stack">
      <section className="welcome-line">
        <div><span className="eyebrow">{connected ? 'TU TEMPORADA, TU HISTORIA' : 'VISTA PREVIA · TEMPORADA 26/27'}</span><h2>¡Vamos, {user?.name?.split(' ')[0] || 'manager'}! <span>⚡</span></h2></div>
        <div className="welcome-date"><CalendarDays size={15} /><span>{new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span></div>
      </section>

      <section className="hero-card">
        <div className="hero-noise" />
        <div className="hero-content">
          <div className="hero-kicker"><span className="hero-kicker-mark"><Zap size={13} fill="currentColor" /></span> JORNADA {week} <span className="hero-kicker-divider" /> <span className="hero-kicker-soft">LA PREVIA EMPIEZA AQUÍ</span></div>
          <h2>La liga se gana<br /><em>antes del pitido.</em></h2>
          <p>Tu próximo movimiento puede cambiarlo todo. Revisa el mercado, ajusta el once y sal a por la jornada.</p>
          <div className="hero-bottom"><button type="button" className="button button-lime" onClick={() => onPage('team')}>{connected ? 'Ver mi plantilla' : 'Preparar mi equipo'} <ArrowRight size={16} /></button><span><Clock3 size={14} /> {fixture?.kickoff ? `Próximo partido · ${fixture.kickoff}` : 'La jornada está a la vuelta de la esquina'}</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-ball"><span className="ball-hex">⬟</span><div className="ball-shine" /></div>
          <div className="hero-float-card"><span className="float-icon"><Trophy size={15} /></span><span><small>OBJETIVO</small><strong>La cima está cerca</strong></span><ArrowUpRight size={16} /></div>
          <span className="hero-art-number">{String(week).padStart(2, '0')}</span>
        </div>
        {demo && <span className="hero-demo-label">DATOS DE MUESTRA</span>}
      </section>

      <section className="metrics-grid" aria-label="Resumen de la temporada">
        <MetricCard icon={Zap} label={connected ? 'PUNTOS EN LA LIGA' : `PUNTOS · J${Number(week) - 1}`} value={connected ? (points == null ? '—' : integer(points)) : '68'} detail={connected ? <span className="metric-muted">Clasificación actual</span> : <><span className="positive"><ArrowUpRight size={13} /> +12</span> vs. jornada anterior</>} color="violet" />
        <MetricCard icon={Trophy} label="POSICIÓN EN LIGA" value={myPosition == null ? '—' : `${myPosition}º`} detail={connected ? <span className="metric-muted">Posición actual</span> : <><span className="positive"><ArrowUpRight size={13} /> 2</span> puestos esta semana</>} color="gold" />
        <MetricCard icon={BarChart3} label="VALOR DE PLANTILLA" value={money(teamValue)} detail={connected ? <span className="metric-muted">Valor actual disponible</span> : <><span className="positive"><TrendingUp size={13} /> +1,2 M€</span> últimos 7 días</>} color="blue" />
        <MetricCard icon={Wallet} label="PRESUPUESTO" value={money(balance)} detail={<><span className="metric-muted">{connected ? 'Saldo devuelto por la API' : 'Disponible para fichajes'}</span></>} color="green" />
      </section>

      <div className="dashboard-grid">
        <section className="panel lineup-panel">
          <PanelHeading eyebrow="EL PLAN DE JUEGO" title={connected ? 'Plantilla sincronizada' : 'Tu once titular'} action={<button className="text-action" type="button" onClick={() => onPage('team')}>Ver plantilla <ArrowRight size={14} /></button>} badge={demo ? <DataTag /> : null} />
          <div className="lineup-subhead"><span><span className="live-indicator" /> {connected ? 'DATOS DE TU EQUIPO' : 'ALINEACIÓN DE EJEMPLO'}</span><strong>{connected ? `${squad.length} jugadores` : '4—3—3'}</strong></div>
          {connected ? squad.length ? <RosterPreview players={squad} onPlayer={onPlayer} /> : <EmptyState icon={Shirt} title="Plantilla pendiente" text="Conecta una liga o actualiza los datos del equipo para consultar tu plantilla." /> : <FormationPitch squad={squad} onPlayer={onPlayer} compact />}
          <div className="lineup-footer"><span><Shield size={15} /> {connected ? 'Valor sincronizado' : 'Plantilla de ejemplo'} <strong>{money(teamValue)}</strong></span><button type="button" onClick={() => onPage('team')}>Abrir plantilla <ChevronRight size={15} /></button></div>
        </section>

        <section className="panel ranking-panel">
          <PanelHeading eyebrow="CARRERA POR EL TÍTULO" title="Clasificación" action={<button className="icon-link" type="button" onClick={() => onPage('leagues')} aria-label="Ver clasificación"><ArrowUpRight size={17} /></button>} badge={demo ? <DataTag /> : null} />
          <div className="ranking-table">
            {standings.slice(0, 5).map((row, index) => (
              <RankingRow key={row.teamId || row.rank || index} row={row} selected={row.isMine || row.manager === user?.name} compact />
            ))}
            {!standings.length && <EmptyState icon={Trophy} title="Clasificación pendiente" text="Conecta con una liga para ver la tabla." />}
          </div>
          <button className="panel-bottom-link" type="button" onClick={() => onPage('leagues')}>Ver clasificación completa <ArrowRight size={15} /></button>
        </section>
      </div>

      <div className="dashboard-grid bottom-dashboard-grid">
        <section className="panel insight-panel">
          <PanelHeading eyebrow="LECTURA RÁPIDA" title="El mercado se mueve" action={<button className="text-action" type="button" onClick={() => onPage('market')}>Ir al mercado <ArrowRight size={14} /></button>} />
          <div className="market-preview-list">
            {recentPlayers.map((player, index) => <MarketPreviewRow key={player.id || index} player={player} index={index} onClick={() => onPlayer(player)} />)}
            {!recentPlayers.length && <EmptyState icon={Coins} title="Sin movimientos todavía" text="Conecta tu cuenta para ver el mercado de tu liga." />}
          </div>
        </section>
        <section className="panel activity-panel">
          <PanelHeading eyebrow={teamName.toUpperCase()} title="Actividad reciente" action={<button className="icon-link" type="button" onClick={() => onPage('leagues')} aria-label="Ver actividad"><ArrowUpRight size={17} /></button>} badge={demo ? <DataTag /> : null} />
          <div className="activity-list">
            {activity.slice(0, 3).map((item, index) => <ActivityRow key={item.id || index} item={item} index={index} />)}
            {!activity.length && <EmptyState icon={Activity} title="No hay actividad para mostrar" text="Los movimientos de tu liga aparecerán aquí." />}
          </div>
        </section>
      </div>
      {!connected && <ConnectNudge onClick={() => onPage('profile')} />}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, color }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${color}`}><Icon size={17} strokeWidth={2} /></div>
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
      <span className="metric-dots"><i /><i /><i /></span>
    </div>
  );
}

function PanelHeading({ eyebrow, title, action, badge }) {
  return <div className="panel-heading"><div><span className="eyebrow">{eyebrow}</span><h3>{title}</h3></div><div className="panel-heading-right">{badge}{action}</div></div>;
}

function FormationPitch({ squad, onPlayer, compact = false }) {
  const groups = [
    { name: 'DEL', players: squad.filter((player) => player.position === 'DEL').slice(0, 3) },
    { name: 'MED', players: squad.filter((player) => player.position === 'MED').slice(0, 3) },
    { name: 'DEF', players: squad.filter((player) => player.position === 'DEF').slice(0, 4) },
    { name: 'POR', players: squad.filter((player) => player.position === 'POR').slice(0, 1) },
  ];
  return (
    <div className={`football-pitch ${compact ? 'compact-pitch' : ''}`}>
      <div className="pitch-grass" />
      <div className="pitch-midline" /><div className="pitch-center-circle" /><div className="pitch-box pitch-box-top" /><div className="pitch-box pitch-box-bottom" />
      <div className="pitch-lines">
        {groups.map((group) => <div className={`pitch-line pitch-${group.name.toLowerCase()}`} key={group.name}>
          {group.players.map((player) => <button type="button" className="pitch-player" key={player.id} onClick={() => onPlayer(player)} title={`${player.name} · ${player.club}`}>
            <PlayerPortrait player={player} size="pitch" />
            <span className="pitch-player-name">{player.name.split(' ').slice(-1)[0]}</span>
            <span className="pitch-player-points">{integer(player.points)} pts</span>
          </button>)}
          {!group.players.length && <span className="pitch-empty">{group.name}</span>}
        </div>)}
      </div>
      <div className="pitch-corners"><span /><span /><span /><span /></div>
    </div>
  );
}

function RosterPreview({ players, onPlayer }) {
  return (
    <div className="roster-preview">
      {players.slice(0, 6).map((player) => <button type="button" className="roster-preview-row" key={player.id} onClick={() => onPlayer(player)}><PlayerPortrait player={player} size="small" /><span className="roster-preview-copy"><strong>{player.name}</strong><small>{player.position} <i /> {player.club}</small></span><span className="roster-preview-points"><strong>{integer(player.points)}</strong><small>PTS</small></span><ChevronRight size={14} /></button>)}
      {players.length > 6 && <div className="roster-preview-more">+{players.length - 6} jugadores en tu plantilla</div>}
    </div>
  );
}

function PlayerPortrait({ player, size = 'medium' }) {
  const code = player?.clubCode || 'LL';
  const background = CLUB_COLORS[code] || '#6f64d9';
  return <span className={`player-portrait portrait-${size}`} style={{ '--portrait-color': background }}><span>{player?.initials || initials(player?.name)}</span></span>;
}

function RankingRow({ row, selected, compact = false }) {
  const medal = row.rank === 1 ? 'first' : row.rank === 2 ? 'second' : row.rank === 3 ? 'third' : '';
  return (
    <div className={`ranking-row ${selected ? 'is-current' : ''} ${compact ? 'ranking-compact' : ''}`}>
      <span className={`rank-number ${medal}`}>{row.rank}{row.rank <= 3 && <i>·</i>}</span>
      <span className={`rank-avatar ${row.rank === 1 ? 'rank-gold' : ''}`}>{row.rank === 1 ? <Crown size={14} /> : initials(row.manager)}</span>
      <span className="rank-team-copy"><strong>{row.teamName || row.manager}</strong><small>{row.manager}</small></span>
      <span className="rank-points"><strong>{integer(row.points)}</strong><small>pts</small></span>
    </div>
  );
}

function MarketPreviewRow({ player, index, onClick }) {
  return (
    <button type="button" className="market-preview-row" onClick={onClick}>
      <span className="market-preview-rank">0{index + 1}</span>
      <PlayerPortrait player={player} size="small" />
      <span className="market-preview-copy"><strong>{player.name}</strong><small>{player.position} <i /> {player.club}</small></span>
      <span className="market-preview-data"><strong>{money(player.price)}</strong><small><TrendingUp size={12} /> {player.form ? `${player.form} forma` : `${integer(player.points)} pts`}</small></span>
      <ChevronRight size={15} className="market-preview-chevron" />
    </button>
  );
}

function ActivityRow({ item, index }) {
  const Icon = index === 0 ? Coins : index === 1 ? Flame : Zap;
  return (
    <div className="activity-row">
      <span className={`activity-icon activity-tone-${index % 3}`}><Icon size={15} /></span>
      <span className="activity-copy"><strong>{item.text}</strong><small>{item.time || 'Recientemente'}</small></span>
      <span className="activity-dot" />
    </div>
  );
}

function TeamPage({ squad, bench, teamValue, balance, demo, onPlayer, onMarket }) {
  const [captain, setCaptain] = useState(squad.find((player) => player.position === 'DEL')?.id || '');
  const positionCounts = ['POR', 'DEF', 'MED', 'DEL'].map((position) => ({ position, count: squad.filter((player) => player.position === position).length }));
  return (
    <div className="page-stack">
      <div className="page-intro-row"><div><span className="eyebrow">{demo ? 'TU ALINEACIÓN · JORNADA 9' : 'PLANTILLA DE TU EQUIPO'}</span><h2>{demo ? 'Los que salen a ganar.' : 'Tus jugadores, al detalle.'}</h2><p>{demo ? 'Revisa el once de ejemplo y la forma de cada jugador antes de que empiece la jornada.' : 'Consulta los jugadores devueltos por la API de tu liga. Los cambios de alineación no se envían.'}</p></div><button className="button button-primary" type="button" onClick={onMarket}><Coins size={16} /> Explorar mercado</button></div>
      <div className="team-summary-grid">
        <SmallStat icon={Users} label="Jugadores" value={`${squad.length + bench.length}`} detail="plantilla actual" />
        <SmallStat icon={BarChart3} label="Valor de plantilla" value={money(teamValue)} detail="valor de mercado" />
        <SmallStat icon={Wallet} label="Saldo disponible" value={money(balance)} detail="para próximos fichajes" />
        <SmallStat icon={ShieldCheck} label={demo ? 'Formación' : 'Datos de plantilla'} value={demo ? '4—3—3' : (squad.length ? `${squad.length} jug.` : '—')} detail={demo ? 'equilibrio total' : 'sincronizados'} />
      </div>
      <div className="team-page-grid">
        <section className="panel team-pitch-panel">
          <PanelHeading eyebrow={demo ? 'ONCE TITULAR DE EJEMPLO' : 'PLANTILLA DEVUELTA POR LA API'} title={demo ? 'Tu formación' : 'Plantilla sincronizada'} action={demo ? <span className="formation-badge"><span className="live-indicator" /> 4—3—3</span> : <span className="sync-pill"><span className="live-indicator" /> CONSULTA</span>} badge={demo ? <DataTag /> : null} />
          {demo ? <><FormationPitch squad={squad} onPlayer={onPlayer} /><div className="team-position-strip">{positionCounts.map((item) => <span key={item.position}><strong>{item.count}</strong>{item.position}</span>)}</div></> : squad.length ? <RosterPreview players={squad} onPlayer={onPlayer} /> : <EmptyState icon={Users} title="Plantilla pendiente" text="No hemos podido identificar jugadores de esta liga." />}
        </section>
        <section className="panel squad-side-panel">
          <PanelHeading eyebrow={demo ? 'GESTIÓN DE PLANTILLA' : 'DETALLE DE JUGADORES'} title={demo ? 'Tu once' : 'Plantilla'} />
          <div className="captain-note"><span><Crown size={15} /></span><div><strong>{demo ? 'Capitán de referencia' : 'Selección local de capitán'}</strong><small>{demo ? 'Solo es una vista de ejemplo.' : 'El cambio es visual y no se sincroniza con LALIGA.'}</small></div></div>
          <div className="squad-list">
            {squad.map((player) => <SquadRow key={player.id} player={player} captain={captain === player.id} onCaptain={() => setCaptain(player.id)} onPlayer={() => onPlayer(player)} />)}
            {!squad.length && <EmptyState icon={Users} title="Todavía no hay jugadores" text="Comprueba que tu cuenta tiene un equipo asignado a esta liga." />}
          </div>
        </section>
      </div>
      {(bench.length > 0 || demo) && <section className="panel bench-panel">
        <PanelHeading eyebrow="PLAN B" title="En el banquillo" action={<span className="bench-count">{bench.length} jugadores</span>} />
        {bench.length ? <div className="bench-grid">{bench.map((player, index) => <button type="button" className="bench-player" key={player.id} onClick={() => onPlayer(player)}><span className="bench-order">{String(index + 1).padStart(2, '0')}</span><PlayerPortrait player={player} /><span className="bench-copy"><strong>{player.name}</strong><small>{player.position} <i /> {player.club}</small></span><span className="bench-points">{integer(player.points)} <small>pts</small></span><ChevronRight size={15} /></button>)}</div> : <EmptyState icon={Users} title="No se ha podido leer el banquillo" text="La plantilla de ejemplo no incluye reservas." />}
      </section>}
      {demo && <div className="demo-note"><Info size={16} /><span>Estás viendo una alineación de ejemplo. Conecta tu cuenta para sincronizar tu plantilla real.</span></div>}
    </div>
  );
}

function SmallStat({ icon: Icon, label, value, detail }) {
  return <div className="small-stat"><span className="small-stat-icon"><Icon size={16} /></span><span className="small-stat-copy"><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></div>;
}

function SquadRow({ player, captain, onCaptain, onPlayer }) {
  return (
    <div className="squad-row">
      <button type="button" className="squad-row-main" onClick={onPlayer}><PlayerPortrait player={player} size="small" /><span><strong>{player.name}</strong><small>{player.position} <i /> {player.club}</small></span></button>
      <span className="squad-row-points"><strong>{integer(player.points)}</strong><small>PTS</small></span>
      <button type="button" className={`captain-toggle ${captain ? 'selected' : ''}`} onClick={onCaptain} aria-label={captain ? 'Capitán' : 'Nombrar capitán'}><Crown size={14} /></button>
    </div>
  );
}

function MarketPage({ players, sourceCount, connected, privateMarketCount, favorites, onFavorite, onPlayer, onConnect, demo }) {
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('TODOS');
  const searchRef = useRef(null);
  useEffect(() => {
    const shortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const [sort, setSort] = useState('points');
  const filters = ['TODOS', 'POR', 'DEF', 'MED', 'DEL'];
  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('es');
    return players.filter((player) => {
      const matchesText = !normalizedQuery || `${player.name} ${player.club} ${player.seller || ''}`.toLocaleLowerCase('es').includes(normalizedQuery);
      return matchesText && (position === 'TODOS' || player.position === position);
    }).sort((a, b) => sort === 'price' ? b.price - a.price : sort === 'form' ? b.form - a.form : b.points - a.points);
  }, [players, query, position, sort]);
  const isPrivateMarket = connected && privateMarketCount > 0;
  return (
    <div className="page-stack">
      <div className="page-intro-row market-intro"><div><span className="eyebrow">EL SIGUIENTE FICHAJE PUEDE SER TUYO</span><h2>Ojea. Analiza. Ataca.</h2><p>Busca talento, compara valores y vigila a los jugadores que pueden cambiar tu once.</p></div><div className="market-intro-score"><span className="score-orbit"><Search size={19} /></span><span><strong>{isPrivateMarket ? integer(privateMarketCount) : integer(sourceCount)}</strong><small>{isPrivateMarket ? 'EN TU MERCADO' : 'JUGADORES EN EL CENSO'}</small></span></div></div>
      {(!connected || (!privateMarketCount && !publicPlayersAvailable(players))) && <div className="market-connect-banner"><span className="market-banner-icon"><Sparkles size={17} /></span><span><strong>{connected ? 'Tu mercado no está disponible todavía' : 'Conecta tu liga para ver el mercado real'}</strong><small>{connected ? 'Mostramos el censo público como alternativa.' : 'La vista previa puede incluir datos de ejemplo. Conecta tu cuenta para ver anuncios y disponibilidad de tu liga.'}</small></span>{!connected && <button type="button" onClick={onConnect}>Conectar <ArrowRight size={14} /></button>}</div>}
      <section className="panel market-panel">
        <div className="market-toolbar">
          <div className="market-toolbar-title"><div><span className="eyebrow">BUSCAR JUGADORES</span><h3>{isPrivateMarket ? 'Disponibles en tu liga' : 'Explorar jugadores'}</h3></div>{demo && <DataTag />}</div>
          <div className="market-controls">
            <label className="search-field"><Search size={16} /><input ref={searchRef} type="search" placeholder="Jugador, club…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar jugador o club" /><kbd>⌘ K</kbd></label>
            <label className="sort-select"><SlidersHorizontal size={15} /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Ordenar jugadores"><option value="points">Más puntos</option><option value="form">Mejor forma</option><option value="price">Mayor valor</option></select><ChevronDown size={13} /></label>
          </div>
        </div>
        <div className="market-filters"><div className="filter-pills">{filters.map((filter) => <button type="button" key={filter} onClick={() => setPosition(filter)} className={position === filter ? 'selected' : ''}>{filter === 'TODOS' ? 'Todos' : filter}</button>)}</div><span className="results-count"><Filter size={13} /> {filteredPlayers.length} resultados</span></div>
        <div className="market-table-head"><span>JUGADOR</span><span>FORMA</span><span>PUNTOS</span><span>VALOR</span><span /></div>
        <div className="market-list">
          {filteredPlayers.slice(0, 18).map((player) => <MarketRow key={player.id} player={player} favorite={favorites.has(String(player.id))} privateListing={isPrivateMarket} onFavorite={() => onFavorite(player.id)} onPlayer={() => onPlayer(player)} notify={notify} />)}
          {!filteredPlayers.length && <EmptyState icon={Search} title="No hemos encontrado jugadores" text="Prueba otro nombre o elimina algún filtro." />}
        </div>
        {filteredPlayers.length > 18 && <div className="market-more">Mostrando 18 de {filteredPlayers.length} jugadores <span>·</span> Refina la búsqueda para explorar el resto</div>}
        {isPrivateMarket && <div className="market-readonly-note"><ShieldCheck size={15} /><span>Mercado sincronizado con tu liga. La web está en modo consulta: las pujas y compras no se envían.</span></div>}
      </section>
      <div className="market-bottom-grid">
        <div className="market-tip-card"><span className="tip-mark"><Sparkles size={17} /></span><div><small>TIP DE MANAGER</small><strong>No fiches solo por el nombre.</strong><p>Compara la forma reciente, el valor y los próximos partidos antes de mover ficha.</p></div><ArrowUpRight size={17} /></div>
        <div className="market-tip-card purple-tip"><span className="tip-mark"><Star size={17} /></span><div><small>LISTA DE SEGUIMIENTO</small><strong>{favorites.size ? `${favorites.size} jugador${favorites.size === 1 ? '' : 'es'} guardado${favorites.size === 1 ? '' : 's'}` : 'Guarda tus candidatos.'}</strong><p>Marca la estrella de cualquier jugador y lo tendrás a mano para comparar.</p></div><Star size={17} /></div>
      </div>
    </div>
  );
}

function publicPlayersAvailable(players) {
  return players.some((player) => player.id && player.raw);
}

function MarketRow({ player, favorite, privateListing, onFavorite, onPlayer, notify }) {
  const change = Number(player.trend || 0);
  const status = player.tag || (player.clause ? 'Cláusula' : player.seller ? `De ${player.seller}` : privateListing ? 'Disponible' : 'Censo público');
  return (
    <div className="market-row">
      <div className="market-player-cell"><PlayerPortrait player={player} /><button type="button" className="market-player-copy" onClick={onPlayer}><strong>{player.name}</strong><small>{player.position} <i /> {player.club}{player.seller && <><i /> {player.seller}</>}</small></button><span className={`market-tag ${player.clause ? 'clause' : player.seller ? 'listed' : ''}`}>{status}</span></div>
      <span className="market-form-cell"><span className="form-meter"><i style={{ width: `${Math.min(100, Math.max(12, Number(player.form || 6) * 8))}%` }} /></span><strong>{Number(player.form || 0).toLocaleString('es-ES', { maximumFractionDigits: 1 })}</strong></span>
      <span className="market-points-cell"><strong>{integer(player.points)}</strong><small>pts</small></span>
      <span className="market-value-cell"><strong>{money(player.price)}</strong>{change !== 0 && <small className={change > 0 ? 'positive' : 'negative'}>{change > 0 ? '+' : ''}{change.toLocaleString('es-ES', { maximumFractionDigits: 1 })} M€</small>}</span>
      <span className="market-actions"><button type="button" className={`favorite-button ${favorite ? 'is-favorite' : ''}`} onClick={onFavorite} aria-label={favorite ? 'Quitar de favoritos' : 'Guardar jugador'}><Star size={16} fill={favorite ? 'currentColor' : 'none'} /></button><button type="button" className="row-detail-button" onClick={onPlayer}>Ficha <ArrowUpRight size={13} /></button></span>
    </div>
  );
}

function LeaguesPage({ connected, user, leagues, league, standing, activity, loading, demo, apiError, onLeague, onConnect }) {
  return (
    <div className="page-stack">
      <div className="page-intro-row"><div><span className="eyebrow">EL ORGULLO DE LA LIGA</span><h2>Tu gente. Tu rivalidad.</h2><p>Consulta la tabla, vigila a tus rivales y sigue cada movimiento de la competición.</p></div>{connected && <span className="sync-pill"><span className="live-indicator" /> {loading ? 'SINCRONIZANDO' : 'SESIÓN ACTIVA'}</span>}</div>
      {!connected && <div className="market-connect-banner league-connect-banner"><span className="market-banner-icon"><Trophy size={17} /></span><span><strong>¿Dónde juegas esta temporada?</strong><small>Inicia sesión con tu cuenta para encontrar tus ligas privadas y su clasificación real.</small></span><button type="button" onClick={onConnect}>Conectar cuenta <ArrowRight size={14} /></button></div>}
      <div className="league-overview-grid">
        <section className="league-feature-card">
          <div className="league-feature-top"><span className="league-cup-big"><Trophy size={21} /></span><span className="league-season">TEMPORADA 26/27 <i /> {connected ? (league?.size ? `${league.size} MANAGERS` : 'LIGA PRIVADA') : 'MODO DEMO'}</span><span className="league-more" aria-hidden="true"><MoreHorizontal size={18} /></span></div>
          <span className="league-feature-eyebrow">{connected ? 'TU COMPETICIÓN' : 'LIGA DE EJEMPLO'}</span>
          <h2>{league?.name || 'Liga del Barrio'}</h2>
          <p>{connected ? 'Una temporada larga. Un solo campeón. Cada punto cuenta.' : 'La clasificación ficticia te enseña cómo se verá tu competición al conectar la cuenta.'}</p>
          {connected && leagues.length > 1 && <label className="league-select-control"><Trophy size={15} /><select value={league?.id || ''} onChange={(event) => onLeague(event.target.value)}>{leagues.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label>}
          <div className="league-feature-stats"><span><strong>{standing.length ? integer(standing.length) : (league?.size ? integer(league.size) : (connected ? '—' : '12'))}</strong><small>MANAGERS</small></span><i /><span><strong>{connected ? '—' : '9'}</strong><small>JORNADAS</small></span><i /><span><strong>1</strong><small>OBJETIVO</small></span></div>
          <div className="league-feature-watermark"><Trophy size={132} /></div>
        </section>
        <section className="panel standings-panel">
          <PanelHeading eyebrow="CLASIFICACIÓN GENERAL" title="La carrera por el título" action={demo ? <DataTag /> : <span className="standings-count">{standing.length} managers</span>} />
          <div className="standings-table-header"><span>POS.</span><span>MANAGER</span><span>PTS</span><span>Δ</span></div>
          <div className="standings-list">
            {standing.slice(0, 7).map((row, index) => <StandingsRow key={row.teamId || index} row={row} selected={row.isMine || row.manager === user?.name} />)}
            {!standing.length && <EmptyState icon={Trophy} title="Sin clasificación" text={apiError || 'Selecciona una liga para ver su tabla.'} />}
          </div>
          <div className="standing-footer"><span><span className="live-indicator" /> PUNTOS ACTUALIZADOS</span><span>{loading ? 'Actualizando…' : 'Hace unos instantes'}</span></div>
        </section>
      </div>
      <div className="league-lower-grid">
        <section className="panel activity-feed-panel"><PanelHeading eyebrow="EL VESTUARIO NO DUERME" title="Últimos movimientos" action={<span className="feed-live"><i /> EN DIRECTO</span>} badge={demo ? <DataTag /> : null} />
          <div className="league-activity-feed">{activity.slice(0, 5).map((item, index) => <ActivityRow key={item.id || index} item={item} index={index} />)}{!activity.length && <EmptyState icon={Activity} title="No hay movimientos" text="La actividad de los managers aparecerá aquí." />}</div>
        </section>
        <RivalCard standing={standing} connected={connected} user={user} />
      </div>
      {demo && <div className="demo-note"><Info size={16} /><span>Clasificación y actividad de ejemplo. Al conectar tu cuenta se sustituirán por los datos de tus ligas.</span></div>}
    </div>
  );
}

function RivalCard({ standing, connected, user }) {
  const mine = standing.find((row) => row.isMine || row.manager === user?.name);
  const leader = standing[0];
  const gap = leader && mine ? Math.max(0, Number(leader.points || 0) - Number(mine.points || 0)) : null;
  return (
    <section className="rival-card"><span className="rival-star"><Award size={19} /></span><span className="eyebrow">A POR EL PRÓXIMO</span><h3>{leader?.manager || 'La cima espera'}</h3><p>{gap != null ? `${integer(gap)} puntos te separan del liderato.` : connected ? 'Sin datos suficientes para calcular la distancia al liderato.' : 'Sigue sumando puntos para escalar posiciones.'}</p><div className="rival-progress"><i style={{ width: gap == null ? '35%' : `${Math.max(9, Math.min(94, 100 - gap / 30))}%` }} /></div><small>{connected ? 'CLASIFICACIÓN ACTUAL' : 'RACHA DE LA JORNADA'} <b>{connected ? 'LIVE' : '+8 PTS'}</b></small></section>
  );
}

function StandingsRow({ row, selected }) {
  const change = Number(row.change ?? row.positionChange ?? 0);
  return (
    <div className={`standings-row ${selected ? 'is-mine' : ''}`}>
      <span className={`standing-rank rank-${row.rank}`}>{String(row.rank).padStart(2, '0')}</span>
      <span className="standing-manager"><Avatar name={row.manager} size="small" /><span><strong>{row.teamName || row.manager}</strong><small>{row.manager}{selected && <em> TÚ</em>}</small></span></span>
      <strong className="standing-points">{integer(row.points)}</strong>
      <span className={`standing-change ${change > 0 ? 'positive' : change < 0 ? 'negative' : 'unchanged'}`}>{change > 0 ? <ArrowUpRight size={13} /> : change < 0 ? <ArrowDownRight size={13} /> : <span>—</span>}{change ? Math.abs(change) : ''}</span>
    </div>
  );
}

function FixturesPage({ fixtures, week, connected, demo, canChangeWeek, loadingWeek, onWeekChange, onTeam }) {
  return (
    <div className="page-stack">
      <section className="fixture-hero">
        <div className="fixture-hero-copy"><span className="eyebrow">TEMPORADA 2026/27 <i /> JORNADA {week}</span><h2>El fútbol no<br /><em>espera a nadie.</em></h2><p>Elige bien tu once. Cada partido es una oportunidad de acercarte a la cima.</p><button type="button" className="button button-lime" onClick={onTeam}>Revisar plantilla <ArrowRight size={15} /></button></div>
        <div className="fixture-round"><span>JORNADA</span><strong>{String(week).padStart(2, '0')}</strong><i>·</i><small>LA LIGA<br />NO PARA</small></div>
        <div className="fixture-hero-caption"><CalendarDays size={14} /> PRÓXIMOS ENCUENTROS <span>·</span> {fixtures.length} PARTIDOS</div>
      </section>
      <div className="fixture-layout">
        <section className="panel fixtures-panel"><div className="fixture-panel-head"><PanelHeading eyebrow="CALENDARIO OFICIAL" title={`Jornada ${week}`} badge={demo ? <DataTag /> : null} /><div className="round-switch"><button type="button" aria-label="Jornada anterior" disabled={!canChangeWeek || loadingWeek || Number(week) <= 1} onClick={() => onWeekChange(Number(week) - 1)}><ChevronDown size={15} /></button><span>{loadingWeek ? '…' : `J${week}`}</span><button type="button" aria-label="Jornada siguiente" disabled={!canChangeWeek || loadingWeek} onClick={() => onWeekChange(Number(week) + 1)}><ChevronDown size={15} /></button></div></div>
          <div className="fixture-list">{fixtures.slice(0, 12).map((match, index) => <FixtureRow key={match.id || index} match={match} index={index} />)}</div>
          {!fixtures.length && <EmptyState icon={CalendarDays} title="Calendario pendiente" text="No hay partidos para esta jornada." />}
        </section>
        <aside className="fixture-aside">
          <section className="panel matchday-insight"><span className="insight-icon"><Zap size={17} /></span><span className="eyebrow">CLAVE DE LA JORNADA</span><h3>La forma importa.<br />El calendario, más.</h3><p>Consulta los cruces y revisa qué jugadores tienen una oportunidad real de brillar.</p><div className="insight-divider" /><span className="insight-quote">«La suerte favorece a la mente preparada.»</span></section>
          <section className="panel fixture-api-note"><ShieldCheck size={18} /><div><strong>Datos conectados</strong><small>{connected ? 'Calendario consultado en la API de LALIGA Fantasy.' : 'Conecta tu cuenta para sincronizar la información de tu competición.'}</small></div></section>
        </aside>
      </div>
    </div>
  );
}

function FixtureRow({ match, index }) {
  const matchDate = match.kickoff ? new Date(match.kickoff) : null;
  const validDate = matchDate && !Number.isNaN(matchDate.getTime()) && String(match.kickoff).includes('T');
  const dateLabel = validDate ? new Intl.DateTimeFormat('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(matchDate).replace('.', '') : match.kickoff || `Partido ${index + 1}`;
  return (
    <div className="fixture-row"><span className="fixture-kickoff"><Clock3 size={13} />{dateLabel}</span><span className="fixture-team home"><strong>{match.home}</strong><ClubBadge code={match.homeCode} name={match.home} /></span><span className="fixture-vs">VS</span><span className="fixture-team away"><ClubBadge code={match.awayCode} name={match.away} /><strong>{match.away}</strong></span><span className="fixture-status">{String(match.status).toLowerCase().includes('live') ? <><i /> EN JUEGO</> : '—'}</span></div>
  );
}

function ClubBadge({ code, name }) {
  const short = String(code || name || 'LL').slice(0, 3).toUpperCase();
  const color = CLUB_COLORS[short] || '#766de0';
  return <span className="club-badge" style={{ '--club-color': color }} title={name}>{short.slice(0, 2)}</span>;
}

function ProfilePage({ user, connected, league, apiStatus, apiError, loading, onConnect, onLogout, onRefresh }) {
  const [showDetails, setShowDetails] = useState(false);
  const apiLabel = apiStatus === 'online' ? 'API pública disponible' : apiStatus === 'partial' ? 'Respuesta parcial' : apiStatus === 'loading' ? 'Comprobando conexión…' : 'Sin conexión pública';
  return (
    <div className="page-stack">
      <div className="page-intro-row"><div><span className="eyebrow">TU ESPACIO</span><h2>Tu cuenta, a tu manera.</h2><p>Administra la sesión y revisa qué datos están conectados.</p></div>{connected && <button className="button button-outline" type="button" onClick={onLogout}><LogOut size={15} /> Cerrar sesión</button>}</div>
      <div className="profile-layout">
        <section className="panel profile-card"><div className="profile-cover"><span className="profile-cover-orb" /><span className="profile-cover-orb second" /><span className="profile-season">LALIGA FANTASY <i /> TEMPORADA 26/27</span></div>
          <div className="profile-identity"><Avatar name={user?.name} image={user?.avatar} size="large" /><span className={`account-state ${connected ? 'connected' : ''}`}><i />{connected ? 'CONECTADA' : 'VISTA PREVIA'}</span></div>
          <div className="profile-info"><span className="eyebrow">MANAGER</span><h2>{user?.name || 'Manager'}</h2><p>{user?.email || 'Inicia sesión para sincronizar tu cuenta de LALIGA Fantasy.'}</p><div className="profile-info-pills"><span><ShieldCheck size={14} /> {connected ? (user?.provider || 'LALIGA Fantasy') : 'Cuenta de invitado'}</span>{league && <span><Trophy size={14} /> {league.name}</span>}</div></div>
          {!connected && <button className="button button-primary profile-login" type="button" onClick={onConnect}><LogIn size={16} /> Conectar mi cuenta</button>}
          <div className="profile-security"><LockKeyhole size={15} /><span><strong>Tu sesión es privada.</strong><small>{connected ? 'El token se guarda en el almacenamiento de sesión de este navegador.' : 'La contraseña nunca se guarda en esta aplicación.'}</small></span></div>
        </section>
        <div className="profile-side-stack">
          <section className="panel connection-card"><PanelHeading eyebrow="ESTADO DEL SERVICIO" title="Conexiones" action={connected ? <button type="button" className={`refresh-button ${loading ? 'spinning' : ''}`} onClick={onRefresh} aria-label="Actualizar conexión"><Activity size={16} /></button> : null} />
            <div className="connection-row"><span className={`connection-dot ${apiStatus === 'online' ? 'green' : apiStatus === 'loading' ? 'yellow' : 'gray'}`} /><span><strong>API pública LALIGA</strong><small>{apiLabel}</small></span><span className="connection-mode">{apiStatus === 'online' ? 'OK' : apiStatus === 'loading' ? '…' : '—'}</span></div>
            <div className="connection-row"><span className={`connection-dot ${connected ? 'green' : 'gray'}`} /><span><strong>Cuenta LALIGA Fantasy</strong><small>{connected ? 'Autenticada en este navegador' : 'No conectada'}</small></span><span className="connection-mode">{connected ? 'OK' : '—'}</span></div>
            <div className="connection-row"><span className={`connection-dot ${connected && league ? 'green' : 'gray'}`} /><span><strong>Datos de liga</strong><small>{league?.name || 'Inicia sesión para cargar tus ligas'}</small></span><span className="connection-mode">{connected && league ? 'OK' : '—'}</span></div>
            {apiError && <div className="connection-warning"><Info size={14} />{apiError}</div>}
          </section>
          <section className="panel endpoint-card"><div className="endpoint-card-head"><span className="endpoint-icon"><Activity size={16} /></span><span><span className="eyebrow">INTEGRACIÓN</span><h3>API oficial de Fantasy</h3></span><button type="button" className="endpoint-toggle" onClick={() => setShowDetails((value) => !value)}>{showDetails ? 'Ocultar' : 'Ver rutas'} <ChevronDown size={14} /></button></div>
            <p>La aplicación consulta datos públicos y, al autenticarte, rutas privadas asociadas a tu cuenta.</p>
            {showDetails && <div className="endpoint-list"><div><span className="endpoint-method public">GET</span><code>/v1/competition/1/players</code><small>Jugadores</small></div><div><span className="endpoint-method public">GET</span><code>/v1/competition/1/calendar</code><small>Calendario</small></div><div><span className="endpoint-method private">GET</span><code>/v4/user/me</code><small>Perfil</small></div><div><span className="endpoint-method private">GET</span><code>/v1/competition/1/leagues</code><small>Ligas</small></div><div><span className="endpoint-method private">GET</span><code>/v1/competition/1/league/{'{id}'}/market</code><small>Mercado</small></div><div><span className="endpoint-method private">GET</span><code>/v1/competition/1/leagues/{'{id}'}/standing</code><small>Clasificación</small></div></div>}
            <div className="endpoint-foot"><span><Shield size={13} /> Endpoints no oficiales / sujetos a cambios</span><a href="https://fantasy-api.llt-services.com/api" target="_blank" rel="noreferrer">Ver API <ExternalLink size={12} /></a></div>
          </section>
          {connected && <button type="button" className="button button-danger-outline logout-mobile" onClick={onLogout}><LogOut size={15} /> Cerrar sesión</button>}
        </div>
      </div>
      <div className="profile-disclaimer"><CircleHelp size={15} /><span>Esta herramienta es una interfaz independiente y no está afiliada ni respaldada por LALIGA. No se envían pujas, ventas ni cambios de alineación.</span></div>
    </div>
  );
}

function AuthModal({ loading, error, notice, onEmail, onGoogle, onClose }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const submit = (event) => {
    event.preventDefault();
    setFormError('');
    if (!email.trim() || !password) return setFormError('Introduce tu correo electrónico y contraseña.');
    onEmail(email.trim(), password);
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button>
        <div className="auth-visual"><Brand compact /><div className="auth-visual-center"><span className="auth-cup-orbit"><span><Trophy size={28} /></span><i /><b /></span><span className="eyebrow">HA LLEGADO TU MOMENTO</span><h2>Juega como<br /><em>un campeón.</em></h2><p>Tu liga, tu equipo, tu siguiente gran decisión.</p></div><div className="auth-visual-foot"><ShieldCheck size={14} /> Acceso seguro a través de LALIGA</div><span className="auth-visual-number">26<br />27</span></div>
        <div className="auth-form-side"><div className="auth-form-head"><span className="eyebrow">BIENVENIDO DE NUEVO</span><h2 id="login-title">Entra en el juego.</h2><p>Conecta la cuenta que usas en LALIGA Fantasy.</p></div>
          <button type="button" className="google-login-button" onClick={onGoogle} disabled={loading}><span className="google-g">G</span><span>Continuar con Google</span>{loading ? <Loader2 size={16} className="spin" /> : <ArrowRight size={15} />}</button>
          <div className="auth-divider"><span /> <small>O ENTRA CON TU CORREO</small> <span /></div>
          <form className="auth-form" onSubmit={submit}>
            <label className="auth-label">Correo electrónico<div className="auth-input-wrap"><Mail size={16} /><input autoComplete="email" type="email" placeholder="tu@correo.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
            <label className="auth-label">Contraseña<div className="auth-input-wrap"><LockKeyhole size={16} /><input autoComplete="current-password" type={showPassword ? 'text' : 'password'} placeholder="Tu contraseña de LALIGA" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
            {(error || formError) && <div className="auth-error"><CircleAlert size={15} />{error || formError}</div>}
            {notice && <div className="auth-notice"><Info size={15} />{notice}</div>}
            <button type="submit" className="button button-primary auth-submit" disabled={loading}>{loading ? <><Loader2 size={16} className="spin" /> Validando…</> : <>Iniciar sesión <ArrowRight size={15} /></>}</button>
          </form>
          <div className="auth-privacy"><ShieldCheck size={15} /><span><strong>La privacidad va primero.</strong><br />Tu contraseña se transmite por HTTPS al proveedor de identidad de LALIGA mediante un proxy limitado. No se almacena en esta aplicación.</span></div>
          <div className="auth-google-note"><Info size={13} /><span>El acceso con Google depende de que LALIGA autorice la URL de retorno de esta instalación. Si el proveedor la rechaza, revisa <code>VITE_LALIGA_REDIRECT_URI</code>.</span></div>
          <div className="auth-register">¿Aún no tienes cuenta? <a href="https://fantasy.laliga.com/" target="_blank" rel="noreferrer">Crea tu cuenta en LALIGA <ExternalLink size={11} /></a></div>
        </div>
      </section>
    </div>
  );
}

function PlayerDetails({ player, favorite, onFavorite, onClose }) {
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const isDemoPlayer = !player?.raw;
  useEffect(() => {
    if (isDemoPlayer) return;
    let active = true;
    setLoading(true);
    Promise.allSettled([
      apiGet(API_ENDPOINTS.player(player.id)),
      apiGet(API_ENDPOINTS.playerValueHistory(player.id)),
    ]).then(([detailResult, historyResult]) => {
      if (!active) return;
      if (detailResult.status === 'fulfilled') setDetail(detailResult.value);
      if (historyResult.status === 'fulfilled') setHistory(unwrapList(historyResult.value, ['history', 'values', 'items', 'content', 'results']));
      if (detailResult.status === 'rejected' && historyResult.status === 'rejected') setLoadError('No se pudo ampliar la ficha desde la API.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [player.id, isDemoPlayer]);
  const detailPayload = detail?.player || detail?.data || detail || {};
  const value = Number(detailPayload.marketValue ?? detailPayload.price ?? player.price) || player.price;
  return (
    <div className="modal-backdrop player-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="player-detail-modal" role="dialog" aria-modal="true" aria-labelledby="player-name">
        <div className="player-detail-cover"><button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Cerrar ficha"><X size={18} /></button><span className="detail-cover-pattern" /><span className="player-detail-position">{player.position} <i /> {player.club}</span><PlayerPortrait player={player} size="hero" /><div className="player-detail-header"><span className="eyebrow">FICHA DE JUGADOR</span><h2 id="player-name">{player.name}</h2><span className="detail-squad-status"><span /> {player.status || 'Disponible'}</span></div></div>
        <div className="player-detail-content">
          {loading && <div className="detail-loading"><Loader2 size={15} className="spin" /> Consultando datos públicos…</div>}
          <div className="player-stat-grid"><div><span>VALOR DE MERCADO</span><strong>{money(value)}</strong>{player.trend ? <small className={player.trend > 0 ? 'positive' : 'negative'}>{player.trend > 0 ? '+' : ''}{player.trend} M€ esta semana</small> : <small>Valor actual</small>}</div><div><span>PUNTOS</span><strong>{integer(detailPayload.points ?? player.points)}</strong><small>temporada actual</small></div><div><span>FORMA</span><strong>{Number(player.form || 0).toLocaleString('es-ES', { maximumFractionDigits: 1 })}<small>/10</small></strong><small>últimas jornadas</small></div></div>
          <div className="detail-data-row"><span>Club <strong>{player.club}</strong></span><span>Posición <strong>{player.position}</strong></span><span>Última actualización <strong>{loading ? 'Consultando…' : 'Datos disponibles'}</strong></span></div>
          {history.length > 0 && <div className="history-preview"><span className="eyebrow">HISTÓRICO DE VALOR</span><div>{history.slice(-6).map((point, index) => <span key={index} style={{ height: `${24 + (Number(point.value ?? point.marketValue ?? point) % 50)}px` }} />)}</div></div>}
          {loadError && <div className="detail-soft-note"><Info size={14} />{loadError}</div>}
          <div className="detail-foot"><span><ShieldCheck size={14} /> {isDemoPlayer ? 'Ficha de ejemplo' : 'Datos públicos de LALIGA Fantasy'}</span><button type="button" className={`button ${favorite ? 'button-favorite-active' : 'button-outline'}`} onClick={onFavorite}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /> {favorite ? 'En seguimiento' : 'Seguir jugador'}</button></div>
        </div>
      </section>
    </div>
  );
}

function ConnectNudge({ onClick }) {
  return <button type="button" className="connect-nudge" onClick={onClick}><span className="nudge-icon"><Sparkles size={18} /></span><span><strong>Este equipo puede ser el tuyo.</strong><small>Conecta tu cuenta de LALIGA Fantasy y deja que tus datos ocupen el campo.</small></span><span className="nudge-link">Sincronizar ahora <ArrowRight size={14} /></span></button>;
}

function EmptyState({ icon: Icon = Info, title, text }) {
  return <div className="empty-state"><span><Icon size={19} /></span><strong>{title}</strong><small>{text}</small></div>;
}

function Toast({ message, kind }) {
  return <div className={`toast-message ${kind === 'info' ? 'toast-info' : ''}`}><span>{kind === 'info' ? <Info size={16} /> : <Check size={16} />}</span>{message}</div>;
}

export default App;
