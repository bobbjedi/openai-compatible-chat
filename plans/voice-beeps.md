# Sound Beeps for Step Voice Mode

## Requirements

Add audio cues (beeps) for state transitions so the user knows what's happening without looking at the screen.

### Beeps

| Trigger | Sound | Meaning |
|---------|-------|---------|
| Microphone starts listening | High-pitch short beep (1100Hz, 0.1s) | "You can speak now" |
| Message sent / Thinking starts | Low-pitch beep (440Hz, 0.2s) | "Processing your request" |

### Where to add

1. **`src/services/stepVoiceService.ts`** — add beep generator and call it at state transitions
   - `startListening()` / `doSend` after TTS → high beep (mic ready)
   - `doSend` right after `speechRecognition.stop()` → low beep (thinking)

2. **No changes to UI** — beeps are audio-only, no visual elements

## Implementation Plan

### `src/services/stepVoiceService.ts`

Add beep generator function:

```typescript
function playBeep(freq = 880, duration = 0.15) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // AudioContext not available
  }
}
```

Call at:

1. **`startListening()`** (line ~165) — when mic turns on:
   ```typescript
   playBeep(1100, 0.1);
   ```

2. **`doSend()`** (line ~105) — after `speechRecognition.stop()`:
   ```typescript
   playBeep(440, 0.2);
   ```

3. **`doSend()`** (line ~135) — after TTS, before restarting mic:
   ```typescript
   playBeep(1100, 0.1);
   ```

## Files to modify

| File | Changes |
|------|---------|
| `src/services/stepVoiceService.ts` | Add `playBeep()` function + 3 beep calls |

## Files to create

None.
