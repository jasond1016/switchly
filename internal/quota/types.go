package quota

import (
	"math"
	"time"
)

type Window struct {
	UsedPercent int
	ResetAt     time.Time
}

type Snapshot struct {
	Session         *Window
	Weekly          *Window
	SourceTimestamp time.Time
	LimitReached    bool
}

type rawWindow struct {
	UsedPercent float64 `json:"used_percent"`
	ResetsAt    int64   `json:"resets_at"`
}

func toWindow(raw *rawWindow) *Window {
	if raw == nil {
		return nil
	}
	win := &Window{
		UsedPercent: clampUsedPercent(raw.UsedPercent),
	}
	if raw.ResetsAt > 0 {
		win.ResetAt = time.Unix(raw.ResetsAt, 0).UTC()
	}
	return win
}

func clampUsedPercent(value float64) int {
	v := int(math.Round(value))
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
