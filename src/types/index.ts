// This file bridges Kanel-generated types to the rest of the application.
// The database is the single source of truth; run "bun run db:generate" to regenerate these.
export type { default as Database } from "./generated/Database";
export type { default as UserTable, User, NewUser, UserUpdate, UserId } from "./generated/public/User";
export type { default as PlatformAdminTable, PlatformAdmin, NewPlatformAdmin, PlatformAdminUpdate, PlatformAdminId } from "./generated/public/PlatformAdmin";
export type { default as DeckTable, Deck, NewDeck, DeckUpdate, DeckId } from "./generated/public/Deck";
export type { default as SrsCardTable, SrsCard, NewSrsCard, SrsCardUpdate, SrsCardId } from "./generated/public/SrsCard";
export type { default as GrammarPointTable, GrammarPoint, NewGrammarPoint, GrammarPointUpdate, GrammarPointId } from "./generated/public/GrammarPoint";
export type { default as UserPreferenceTable, UserPreference, NewUserPreference, UserPreferenceUpdate } from "./generated/public/UserPreference";
