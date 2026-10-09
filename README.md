# LALIGA Fantasy Companion

Una interfaz web responsive para consultar plantilla, mercado, ligas y jornada de LALIGA Fantasy. El proyecto empieza en **modo demostración** para que puedas explorar el producto sin introducir credenciales; al iniciar sesión intenta cargar los datos reales desde la API de Fantasy.

> **Proyecto independiente y no oficial.** La API no ofrece documentación pública estable y sus rutas pueden cambiar. Esta aplicación no envía pujas, compras, ventas ni cambios de alineación: el mercado funciona en modo consulta.

## Desarrollo

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite. Para probar la compilación y el servidor de producción:

```bash
npm run build
npm start
```

El servidor de desarrollo y `server.mjs` publican un proxy de mismo origen para evitar que el navegador dependa de CORS:

- `/api/laliga/*` → `https://fantasy-api.llt-services.com/api/*`
- `/auth/provider/token` → endpoint de tokens de Azure AD B2C de LALIGA

El proxy es intencionadamente limitado a esos dos destinos; no es un proxy de URLs arbitrarias.

## Descubrimientos de la API

Base conocida: [`https://fantasy-api.llt-services.com/api`](https://fantasy-api.llt-services.com/api). Las rutas siguientes se han reconstruido a partir de referencias públicas y clientes comunitarios; no son un contrato oficial y no se pudieron validar en este entorno. La mayor parte de las rutas de competición usa el identificador `1` en `/v1/competition/1/`.

### Lectura pública (no requiere sesión)

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/v1/competition/1/players` | Censo de jugadores |
| `GET` | `/v3/teams-master` | Equipos y metadatos de clubes |
| `GET` | `/v1/competition/1/week/current` | Jornada actual |
| `GET` | `/v1/competition/1/calendar?weekNumber=N` | Calendario de una jornada |
| `GET` | `/v1/competition/1/player/{id}` | Ficha pública de jugador |
| `GET` | `/v1/competition/1/player/{id}/market-value` | Histórico público de valor del jugador |

### Lectura privada (requiere `Authorization: Bearer …`)

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/v4/user/me` | Perfil de la cuenta |
| `GET` | `/v1/competition/1/leagues` | Ligas del usuario |
| `GET` | `/v1/competition/1/leagues/{leagueId}/standing` | Clasificación de una liga |
| `GET` | `/v1/competition/1/leagues/{leagueId}/teams/{teamId}` | Plantilla de un mánager |
| `GET` | `/v1/competition/1/leagues/{leagueId}/activity/{index}` | Actividad reciente |
| `GET` | `/v1/competition/1/teams/{teamId}/money` | Saldo del equipo propio |
| `GET` | `/v1/competition/1/league/{leagueId}/market` | Mercado de una liga (ruta singular `league`) |

Los endpoints privados se consultan solo después de que el usuario inicia sesión. La información de clasificación, equipos y mercado es privada a nivel de liga; no basta con las rutas públicas.

## Inicio de sesión y límites

La autenticación observada usa Azure AD B2C (`login.laliga.es`), con el endpoint `/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token`. El formulario de correo usa el flujo de contraseña bajo la política `B2C_1A_ResourceOwnerv2`; Google inicia autorización y canje de código con **PKCE** bajo `B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN`. Los client IDs configurables de `.env.example` son identificadores públicos observados, no secretos. La contraseña no se guarda en la app. Los tokens se guardan en `sessionStorage` (no en `localStorage`) y desaparecen al cerrar la pestaña.

**La autenticación web puede requerir configuración por parte de LALIGA.** Azure B2C valida las URLs de retorno permitidas por cada cliente. Por eso, el inicio con Google solo funcionará si el `redirect_uri` de esta instalación está aceptado por la política/cliente de LALIGA. Configura `VITE_LALIGA_REDIRECT_URI` en `.env` y usa una URL HTTPS autorizada. Si B2C devuelve un error de `redirect_uri`, no es un fallo de la interfaz: la URL aún no está permitida por el proveedor. Los IDs de cliente incluidos son identificadores públicos observados, no credenciales ni una garantía de disponibilidad; pueden cambiar.

Para probar ajustes locales, copia `.env.example` a `.env`. No guardes contraseñas, tokens ni secretos de usuario en `.env` o en el repositorio.

## Modos de datos

- **Modo demo:** deja navegar por todas las secciones con información de muestra cuando la API no responde o no hay sesión.
- **API pública:** sincroniza jugadores, equipos, jornada y calendario si están disponibles.
- **Cuenta conectada:** intenta cargar perfil, ligas, clasificación, plantillas, saldo y mercado. Si un endpoint privado cambia o falla, se muestra el error y la aplicación mantiene una experiencia de consulta.
- **Escrituras desactivadas:** no se ha conectado ningún endpoint de mutación, ya que las rutas de puja/compra/venta no están verificadas públicamente.

## Privacidad y atribución

La app no está afiliada ni respaldada por LALIGA. Inicia sesión únicamente con tu propia cuenta y revisa las condiciones del servicio oficial. Las credenciales se envían mediante HTTPS al proveedor de identidad de LALIGA; el proxy del proyecto reenvía el cuerpo sin registrarlo. La API y el proveedor pueden cambiar sin aviso.
