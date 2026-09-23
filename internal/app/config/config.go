package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	HTTP      HTTPConfig
	SQLite    SQLiteConfig
	Scheduler SchedulerConfig
	Nodes     NodesConfig
}

type HTTPConfig struct {
	ListenAddr string
}

type SQLiteConfig struct {
	Path          string
	BusyTimeoutMS int
}

type SchedulerConfig struct {
	PollInterval time.Duration
}

type NodesConfig struct {
	DefaultRequestTimeout time.Duration
}

type rawConfig struct {
	HTTP struct {
		ListenAddr string `yaml:"listen_addr"`
	} `yaml:"http"`
	Server struct {
		Listen string `yaml:"listen"`
	} `yaml:"server"`
	Database struct {
		Path          string `yaml:"path"`
		BusyTimeoutMS int    `yaml:"busy_timeout_ms"`
	} `yaml:"database"`
	SQLite struct {
		Path          string `yaml:"path"`
		BusyTimeoutMS int    `yaml:"busy_timeout_ms"`
	} `yaml:"sqlite"`
	Scheduler struct {
		PollInterval string `yaml:"poll_interval"`
	} `yaml:"scheduler"`
	Nodes struct {
		DefaultRequestTimeout string `yaml:"default_request_timeout"`
	} `yaml:"nodes"`
}

func Load(path string) (Config, error) {
	raw := defaultRawConfig()

	if path != "" {
		content, err := os.ReadFile(path)
		if err != nil {
			return Config{}, fmt.Errorf("read config file %q: %w", path, err)
		}
		if err := yaml.Unmarshal(content, &raw); err != nil {
			return Config{}, fmt.Errorf("parse config file %q: %w", path, err)
		}
	}

	applyEnvOverrides(&raw)

	cfg, err := normalize(raw)
	if err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func defaultRawConfig() rawConfig {
	var raw rawConfig
	raw.HTTP.ListenAddr = "127.0.0.1:18080"
	raw.Database.Path = "./router.db"
	raw.Database.BusyTimeoutMS = 5000
	raw.Scheduler.PollInterval = "10s"
	raw.Nodes.DefaultRequestTimeout = "5s"
	return raw
}

func applyEnvOverrides(raw *rawConfig) {
	if v := os.Getenv("ROUTERD_HTTP_LISTEN_ADDR"); v != "" {
		raw.HTTP.ListenAddr = v
	}
	if v := os.Getenv("ROUTERD_SQLITE_PATH"); v != "" {
		raw.SQLite.Path = v
	}
	if v := os.Getenv("ROUTERD_SQLITE_BUSY_TIMEOUT_MS"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			raw.SQLite.BusyTimeoutMS = parsed
		}
	}
	if v := os.Getenv("ROUTERD_SCHEDULER_POLL_INTERVAL"); v != "" {
		raw.Scheduler.PollInterval = v
	}
	if v := os.Getenv("ROUTERD_NODES_DEFAULT_REQUEST_TIMEOUT"); v != "" {
		raw.Nodes.DefaultRequestTimeout = v
	}
}

func normalize(raw rawConfig) (Config, error) {
	listenAddr := firstNonEmpty(raw.HTTP.ListenAddr, raw.Server.Listen)
	sqlitePath := firstNonEmpty(raw.SQLite.Path, raw.Database.Path)
	busyTimeout := firstPositive(raw.SQLite.BusyTimeoutMS, raw.Database.BusyTimeoutMS)

	if strings.TrimSpace(listenAddr) == "" {
		return Config{}, fmt.Errorf("http listen address is required")
	}
	if strings.TrimSpace(sqlitePath) == "" {
		return Config{}, fmt.Errorf("sqlite path is required")
	}
	if busyTimeout <= 0 {
		return Config{}, fmt.Errorf("sqlite busy timeout must be > 0")
	}

	pollInterval, err := parseDuration(raw.Scheduler.PollInterval, "scheduler.poll_interval")
	if err != nil {
		return Config{}, err
	}
	nodeRequestTimeout, err := parseDuration(raw.Nodes.DefaultRequestTimeout, "nodes.default_request_timeout")
	if err != nil {
		return Config{}, err
	}

	return Config{
		HTTP: HTTPConfig{ListenAddr: listenAddr},
		SQLite: SQLiteConfig{
			Path:          sqlitePath,
			BusyTimeoutMS: busyTimeout,
		},
		Scheduler: SchedulerConfig{PollInterval: pollInterval},
		Nodes: NodesConfig{
			DefaultRequestTimeout: nodeRequestTimeout,
		},
	}, nil
}

func parseDuration(raw, field string) (time.Duration, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, fmt.Errorf("%s is required", field)
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", field, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be > 0", field)
	}
	return d, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func firstPositive(values ...int) int {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}
