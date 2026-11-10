package domain

import (
	"fmt"
	"regexp"
)

var impersonationPattern = regexp.MustCompile(`^(auto|(chrome|edge|safari|firefox|tor)(-[0-9][a-z0-9.]*)?(:(windows|macos|linux|android|ios)(-[0-9][a-z0-9.]*)?)?)$`)

func ValidateImpersonation(value string) error {
	if value != "" && (len(value) > 80 || !impersonationPattern.MatchString(value)) {
		return fmt.Errorf("invalid yt-dlp impersonation profile")
	}
	return nil
}

type NodeMediaCapabilities struct {
	ImpersonationSupported bool     `json:"impersonationSupported"`
	ImpersonationTargets   []string `json:"impersonationTargets"`
	DiagnosticsSupported   bool     `json:"diagnosticsSupported"`
}
type NodeDiagnosticRequest struct {
	Mode        string `json:"mode"`
	URL         string `json:"url,omitempty"`
	Impersonate string `json:"impersonate,omitempty"`
	Verbose     bool   `json:"verbose,omitempty"`
}
type NodeDiagnosticResult struct {
	Command        []string `json:"command"`
	ExitCode       int      `json:"exitCode"`
	Stdout         string   `json:"stdout"`
	Stderr         string   `json:"stderr"`
	Truncated      bool     `json:"truncated"`
	TimedOut       bool     `json:"timedOut"`
	DurationMillis int64    `json:"durationMillis"`
}
