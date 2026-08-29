package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
)

// middleware.go：CORS、日志、请求上下文工具

type contextKey string

const userIDKey contextKey = "userID"

func withUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, userIDKey, id)
}

func userIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}

// corsMiddleware 允许前端（Vite dev 服务器）跨域调用 Go API。
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := origin == "http://localhost:1430" || origin == "http://127.0.0.1:1430"
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s (%s)", r.Method, r.URL.Path, r.RemoteAddr, time.Since(start))
	})
}

// --- SQL 辅助 ---

// nullString 返回可空字符串（空串 -> NULL）。
func nullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// nullStringOrNil 返回指针或 nil（用于 COALESCE 语义）。
func nullStringOrNil(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

func isUniqueViolation(err error) bool {
	var pqErr interface{ Code() string }
	if errors.As(err, &pqErr) {
		return pqErr.Code() == "23505"
	}
	return false
}

var _ = sql.ErrNoRows