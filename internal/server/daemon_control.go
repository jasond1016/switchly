package server

type DaemonInfo struct {
	PID               int    `json:"pid"`
	Addr              string `json:"addr"`
	PublicBaseURL     string `json:"public_base_url"`
	RestartSupported  bool   `json:"restart_supported"`
	DefaultRestartCmd string `json:"default_restart_cmd,omitempty"`
}

type DaemonController interface {
	Info() DaemonInfo
	Shutdown() error
	Restart(startCmd string) error
}
