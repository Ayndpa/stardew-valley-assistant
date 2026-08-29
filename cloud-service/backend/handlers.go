package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type App struct {
	db        *sql.DB
	jwtSecret []byte
}

type Account struct {
	ID           string     `json:"id"`
	Email        string     `json:"email"`
	Username     *string    `json:"username,omitempty"`
	AvatarURL    *string    `json:"avatar_url,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	PasswordHash string     `json:"-"`
}

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/register", a.handleRegister)
	mux.HandleFunc("POST /api/login", a.handleLogin)
	mux.HandleFunc("GET /api/me", a.requireAuth(a.handleMe))
	mux.HandleFunc("PATCH /api/me", a.requireAuth(a.handleUpdateMe))
	mux.HandleFunc("GET /api/settings", a.requireAuth(a.handleGetSettings))
	mux.HandleFunc("PUT /api/settings", a.requireAuth(a.handlePutSettings))
	mux.HandleFunc("POST /api/logout", a.handleLogout)
}

// --- 响应工具 ---

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// --- 认证 ---

type Claims struct {
	UserID string `json:"uid"`
	jwt.RegisteredClaims
}

func (a *App) issueToken(userID string) (string, time.Time, error) {
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "account-system",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(a.jwtSecret)
	return signed, expiresAt, err
}

func (a *App) parseToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("意外的签名算法")
		}
		return a.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("无效或过期的令牌")
	}
	return claims, nil
}

func (a *App) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		token := strings.TrimPrefix(auth, "Bearer ")
		if token == "" || token == auth {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		claims, err := a.parseToken(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		next(w, r.WithContext(withUserID(r.Context(), claims.UserID)))
	}
}

// --- 注册 ---

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Username string `json:"username"`
}

func (a *App) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Username = strings.TrimSpace(req.Username)

	if req.Email == "" || !strings.Contains(req.Email, "@") {
		writeError(w, http.StatusBadRequest, "邮箱格式不正确")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "密码至少 8 位")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "密码加密失败")
		return
	}

	var id string
	err = a.db.QueryRowContext(r.Context(),
		`INSERT INTO public.accounts (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id`,
		req.Email, string(hash), nullString(req.Username),
	).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "该邮箱已注册")
			return
		}
		writeError(w, http.StatusInternalServerError, "注册失败")
		return
	}

	token, expiresAt, err := a.issueToken(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成令牌失败")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"token":      token,
		"expires_at": expiresAt,
		"user": map[string]any{
			"id":       id,
			"email":    req.Email,
			"username": nullString(req.Username),
		},
	})
}

// --- 登录 ---

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	var acc Account
	err := a.db.QueryRowContext(r.Context(),
		`SELECT id, email, password_hash, username, avatar_url, created_at, updated_at
		 FROM public.accounts WHERE email = $1`,
		req.Email,
	).Scan(&acc.ID, &acc.Email, &acc.PasswordHash, &acc.Username, &acc.AvatarURL, &acc.CreatedAt, &acc.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "邮箱或密码不正确")
			return
		}
		writeError(w, http.StatusInternalServerError, "查询账户失败")
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(acc.PasswordHash), []byte(req.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "邮箱或密码不正确")
		return
	}

	token, expiresAt, err := a.issueToken(acc.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成令牌失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"expires_at": expiresAt,
		"user": map[string]any{
			"id":         acc.ID,
			"email":      acc.Email,
			"username":   acc.Username,
			"avatar_url": acc.AvatarURL,
		},
	})
}

func (a *App) handleLogout(w http.ResponseWriter, _ *http.Request) {
	// JWT 无状态：前端删除本地令牌即可。预留端点便于未来加黑名单。
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- 用户资料 ---

func (a *App) handleMe(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())

	var acc Account
	err := a.db.QueryRowContext(r.Context(),
		`SELECT id, email, username, avatar_url, created_at, updated_at
		 FROM public.accounts WHERE id = $1`,
		userID,
	).Scan(&acc.ID, &acc.Email, &acc.Username, &acc.AvatarURL, &acc.CreatedAt, &acc.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "账户不存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "查询账户失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":         acc.ID,
			"email":      acc.Email,
			"username":   acc.Username,
			"avatar_url": acc.AvatarURL,
			"created_at": acc.CreatedAt,
		},
	})
}

type updateMeRequest struct {
	Username  *string `json:"username"`
	AvatarURL *string `json:"avatar_url"`
}

func (a *App) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())

	var req updateMeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	if req.Username != nil {
		*req.Username = strings.TrimSpace(*req.Username)
	}

	_, err := a.db.ExecContext(r.Context(),
		`UPDATE public.accounts
		 SET username = COALESCE($2, username),
		     avatar_url = COALESCE($3, avatar_url)
		 WHERE id = $1`,
		userID, nullStringOrNil(req.Username), nullStringOrNil(req.AvatarURL),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新资料失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- 用户设置（云同步载体） ---

func (a *App) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())

	var settings json.RawMessage
	err := a.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(settings, '{}'::jsonb) FROM public.user_settings WHERE account_id = $1`,
		userID,
	).Scan(&settings)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusOK, map[string]any{"settings": map[string]any{}})
			return
		}
		writeError(w, http.StatusInternalServerError, "查询设置失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

type putSettingsRequest struct {
	Settings json.RawMessage `json:"settings"`
}

func (a *App) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())

	var req putSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if len(req.Settings) == 0 || string(req.Settings) == "null" {
		req.Settings = json.RawMessage(`{}`)
	}

	_, err := a.db.ExecContext(r.Context(),
		`INSERT INTO public.user_settings (account_id, settings)
		 VALUES ($1, $2::jsonb)
		 ON CONFLICT (account_id)
		 DO UPDATE SET settings = EXCLUDED.settings`,
		userID, string(req.Settings),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "保存设置失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}