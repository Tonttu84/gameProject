# Auth Module Design

Status: **skeleton / TDD-only — no implementation yet.**
Every endpoint is currently unauthenticated. This document is the agreed design
before any code is written.

Pattern follows FullStackOpen Part 4 "Token authentication"
(https://fullstackopen.com/en/part4/token_authentication), adapted for a
single-process C++ server with OpenSSL instead of Node/bcrypt.

---

## 1. Scope

Single-player campaign server. No OAuth, no database, no multi-tenant users.
The goals are:

- Prevent anonymous calls to mutating/expensive endpoints (primarily
  `POST /api/battle`, which shells out a subprocess per call).
- Keep it compilable and testable with `-DTESTING` and zero new library deps
  beyond what is already on the system (OpenSSL is available via `libssl-dev`).
- Slot into `BattleServer.cpp` as a thin middleware helper — no rearchitecture
  of the server loop.

---

## 2. Endpoint table

| Method | Path         | Auth required | Description                                          |
|--------|--------------|---------------|------------------------------------------------------|
| GET    | /api/info    | No            | Build metadata (public)                              |
| GET    | /api/map     | No            | Map JSON (public; read-only)                         |
| POST   | /api/users   | No            | Create account → 201 `{ username, id }` \| 409      |
| GET    | /api/users   | No            | List users (optional, public) → `[{ username, id }]` |
| POST   | /api/login   | No            | Verify credentials → 200 `{ token }` \| 401         |
| POST   | /api/battle  | Yes           | Run a battle (expensive; protected) → 401 if no/bad token |

Additional endpoints added in the future should default to **Yes** unless
explicitly documented as public.

Response shapes follow FullStackOpen conventions exactly:

```json
// POST /api/login — success
{ "token": "<jwt>" }

// POST /api/login — failure (wrong password OR unknown user — same body both ways)
{ "error": "invalid username or password" }

// POST /api/users — success
{ "username": "alice", "id": "<generated-id>" }

// POST /api/users — duplicate
{ "error": "username must be unique" }

// Protected endpoint — missing or invalid token
{ "error": "token missing or invalid" }
```

---

## 3. Data structures

```cpp
// auth/AuthStore.hpp  (proposed)

#pragma once
#include <string>
#include <unordered_map>
#include <mutex>

namespace Auth {

struct User {
    std::string id;            // UUID or sequential id, returned in POST /api/users
    std::string username;
    std::string passwordHash;  // PBKDF2-SHA256, self-describing format (see §5)
                               // format: "pbkdf2$<iters>$<hex-salt>$<hex-dk>"
};

// No Session struct needed — JWT is stateless.
// The server only needs to store users, not active tokens.

class AuthStore {
public:
    // POST /api/users. Returns the new User on success, nullopt if username already exists
    // or if username/password fail validation rules.
    std::optional<User> createUser(const std::string& username,
                                   const std::string& password);

    // POST /api/login. Verifies credentials; returns a signed JWT on success,
    // empty string on failure (wrong password OR unknown user — indistinguishable).
    std::string login(const std::string& username,
                      const std::string& password,
                      const std::string& jwtSecret);

    // Optional: returns a snapshot for GET /api/users.
    std::vector<User> listUsers() const;

    // Test accessor — exposes stored hash for PBKDF2 format assertions.
    std::string getPasswordHash(const std::string& username) const;

private:
    mutable std::mutex _mu;
    std::unordered_map<std::string, User> _users;  // username → User

    std::string hashPassword(const std::string& password);
    bool verifyPassword(const std::string& password, const std::string& stored);
    std::string nextId();
};

} // namespace Auth
```

---

## 4. JWT scheme (HS256 / stateless)

**Algorithm**: HMAC-SHA256 (HS256) — the simplest JWT algorithm, no key-pair management.

**Structure**: standard three-part `header.payload.signature`, all base64url-encoded.

```
header   = base64url({ "alg": "HS256", "typ": "JWT" })
payload  = base64url({ "id": "<user-id>", "username": "alice", "exp": <unix-ts> })
signature = HMAC-SHA256(header + "." + payload, JWT_SECRET)
token = header + "." + payload + "." + base64url(signature)
```

**Payload claims** (minimal, FullStackOpen style):

| Claim      | Value                                    |
|------------|------------------------------------------|
| `id`       | User id (string)                         |
| `username` | Username (string)                        |
| `exp`      | Unix timestamp: `now + 7 * 24 * 3600`   |

**Secret**: read from the `JWT_SECRET` environment variable at server startup.
The server calls `getenv("JWT_SECRET")` in `runServer()`; if it returns `nullptr`
or an empty string the server prints an error and exits immediately — it must
never start with an empty secret.

**Stateless verification**: `verifyJwt(token, secret)` re-computes the signature
over `header.payload` and compares with `CRYPTO_memcmp()` (constant-time). Then
checks `exp >= time(nullptr)`. No server-side token map is needed.

**Why stateless / why no logout**: FullStackOpen's Part 4 approach. For a
single-player game where sessions last days, the simplicity trade-off is
acceptable. If logout becomes important later, a small server-side revocation
list (bloom filter or set) can be added without changing the token format.

**C++ implementation sketch**:

```cpp
// auth/Jwt.hpp (proposed)
namespace Auth {

// Signs a new token for `user` using `secret`. Returns the JWT string.
std::string signJwt(const User& user, const std::string& secret);

// Verifies signature and exp claim. Returns the decoded payload on success,
// or nullopt if signature is invalid, token is malformed, or exp has passed.
std::optional<json> verifyJwt(const std::string& token, const std::string& secret);

} // namespace Auth
```

---

## 5. Password storage

PBKDF2-SHA256 via OpenSSL's `PKCS5_PBKDF2_HMAC()`:

- **Salt**: 16 random bytes from `RAND_bytes()`, generated per user at
  registration time.
- **Iterations**: 100,000 (NIST SP 800-132 minimum recommendation for
  PBKDF2-SHA256 as of 2024; adjust upward if server latency allows).
- **Derived key length**: 32 bytes.
- **Stored string format**: `"pbkdf2$100000$<hex-salt>$<hex-dk>"` — fully
  self-describing so the iteration count can be bumped in the future without a
  migration step.

FullStackOpen uses bcrypt in Node.js. PBKDF2 at 100k iterations is the C++
equivalent: same purpose (slow KDF with per-user salt), available in OpenSSL
without new deps. Argon2 would be stronger but requires an external library.

---

## 6. Frontend changes (`frontend/src/services/api.js`)

Follows FullStackOpen Part 4 style — token stored in `localStorage`, injected
as `Authorization: Bearer <token>` on protected calls.

```js
// Store token from login:
export const login = (username, password) =>
    axios.post('/api/login', { username, password })
         .then(r => {
             const token = r.data.token;
             window.localStorage.setItem('battleAppToken', token);
             return r.data;
         });

// Create account (no token returned on register — must login separately):
export const createUser = (username, password) =>
    axios.post('/api/users', { username, password }).then(r => r.data);

// Helper: read token from localStorage and build header object:
const authHeader = () => {
    const token = window.localStorage.getItem('battleAppToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

// Protected call:
export const postBattle = (payload) =>
    axios.post('/api/battle', payload, { headers: authHeader() })
         .then(r => r.data);
```

Note: `localStorage` persists across page reloads (unlike the previous
module-scope approach). If the server is ever exposed beyond localhost, switch to
an `HttpOnly` cookie to prevent XSS token theft.

---

## 7. BattleServer.cpp middleware sketch

```cpp
// JWT_SECRET must be set before the server starts:
const char* secret_env = getenv("JWT_SECRET");
if (!secret_env || secret_env[0] == '\0') {
    std::cerr << "JWT_SECRET environment variable not set — refusing to start\n";
    return;
}
std::string jwtSecret(secret_env);

// Middleware helper — call at the top of each protected handler:
static bool requireAuth(const httplib::Request& req, httplib::Response& res,
                        const std::string& secret)
{
    std::string hdr = req.get_header_value("Authorization");
    if (hdr.size() < 8 || hdr.substr(0, 7) != "Bearer ") {
        res.status = 401;
        res.set_content("{\"error\":\"token missing or invalid\"}", "application/json");
        return false;
    }
    std::string token = hdr.substr(7);
    if (!Auth::verifyJwt(token, secret)) {
        res.status = 401;
        res.set_content("{\"error\":\"token missing or invalid\"}", "application/json");
        return false;
    }
    return true;
}

// POST /api/battle handler:
svr.Post("/api/battle", [&](const httplib::Request& req, httplib::Response& res) {
    if (!requireAuth(req, res, jwtSecret)) return;
    // ... existing logic unchanged ...
});

// POST /api/login handler:
svr.Post("/api/login", [&](const httplib::Request& req, httplib::Response& res) {
    auto j = json::parse(req.body, nullptr, false);
    if (j.is_discarded() || !j.contains("username") || !j.contains("password")) {
        res.status = 400;
        res.set_content("{\"error\":\"username and password required\"}", "application/json");
        return;
    }
    std::string token = authStore.login(j["username"], j["password"], jwtSecret);
    if (token.empty()) {
        res.status = 401;
        res.set_content("{\"error\":\"invalid username or password\"}", "application/json");
        return;
    }
    res.status = 200;
    res.set_content("{\"token\":\"" + token + "\"}", "application/json");
});

// POST /api/users handler:
svr.Post("/api/users", [&](const httplib::Request& req, httplib::Response& res) {
    auto j = json::parse(req.body, nullptr, false);
    if (j.is_discarded() || !j.contains("username") || !j.contains("password")) {
        res.status = 400;
        res.set_content("{\"error\":\"username and password required\"}", "application/json");
        return;
    }
    auto user = authStore.createUser(j["username"], j["password"]);
    if (!user) {
        res.status = 409;
        res.set_content("{\"error\":\"username must be unique\"}", "application/json");
        return;
    }
    res.status = 201;
    res.set_content(
        "{\"username\":\"" + user->username + "\",\"id\":\"" + user->id + "\"}",
        "application/json");
});
```

---

## 8. Attack surface and security notes

| Threat                           | Mitigation                                                      |
|----------------------------------|-----------------------------------------------------------------|
| JWT signature forgery            | HMAC-SHA256 with server-only `JWT_SECRET`; constant-time compare via `CRYPTO_memcmp()`. |
| JWT exp bypass                   | `verifyJwt()` always checks `exp >= time(nullptr)` before returning success. |
| Brute-force login                | PBKDF2 at 100k iterations slows each attempt. Rate-limiting is a TODO. |
| Token theft (XSS)                | `localStorage` per FullStackOpen style; acceptable for localhost dev. Switch to `HttpOnly` cookie if server leaves localhost. |
| No logout / token revocation     | Accepted trade-off (stateless JWT). Add a small revocation set later if needed. |
| Username enumeration             | `login()` returns the same 401 body for unknown user and wrong password. |
| Long passwords (DoS via PBKDF2)  | Reject passwords longer than 1024 bytes before hashing.        |
| Path traversal on map name       | `isSafeMapName()` already guards this; auth does not change it. |
| Concurrent access to user store  | `std::mutex` in `AuthStore` guards `_users`.                   |
| Empty JWT_SECRET at startup      | Server refuses to start if `JWT_SECRET` is unset or empty.     |
| CORS missing Authorization header| `Access-Control-Allow-Headers` in `BattleServer.cpp` must add `Authorization` alongside `Content-Type` for browser preflight to pass. |
| Temp-file race on /api/battle    | Existing PID-named file race (noted in `BattleServer.cpp`). Auth does not fix this; tracked separately. |

---

## 9. Open questions (flag for user)

1. **Persistence**: user accounts vanish on server restart. Acceptable for now?
   A flat JSON file (`auth/users.json`, not committed to git) would survive
   restarts without needing a database.

2. **Rate-limiting**: no brute-force protection beyond PBKDF2 slowness. A
   per-IP fail counter with exponential back-off is the natural next step.

3. **Token revocation / logout**: JWT is stateless so there is no server-side
   logout. If the game needs "sign out everywhere" semantics, add a small
   in-memory revocation set (token jti claims + a set of revoked jti strings)
   or switch back to stateful sessions for that endpoint only.

4. **Username constraints**: no policy is defined yet. Minimum/maximum length,
   allowed characters, case-sensitivity — all TBD before `createUser()` is
   implemented.

5. **GET /api/users**: included in the endpoint table following FullStackOpen
   convention, but may be omitted for the game if listing all users serves no
   purpose.
