package model

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

// withTextEnabled temporarily enables detailed log text recording and restores
// the original setting afterwards.
func withTextEnabled(t *testing.T, maxLen int) {
	t.Helper()
	prevEnabled := common.DetailedLogTextEnabled
	prevMax := common.DetailedLogMaxTextLength
	common.DetailedLogTextEnabled = true
	common.DetailedLogMaxTextLength = maxLen
	t.Cleanup(func() {
		common.DetailedLogTextEnabled = prevEnabled
		common.DetailedLogMaxTextLength = prevMax
	})
}

func TestTruncateDetailedLogText_NoTruncation(t *testing.T) {
	withTextEnabled(t, 65535)
	in := "hello world"
	if got := truncateDetailedLogText(in); got != in {
		t.Fatalf("expected unchanged input, got %q", got)
	}
}

func TestTruncateDetailedLogText_DisabledReturnsEmpty(t *testing.T) {
	common.DetailedLogTextEnabled = false
	if got := truncateDetailedLogText("anything"); got != "" {
		t.Fatalf("expected empty when disabled, got %q", got)
	}
}

func TestTruncateDetailedLogText_ASCII(t *testing.T) {
	// 100 bytes, maxLength 50, marker 13 bytes -> cut at 37.
	withTextEnabled(t, 50)
	in := strings.Repeat("a", 100)
	got := truncateDetailedLogText(in)
	if len(got) != 50 {
		t.Fatalf("expected length 50, got %d", len(got))
	}
	if !strings.HasSuffix(got, "...(truncated)") {
		t.Fatalf("expected marker suffix, got %q", got)
	}
}

func TestTruncateDetailedLogText_MultibyteDoesNotSplitRune(t *testing.T) {
	// Repeat a 3-byte rune (…) so any byte cut is likely mid-rune.
	// We want to assert: (1) result is valid UTF-8, (2) ends with marker,
	// (3) the byte just before the marker is a rune boundary (no orphan lead).
	rune3 := "…" // U+2026, 3 bytes: E2 80 A6
	withTextEnabled(t, 50)
	in := strings.Repeat(rune3, 100) // 300 bytes
	got := truncateDetailedLogText(in)

	if !utf8.ValidString(got) {
		t.Fatalf("truncated result is not valid UTF-8: %q", got)
	}
	if !strings.HasSuffix(got, "...(truncated)") {
		t.Fatalf("expected marker suffix, got %q", got)
	}
	// The byte immediately before the marker must be the last byte of a full rune.
	cut := got[:len(got)-len("...(truncated)")]
	if cut != "" {
		tail := cut[len(cut)-1]
		// Last byte of a UTF-8 string must NOT be a lead byte that expects
		// continuation bytes it doesn't have. A full rune ends on a
		// continuation byte (for multi-byte) or an ASCII byte; either way
		// decoding the final rune must succeed.
		_, size := utf8.DecodeLastRuneInString(cut)
		if size == 0 {
			t.Fatalf("could not decode last rune of cut: %q", cut)
		}
		_ = tail
	}
}

func TestTruncateDetailedLogText_4ByteEmoji(t *testing.T) {
	// 4-byte emoji (😀 = F0 9F 98 80) — verify truncation never leaves
	// a 1-3 byte fragment of it.
	emoji := "😀"
	withTextEnabled(t, 30)
	in := strings.Repeat(emoji, 50) // 200 bytes
	got := truncateDetailedLogText(in)
	if !utf8.ValidString(got) {
		t.Fatalf("truncated emoji result is not valid UTF-8: %q", got)
	}
}

func TestTruncateDetailedLogText_TinyMaxLength(t *testing.T) {
	// maxLength smaller than the marker: should still return valid UTF-8.
	withTextEnabled(t, 5)
	in := strings.Repeat("…", 20) // 60 bytes
	got := truncateDetailedLogText(in)
	if !utf8.ValidString(got) {
		t.Fatalf("tiny-max result is not valid UTF-8: %q", got)
	}
	if len(got) > 5 {
		t.Fatalf("result exceeds maxLength: %d", len(got))
	}
}
