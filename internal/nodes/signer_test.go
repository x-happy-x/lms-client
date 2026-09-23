package nodes

import (
	"testing"
	"time"
)

func TestSignDeterministicVector(t *testing.T) {
	t.Parallel()

	in := SignInput{
		Method:   "POST",
		Path:     "/api/jobs",
		Body:     []byte(`{"type":"DIRECT","url":"https://example.com/file.bin"}`),
		ClientID: "router-main",
		Secret:   "change-me",
		Now:      time.Unix(1_700_000_000, 0).UTC(),
		Nonce:    "nonce-123",
	}

	h, err := Sign(in)
	if err != nil {
		t.Fatalf("sign failed: %v", err)
	}

	if h.Timestamp != "1700000000" {
		t.Fatalf("unexpected timestamp: %s", h.Timestamp)
	}
	if h.BodySHA256 != "08fec0387d9e1bed27223e841e0416ce220b971c8abb2330a82e668e4329b466" {
		t.Fatalf("unexpected body sha: %s", h.BodySHA256)
	}
	if h.Signature != "d89e74c5ef281b7bf145cd25d9dbeb712790f9dd76d7666ca17394c131f312fc" {
		t.Fatalf("unexpected signature: %s", h.Signature)
	}
}
