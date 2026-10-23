import type { Visibility } from '../backend/types';

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: 'Only me',
  team: 'Whole team',
  scheduled: 'Team, from a date',
  blind: 'Blind until revealed',
};

export const VISIBILITY_HELP: Record<Visibility, string> = {
  private: 'Nobody else can fetch this tier, not even admins.',
  team: 'Every member of the team sees it now.',
  scheduled: 'Hidden from the others until the date you choose.',
  blind: 'Hidden until an admin reveals blind tiers for this recording, so annotators work independently.',
};
