import React from 'react';

// Shared by the session settings tabs (NewSessionModal holds the state).

export type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

/** Whether there is a vault to save into, and whether it is open. */
export type VaultState = 'unknown' | 'none' | 'locked' | 'ready';

/** Logging for this session: as in Settings > Logging, always or never. */
export type AutoLog = 'global' | 'always' | 'never';
