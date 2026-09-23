package nodes

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type SignInput struct {
	Method   string
	Path     string
	Body     []byte
	ClientID string
	Secret   string
	Now      time.Time
	Nonce    string
}

type SignedHeaders struct {
	ClientID   string
	Timestamp  string
	Nonce      string
	BodySHA256 string
	Signature  string
}

type SignHashInput struct {
	Method     string
	Path       string
	BodySHA256 string
	ClientID   string
	Secret     string
	Now        time.Time
	Nonce      string
}

func Sign(input SignInput) (SignedHeaders, error) {
	if strings.TrimSpace(input.Method) == "" {
		return SignedHeaders{}, fmt.Errorf("method is required")
	}
	if strings.TrimSpace(input.Path) == "" {
		return SignedHeaders{}, fmt.Errorf("path is required")
	}
	if strings.TrimSpace(input.ClientID) == "" {
		return SignedHeaders{}, fmt.Errorf("client id is required")
	}
	if strings.TrimSpace(input.Secret) == "" {
		return SignedHeaders{}, fmt.Errorf("secret is required")
	}
	if strings.TrimSpace(input.Nonce) == "" {
		return SignedHeaders{}, fmt.Errorf("nonce is required")
	}

	bodyHash := sha256Hex(input.Body)
	return SignWithBodyHash(SignHashInput{
		Method:     input.Method,
		Path:       input.Path,
		BodySHA256: bodyHash,
		ClientID:   input.ClientID,
		Secret:     input.Secret,
		Now:        input.Now,
		Nonce:      input.Nonce,
	})
}

func SignWithBodyHash(input SignHashInput) (SignedHeaders, error) {
	if strings.TrimSpace(input.Method) == "" {
		return SignedHeaders{}, fmt.Errorf("method is required")
	}
	if strings.TrimSpace(input.Path) == "" {
		return SignedHeaders{}, fmt.Errorf("path is required")
	}
	if strings.TrimSpace(input.ClientID) == "" {
		return SignedHeaders{}, fmt.Errorf("client id is required")
	}
	if strings.TrimSpace(input.Secret) == "" {
		return SignedHeaders{}, fmt.Errorf("secret is required")
	}
	if strings.TrimSpace(input.Nonce) == "" {
		return SignedHeaders{}, fmt.Errorf("nonce is required")
	}
	bodyHash := strings.TrimSpace(strings.ToLower(input.BodySHA256))
	if bodyHash == "" {
		bodyHash = sha256Hex(nil)
	}
	timestamp := strconv.FormatInt(input.Now.UTC().Unix(), 10)
	payload := strings.ToUpper(input.Method) + "\n" +
		input.Path + "\n" +
		timestamp + "\n" +
		input.Nonce + "\n" +
		bodyHash

	signature := hmacSHA256Hex(input.Secret, payload)
	return SignedHeaders{
		ClientID:   input.ClientID,
		Timestamp:  timestamp,
		Nonce:      input.Nonce,
		BodySHA256: bodyHash,
		Signature:  signature,
	}, nil
}

func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func hmacSHA256Hex(secret, payload string) string {
	m := hmac.New(sha256.New, []byte(secret))
	_, _ = m.Write([]byte(payload))
	return hex.EncodeToString(m.Sum(nil))
}
