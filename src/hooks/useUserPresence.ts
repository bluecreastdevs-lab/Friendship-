import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { UserStatus } from '../types';

interface UseUserPresenceProps {
  socket: Socket | null;
  roomId: string;
  enabled?: boolean;
}

export function useUserPresence({ socket, roomId, enabled = true }: UseUserPresenceProps) {
  const [currentStatus, setCurrentStatus] = useState<UserStatus>('online');
  const [manualOverride, setManualOverride] = useState<UserStatus | null>(null);
  const [statusReason, setStatusReason] = useState<string>('Active in lounge');

  // References to preserve state across listeners without re-binding
  const manualOverrideRef = useRef<UserStatus | null>(null);
  manualOverrideRef.current = manualOverride;

  const currentStatusRef = useRef<UserStatus>('online');
  currentStatusRef.current = currentStatus;

  const tabSwitchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tabHiddenAtRef = useRef<number | null>(null);

  // Emit status change to server
  const emitStatus = useCallback(
    (status: UserStatus, reason: string, hiddenAt?: number) => {
      if (!socket || !roomId) return;
      setCurrentStatus(status);
      setStatusReason(reason);

      socket.emit('user-status-change', {
        roomId,
        status,
        statusReason: reason,
        tabHiddenAt: hiddenAt
      });
    },
    [socket, roomId]
  );

  // Manual status override function (e.g. user toggles Busy or Away manually)
  const setStatus = useCallback(
    (status: UserStatus | 'auto') => {
      if (tabSwitchTimerRef.current) clearTimeout(tabSwitchTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      if (status === 'auto') {
        setManualOverride(null);
        manualOverrideRef.current = null;
        if (document.hidden) {
          const now = Date.now();
          tabHiddenAtRef.current = now;
          emitStatus('away', 'Switched tab', now);
        } else {
          tabHiddenAtRef.current = null;
          emitStatus('online', 'Active in lounge');
        }
        return;
      }

      setManualOverride(status);
      manualOverrideRef.current = status;
      let reason = 'Set by user';
      if (status === 'busy') reason = 'Do Not Disturb / Busy';
      else if (status === 'away') reason = 'Away from screen';
      else if (status === 'online') reason = 'Active in lounge';

      emitStatus(status, reason, status === 'away' ? Date.now() : undefined);
    },
    [emitStatus]
  );

  useEffect(() => {
    if (!enabled || !socket || !roomId) return;

    // --- 1. Visibility Change API Handling ---
    // Timing: When user switches tabs, document.hidden becomes true.
    // We apply a precise 3-second grace debounce so rapid tab flickers don't cause jitter,
    // while accurately recording the exact tab-switch timestamp when the user leaves!
    const handleVisibilityChange = () => {
      if (manualOverrideRef.current !== null) {
        // If user explicitly set their status (e.g. 'busy'), don't override with auto-visibility
        return;
      }

      if (document.hidden) {
        const switchTimestamp = Date.now();
        tabHiddenAtRef.current = switchTimestamp;

        if (tabSwitchTimerRef.current) clearTimeout(tabSwitchTimerRef.current);

        // 3-second grace period for tab switch detection
        tabSwitchTimerRef.current = setTimeout(() => {
          if (document.hidden && manualOverrideRef.current === null) {
            emitStatus('away', 'Switched tab', switchTimestamp);
          }
        }, 3000);
      } else {
        // User returned to tab
        if (tabSwitchTimerRef.current) {
          clearTimeout(tabSwitchTimerRef.current);
          tabSwitchTimerRef.current = null;
        }
        tabHiddenAtRef.current = null;

        if (currentStatusRef.current !== 'online' && manualOverrideRef.current === null) {
          emitStatus('online', 'Active in lounge');
        }
      }
    };

    // --- 2. Inactivity / Idle Timer (60s idle threshold) ---
    const resetIdleTimer = () => {
      if (manualOverrideRef.current !== null) return;

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      // If user was marked away due to idle, return them to online on interaction
      if (!document.hidden && currentStatusRef.current === 'away' && statusReason.startsWith('Idle')) {
        emitStatus('online', 'Active in lounge');
      }

      // 60 seconds of no interaction marks user as away
      idleTimerRef.current = setTimeout(() => {
        if (!document.hidden && manualOverrideRef.current === null && currentStatusRef.current === 'online') {
          emitStatus('away', 'Idle (1m+)', Date.now());
        }
      }, 60000);
    };

    // Activity listeners
    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    activityEvents.forEach((event) => {
      window.addEventListener(event, resetIdleTimer, { passive: true });
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('blur', handleVisibilityChange);

    // Initial check
    if (document.hidden) {
      handleVisibilityChange();
    } else {
      emitStatus('online', 'Active in lounge');
      resetIdleTimer();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('blur', handleVisibilityChange);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, resetIdleTimer);
      });
      if (tabSwitchTimerRef.current) clearTimeout(tabSwitchTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [enabled, socket, roomId, emitStatus]);

  return {
    currentStatus,
    manualOverride,
    statusReason,
    setStatus
  };
}
