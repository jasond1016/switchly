package quota

import "testing"

func TestParseThreadIDFromExecOutput(t *testing.T) {
	output := []byte(`{"type":"thread.started","thread_id":"019c7624-d865-7022-96e8-688be982e162"}` + "\n" +
		`{"type":"turn.started"}` + "\n")
	got := parseThreadIDFromExecOutput(output)
	if got != "019c7624-d865-7022-96e8-688be982e162" {
		t.Fatalf("unexpected thread id: %s", got)
	}
}

func TestParseThreadIDFromExecOutputMissing(t *testing.T) {
	output := []byte(`{"type":"turn.started"}` + "\n" + `non-json` + "\n")
	got := parseThreadIDFromExecOutput(output)
	if got != "" {
		t.Fatalf("expected empty thread id, got %s", got)
	}
}
