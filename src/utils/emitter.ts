import { EventEmitter } from 'events';

export const appEmitter = new EventEmitter();

// Event names
export const EVENTS = {
  LEADERBOARD_UPDATE: 'leaderboard:update',
  ANNOUNCEMENT_PUBLISHED: 'announcement:published',
};
