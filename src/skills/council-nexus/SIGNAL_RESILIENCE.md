# Skill: Signal Resilience & Grace Buffering
*Domain: Reliability Engineering & UX Stability*

## 1. The Sensitivity Problem
In cloud-bridged systems (Tunnels), network packets will drop. If the UI reacts to a single dropped packet, the dashboard will flicker "Offline," causing user anxiety and breaking the mental model of a stable connection.

## 2. The Grace Period Solution
Implement a **Failure Threshold** instead of a boolean "isOnline" check.
- **Logic**: Maintain a `consecutiveFailures` counter.
- **Buffer**: Do not declare "OFFLINE" until N failures (e.g., 6 attempts / 12 seconds).
- **Interim State**: Transition to a `RE-SYNCING` state (Yellow) during the buffer period. This maintains the current data on-screen while the tunnel auto-heals.

## 3. Relentless Polling
Never use `clearInterval()` on a network error. 
- **Rule**: If a fetch fails, log the failure and wait for the next tick. 
- **Benefit**: This allows the system to "catch" the signal the millisecond the local tunnel manager (Iron Link) finishes a restart, creating a "Self-Healing" UI.

## 4. Visual Heartbeat (Uplink LED)
Always provide a low-level "Pulse" indicator (LED) separate from the main data cards.
- **Green**: 0 failures.
- **Blinking Yellow**: Within Grace Period.
- **Red**: Threshold exceeded.
